import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { FilingRecordResultInput } from './schema';

export interface FilingRecordResultResponse {
  success: true;
  id: string;
}

export async function recordFilingResult(
  input: FilingRecordResultInput,
  auth: AuthContext,
): Promise<FilingRecordResultResponse> {
  const filingRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}/filings/${input.filingId}`,
  );

  await db.runTransaction(async (tx) => {
    const filingSnap = await tx.get(filingRef);
    if (!filingSnap.exists) {
      throw new HttpsError('not-found', '届出が見つかりません');
    }

    const data = filingSnap.data()!;

    if (data.version !== input.expectedVersion) {
      throw new HttpsError(
        'failed-precondition',
        `データが更新されています（現在のバージョン: ${data.version}）`,
      );
    }

    if (data.submissionStatus !== 'submitted') {
      throw new HttpsError('failed-precondition', '提出済みの届出のみ結果を記録できます');
    }

    const now = Timestamp.now();
    tx.update(filingRef, {
      submissionStatus: input.result,
      resultReceivedAt: now,
      resultNote: input.note ?? null,
      updatedAt: now,
      version: data.version + 1,
    });

    const auditRef = db.collection(`companies/${auth.companyId}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'filing' as const,
      entityId: input.filingId,
      action: 'update' as const,
      changes: {
        submissionStatus: { from: 'submitted', to: input.result },
      },
      performedBy: auth.uid,
      performedAt: now,
      version: data.version + 1,
    });
  });

  const { refreshEmployeeProcedures } = await import('../../procedures/hooks');
  await refreshEmployeeProcedures(auth.companyId, input.employeeId);

  return { success: true, id: input.filingId };
}
