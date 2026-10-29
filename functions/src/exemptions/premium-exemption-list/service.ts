import { db } from '../../config';
import { HttpsError } from 'firebase-functions/v2/https';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { PremiumExemptionListInput } from './schema';

const EXEMPTION_LABELS: Record<string, string> = {
  childcare: '育児休業免除',
  maternity: '産前産後免除',
  childcare_reduced: '育児短時間勤務免除',
};

interface PremiumExemptionListItem {
  id: string;
  employeeId: string;
  employeeName: string;
  exemptionType: string;
  exemptionTypeLabel: string;
  startMonth: string;
  endMonth: string | null;
  status: string;
  version: number;
  approvedDate: string | null;
  isMonthlyExempted: boolean;
  isBonusExempted: boolean;
}

export interface PremiumExemptionListResponse {
  items: PremiumExemptionListItem[];
  hasMore: boolean;
}

export async function listPremiumExemptions(
  input: PremiumExemptionListInput,
  auth: AuthContext,
): Promise<PremiumExemptionListResponse> {
  const effectiveLimit = input.limit ?? 20;
  const base = `companies/${auth.companyId}`;

  if (input.employeeId) {
    return listForEmployee(base, input.employeeId, input, effectiveLimit, auth);
  }

  const empSnap = await db
    .collection(`${base}/employees`)
    .where('deletedAt', '==', null)
    .where('isActive', '==', true)
    .orderBy('employeeNumber', 'asc')
    .get();

  const items: PremiumExemptionListItem[] = [];
  for (const empDoc of empSnap.docs) {
    const emp = empDoc.data();
    if (!auth.roles.includes('admin') && !auth.officeIds.includes(emp.officeId)) continue;
    let query = db
      .collection(`${base}/employees/${empDoc.id}/premiumExemptions`)
      .orderBy('startMonth', 'desc') as FirebaseFirestore.Query;

    if (input.exemptionType) query = query.where('exemptionType', '==', input.exemptionType);
    if (input.status) query = query.where('status', '==', input.status);

    const snap = await query.limit(effectiveLimit + 1).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      items.push({
        id: doc.id,
        employeeId: empDoc.id,
        employeeName: `${emp.lastName} ${emp.firstName}`,
        exemptionType: d.exemptionType,
        exemptionTypeLabel: EXEMPTION_LABELS[d.exemptionType] ?? d.exemptionType,
        startMonth: d.startMonth,
        endMonth: d.endMonth ?? null,
        status: d.status,
        version: d.version ?? 1,
        approvedDate: d.approvedAt?.toDate().toISOString().slice(0, 10) ?? null,
        isMonthlyExempted: d.isMonthlyExempted === true,
        isBonusExempted: d.isBonusExempted === true,
      });
    }
  }

  items.sort((a, b) => b.startMonth.localeCompare(a.startMonth));
  const hasMore = items.length > effectiveLimit;
  return { items: items.slice(0, effectiveLimit), hasMore };
}

async function listForEmployee(
  base: string,
  employeeId: string,
  input: PremiumExemptionListInput,
  limit: number,
  auth: AuthContext,
): Promise<PremiumExemptionListResponse> {
  const empDoc = await db.doc(`${base}/employees/${employeeId}`).get();
  if (!empDoc.exists || empDoc.data()?.deletedAt !== null) {
    throw new HttpsError('not-found', '従業員が見つかりません');
  }
  const emp = empDoc.data()!;
  requireOffice(auth, emp.officeId);

  let query = db
    .collection(`${base}/employees/${employeeId}/premiumExemptions`)
    .orderBy('startMonth', 'desc') as FirebaseFirestore.Query;

  if (input.exemptionType) query = query.where('exemptionType', '==', input.exemptionType);
  if (input.status) query = query.where('status', '==', input.status);

  if (input.lastDocId) {
    const cursor = await db
      .doc(`${base}/employees/${employeeId}/premiumExemptions/${input.lastDocId}`)
      .get();
    if (cursor.exists) query = query.startAfter(cursor);
  }

  const snap = await query.limit(limit + 1).get();
  const items = snap.docs.slice(0, limit).map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      employeeId,
      employeeName: `${emp.lastName ?? ''} ${emp.firstName ?? ''}`,
      exemptionType: d.exemptionType,
      exemptionTypeLabel: EXEMPTION_LABELS[d.exemptionType] ?? d.exemptionType,
      startMonth: d.startMonth,
      endMonth: d.endMonth ?? null,
      status: d.status,
        version: d.version ?? 1,
        approvedDate: d.approvedAt?.toDate().toISOString().slice(0, 10) ?? null,
        isMonthlyExempted: d.isMonthlyExempted === true,
        isBonusExempted: d.isBonusExempted === true,
    };
  });

  return { items, hasMore: snap.docs.length > limit };
}
