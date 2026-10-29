import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { MutationResponse } from '../../types/response';
import { OfficeCreateInput } from './schema';

export async function createOffice(
  input: OfficeCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const ref = db.collection(`companies/${auth.companyId}/offices`).doc();

  await ref.set({
    name: input.name,
    officeNumber: input.officeNumber ?? '',
    prefectureCode: input.prefectureCode ?? '',
    insurerId: input.insurerId ?? '',
    address: input.address ?? '',
    phone: input.phone ?? '',
    closingDay: input.closingDay ?? 25,
    paymentDay: input.paymentDay ?? 25,
    paymentMonth: input.paymentMonth ?? 'next',
    deductionMethod: input.deductionMethod ?? 'current',
    roundingRule: input.roundingRule ?? 'truncate',
    isActive: true,
    version: 1,
    createdAt: Timestamp.now(),
    createdBy: auth.uid,
    updatedAt: Timestamp.now(),
  });

  return { success: true, id: ref.id };
}
