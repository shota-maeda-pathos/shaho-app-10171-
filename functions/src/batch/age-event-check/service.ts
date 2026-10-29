import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { ageAtEndOfMonth } from '../../utils/age';

export interface AgeEvent {
  employeeId: string;
  employeeName: string;
  birthDate: string;
  age: number;
  eventType: 'longTermCareStart' | 'longTermCareEnd' | 'pensionExclusion' | 'healthExclusion';
  description: string;
}

export interface AgeEventCheckResponse {
  yearMonth: string;
  events: AgeEvent[];
}

const AGE_MILESTONES: { age: number; type: AgeEvent['eventType']; description: string }[] = [
  { age: 40, type: 'longTermCareStart', description: '介護保険第2号被保険者の対象になります' },
  { age: 65, type: 'longTermCareEnd', description: '介護保険第1号被保険者に移行します（給与天引き終了）' },
  { age: 70, type: 'pensionExclusion', description: '厚生年金被保険者資格を喪失します（70歳以上被用者届が必要）' },
  { age: 75, type: 'healthExclusion', description: '後期高齢者医療制度に移行します（健康保険資格喪失届が必要）' },
];

export async function checkAgeEvents(
  auth: AuthContext,
  targetYearMonth?: string,
): Promise<AgeEventCheckResponse> {
  const now = new Date();
  const ym = targetYearMonth ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const base = `companies/${auth.companyId}`;

  const empSnap = await db
    .collection(`${base}/employees`)
    .where('deletedAt', '==', null)
    .where('isActive', '==', true)
    .get();

  const events: AgeEvent[] = [];

  for (const doc of empSnap.docs) {
    const emp = doc.data() as EmployeeDoc;
    if (!auth.roles.includes('admin') && !auth.officeIds.includes(emp.officeId)) continue;
    if (!emp.birthDate) continue;

    const age = ageAtEndOfMonth(emp.birthDate, ym);

    for (const milestone of AGE_MILESTONES) {
      if (age === milestone.age) {
        // 前月の年齢と比較して、この月に到達したか確認
        const [y, m] = ym.split('-').map(Number);
        const prevDate = new Date(y, m - 2, 1);
        const prevYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        const prevAge = ageAtEndOfMonth(emp.birthDate, prevYm);

        if (prevAge < milestone.age) {
          events.push({
            employeeId: doc.id,
            employeeName: `${emp.lastName} ${emp.firstName}`,
            birthDate: emp.birthDate.toDate().toISOString().slice(0, 10),
            age: milestone.age,
            eventType: milestone.type,
            description: milestone.description,
          });
        }
      }
    }
  }

  events.sort((a, b) => a.age - b.age || a.employeeName.localeCompare(b.employeeName));
  return { yearMonth: ym, events };
}
