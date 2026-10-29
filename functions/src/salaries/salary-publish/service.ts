import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { SalaryPublishInput } from './schema';

export async function publishSalaries(
  input: SalaryPublishInput,
  auth: AuthContext,
): Promise<{ success: boolean; published: number; errors: string[] }> {
  let published = 0;
  const errors: string[] = [];
  const base = `companies/${auth.companyId}`;

  for (let i = 0; i < input.employeeIds.length; i += 10) {
    const batch = input.employeeIds.slice(i, i + 10);

    await db.runTransaction(async (tx) => {
      for (const employeeId of batch) {
        const salaryRef = db.doc(`${base}/employees/${employeeId}/salaries/${input.yearMonth}`);
        const snap = await tx.get(salaryRef);

        if (!snap.exists) {
          errors.push(`${employeeId}: 給与データなし`);
          continue;
        }

        const data = snap.data()!;
        if (!data.isConfirmed) {
          errors.push(`${employeeId}: 未承認のため公開不可`);
          continue;
        }

        if (data.isPublished) continue;

        const now = Timestamp.now();
        tx.update(salaryRef, {
          isPublished: true,
          publishedAt: now,
          publishedBy: auth.uid,
          updatedAt: now,
        });
        published++;
      }
    });
  }

  return { success: true, published, errors };
}
