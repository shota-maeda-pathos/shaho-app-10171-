import { db } from '../../config';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { PremiumExemptionCreateInput } from './schema';

export interface PremiumExemptionCreateResponse {
  id: string;
}

export async function createPremiumExemption(
  input: PremiumExemptionCreateInput,
  auth: AuthContext,
): Promise<PremiumExemptionCreateResponse> {
  const empRef = db.doc(
    `companies/${auth.companyId}/employees/${input.employeeId}`,
  );
  const empSnap = await empRef.get();
  if (!empSnap.exists || empSnap.data()?.deletedAt !== null) {
    const { HttpsError } = await import('firebase-functions/v2/https');
    throw new HttpsError('not-found', '従業員が見つかりません');
  }

  requireOffice(auth, empSnap.data()!.officeId);

  if (input.leaveId) {
    const leave = await db.doc(`companies/${auth.companyId}/employees/${input.employeeId}/leaves/${input.leaveId}`).get();
    if (!leave.exists || leave.data()?.status === 'cancelled') {
      const { HttpsError } = await import('firebase-functions/v2/https');
      throw new HttpsError('invalid-argument', '関連する休業が見つからないか、取り消されています');
    }
  }

  const ref = db.collection(
    `companies/${auth.companyId}/employees/${input.employeeId}/premiumExemptions`,
  ).doc();

  await ref.set({
    exemptionType: input.exemptionType,
    startMonth: input.startMonth,
    endMonth: input.endMonth ?? null,
    leaveId: input.leaveId ?? null,
    status: 'active',
    approvedAt: input.approvedDate ? Timestamp.fromDate(new Date(input.approvedDate)) : null,
    isMonthlyExempted: input.isMonthlyExempted ?? true,
    isBonusExempted: input.isBonusExempted ?? false,
    notes: input.notes ?? '',
    createdBy: auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    version: 1,
  });

  return { id: ref.id };
}
