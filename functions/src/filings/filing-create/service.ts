import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { MutationResponse } from '../../types/response';
import { notFound } from '../../utils/errors';
import { FilingCreateInput } from './schema';

export async function createFiling(
  input: FilingCreateInput,
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

    const now = Timestamp.now();
    const filingRef = db
      .collection(
        `companies/${auth.companyId}/employees/${input.employeeId}/filings`,
      )
      .doc();

    tx.set(filingRef, {
      filingType: input.filingType,
      workflowStatus: 'draft',
      mockStatus: 'notStarted',
      submissionStatus: 'notSubmitted',
      effectiveDate: input.effectiveDate,
      formData: input.formData,
      submittedAt: null,
      resultReceivedAt: null,
      resultNote: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'filing',
      entityId: filingRef.id,
      action: 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return filingRef.id;
  });

  return { success: true, id: result };
}
