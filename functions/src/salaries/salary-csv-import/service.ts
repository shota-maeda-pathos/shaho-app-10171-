import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { SalaryCsvImportInput } from './schema';

function sumValues(map: Record<string, number>): number {
  return Object.values(map).reduce((a, b) => a + b, 0);
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importSalaryCsv(
  input: SalaryCsvImportInput,
  auth: AuthContext,
): Promise<ImportResult> {
  const base = `companies/${auth.companyId}`;

  const empSnap = await db.collection(`${base}/employees`)
    .where('deletedAt', '==', null)
    .where('isActive', '==', true)
    .get();

  const empByNumber = new Map<string, { id: string; doc: EmployeeDoc }>();
  for (const doc of empSnap.docs) {
    const data = doc.data() as EmployeeDoc;
    empByNumber.set(data.employeeNumber, { id: doc.id, doc: data });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < input.csvRows.length; i += 10) {
    const batch = input.csvRows.slice(i, i + 10);

    await db.runTransaction(async (tx) => {
      for (const row of batch) {
        const emp = empByNumber.get(row.employeeNumber);
        if (!emp) {
          errors.push(`${row.employeeNumber}: 従業員が見つかりません`);
          skipped++;
          continue;
        }

        if (!auth.roles.includes('admin')) {
          try {
            requireOffice(auth, emp.doc.officeId);
          } catch {
            errors.push(`${row.employeeNumber}: アクセス権限がありません`);
            skipped++;
            continue;
          }
        }

        const salaryRef = db.doc(`${base}/employees/${emp.id}/salaries/${input.yearMonth}`);
        const existing = await tx.get(salaryRef);
        if (existing.exists) {
          errors.push(`${row.employeeNumber} (${emp.doc.lastName}${emp.doc.firstName}): ${input.yearMonth}のデータが既に存在します`);
          skipped++;
          continue;
        }

        const fixed = row.fixedAllowances ?? {};
        const variable = row.variableAllowances ?? {};
        const totalFixedWage = row.baseSalary + sumValues(fixed);
        const totalVariableWage = sumValues(variable);
        const totalSalary = totalFixedWage + totalVariableWage;

        const now = Timestamp.now();
        tx.set(salaryRef, {
          yearMonth: input.yearMonth,
          officeId: emp.doc.officeId,
          paymentBasisDays: row.paymentBasisDays,
          baseSalary: row.baseSalary,
          fixedAllowances: fixed,
          variableAllowances: variable,
          totalFixedWage,
          totalVariableWage,
          totalSalary,
          isConfirmed: false,
          confirmedAt: null,
          confirmedBy: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });

        const auditRef = db.collection(`${base}/auditLogs`).doc();
        tx.set(auditRef, {
          entity: 'salary',
          entityId: `${emp.id}/${input.yearMonth}`,
          action: 'create',
          changes: { source: { from: null, to: 'csvImport' } },
          performedBy: auth.uid,
          performedAt: now,
          version: 1,
        });

        imported++;
      }
    });
  }

  return { success: true, imported, skipped, errors };
}
