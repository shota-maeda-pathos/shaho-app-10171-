import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { ApprovalRequestListInput } from './schema';
import { mapConcurrent } from '../../utils/parallel';

interface ApprovalRequestListItem {
  id: string;
  employeeId: string;
  employeeName: string;
  requestType: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  targetVersion: number;
  summary: { yearMonth: string | null; totalAmount: number | null; cumulativeBonusAmount: number | null; totalEmployee: number | null; totalEmployer: number | null } | null;
}

export interface ApprovalRequestListResponse {
  items: ApprovalRequestListItem[];
}

/** 承認待ちは全件（上限あり）、処理済みは新しい順に limit 件まで返す */
const MAX_PENDING = 3000;

function summaryOf(data: FirebaseFirestore.DocumentData): ApprovalRequestListItem['summary'] {
  const snap = data.snapshotData ?? {};
  if (['bonus', 'bonusInsurance'].includes(data.requestType)) {
    return {
      yearMonth: snap.yearMonth ?? null,
      totalAmount: snap.totalAmount ?? snap.totalBonusAmount ?? null,
      cumulativeBonusAmount: snap.cumulativeBonusAmount ?? null,
      totalEmployee: snap.totalEmployeeAmount ?? null,
      totalEmployer: snap.totalEmployerAmount ?? null,
    };
  }
  // 毎月の処理の給与・保険料も、承認者が金額を見て判断できるようにする
  if (data.requestType === 'salary' || data.requestType === 'monthlyInsurance') {
    return {
      yearMonth: snap.yearMonth ?? null,
      totalAmount: data.requestType === 'salary' ? (snap.noPay ? 0 : snap.totalSalary ?? null) : null,
      cumulativeBonusAmount: null,
      totalEmployee: snap.totalEmployeeAmount ?? null,
      totalEmployer: snap.totalEmployerAmount ?? null,
    };
  }
  return null;
}

const time = (data: FirebaseFirestore.DocumentData) => data.requestedAt?.toMillis?.() ?? 0;

/**
 * 承認の一覧。承認待ちは件数で切らずに返し（毎月の処理で数百件になる）、処理済みは新しい順に limit 件まで返す。
 * 従業員ごとの申請を並行して読む。承認待ちは status の等価条件、処理済みは requestedAt の並べ替えだけなので、複合索引は要らない。
 */
export async function listApprovalRequests(
  input: ApprovalRequestListInput,
  auth: AuthContext,
): Promise<ApprovalRequestListResponse> {
  const effectiveLimit = input.limit ?? 50;
  if (input.officeId) requireOffice(auth, input.officeId);

  let empQuery: FirebaseFirestore.Query = db.collection(`companies/${auth.companyId}/employees`).where('deletedAt', '==', null);
  if (input.officeId) empQuery = empQuery.where('officeId', '==', input.officeId);
  const empSnap = await empQuery.get();
  const employees = empSnap.docs.filter(d => {
    const officeId = d.data().officeId;
    if (input.officeId && officeId !== input.officeId) return false;
    return auth.roles.includes('admin') || auth.officeIds.includes(officeId);
  });

  const perEmployee = await mapConcurrent(employees, 20, async empDoc => {
    const col = db.collection(`companies/${auth.companyId}/employees/${empDoc.id}/approvalRequests`);
    let docs: FirebaseFirestore.QueryDocumentSnapshot[];
    if (input.status || input.requestType) {
      let q: FirebaseFirestore.Query = col;
      if (input.status) q = q.where('status', '==', input.status);
      if (input.requestType) q = q.where('requestType', '==', input.requestType);
      docs = (await q.get()).docs;
    } else {
      const [pending, recent] = await Promise.all([
        col.where('status', '==', 'pending').get(),
        col.orderBy('requestedAt', 'desc').limit(effectiveLimit).get(),
      ]);
      docs = [...pending.docs, ...recent.docs];
    }
    const empData = empDoc.data();
    const seen = new Set<string>();
    return docs.filter(d => !seen.has(d.id) && seen.add(d.id)).map(d => ({ empDoc, empData, doc: d, data: d.data() }));
  });

  const all = perEmployee.flat().sort((a, b) => time(b.data) - time(a.data));
  const toItem = ({ empDoc, empData, doc, data }: typeof all[number]): ApprovalRequestListItem => ({
    id: doc.id,
    employeeId: empDoc.id,
    employeeName: `${empData.lastName} ${empData.firstName}`,
    requestType: data.requestType,
    status: data.status,
    requestedBy: data.requestedBy,
    requestedAt: data.requestedAt?.toDate?.()?.toISOString?.() ?? '',
    targetVersion: data.targetVersion,
    summary: summaryOf(data),
  });
  if (input.status === 'pending') return { items: all.slice(0, MAX_PENDING).map(toItem) };
  if (input.status || input.requestType) return { items: all.slice(0, effectiveLimit).map(toItem) };
  const pending = all.filter(x => x.data.status === 'pending').slice(0, MAX_PENDING);
  const processed = all.filter(x => x.data.status !== 'pending').slice(0, effectiveLimit);
  return { items: [...pending, ...processed].map(toItem) };
}
