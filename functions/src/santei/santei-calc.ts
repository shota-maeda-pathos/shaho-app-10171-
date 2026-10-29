import { GradeDoc, GradeTableEntry, SalaryDoc } from '../types/firestore';
import {
  addMonths, InsuredCategory, lookupGrade, monthOf, remunerationForJudgement, SanteiBasis, selectSanteiMonths,
} from '../insurance/calculator';

export type SanteiStatus = 'ok' | 'excluded' | 'pending' | 'needsAction';

export interface SanteiMonth {
  yearMonth: string;
  paymentBasisDays: number | null;
  remuneration: number | null;
  /** 平均に使った月か */
  used: boolean;
}

export interface SanteiGrade {
  healthGradeNumber: number;
  healthStandardRemuneration: number;
  pensionGradeNumber: number;
  pensionStandardRemuneration: number;
}

export interface SanteiRow {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  status: SanteiStatus;
  /** 除外・保留・対応要の理由 */
  reason: string;
  insuredCategory: InsuredCategory;
  months: SanteiMonth[];
  basis: SanteiBasis | null;
  average: number | null;
  current: SanteiGrade | null;
  proposed: SanteiGrade | null;
  changed: boolean;
  /** 既に出ている定時決定の承認申請 */
  approvalStatus: 'none' | 'pending' | 'approved';
}

export interface SanteiEmployeeData {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  acquisitionDate: string | null;
  lossDate: string | null;
  enrolled: boolean;
  insuredCategory: InsuredCategory;
  /** 4〜6月の給与（なければ null） */
  salaries: Record<string, SalaryDoc | null>;
  /** 8月時点で適用中の等級 */
  currentGrade: GradeDoc | null;
  /** 7〜9月に適用される随時改定の等級があるか */
  hasOccasionalRevisionJulToSep: boolean;
  approvalStatus: SanteiRow['approvalStatus'];
}

const BASE: Omit<SanteiRow, 'employeeId' | 'employeeNumber' | 'employeeName' | 'status' | 'reason' | 'insuredCategory' | 'approvalStatus'> = {
  months: [], basis: null, average: null, current: null, proposed: null, changed: false,
};

/**
 * 定時決定（算定基礎届）の1人分の判定。
 * 除外：6月1日以降の資格取得、7月1日までの資格喪失、7〜9月の随時改定予定、適用外
 * 保留：4〜6月の給与が未登録・未承認（他の対象者の処理は止めない）
 * 対応要：支払基礎日数の基準を満たす月がない
 */
export function computeSanteiRow(year: number, data: SanteiEmployeeData, tables: { health: GradeTableEntry[]; pension: GradeTableEntry[] }): SanteiRow {
  const head = {
    employeeId: data.employeeId, employeeNumber: data.employeeNumber, employeeName: data.employeeName,
    insuredCategory: data.insuredCategory, approvalStatus: data.approvalStatus,
  };
  const exclude = (reason: string): SanteiRow => ({ ...head, ...BASE, status: 'excluded', reason });

  if (!data.enrolled) return exclude('社会保険の適用外です');
  if (!data.acquisitionDate) return exclude('資格取得日が登録されていません');
  if (data.acquisitionDate >= `${year}-06-01`) return exclude('6月1日以降に資格を取得したため、資格取得時の決定が優先されます');
  if (data.lossDate && data.lossDate <= `${year}-07-01`) return exclude('7月1日までに資格を喪失しています');
  if (data.hasOccasionalRevisionJulToSep) return exclude('7〜9月に随時改定が行われる予定です');

  const current = data.currentGrade ? {
    healthGradeNumber: data.currentGrade.healthGradeNumber,
    healthStandardRemuneration: data.currentGrade.healthStandardRemuneration,
    pensionGradeNumber: data.currentGrade.pensionGradeNumber,
    pensionStandardRemuneration: data.currentGrade.pensionStandardRemuneration,
  } : null;

  // 資格取得前の月は対象外
  const targetMonths = [4, 5, 6].map(m => `${year}-${String(m).padStart(2, '0')}`)
    .filter(ym => ym >= monthOf(data.acquisitionDate!));
  const missing = targetMonths.filter(ym => !data.salaries[ym]);
  const unconfirmed = targetMonths.filter(ym => data.salaries[ym] && !data.salaries[ym]!.isConfirmed);
  const months: SanteiMonth[] = targetMonths.map(ym => {
    const s = data.salaries[ym];
    return {
      yearMonth: ym,
      paymentBasisDays: s ? s.paymentBasisDays : null,
      remuneration: s ? remunerationForJudgement({ totalSalary: s.totalSalary, inKind: s.inKindAmount, retroactiveAmount: s.retroactivePay?.amount }) : null,
      used: false,
    };
  });
  if (missing.length || unconfirmed.length) {
    const reasons = [
      missing.length ? `${missing.map(ym => `${Number(ym.slice(5))}月`).join('・')}の給与が未登録` : '',
      unconfirmed.length ? `${unconfirmed.map(ym => `${Number(ym.slice(5))}月`).join('・')}の給与が未承認` : '',
    ].filter(Boolean);
    return { ...head, ...BASE, months, current, status: 'pending', reason: `${reasons.join('、')}のため保留しています（無給休職・免除中の場合は個別に対応してください）` };
  }

  const selection = selectSanteiMonths(
    months.map(m => ({ yearMonth: m.yearMonth, paymentBasisDays: m.paymentBasisDays!, remuneration: m.remuneration! })),
    data.insuredCategory,
  );
  const used = new Set(selection.usedMonths.map(m => m.yearMonth));
  const markedMonths = months.map(m => ({ ...m, used: used.has(m.yearMonth) }));
  if (selection.average === null) {
    const minDays = data.insuredCategory === 'shortTime' ? 11 : data.insuredCategory === 'partTimer' ? 15 : 17;
    return { ...head, ...BASE, months: markedMonths, current, status: 'needsAction', reason: `支払基礎日数が${minDays}日以上の月がありません。従前の標準報酬月額で決定するなど、担当者の判断が必要です` };
  }

  const health = lookupGrade(tables.health, selection.average);
  const pension = lookupGrade(tables.pension, selection.average);
  const proposed: SanteiGrade = {
    healthGradeNumber: health.gradeNumber,
    healthStandardRemuneration: health.standardRemuneration,
    pensionGradeNumber: pension.gradeNumber,
    pensionStandardRemuneration: pension.standardRemuneration,
  };
  const changed = !current
    || current.healthGradeNumber !== proposed.healthGradeNumber
    || current.pensionGradeNumber !== proposed.pensionGradeNumber;
  const basisText = selection.basis === 'days15' ? '（パートの15日特例）' : '';
  return {
    ...head,
    status: 'ok',
    reason: `${selection.usedMonths.length}か月の平均${basisText}`,
    months: markedMonths,
    basis: selection.basis,
    average: selection.average,
    current,
    proposed,
    changed,
  };
}

/** 新等級は9月分の保険料から適用する */
export function santeiEffectiveMonth(year: number): string {
  return `${year}-09`;
}

/** 8月時点で適用中の等級を取る月 */
export function santeiCurrentGradeMonth(year: number): string {
  return addMonths(santeiEffectiveMonth(year), -1);
}
