import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice, requireRole } from '../../middleware/auth';
import { invalidArg, notFound } from '../../utils/errors';
import { BonusGetInput, BonusUpdateInput } from './schema';
export async function getBonus(input: BonusGetInput, auth: AuthContext) {
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  const base = `companies/${auth.companyId}/employees/${input.employeeId}`;
  return db.runTransaction(async tx => {
    const employee = await tx.get(db.doc(base));
    if (!employee.exists || employee.data()!.deletedAt !== null) throw notFound('従業員');
    requireOffice(auth, employee.data()!.officeId);
    const bonus = await tx.get(db.doc(`${base}/bonuses/${input.yearMonth}`));
    const insurance = await tx.get(db.doc(`${base}/bonusInsurance/${input.yearMonth}`));
    const b = bonus.data(), i = insurance.data();
    return {
      bonus: b ? { yearMonth: b.yearMonth, totalAmount: b.totalAmount, standardBonusAmount: b.standardBonusAmount,
        cumulativeBonusAmount: b.cumulativeBonusAmount, version: b.version, isConfirmed: b.isConfirmed === true, approvalPending: b.approvalPending === true } : null,
      insurance: i ? { yearMonth: i.yearMonth, version: i.version, bonusVersion: i.bonusVersion ?? null,
        healthCappedAmount: i.healthCappedAmount, pensionCappedAmount: i.pensionCappedAmount,
        healthEmployee: i.healthInsurance?.employeeAmount ?? null, pensionEmployee: i.pensionInsurance?.employeeAmount ?? null,
        longTermCareEmployee: i.longTermCareInsurance === null ? 0 : i.longTermCareInsurance?.employeeAmount ?? null,
        childSupportEmployer: i.childSupportContribution?.employerAmount ?? null,
        totalEmployee: i.totalEmployeeAmount, totalEmployer: i.totalEmployerAmount,
        isExempted: i.isExempted === true, isConfirmed: i.isConfirmed === true, approvalPending: i.approvalPending === true } : null,
    };
  });
}
export async function updateBonus(input: BonusUpdateInput, auth: AuthContext) {
  requireRole(auth, 'admin', 'operator');
  const base = `companies/${auth.companyId}/employees/${input.employeeId}`;
  const fingerprint = JSON.stringify({ kind: 'bonusUpdate', employeeId: input.employeeId, yearMonth: input.yearMonth,
    totalAmount: input.totalAmount, cumulativeBonusAmount: input.cumulativeBonusAmount, expectedVersion: input.expectedVersion });
  return db.runTransaction(async tx => {
    const employee = await tx.get(db.doc(base));
    if (!employee.exists || employee.data()!.deletedAt !== null) throw notFound('従業員');
    requireOffice(auth, employee.data()!.officeId);
    const receipt = db.doc(`companies/${auth.companyId}/employeeRequests/${input.requestId}`);
    const previous = await tx.get(receipt);
    if (previous.exists) {
      if (previous.data()!.fingerprint !== fingerprint) throw invalidArg('同じrequestIdで異なる更新はできません');
      return previous.data()!.result;
    }
    const ref = db.doc(`${base}/bonuses/${input.yearMonth}`);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw notFound('賞与');
    const data = snapshot.data()!;
    if (data.version !== input.expectedVersion) throw new HttpsError('aborted', '賞与が更新されました。再読み込みしてください');
    if (data.isConfirmed || data.approvalPending) throw invalidArg('承認済み・申請中の賞与は変更できません');
    const now = Timestamp.now();
    const result = { success: true, id: input.yearMonth, version: data.version + 1 };
    tx.update(ref, { totalAmount: input.totalAmount, standardBonusAmount: Math.floor(input.totalAmount / 1000) * 1000,
      cumulativeBonusAmount: input.cumulativeBonusAmount, version: result.version, updatedAt: now });
    tx.set(receipt, { fingerprint, result, createdAt: now });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), { entity: 'bonus', entityId: input.yearMonth, action: 'update',
      changes: { totalAmount: { from: data.totalAmount, to: input.totalAmount }, cumulativeBonusAmount: { from: data.cumulativeBonusAmount, to: input.cumulativeBonusAmount } },
      performedBy: auth.uid, performedAt: now, version: result.version });
    return result;
  });
}
