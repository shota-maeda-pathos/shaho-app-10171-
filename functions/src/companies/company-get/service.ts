import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';

export interface CompanyResponse {
  id: string;
  name: string;
  corporateNumber: string;
  representativeName: string;
  address: string;
  phone: string;
  email: string;
  healthInsurerId: string;
  pensionCode: string;
  version: number;
}

export async function getCompany(
  companyId: string,
  _auth: AuthContext,
): Promise<CompanyResponse> {
  const snap = await db.doc(`companies/${companyId}`).get();
  const d = snap.data() ?? {};
  return {
    id: companyId,
    name: d.name ?? '',
    corporateNumber: d.corporateNumber ?? '',
    representativeName: d.representativeName ?? '',
    address: d.address ?? '',
    phone: d.phone ?? '',
    email: d.email ?? '',
    healthInsurerId: d.healthInsurerId ?? '',
    pensionCode: d.pensionCode ?? '',
    version: d.version ?? 1,
  };
}
