import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { MutationResponse } from '../../types/response';
import { invalidArg } from '../../utils/errors';
import { CollectionCreateInput } from './schema';

export async function createCollection(
  input: CollectionCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const base = `companies/${auth.companyId}`;
  if(input.officeId) requireOffice(auth,input.officeId);
  else if(!auth.roles.includes('admin')) throw invalidArg('対象事業所を選択してください');
  const collectionType = input.collectionType ?? 'monthly';
  const docId = `${collectionType}-${input.yearMonth}${input.officeId ? `-${input.officeId}` : ''}`;
  const ref = db.doc(`${base}/insuranceCollections/${docId}`);

  const result = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      throw invalidArg('この年月・種別の徴収記録は既に存在します');
    }

    // 対象従業員の保険料集計
    const insuranceCollection = collectionType === 'monthly' ? 'monthlyInsurance' : 'bonusInsurance';
    const empSnap = await db
      .collection(`${base}/employees`)
      .where('deletedAt', '==', null)
      .get();

    let totalEmployeeAmount = 0;
    let totalEmployerAmount = 0;
    let employeeCount = 0;
    const details: Array<{
      employeeId: string;
      employeeName: string;
      employeeAmount: number;
      employerAmount: number;
      isConfirmed: boolean;
    }> = [];

    for (const empDoc of empSnap.docs) {
      const emp = empDoc.data();
      if (input.officeId && emp.officeId !== input.officeId) continue;
      if(!auth.roles.includes('admin')&&!auth.officeIds.includes(emp.officeId)) continue;

      const insRef = db.doc(`${base}/employees/${empDoc.id}/${insuranceCollection}/${input.yearMonth}`);
      const insSnap = await tx.get(insRef);
      if (!insSnap.exists) continue;

      const ins = insSnap.data()!;
      if(ins.isConfirmed!==true) throw invalidArg('未承認の保険料があります。承認後に徴収記録を作成してください');
      if(input.yearMonth>='2026-04'&&!ins.childSupportPayment) throw invalidArg('支援金を含む保険料の再計算・承認を確認してください');
      details.push({
        employeeId: empDoc.id,
        employeeName: `${emp.lastName} ${emp.firstName}`,
        employeeAmount: ins.totalEmployeeAmount ?? 0,
        employerAmount: ins.totalEmployerAmount ?? 0,
        isConfirmed: ins.isConfirmed === true,
      });

      totalEmployeeAmount += ins.totalEmployeeAmount ?? 0;
      totalEmployerAmount += ins.totalEmployerAmount ?? 0;
      employeeCount++;
    }

    if(!employeeCount) throw invalidArg('対象の承認済み保険料がありません');
    const now = Timestamp.now();
    tx.set(ref, {
      yearMonth: input.yearMonth,
      collectionType,
      officeId: input.officeId ?? null,
      status: 'draft',
      totalEmployeeAmount,
      totalEmployerAmount,
      totalAmount: totalEmployeeAmount + totalEmployerAmount,
      employeeCount,
      details,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
      version: 1,
      createdBy: auth.uid,
      createdAt: now,
      updatedAt: now,
    });

    return docId;
  });

  return { success: true, id: result };
}
