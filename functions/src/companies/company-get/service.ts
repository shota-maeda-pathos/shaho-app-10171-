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
  allowedGoogleDomains: string[];
  /** 届出を委託している社会保険労務士（届出の社労士欄に書く）。委託していなければ null */
  laborConsultant: { name: string; registrationNumber: string } | null;
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
    allowedGoogleDomains: d.allowedGoogleDomains ?? [],
    laborConsultant: d.laborConsultant?.name ? { name: d.laborConsultant.name, registrationNumber: d.laborConsultant.registrationNumber ?? '' } : null,
    version: d.version ?? 1,
  };
}
