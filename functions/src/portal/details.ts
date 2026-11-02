import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config';
import { AuthContext } from '../middleware/auth';
import { employeeFilingStatus } from '../filings/index/rules';
import { stateOf } from '../filings/submission/rules';
import { EmploymentDoc } from '../types/firestore';
import { normalizeEmployment, qualificationDates, toDateString } from '../utils/employment';
import { self } from './service';
import { hiddenItems } from './visibility';

const EMPLOYMENT_LABELS: Record<string, string> = {
  regular: '正社員', contract: '契約社員', partTime: 'パートタイマー', arbeit: 'アルバイト',
  executiveFull: '役員（常勤）', executivePart: '役員（非常勤）',
};

export const FILING_LABELS: Record<string, string> = {
  acquisitionNotification: '資格取得届', lossNotification: '資格喪失届', pensionLoss70: '資格喪失届・70歳以上被用者該当届',
  remunerationMonthlyAlgorithm: '算定基礎届', remunerationMonthlyChange: '月額変更届', bonusPayment: '賞与支払届',
  bonusNonPayment: '賞与不支給報告書', dependentChange: '被扶養者（異動）届', maternityLeaveStart: '産前産後休業取得者申出書',
  maternityLeaveChange: '産前産後休業取得者変更（終了）届', childcareLeaveStart: '育児休業等取得者申出書',
  childcareLeaveEnd: '育児休業等取得者終了届', correction: '訂正届', cancellation: '取消届',
  maternityLeaveEndChange: '産前産後休業終了時報酬月額変更届', childcareLeaveEndChange: '育児休業等終了時報酬月額変更届',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  spouse: '配偶者', child: '子', parent: '父母', grandparent: '祖父母', sibling: '兄弟姉妹', grandchild: '孫', other: 'その他',
};

const DETERMINATION_LABELS: Record<string, string> = {
  regular: '定時決定', occasional: '随時改定', initial: '資格取得時決定', leaveEnd: '産休・育休終了時改定', specific: 'その他の決定',
};

/** 本人に見せる届出の状態（カタログ11章：申請中／承認済み／提出済み／完了） */
export function portalFilingStatus(data: Record<string, unknown>): string {
  const { status, paperStatus } = employeeFilingStatus(data);
  if (status === 'cancelled') return '取消';
  if (status === 'completed' || paperStatus === 'accepted') return '完了';
  if (status === 'returned') return '返戻（担当者が対応中）';
  if (['sent', 'received', 'processing'].includes(status) || paperStatus === 'submitted') return '提出済み';
  if (status === 'approved' || status === 'mockFailed') return '承認済み';
  return '申請中';
}

export interface PremiumMonth {
  yearMonth: string;
  standardRemuneration: number | null;
  health: number;
  childSupport: number;
  longTermCare: number | null;
  pension: number;
  total: number;
  isExempted: boolean;
  /** 前の月から本人負担が変わったときの理由。変わらなければ null */
  changeReason: string | null;
  change: number | null;
}

/** 月ごとの保険料（古い順）に、前月からの変化と理由を付ける */
export function withChanges(months: Omit<PremiumMonth, 'changeReason' | 'change'>[], grades: { yearMonth: string; healthGrade: number; pensionGrade: number }[]): PremiumMonth[] {
  const gradeOf = new Map(grades.map(g => [g.yearMonth, g]));
  return months.map((m, i) => {
    const prev = months[i - 1];
    if (!prev || prev.total === m.total) return { ...m, changeReason: null, change: null };
    const a = gradeOf.get(prev.yearMonth), b = gradeOf.get(m.yearMonth);
    const reason = m.isExempted !== prev.isExempted ? (m.isExempted ? '産休・育休の免除' : '免除の終了')
      : a && b && (a.healthGrade !== b.healthGrade || a.pensionGrade !== b.pensionGrade) ? '等級の改定'
      : (m.longTermCare === null) !== (prev.longTermCare === null) ? (m.longTermCare === null ? '介護保険料の終了（65歳）' : '介護保険料の開始（40歳）')
      : '料率の改定';
    return { ...m, changeReason: reason, change: m.total - prev.total };
  });
}

