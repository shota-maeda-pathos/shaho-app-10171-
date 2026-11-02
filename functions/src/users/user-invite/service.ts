import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { MutationResponse } from '../../types/response';
import { invalidArg } from '../../utils/errors';
import { UserInviteInput } from './schema';

const INVITATION_EXPIRY_DAYS = 7;
const OFFICE_ROLES = ['operator', 'approver', 'viewer'];

/**
 * 招待の中身を確かめる。担当者・承認者・閲覧者（管理者でない人）は担当事業所が要る（ないと何も見えない）。
 * 従業員（本人）は従業員につなぐ必要があるので、従業員の画面の「本人ポータル」から招待する
 */
export function inviteProblem(input: Pick<UserInviteInput, 'roles' | 'officeIds' | 'employeeId'>): string | null {
  if (input.roles.includes('employee') && !input.employeeId) {
    return '従業員（本人）は、従業員の画面の「本人ポータル」から招待してください（従業員の記録につなぐため）';
  }
  if (!input.roles.includes('admin') && input.roles.some(r => OFFICE_ROLES.includes(r)) && !(input.officeIds ?? []).length) {
    return '担当事業所を選んでください（担当者・承認者・閲覧者は、担当事業所のデータだけを扱います）';
  }
  return null;
}

export async function inviteUser(
  input: UserInviteInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const problem = inviteProblem(input);
  if (problem) throw invalidArg(problem);
  const officeIds = [...new Set(input.officeIds ?? [])];
  if (officeIds.length) {
    const offices = await db.getAll(...officeIds.map(id => db.doc(`companies/${auth.companyId}/offices/${id}`)));
    const missing = offices.find(o => !o.exists || o.data()?.abolishedOn);
    if (missing) throw invalidArg(`担当事業所が見つからないか、廃止されています（${missing.id}）`);
  }

  const result = await db.runTransaction(async (tx) => {
    const existingUsersSnap = await db
      .collection(`companies/${auth.companyId}/users`)
      .where('email', '==', input.email)
      .limit(1)
      .get();

    if (!existingUsersSnap.empty) {
      throw invalidArg('このメールアドレスは既に登録されています');
    }

    const pendingInvitesSnap = await db
      .collection(`companies/${auth.companyId}/invitations`)
      .where('email', '==', input.email)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!pendingInvitesSnap.empty) {
      throw invalidArg('このメールアドレスには既に招待が送信されています');
    }

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(
      now.toMillis() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    const inviteRef = db
      .collection(`companies/${auth.companyId}/invitations`)
      .doc();

    tx.set(inviteRef, {
      email: input.email,
      displayName: input.displayName,
      roles: input.roles,
      officeIds,
      employeeId: input.employeeId ?? null,
      status: 'pending',
      invitedBy: auth.uid,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'invitation',
      entityId: inviteRef.id,
      action: 'invite',
      changes: { email: input.email, displayName: input.displayName, roles: input.roles, officeIds },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return inviteRef.id;
  });

  return { success: true, id: result };
}
