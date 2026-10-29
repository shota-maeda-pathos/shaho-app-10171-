import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, FilingDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound, invalidArg } from '../../utils/errors';
import { FilingSubmitInput } from './schema';

export async function submitFiling(
  input: FilingSubmitInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );

  const result = await db.runTransaction(async (tx) => {
    const empSnap = await tx.get(empRef);
    if (!empSnap.exists || empSnap.data()!.deletedAt !== null) {
      throw notFound('従業員');
    }
    const employee = empSnap.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) {
      requireOffice(auth, employee.officeId);
    }

    const filingRef = db.doc(
      `companies/${auth.companyId}/employees/${input.employeeId}/filings/${input.filingId}`,
    );
    const filingSnap = await tx.get(filingRef);
    if (!filingSnap.exists) {
      throw notFound('届出');
    }

    const filing = filingSnap.data()! as FilingDoc;
    if (filing.version !== input.expectedVersion) {
      throw invalidArg(
        `版番号が一致しません（現行: ${filing.version}, 指定: ${input.expectedVersion}）`,
      );
    }

    if (filing.workflowStatus !== 'approved') {
      throw invalidArg('社内承認が完了していない届出は提出できません');
    }

    if (filing.submissionStatus !== 'notSubmitted') {
      throw invalidArg(`この届出は既に提出済みです（状態: ${filing.submissionStatus}）`);
    }

    const now = Timestamp.now();

    tx.update(filingRef, {
      submissionStatus: 'submitted',
      submittedAt: now,
      version: filing.version + 1,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'filing',
      entityId: input.filingId,
      action: 'update',
      changes: {
        submissionStatus: { from: 'notSubmitted', to: 'submitted' },
      },
      performedBy: auth.uid,
      performedAt: now,
      version: filing.version + 1,
    });

    return input.filingId;
  });

  const { refreshEmployeeProcedures } = await import('../../procedures/hooks');
  await refreshEmployeeProcedures(auth.companyId, input.employeeId);

  return { success: true, id: result };
}