/** 年ごとの本人負担の合計（新しい年から） */
export function annualTotals(months: PremiumMonth[]): { year: string; total: number; months: number }[] {
  const byYear = new Map<string, { total: number; months: number }>();
  for (const m of months) {
    const y = m.yearMonth.slice(0, 4);
    const cur = byYear.get(y) ?? { total: 0, months: 0 };
    byYear.set(y, { total: cur.total + m.total, months: cur.months + 1 });
  }
  return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, v]) => ({ year, ...v }));
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 本人ポータルの詳しい情報（カタログ11章）。公開範囲で非公開の項目は返さない */
export async function getPortalDetails(auth: AuthContext) {
  const employee = await self(auth);
  if (!employee) throw new HttpsError('failed-precondition', '従業員との紐付けがありません。管理者に確認してください');
  const { path, data } = employee;
  const company = `companies/${auth.companyId}`;
  const hidden = await hiddenItems(auth.companyId);
  const show = (k: Parameters<typeof hidden.has>[0]) => !hidden.has(k);

  const [office, department, employments, grades, insurances, dependents, filings] = await Promise.all([
    db.doc(`${company}/offices/${data.officeId}`).get(),
    data.departmentId ? db.doc(`${company}/departments/${data.departmentId}`).get() : Promise.resolve(null),
    db.collection(`${path}/employments`).orderBy('effectiveDate', 'desc').limit(1).get(),
    db.collection(`${path}/grades`).orderBy('effectiveMonth', 'asc').get(),
    db.collection(`${path}/monthlyInsurance`).where('isConfirmed', '==', true).get(),
    show('dependents') ? db.collection(`${path}/dependents`).where('deletedAt', '==', null).get() : Promise.resolve(null),
    show('filings') ? db.collection(`${path}/filings`).get() : Promise.resolve(null),
  ]);

  const employment = employments.docs[0] ? normalizeEmployment(employments.docs[0].data() as EmploymentDoc) : null;
  const gradeDocs = grades.docs.map(d => d.data());
  const current = [...gradeDocs].reverse().find(g => g.effectiveMonth <= new Date().toISOString().slice(0, 7)) ?? gradeDocs.at(-1) ?? null;
  const months = insurances.docs.map(d => d.data()).sort((a, b) => String(a.yearMonth).localeCompare(String(b.yearMonth)));
  const latest = months.at(-1);
  const { acquisitionDate } = qualificationDates(data as never);

  const premiumMonths = withChanges(months.map(m => ({
    yearMonth: m.yearMonth, standardRemuneration: m.healthStandardRemuneration ?? null,
    health: num(m.healthInsurance?.employeeAmount), childSupport: num(m.childSupportPayment?.employeeAmount),
    longTermCare: m.longTermCareInsurance ? num(m.longTermCareInsurance.employeeAmount) : null,
    pension: num(m.pensionInsurance?.employeeAmount), total: num(m.totalEmployeeAmount), isExempted: m.isExempted === true,
  })), months.map(m => ({ yearMonth: m.yearMonth, healthGrade: m.healthGradeNumber, pensionGrade: m.pensionGradeNumber })))
    // 訂正した月（カタログ6章⑤）：訂正があった旨と理由を出す
    .map((p, i) => ({ ...p, corrected: months[i].correctionCount ? String(months[i].correctionReason ?? '保険料を訂正しました') : null }));

  const totalOf = (ym: string) => premiumMonths.find(p => p.yearMonth === ym)?.total ?? null;
  const prevMonth = (ym: string) => { const [y, mo] = ym.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };

  return {
    profile: {
      employeeName: `${data.lastName} ${data.firstName}`,
      birthDate: toDateString(data.birthDate),
      gender: data.gender === 'female' ? '女' : '男',
      ...(show('address') ? { address: [data.postalCode ? `〒${data.postalCode}` : '', data.prefecture, data.city, data.addressLine, data.building].filter(Boolean).join(' ') || (data.address ?? null) } : {}),
      ...(show('employment') ? {
        employmentType: employment ? EMPLOYMENT_LABELS[employment.employmentType] ?? employment.employmentType : null,
        hireDate: toDateString(data.hireDate), officeName: office.data()?.name ?? null, departmentName: department?.data()?.name ?? null,
      } : {}),
      ...(show('insuranceNumbers') ? { healthInsuranceNumber: data.healthInsuranceNumber ?? null, insuredPersonNumber: data.insuredPersonNumber ?? null } : {}),
    },
    grade: show('grade') && current ? {
      healthGrade: current.healthGradeNumber, healthStandardRemuneration: current.healthStandardRemuneration,
      pensionGrade: current.pensionGradeNumber, pensionStandardRemuneration: current.pensionStandardRemuneration, effectiveMonth: current.effectiveMonth,
    } : null,
    insuranceTypes: show('insuranceTypes') ? {
      health: employment?.healthInsuranceEnrolled ?? null, pension: employment?.pensionEnrolled ?? null,
      longTermCare: latest ? !!latest.longTermCareInsurance : null, acquisitionDate,
    } : null,
    premiums: show('premiums') ? { months: [...premiumMonths].reverse(), annual: annualTotals(premiumMonths) } : null,
    gradeChanges: show('gradeChanges') ? gradeDocs.slice(1).map((g, i) => {
      const before = gradeDocs[i];
      const after = totalOf(g.effectiveMonth), prior = totalOf(prevMonth(g.effectiveMonth));
      return {
        effectiveMonth: g.effectiveMonth, reason: DETERMINATION_LABELS[g.determinationType] ?? g.reason ?? '',
        oldHealthGrade: before.healthGradeNumber, newHealthGrade: g.healthGradeNumber,
        oldPensionGrade: before.pensionGradeNumber, newPensionGrade: g.pensionGradeNumber,
        premiumChange: after !== null && prior !== null ? after - prior : null,
      };
    }).reverse() : null,
    filings: filings ? filings.docs.map(d => d.data()).filter(f => f.workflowStatus !== 'draft').map(f => ({
      type: FILING_LABELS[f.filingType] ?? f.filingType,
      requestedAt: (f.createdAt?.toDate?.() as Date | undefined)?.toISOString() ?? null,
      status: portalFilingStatus(f),
      acceptanceNumber: stateOf('employee', f).mock?.acceptanceNumber ?? null,
    })).sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? '')) : null,
    dependents: dependents ? dependents.docs.map(d => d.data()).map(d => ({
      name: `${d.lastName} ${d.firstName}`, birthDate: toDateString(d.birthDate),
      relationship: RELATIONSHIP_LABELS[d.relationship] ?? d.relationship,
      qualificationDate: toDateString(d.qualificationDate),
      status: d.disqualificationDate ? `扶養から外れた（${toDateString(d.disqualificationDate)}）` : d.certification === 'certified' ? '認定済み' : '登録済み',
    })) : null,
    hidden: [...hidden],
  };
}
