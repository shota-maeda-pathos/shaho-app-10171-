import { db } from '../config';
import { isBonusPremiumExempt, isMonthlyPremiumExempt, LeavePeriod } from '../insurance/calculator/exemption';

type Tx = FirebaseFirestore.Transaction;

export interface ExemptionDecision {
  exempt: boolean;
  exemptionIds: string[];
}

/**
 * 承認済みの免除登録（届出承認後に反映される免除）か。
 * 産休・育休の手続きで作った免除は、申出書（filingId）が承認されていれば、免除の記録を書き換える前でも効かせる
 */
async function isApprovedActive(tx: Tx, base: string, data: FirebaseFirestore.DocumentData): Promise<boolean> {
  if (data.deletedAt != null || !['maternity', 'childcare'].includes(data.exemptionType)) return false;
  if (data.status === 'active' && data.approvedAt != null) return true;
  if (data.status !== 'pending' || !data.filingId) return false;
  const filing = await tx.get(db.doc(`${base}/filings/${data.filingId}`));
  return filing.exists && filing.data()!.workflowStatus === 'approved';
}

function leavePeriod(kind: 'maternity' | 'childcare', leave: FirebaseFirestore.DocumentData | undefined): LeavePeriod | null {
  if (!leave || leave.status === 'cancelled') return null;
  const start = leave.actualStartDate ?? leave.expectedStartDate;
  const end = leave.actualEndDate ?? leave.expectedEndDate;
  return start && end ? { kind, start, end } : null;
}

/**
 * 対象月（賞与は支給月）の保険料が免除されるか。
 * 休業の期間があれば月末・14日・1か月超の基準で判定し、休業と紐付かない旧データは登録された免除月の範囲で判定する。
 */
export async function decideExemption(
  tx: Tx,
  companyId: string,
  employeeId: string,
  yearMonth: string,
  target: 'monthly' | 'bonus',
): Promise<ExemptionDecision> {
  const base = `companies/${companyId}/employees/${employeeId}`;
  const snap = await tx.get(db.collection(`${base}/premiumExemptions`).where('startMonth', '<=', yearMonth));
  const exemptionIds: string[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (target === 'monthly' && data.isMonthlyExempted !== true) continue;
    if (!(await isApprovedActive(tx, base, data))) continue;
    let exempt: boolean;
    const leaveSnap = data.leaveId ? await tx.get(db.doc(`${base}/leaves/${data.leaveId}`)) : null;
    const period = leaveSnap?.exists ? leavePeriod(data.exemptionType, leaveSnap.data()) : null;
    if (period) {
      exempt = target === 'monthly' ? isMonthlyPremiumExempt(period, yearMonth) : isBonusPremiumExempt(period, yearMonth);
    } else {
      const inRange = !data.endMonth || yearMonth <= data.endMonth;
      exempt = inRange && (target === 'monthly' || data.isBonusExempted === true);
    }
    if (exempt) exemptionIds.push(doc.id);
  }
  return { exempt: exemptionIds.length > 0, exemptionIds };
}
