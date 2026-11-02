import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { todayJst } from '../../procedures/wizard';
import { invalidArg, notFound } from '../../utils/errors';
import { absenceErrors, EmploymentStatusKind, STATUS_LABELS, statusNote, statusOn, StatusPeriod, statusPeriods } from './rules';
import { AbsenceSaveInput, EmployeeStatusGetInput } from './schema';

/** 従業員の期間の一覧（退職日・休業・休職の記録から） */
export async function periodsOf(companyId: string, employeeId: string, resignationDate?: unknown): Promise<StatusPeriod[]> {
  const base = `companies/${companyId}/employees/${employeeId}`;
  const [leaves, absences] = await Promise.all([db.collection(`${base}/leaves`).get(), db.collection(`${base}/absences`).get()]);
  return statusPeriods({
    resignationDate,
    leaves: leaves.docs.map(d => ({ id: d.id, data: d.data() })),
    absences: absences.docs.map(d => ({ id: d.id, data: d.data() })),
  });
}

/** 今日の在籍ステータス（一覧で使う） */
export async function currentStatusOf(companyId: string, employeeId: string, resignationDate?: unknown): Promise<EmploymentStatusKind> {
  return statusOn(await periodsOf(companyId, employeeId, resignationDate), todayJst()).kind;
}

async function employeeOf(companyId: string, employeeId: string, auth: AuthContext) {
  const snap = await db.doc(`companies/${companyId}/employees/${employeeId}`).get();
  if (!snap.exists || snap.data()!.deletedAt != null) throw notFound('従業員');
  requireOffice(auth, snap.data()!.officeId);
  return snap;
}

/** 在籍ステータス：今の状態・説明・日付つきの履歴 */
export async function getEmployeeStatus(input: EmployeeStatusGetInput, auth: AuthContext) {
  const emp = await employeeOf(auth.companyId, input.employeeId, auth);
  const periods = await periodsOf(auth.companyId, input.employeeId, emp.data()!.resignationDate);
  const today = todayJst();
  const { kind, period } = statusOn(periods, today);
  return {
    today, kind, label: STATUS_LABELS[kind], note: statusNote(kind), since: period?.start ?? null, until: period?.end ?? null,
    history: periods.map(p => ({ ...p, label: STATUS_LABELS[p.kind] })),
  };
}

/** 休職の記録を足す・直す・消す（傷病休職・私傷病）。産休・育休・介護休業は休業の手続きで記録する */
export async function saveAbsence(input: AbsenceSaveInput, auth: AuthContext) {
  if (!auth.roles.some(r => r === 'admin' || r === 'operator')) throw invalidArg('休職を記録できるのは管理者・担当者です');
  const emp = await employeeOf(auth.companyId, input.employeeId, auth);
  const col = db.collection(`companies/${auth.companyId}/employees/${input.employeeId}/absences`);
  const now = Timestamp.now();
  if (input.action === 'delete') {
    if (!input.absenceId) throw invalidArg('消す記録を指定してください');
    const ref = col.doc(input.absenceId);
    const snap = await ref.get();
    if (!snap.exists) throw notFound('休職の記録');
    await ref.update({ deletedAt: now, updatedAt: now });
    await db.collection(`companies/${auth.companyId}/auditLogs`).add({
      entity: 'absence', entityId: ref.id, action: 'delete', changes: { startDate: { from: snap.data()!.startDate, to: null } },
      employeeId: input.employeeId, performedBy: auth.uid, performedAt: now, version: (snap.data()!.version ?? 1) + 1,
    });
    return { success: true };
  }
  if (!input.startDate || !input.reason) throw invalidArg('休職の理由と開始日を入れてください');
  const periods = (await periodsOf(auth.companyId, input.employeeId, emp.data()!.resignationDate)).filter(p => p.id !== input.absenceId);
  const errors = absenceErrors({ startDate: input.startDate, endDate: input.endDate ?? null }, periods);
  if (errors.length) throw invalidArg(errors.join('。'));
  const ref = input.absenceId ? col.doc(input.absenceId) : col.doc();
  const before = input.absenceId ? (await ref.get()).data() : undefined;
  if (input.absenceId && !before) throw notFound('休職の記録');
  const data = {
    kind: 'sickLeave', reason: input.reason, startDate: input.startDate, endDate: input.endDate ?? null, note: input.note?.trim() || null,
    updatedAt: now, updatedBy: auth.uid, version: ((before?.version as number | undefined) ?? 0) + 1, deletedAt: null,
    ...(before ? {} : { createdAt: now, createdBy: auth.uid }),
  };
  await ref.set(data, { merge: true });
  await db.collection(`companies/${auth.companyId}/auditLogs`).add({
    entity: 'absence', entityId: ref.id, action: before ? 'update' : 'create',
    changes: { period: { from: before ? `${before.startDate}〜${before.endDate ?? ''}` : null, to: `${input.startDate}〜${input.endDate ?? ''}` } },
    employeeId: input.employeeId, performedBy: auth.uid, performedAt: now, version: data.version,
  });
  return { success: true, absenceId: ref.id };
}
