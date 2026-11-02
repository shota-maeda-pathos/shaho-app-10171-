import { GradeDoc, GradeTableEntry, SalaryDoc } from '../types/firestore';
import {
  addMonths, InsuredCategory, lookupGrade, monthOf, remunerationForJudgement, SanteiBasis, selectSanteiMonths,
} from '../insurance/calculator';

export type SanteiStatus = 'ok' | 'excluded' | 'pending' | 'needsAction';

export interface SanteiMonth {
  yearMonth: string;
  paymentBasisDays: number | null;
  /** 判定に使う報酬（現物を含め、遡及差額を除く） */
  remuneration: number | null;
  /** 届出に書く通貨・現物（実際に支払った額。遡及差額を含む） */
  cash: number | null;
  inKind: number | null;
  retroactive: number;
  /** 平均に使った月か */
  used: boolean;
}

export interface SanteiGrade {
  healthGradeNumber: number;
  healthStandardRemuneration: number;
  pensionGradeNumber: number;
  pensionStandardRemuneration: number;
}

/** 担当者の判断。支払基礎日数の基準を満たす月がない人を、従前の標準報酬月額で決める */
export type SanteiDecision = 'previous';

export interface SanteiApproval {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  requestId: string | null;
  requestedBy: string | null;
  /** 差し戻しの理由（出し直すまで出す） */
  rejection: string | null;
}

export interface SanteiRow {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  status: SanteiStatus;
  /** 除外・保留・対応要の理由、または平均の取り方 */
  reason: string;
  insuredCategory: InsuredCategory;
  months: SanteiMonth[];
  basis: SanteiBasis | 'previous' | null;
  /** 平均額（判定に使った額） */
  average: number | null;
  current: SanteiGrade | null;
  /** 今の等級の適用開始月（届出の「従前の改定月」） */
  currentEffectiveMonth: string | null;
  proposed: SanteiGrade | null;
  changed: boolean;
  /** 担当者が決めた方法（対応要の人だけ） */
  decision: SanteiDecision | null;
  approval: SanteiApproval;
}

export interface SanteiEmployeeData {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  acquisitionDate: string | null;
  lossDate: string | null;
  enrolled: boolean;
  insuredCategory: InsuredCategory;
  /** 4〜6月に支払った給与（なければ null） */
  salaries: Record<string, SalaryDoc | null>;
  /** 8月時点で適用中の等級 */
  currentGrade: GradeDoc | null;
  /** 7〜9月に適用される随時改定の等級があるか */
  hasOccasionalRevisionJulToSep: boolean;
  approval: SanteiApproval;
  decision: SanteiDecision | null;
}

const BASE: Pick<SanteiRow, 'months' | 'basis' | 'average' | 'current' | 'proposed' | 'changed' | 'decision'> = {
  months: [], basis: null, average: null, current: null, proposed: null, changed: false, decision: null,
};

export const NO_APPROVAL: SanteiApproval = { status: 'none', requestId: null, requestedBy: null, rejection: null };

const monthName = (ym: string) => `${Number(ym.slice(5))}月`;

/** 支払基礎日数の基準（一般17日・パート15日の特例・短時間労働者11日） */
export function santeiMinDays(category: InsuredCategory) {
  return category === 'shortTime' ? 11 : category === 'partTimer' ? 15 : 17;
}

/**
 * 定時決定（算定基礎届）の1人分の判定。
 * 除外：6月1日以降の資格取得、7月1日までの資格喪失、7〜9月の随時改定予定、適用外
 * 保留：4〜6月の給与が未登録・未承認（他の対象者の処理は止めない）
 * 対応要：支払基礎日数の基準を満たす月がない（担当者が「従前の標準報酬月額で決める」と決めれば対象）
 */
