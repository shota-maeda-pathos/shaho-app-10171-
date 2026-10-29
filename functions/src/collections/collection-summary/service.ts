import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { CollectionSummaryInput } from './schema';

interface EmployeePremiumRow {
  officeId:string;
  collectedAmount:number|null;
  collectionVersion:number;
  employeeId: string;
  employeeName: string;
  healthEmployee: number;
  healthEmployer: number;
  longTermCareEmployee: number;
  longTermCareEmployer: number;
  pensionEmployee: number;
  pensionEmployer: number;
  childSupportEmployer: number;
  totalEmployee: number;
  totalEmployer: number;
  isConfirmed: boolean;
  isExempted: boolean;
}

export interface CollectionSummaryResponse {
  yearMonth: string;
  officeId: string | null;
  rows: EmployeePremiumRow[];
  totals: {
    healthEmployee: number;
    healthEmployer: number;
    longTermCareEmployee: number;
    longTermCareEmployer: number;
    pensionEmployee: number;
    pensionEmployer: number;
    childSupportEmployer: number;
    totalEmployee: number;
    totalEmployer: number;
    grandTotal: number;
  };
  employeeCount: number;
}

export async function getCollectionSummary(
  input: CollectionSummaryInput,
  auth: AuthContext,
): Promise<CollectionSummaryResponse> {
  if(input.officeId) requireOffice(auth,input.officeId);
  const base = `companies/${auth.companyId}`;

  const empSnap = await db
    .collection(`${base}/employees`)
    .where('deletedAt', '==', null)
    .where('isActive', '==', true)
    .orderBy('employeeNumber', 'asc')
    .get();

  const rows: EmployeePremiumRow[] = [];
  const totals = {
    healthEmployee: 0, healthEmployer: 0,
    longTermCareEmployee: 0, longTermCareEmployer: 0,
    pensionEmployee: 0, pensionEmployer: 0,
    childSupportEmployer: 0,
    totalEmployee: 0, totalEmployer: 0, grandTotal: 0,
  };

  for (const empDoc of empSnap.docs) {
    const emp = empDoc.data();
    if (input.officeId && emp.officeId !== input.officeId) continue;
    if (!auth.roles.includes('admin')) {
      try { requireOffice(auth, emp.officeId); } catch { continue; }
    }

    const insSnap = await db
      .doc(`${base}/employees/${empDoc.id}/monthlyInsurance/${input.yearMonth}`)
      .get();

    if (!insSnap.exists) continue;
    const ins = insSnap.data()!;
    const receipt=await db.doc(`${base}/employees/${empDoc.id}/collectionReceipts/${input.yearMonth}`).get();

    const row: EmployeePremiumRow = {
      officeId:emp.officeId,
      collectedAmount:typeof receipt.data()?.collectedAmount==='number'?receipt.data()!.collectedAmount:null,
      collectionVersion:receipt.data()?.version??0,
      employeeId: empDoc.id,
      employeeName: `${emp.lastName} ${emp.firstName}`,
      healthEmployee: ins.healthInsurance?.employeeAmount ?? 0,
      healthEmployer: ins.healthInsurance?.employerAmount ?? 0,
      longTermCareEmployee: ins.longTermCareInsurance?.employeeAmount ?? 0,
      longTermCareEmployer: ins.longTermCareInsurance?.employerAmount ?? 0,
      pensionEmployee: ins.pensionInsurance?.employeeAmount ?? 0,
      pensionEmployer: ins.pensionInsurance?.employerAmount ?? 0,
      childSupportEmployer: ins.childSupportContribution?.employerAmount ?? 0,
      totalEmployee: ins.totalEmployeeAmount ?? 0,
      totalEmployer: ins.totalEmployerAmount ?? 0,
      isConfirmed: ins.isConfirmed === true,
      isExempted: ins.isExempted === true,
    };
    rows.push(row);

    totals.healthEmployee += row.healthEmployee;
    totals.healthEmployer += row.healthEmployer;
    totals.longTermCareEmployee += row.longTermCareEmployee;
    totals.longTermCareEmployer += row.longTermCareEmployer;
    totals.pensionEmployee += row.pensionEmployee;
    totals.pensionEmployer += row.pensionEmployer;
    totals.childSupportEmployer += row.childSupportEmployer;
    totals.totalEmployee += row.totalEmployee;
    totals.totalEmployer += row.totalEmployer;
  }

  totals.grandTotal = totals.totalEmployee + totals.totalEmployer;

  return {
    yearMonth: input.yearMonth,
    officeId: input.officeId ?? null,
    rows,
    totals,
    employeeCount: rows.length,
  };
}
