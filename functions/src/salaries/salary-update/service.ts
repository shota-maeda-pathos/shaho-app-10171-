import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, SalaryDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { invalidArg, notFound } from '../../utils/errors';
import { SalaryUpdateInput } from './schema';

function sumValues(map: Record<string, number>): number {
  return Object.values(map).reduce((a, b) => a + b, 0);
}

export async function updateSalary(
  input: SalaryUpdateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  if(input.isConfirmed!==undefined) throw invalidArg('給与の承認・差戻しは承認画面から行ってください');
  const salaryRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}/salaries/${input.salaryId}`,
  );

  await db.runTransaction(async (tx) => {
    const empRef = db.doc(
      `companies/${auth.companyId}/employees/${input.employeeId}`,
    );
    const empDoc = await tx.get(empRef);
    if (!empDoc.exists || empDoc.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const employee = empDoc.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, employee.officeId);
    }

    const salaryDoc = await tx.get(salaryRef);
    if (!salaryDoc.exists) {
      throw notFound('給与データ');
    }
    const current = salaryDoc.data()! as SalaryDoc;

    if (current.isConfirmed || salaryDoc.data()!.approvalPending===true) {
      throw invalidArg('承認済みの給与データは直接編集できません');
    }

    if (current.version !== input.expectedVersion) {
      throw new HttpsError(
        'failed-precondition',
        `データが更新されています（現在のバージョン: ${current.version}）`,
      );
    }

    const now = Timestamp.now();
    const baseSalary = input.baseSalary ?? current.baseSalary;
    const fixed = input.fixedAllowances ?? current.fixedAllowances;
    const variable = input.variableAllowances ?? current.variableAllowances;
    const totalFixedWage = baseSalary + sumValues(fixed);
    const totalVariableWage = sumValues(variable);
    const totalSalary = totalFixedWage + totalVariableWage;

    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (input.paymentBasisDays !== undefined && input.paymentBasisDays !== current.paymentBasisDays) {
      changes.paymentBasisDays = { from: current.paymentBasisDays, to: input.paymentBasisDays };
    }
    if (input.baseSalary !== undefined && input.baseSalary !== current.baseSalary) {
      changes.baseSalary = { from: current.baseSalary, to: input.baseSalary };
    }
    if (input.fixedAllowances !== undefined) {
      changes.fixedAllowances = { from: current.fixedAllowances, to: input.fixedAllowances };
    }
    if (input.variableAllowances !== undefined) {
      changes.variableAllowances = { from: current.variableAllowances, to: input.variableAllowances };
    }

    // 随時改定の自動検知: 固定的賃金（基本給＋固定手当）が変動した場合フラグを立てる
    const prevFixed = current.totalFixedWage;
    const fixedChanged = prevFixed !== totalFixedWage;
    const revisionFlag = fixedChanged && !current.revisionFlag;

    const updateData: Record<string, unknown> = {
      paymentBasisDays: input.paymentBasisDays ?? current.paymentBasisDays,
      baseSalary,
      fixedAllowances: fixed,
      variableAllowances: variable,
      totalFixedWage,
      totalVariableWage,
      totalSalary,
      updatedAt: now,
      version: current.version + 1,
    };
    if (input.inKindAmount !== undefined) updateData.inKindAmount = input.inKindAmount;
    if (input.retroactivePay !== undefined) updateData.retroactivePay = input.retroactivePay;
    if (revisionFlag) {
      updateData.revisionFlag = true;
      updateData.revisionDetectedAt = now;
      updateData.previousTotalFixedWage = prevFixed;
    }
    tx.update(salaryRef, updateData);

    if (Object.keys(changes).length > 0) {
      const auditRef = db
        .collection(`companies/${auth.companyId}/auditLogs`)
        .doc();
      tx.set(auditRef, {
        entity: 'salary',
        entityId: input.salaryId,
        action: 'update',
        changes,
        performedBy: auth.uid,
        performedAt: now,
        version: current.version + 1,
      });
    }
  });

  return { success: true, id: input.salaryId };
}
