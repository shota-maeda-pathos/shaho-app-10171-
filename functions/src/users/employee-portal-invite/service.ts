import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, InvitationDoc } from '../../types/firestore';
import { invalidArg, notFound } from '../../utils/errors';
import { EmployeePortalInviteInput, EmployeePortalStatusInput } from './schema';

const INVITATION_EXPIRY_DAYS = 7;

/**
 * 本人ポータルの状態。active＝アカウントがあり従業員につながっている、invited＝受け取られていない招待がある、none＝どちらもない。
 * active の access は今日の時点（full＝使える、readonly＝退職などで閲覧のみ、disabled＝ログインが止まっている）。
 * readonlyFrom・loginStopsFrom は退職で決まった日（YYYY-MM-DD、先の日付なら予定）。none の email は台帳のメール（招待の欄の初期値）
 */
export type EmployeePortalStatus =
  | { state: 'active'; email: string | null; access: 'full' | 'readonly' | 'disabled'; readonlyFrom: string | null; loginStopsFrom: string | null }
  | { state: 'invited'; invitationId: string; email: string; expiresAt: string }
  | { state: 'none'; email: string | null; canInvite: boolean };

const base = (companyId: string) => `companies/${companyId}`;

/** 招待できない理由（退職・削除）。招待できるなら null */
function inviteBlocker(e: EmployeeDoc): string | null {
  if (!e.isActive || e.resignationDate) return '退職した従業員は本人ポータルに招待できません';
  return null;
}

async function loadEmployee(companyId: string, employeeId: string, auth: AuthContext): Promise<EmployeeDoc> {
  const snap = await db.doc(`${base(companyId)}/employees/${employeeId}`).get();
  if (!snap.exists || snap.data()!.deletedAt) throw notFound('従業員');
  const employee = snap.data() as EmployeeDoc;
  requireOffice(auth, employee.officeId);
  return employee;
}

export async function getEmployeePortalStatus(input: EmployeePortalStatusInput, auth: AuthContext): Promise<EmployeePortalStatus> {
  const employee = await loadEmployee(input.companyId, input.employeeId, auth);
  if (employee.userId) {
    const user = (await db.doc(`${base(input.companyId)}/users/${employee.userId}`).get()).data() ?? {};
    // 日付は東京の今日で比べる（middleware/auth.ts と同じ）
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const date = (v: unknown) => (typeof v === 'string' ? v : null);
    const readonlyFrom = date(user.suspendFrom), loginStopsFrom = date(user.loginDisabledFrom);
    const access = user.isLoginDisabled || (loginStopsFrom !== null && loginStopsFrom <= today) ? 'disabled'
      : user.isSuspended || (readonlyFrom !== null && readonlyFrom <= today) ? 'readonly' : 'full';
    return { state: 'active', email: date(user.email), access, readonlyFrom, loginStopsFrom };
  }
  const invites = await db.collection(`${base(input.companyId)}/invitations`)
    .where('employeeId', '==', input.employeeId).where('status', '==', 'pending').get();
  const live = invites.docs.find(d => (d.data() as InvitationDoc).expiresAt.toMillis() > Date.now());
  if (live) {
    const inv = live.data() as InvitationDoc;
    return { state: 'invited', invitationId: live.id, email: inv.email, expiresAt: inv.expiresAt.toDate().toISOString() };
  }
  return { state: 'none', email: employee.email ?? null, canInvite: inviteBlocker(employee) === null };
}

/**
 * 従業員を本人ポータルに招待する（ロールは従業員だけ、担当事業所はその人の事業所、従業員につなぐ）。
 * 受け取られていない有効な招待があればそれを返す（replace のときは無効にして作り直す）。期限切れの招待は expired にしてから作り直す
 */
export async function inviteEmployeeToPortal(
  input: EmployeePortalInviteInput,
  auth: AuthContext,
): Promise<{ success: true; id: string; email: string; expiresAt: string; reused: boolean }> {
  const employeeRef = db.doc(`${base(input.companyId)}/employees/${input.employeeId}`);
  const invitations = db.collection(`${base(input.companyId)}/invitations`);
  return db.runTransaction(async (tx) => {
    const employeeSnap = await tx.get(employeeRef);
    if (!employeeSnap.exists || employeeSnap.data()!.deletedAt) throw notFound('従業員');
    const employee = employeeSnap.data() as EmployeeDoc;
    requireOffice(auth, employee.officeId);
    if (employee.userId) throw new HttpsError('failed-precondition', 'この従業員はすでに本人ポータルを使えます');
    const blocker = inviteBlocker(employee);
    if (blocker) throw new HttpsError('failed-precondition', blocker);

    const [forEmployee, forEmail, users] = await Promise.all([
      tx.get(invitations.where('employeeId', '==', input.employeeId).where('status', '==', 'pending')),
      tx.get(invitations.where('email', '==', input.email).where('status', '==', 'pending')),
      tx.get(db.collection(`${base(input.companyId)}/users`).where('email', '==', input.email).limit(1)),
    ]);
    const nowMs = Date.now();
    const isLive = (d: { data(): unknown }) => (d.data() as InvitationDoc).expiresAt.toMillis() > nowMs;

    const live = forEmployee.docs.find(isLive);
    if (live && !input.replace) {
      const inv = live.data() as InvitationDoc;
      return { success: true as const, id: live.id, email: inv.email, expiresAt: inv.expiresAt.toDate().toISOString(), reused: true };
    }
    if (!users.empty) throw invalidArg('このメールアドレスは別のアカウントで使われています');
    const own = new Set(forEmployee.docs.map(d => d.id));
    if (forEmail.docs.some(d => isLive(d) && !own.has(d.id))) throw invalidArg('このメールアドレスには別の招待が送られています');

    // この従業員あての招待（有効なものも）と、同じメールの期限切れの招待を無効にする
    const now = Timestamp.now();
    const expired = new Map([...forEmployee.docs, ...forEmail.docs].map(d => [d.id, d.ref]));
    for (const ref of expired.values()) tx.update(ref, { status: 'expired', updatedAt: now });

    const expiresAt = Timestamp.fromMillis(now.toMillis() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const inviteRef = invitations.doc();
    tx.set(inviteRef, {
      email: input.email,
      roles: ['employee'],
      officeIds: [employee.officeId],
      employeeId: input.employeeId,
      status: 'pending',
      invitedBy: auth.uid,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(db.collection(`${base(input.companyId)}/auditLogs`).doc(), {
      entity: 'invitation',
      entityId: inviteRef.id,
      action: 'invite',
      changes: { employeeId: { from: null, to: input.employeeId }, roles: { from: null, to: ['employee'] } },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });
    return { success: true as const, id: inviteRef.id, email: input.email, expiresAt: expiresAt.toDate().toISOString(), reused: false };
  });
}
