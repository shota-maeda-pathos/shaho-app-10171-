import { db } from '../../config';
import type { AuthContext } from '../../middleware/auth';
import type { OfficeDoc } from '../../types/firestore';
import type { OfficeResponse } from '../../types/response';
import { toISOString } from '../../utils/firestore';
import type { OfficeListInput } from './schema';
import { fieldIssues, officeSetupIssues } from '../lifecycle';

function toOfficeResponse(id: string, data: OfficeDoc, setupIssues: string[]): OfficeResponse {
  return {
    id,
    name: data.name,
    officeNumber: data.officeNumber ?? '',
    prefectureCode: data.prefectureCode,
    insurerId: data.insurerId,
    address: data.address,
    phone: data.phone ?? '',
    closingDay: data.closingDay,
    paymentDay: data.paymentDay,
    paymentMonth: data.paymentMonth,
    deductionMethod: data.deductionMethod,
    roundingRule: data.roundingRule,
    bonusMonths: data.bonusMonths ?? [],
    isActive: data.isActive,
    healthInsuranceType: data.healthInsuranceType === 'union' ? 'union' : 'kyokai',
    pensionOfficeName: data.pensionOfficeName ?? null,
    officeCode: data.officeCode ?? null,
    abolishedOn: data.abolishedOn ?? null,
    setupIssues,
    version: data.version ?? 1,
    createdAt: toISOString(data.createdAt),
    updatedAt: toISOString(data.updatedAt),
  };
}

export async function listOffices(
  input: OfficeListInput,
  auth: AuthContext,
): Promise<{ items: OfficeResponse[] }> {
  const collRef = db.collection(`companies/${auth.companyId}/offices`);

  let query: FirebaseFirestore.Query = collRef;

  if (!(input.includeInactive ?? false)) {
    query = query.where('isActive', '==', true);
  }

  // operator は担当事業所のみ
  if (!auth.roles.includes('admin')) {
    if (auth.officeIds.length === 0) {
      return { items: [] };
    }
    query = query.where('__name__', 'in', auth.officeIds);
  }

  const snap = await query.get();
  const items = (await Promise.all(snap.docs.map(async d => {
    const o = d.data() as OfficeDoc;
    return toOfficeResponse(d.id, o, input.withSetup ? await officeSetupIssues(auth.companyId, o) : (o.abolishedOn ? ['廃止済み'] : fieldIssues(o)));
  })))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  return { items };
}