export function computeSanteiRow(year: number, data: SanteiEmployeeData, tables: { health: GradeTableEntry[]; pension: GradeTableEntry[] }): SanteiRow {
  const head = {
    employeeId: data.employeeId, employeeNumber: data.employeeNumber, employeeName: data.employeeName,
    insuredCategory: data.insuredCategory, approval: data.approval,
    currentEffectiveMonth: data.currentGrade?.effectiveMonth ?? null,
  };
  const exclude = (reason: string): SanteiRow => ({ ...head, ...BASE, status: 'excluded', reason });

  if (!data.enrolled) return exclude('社会保険の適用外です');
  if (!data.acquisitionDate) return exclude('資格取得日が登録されていません');
  if (data.acquisitionDate >= `${year}-06-01`) return exclude('6月1日以降に資格を取得したため、資格取得時の決定が優先されます');
  if (data.lossDate && data.lossDate <= `${year}-07-01`) return exclude('7月1日までに資格を喪失しています');
  if (data.hasOccasionalRevisionJulToSep) return exclude('7〜9月に随時改定が行われる予定です（月額変更届を出します）');

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
      cash: s ? s.totalSalary : null,
      inKind: s ? (s.inKindAmount ?? 0) : null,
      retroactive: s?.retroactivePay?.amount ?? 0,
      used: false,
    };
  });
  if (missing.length || unconfirmed.length) {
    const reasons = [
      missing.length ? `${missing.map(monthName).join('・')}の給与が未登録` : '',
      unconfirmed.length ? `${unconfirmed.map(monthName).join('・')}の給与が未承認` : '',
    ].filter(Boolean);
    return { ...head, ...BASE, months, current, status: 'pending', reason: `${reasons.join('、')}です。毎月の処理で登録・承認するか、無給休職などで決められない人は保留にしてください` };
  }

  const selection = selectSanteiMonths(
    months.map(m => ({ yearMonth: m.yearMonth, paymentBasisDays: m.paymentBasisDays!, remuneration: m.remuneration! })),
    data.insuredCategory,
  );
  const used = new Set(selection.usedMonths.map(m => m.yearMonth));
  const markedMonths = months.map(m => ({ ...m, used: used.has(m.yearMonth) }));
  if (selection.average === null) {
    const reason = `支払基礎日数が${santeiMinDays(data.insuredCategory)}日以上の月がありません`;
    if (data.decision === 'previous' && current) {
      return {
        ...head, ...BASE, months: markedMonths, current, status: 'ok', basis: 'previous', decision: 'previous',
        reason: `${reason}。従前の標準報酬月額で決めます`, proposed: current, changed: false,
      };
    }
    return {
      ...head, ...BASE, months: markedMonths, current, status: 'needsAction', decision: data.decision,
      reason: current ? `${reason}。従前の標準報酬月額で決めるか、担当者の判断が必要です` : `${reason}。今の等級もないため、担当者の判断が必要です`,
    };
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
  const basisText = selection.basis === 'days15' ? '（パートの15日特例）' : selection.basis === 'days11' ? '（短時間労働者の11日基準）' : '';
  return {
    ...head,
    ...BASE,
    status: 'ok',
    reason: `${selection.usedMonths.map(m => monthName(m.yearMonth)).join('・')}の平均${basisText}`,
    months: markedMonths,
    basis: selection.basis,
    average: selection.average,
    current,
    proposed,
    changed,
  };
}

/** 承認申請に書く内容。届出はこの内容（承認された値）から作る */
export function santeiApprovalMetadata(year: number, row: SanteiRow) {
  if (row.status !== 'ok' || !row.proposed) throw new Error('算定の対象ではありません');
  const usedMonths = row.months.filter(m => m.used).map(m => monthName(m.yearMonth)).join('・');
  return {
    effectiveMonth: santeiEffectiveMonth(year),
    determinationType: 'regular',
    ...row.proposed,
    basisRemuneration: row.basis === 'previous' ? row.current!.healthStandardRemuneration : row.average,
    basisMonths: row.months.filter(m => m.used).map(m => m.yearMonth),
    previousGrade: row.current,
    previousGradeMonth: row.currentEffectiveMonth,
    months: row.months,
    basis: row.basis,
    insuredCategory: row.insuredCategory,
    reason: row.basis === 'previous'
      ? `${year}年 定時決定（支払基礎日数の基準を満たす月がないため従前の標準報酬月額で決定）`
      : `${year}年 定時決定（${usedMonths}の平均 ${row.average!.toLocaleString('ja-JP')}円）`,
    source: 'santei',
  };
}

export type SanteiApprovalMetadata = ReturnType<typeof santeiApprovalMetadata>;

/** 承認を依頼した後に給与や等級が変わっていないか（変わっていれば承認しない） */
export function santeiMetadataMatches(meta: Partial<SanteiApprovalMetadata> | null | undefined, row: SanteiRow) {
  if (!meta || row.status !== 'ok' || !row.proposed) return false;
  const p = row.proposed;
  return meta.healthGradeNumber === p.healthGradeNumber && meta.pensionGradeNumber === p.pensionGradeNumber
    && meta.healthStandardRemuneration === p.healthStandardRemuneration && meta.pensionStandardRemuneration === p.pensionStandardRemuneration
    && (meta.basis ?? null) === row.basis
    && JSON.stringify(meta.basisMonths ?? []) === JSON.stringify(row.months.filter(m => m.used).map(m => m.yearMonth));
}

