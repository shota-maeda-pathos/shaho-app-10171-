import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireRole, requireOffice } from '../../middleware/auth';
import { invalidArg, notFound } from '../../utils/errors';
import { PremiumExemptionUpdateInput } from './schema';
export async function updatePremiumExemption(input: PremiumExemptionUpdateInput, auth: AuthContext) {
  requireRole(auth, 'admin', 'operator');
  const base = `companies/${auth.companyId}/employees/${input.employeeId}`;
  const target = db.doc(`${base}/premiumExemptions/${input.exemptionId}`);
  const receipt = db.doc(`companies/${auth.companyId}/employeeRequests/${input.requestId}`);
  const fingerprint = JSON.stringify({ kind: 'premiumExemptionUpdate', employeeId: input.employeeId, id: input.exemptionId, endMonth: input.endMonth, approvedDate: input.approvedDate ?? null, version: input.expectedVersion, ...(input.isBonusExempted !== undefined ? { isBonusExempted: input.isBonusExempted } : {}) });
  return db.runTransaction(async tx => {
    const employee = await tx.get(db.doc(base));
    if (!employee.exists || employee.data()!.deletedAt !== null) throw notFound('従業員');
    requireOffice(auth, employee.data()!.officeId);
    const previous = await tx.get(receipt);
    if (previous.exists) {
      if (previous.data()!.fingerprint !== fingerprint) throw invalidArg('同じrequestIdで異なる更新はできません');
      return previous.data()!.result;
    }
    const snapshot = await tx.get(target);
    if (!snapshot.exists) throw notFound('免除');
    const data = snapshot.data()!;
    const version = data.version ?? 1;
    if (version !== input.expectedVersion) throw new HttpsError('aborted', '他の操作で免除が更新されました。再読み込みしてください');
    if (data.status !== 'active') throw invalidArg('有効な免除登録だけ変更できます');
    if (input.endMonth && input.endMonth < data.startMonth) throw invalidArg('終了月は開始月以降にしてください');
    if (input.isBonusExempted === true && !['maternity', 'childcare'].includes(data.exemptionType)) throw invalidArg('この免除種別には賞与免除を設定できません');
    const now = Timestamp.now();
    const approvedAt = input.approvedDate ? Timestamp.fromDate(new Date(input.approvedDate)) : null;
    // Keep active so historical covered months remain eligible. Bounds decide the applicable month.
    const isBonusExempted = input.isBonusExempted ?? (data.isBonusExempted === true);
    const result = { id: target.id, endMonth: input.endMonth, approvedDate: input.approvedDate ?? null, isBonusExempted, version: version + 1 };
    tx.update(target, { endMonth: input.endMonth, approvedAt, isBonusExempted, version: result.version, updatedAt: now });
    tx.set(receipt, { fingerprint, result, employeeId: input.employeeId, createdAt: now });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: 'premiumExemption', entityId: input.exemptionId, action: 'update',
      changes: { endMonth: { from: data.endMonth ?? null, to: input.endMonth }, approvedAt: { from: data.approvedAt ?? null, to: approvedAt }, isBonusExempted: { from: data.isBonusExempted === true, to: isBonusExempted } },
      performedBy: auth.uid, performedAt: now, version: result.version,
    });
    return result;
  });
}
