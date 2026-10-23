import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { alreadyExists, notFound } from '../../utils/errors';
import { BonusCreateInput } from './schema';

export async function createBonus(
  input: BonusCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  const bonusDocId = input.yearMonth;

  const result = await db.runTransaction(async (tx) => {
    const empDoc = await tx.get(empRef);
    if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const employee = empDoc.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, employee.officeId);
    }

    const bonusRef = db.doc(
      `companies/${auth.companyId}/employees/${input.employeeId}/bonuses/${bonusDocId}`,
    );
    const existing = await tx.get(bonusRef);
    if (existing.exists) {
      throw alreadyExists('この年月の賞与データ');
    }

    const now = Timestamp.now();
    tx.set(bonusRef, {
      yearMonth: input.yearMonth,
      officeId: employee.officeId,
      totalAmount: input.totalAmount,
      standardBonusAmount: input.standardBonusAmount,
      cumulativeBonusAmount: input.cumulativeBonusAmount,
      isConfirmed: false,
      confirmedAt: null,
      confirmedBy: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'bonus',
      entityId: bonusDocId,
      action: 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return bonusDocId;
  });

  return { success: true, id: result };
}