export interface SanteiFilingPerson {
  employeeId: string;
  被保険者整理番号: string;
  被保険者氏名: string;
  生年月日: string;
  適用年月: string;
  従前の標準報酬月額_健康保険: number | null;
  従前の標準報酬月額_厚生年金: number | null;
  従前の改定月: string | null;
  months: { 月: number; 支払基礎日数: number; 通貨: number; 現物: number; 合計: number }[];
  総計: number;
  平均額: number | null;
  修正平均額: number | null;
  決定_健康保険等級: number;
  決定_健康保険標準報酬月額: number;
  決定_厚生年金等級: number;
  決定_厚生年金標準報酬月額: number;
  備考: string;
  /** 様式の備考欄の番号（1:70歳以上被用者 4:途中入社 6:短時間労働者 7:パート 9:その他） */
  備考区分: number[];
  /** 備考「9．その他」の内容 */
  備考その他: string;
  /** ⑰ 70歳以上被用者だけ（個人番号は載せず基礎年金番号を書く） */
  基礎年金番号?: string;
}

/**
 * 算定基礎届の1人分の行。承認された内容から作る。
 * 総計・平均額は基準を満たした月（平均に使った月）の支払額。遡及差額があれば、差額を除いた平均を修正平均額にする。
 */
export function santeiFilingPerson(input: {
  employeeId: string; insuredPersonNumber: string; name: string; birthDate: string;
  meta: SanteiApprovalMetadata; age70: boolean; basicPensionNumber?: string;
}): SanteiFilingPerson {
  const { meta } = input;
  const usedMonths = meta.months.filter(m => m.used);
  const paid = (m: SanteiMonth) => (m.cash ?? 0) + (m.inKind ?? 0);
  const total = usedMonths.reduce((a, m) => a + paid(m), 0);
  const average = usedMonths.length ? Math.floor(total / usedMonths.length) : null;
  const retro = usedMonths.some(m => m.retroactive > 0);
  // 4月より後に資格を取った人は、取得した月からの月だけを使う（途中入社）
  const midJoin = meta.months.length > 0 && meta.months[0].yearMonth > `${meta.effectiveMonth.slice(0, 4)}-04`;
  const notes = [
    meta.insuredCategory === 'partTimer' ? 'パート' : meta.insuredCategory === 'shortTime' ? '短時間労働者（特定適用事業所等）' : '',
    meta.basis === 'previous' ? '支払基礎日数不足のため従前の標準報酬月額で決定' : '',
    input.age70 ? '70歳以上被用者' : '',
    midJoin ? '途中入社' : '',
    retro ? '遡及支払額あり' : '',
  ].filter(Boolean);
  const others = [meta.basis === 'previous' ? '従前の標準報酬月額で決定' : '', retro ? '遡及支払額あり' : ''].filter(Boolean);
  const codes = [
    input.age70 ? 1 : 0, midJoin ? 4 : 0, meta.insuredCategory === 'shortTime' ? 6 : 0, meta.insuredCategory === 'partTimer' ? 7 : 0, others.length ? 9 : 0,
  ].filter(Boolean);
  return {
    employeeId: input.employeeId,
    被保険者整理番号: input.insuredPersonNumber,
    被保険者氏名: input.name,
    生年月日: input.birthDate,
    適用年月: meta.effectiveMonth,
    従前の標準報酬月額_健康保険: meta.previousGrade?.healthStandardRemuneration ?? null,
    従前の標準報酬月額_厚生年金: meta.previousGrade?.pensionStandardRemuneration ?? null,
    従前の改定月: meta.previousGradeMonth,
    months: meta.months.map(m => ({
      月: Number(m.yearMonth.slice(5)), 支払基礎日数: m.paymentBasisDays ?? 0, 通貨: m.cash ?? 0, 現物: m.inKind ?? 0, 合計: paid(m),
    })),
    総計: total,
    平均額: average,
    修正平均額: retro && meta.basis !== 'previous' ? meta.basisRemuneration : null,
    決定_健康保険等級: meta.healthGradeNumber,
    決定_健康保険標準報酬月額: meta.healthStandardRemuneration,
    決定_厚生年金等級: meta.pensionGradeNumber,
    決定_厚生年金標準報酬月額: meta.pensionStandardRemuneration,
    備考: notes.join('・'),
    備考区分: codes,
    備考その他: others.join('・'),
    ...(input.age70 && input.basicPensionNumber ? { 基礎年金番号: input.basicPensionNumber } : {}),
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

/** 届出期間（7月1日〜10日。10日が土日祝でも、ここでは日付だけを示す） */
export function santeiFilingPeriod(year: number) {
  return { from: `${year}-07-01`, to: `${year}-07-10` };
}
