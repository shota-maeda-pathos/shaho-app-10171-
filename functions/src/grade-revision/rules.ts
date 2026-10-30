import { GradeTableEntry } from '../types/firestore';
import {
  addDays, addMonths, ageReachDate, ChangeDirection, InsuranceKind, InsuredCategory, judgeGradeChange, monthOf, occasionalRevisionMinDays,
  remunerationForJudgement, selectSanteiMonths,
} from '../insurance/calculator';

/**
 * 随時改定と産休・育休終了時改定の判定（純粋関数）。
 * - 随時改定：固定的賃金が変わった月（変動月）から3か月。3か月とも支払基礎日数が基準以上（一般17日・短時間11日）、
 *   2等級以上の差（上限・下限の特例あり）、固定的賃金と等級の変動方向が同じ。
 * - 終了時改定：休業を終えた日の翌日が属する月から3か月。基準に満たない月を除いて平均し（パートは15日の特例あり）、
 *   1等級でも差があれば本人の申出により改定する。固定的賃金の変動・方向は問わない。
 * どちらも健保・厚年で別々に判定し、新しい等級は起点の月から4か月目の保険料から使う。
 */

export type RevisionKind = 'occasional' | 'maternityEnd' | 'childcareEnd';

export const KIND_LABEL: Record<RevisionKind, string> = {
  occasional: '随時改定',
  maternityEnd: '産休終了時の改定',
  childcareEnd: '育休終了時の改定',
};

export const FILING_TYPE: Record<RevisionKind, string> = {
  occasional: 'remunerationMonthlyChange',
  maternityEnd: 'maternityLeaveEndChange',
  childcareEnd: 'childcareLeaveEndChange',
};

export const FILING_LABEL: Record<RevisionKind, string> = {
  occasional: '月額変更届',
  maternityEnd: '産前産後休業終了時報酬月額変更届',
  childcareEnd: '育児休業等終了時報酬月額変更届',
};

export const DETERMINATION: Record<RevisionKind, 'occasional' | 'leaveEnd'> = {
  occasional: 'occasional', maternityEnd: 'leaveEnd', childcareEnd: 'leaveEnd',
};

const ym = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;

/** 判定に使う3か月 */
export function revisionMonths(startMonth: string): string[] {
  return [0, 1, 2].map(i => addMonths(startMonth, i));
}

/** 新しい等級を使い始める月（起点の月から4か月目） */
export function effectiveMonthOf(startMonth: string): string {
  return addMonths(startMonth, 3);
}

/** 終了時改定の起点：休業を終えた日の翌日が属する月 */
export function leaveEndStartMonth(endDate: string): string {
  return monthOf(addDays(endDate, 1));
}

// ── 固定的賃金の変動 ────────────────────────────────

export interface FixedWageInput {
  /** 変動月の前月の固定的賃金。給与がなければ null */
  before: number | null;
  /** 変動月の固定的賃金 */
  after: number | null;
  /** 前月の給与がないときなどに担当者が入れた変動の向き */
  manualDirection: ChangeDirection | null;
}

export interface FixedWageResult {
  changed: boolean | null;
  direction: ChangeDirection | null;
  /** 向きを担当者が決める必要がある */
  needsInput: boolean;
  message: string;
}

/** 変動月とその前月の固定的賃金を比べる。比べられないときは担当者が入れた向きを使う */
export function fixedWageChange(i: FixedWageInput): FixedWageResult {
  if (i.after !== null && i.before !== null) {
    if (i.after === i.before) {
      return { changed: false, direction: null, needsInput: false, message: `固定的賃金が変わっていません（${i.before.toLocaleString('ja-JP')}円）` };
    }
    const direction: ChangeDirection = i.after > i.before ? 'up' : 'down';
    return {
      changed: true, direction, needsInput: false,
      message: `固定的賃金が${i.before.toLocaleString('ja-JP')}円から${i.after.toLocaleString('ja-JP')}円に${direction === 'up' ? '上がりました' : '下がりました'}`,
    };
  }
  if (i.manualDirection) {
    return { changed: true, direction: i.manualDirection, needsInput: false, message: `固定的賃金が${i.manualDirection === 'up' ? '上がった' : '下がった'}（担当者が確認）` };
  }
  return {
    changed: null, direction: null, needsInput: true,
    message: i.after === null ? '変動月の給与がまだありません' : '前の月の給与がないため、固定的賃金が上がったか下がったかを選んでください',
  };
}

// ── 終了時改定の要件 ───────────────────────────────

export interface LeaveEndInput {
  kind: 'maternityEnd' | 'childcareEnd';
  /** 休業を終えた日 */
  endDate: string | null;
  /** 養育する子の生年月日 */
  childBirthDate: string | null;
  /** 休業を終えた翌日から、続けて産休・育休に入る */
  nextLeaveFromNextDay: boolean;
  /** 本人の申出がある */
  applied: boolean;
}

export interface LeaveEndCheck {
  /** 入れてもらう必要があるもの（担当者の確認待ち） */
  missing: string[];
  /** 終了時の改定ができない理由 */
  blocking: string[];
}

/** 終了時改定ができるか */
export function leaveEndCheck(i: LeaveEndInput): LeaveEndCheck {
  const missing: string[] = [];
  const blocking: string[] = [];
  if (!i.endDate) missing.push('休業を終えた日を入れてください');
  if (!i.childBirthDate) missing.push('養育する子の生年月日を入れてください');
  if (i.endDate && i.childBirthDate) {
    if (i.childBirthDate > i.endDate) missing.push('子の生年月日が休業を終えた日より後になっています');
    // 育休を終えた日に3歳未満の子を養育していること（3歳に達する日＝誕生日の前日）
    if (i.kind === 'childcareEnd' && i.endDate >= ageReachDate(i.childBirthDate, 3)) blocking.push('育休を終えた日に子が3歳に達しているため、終了時の改定はできません');
  }
  if (i.nextLeaveFromNextDay) {
    blocking.push(i.kind === 'maternityEnd'
      ? '産休の翌日から育休に入る場合は、産休終了時の改定はしません（育休を終えたときに判定します）'
      : '育休の翌日から続けて産休・育休に入る場合は、終了時の改定はしません');
  }
  if (!i.applied) missing.push('終了時の改定は本人の申出により行います。申出を受けたら「本人の申出あり」にしてください');
  return { missing, blocking };
}

// ── 3か月の報酬と等級の判定 ───────────────────────────

export interface RevisionSalary {
  yearMonth: string;
  confirmed: boolean;
  totalSalary: number;
  inKind: number;
  /** 遡及差額（判定から除く） */
  retroactive: number;
  paymentBasisDays: number;
}

export interface CurrentGrade {
  effectiveMonth: string;
  healthGrade: number;
  healthStandard: number;
  pensionGrade: number;
  pensionStandard: number;
  /** 従前の等級を決めたときの報酬月額（上限・下限の特例に使う） */
  basisRemuneration: number | null;
}

export interface RevisionInput {
  kind: RevisionKind;
  startMonth: string;
  /** 3か月分。給与がない月は null */
  salaries: (RevisionSalary | null)[];
  insuredCategory: InsuredCategory;
  current: CurrentGrade | null;
  /** 随時改定：固定的賃金の変動の向き。分からなければ null */
  direction: ChangeDirection | null;
  /** 随時改定：固定的賃金が変わっていない */
  fixedWageUnchanged?: boolean;
  enrolled: { health: boolean; pension: boolean };
  tables: Record<InsuranceKind, GradeTableEntry[]>;
  /** 上限・下限の特例で使う従前の報酬月額（担当者が入れた値。なければ従前の等級の根拠の額） */
  previousRemuneration: number | null;
  /** 終了時改定の要件 */
  leaveEnd?: LeaveEndCheck;
}

export interface RevisionMonthRow {
  yearMonth: string;
  status: 'ok' | 'missing' | 'unconfirmed';
  totalSalary: number | null;
  inKind: number | null;
  retroactive: number | null;
  remuneration: number | null;
  paymentBasisDays: number | null;
  /** 平均に使う月 */
  used: boolean;
  /** 支払基礎日数が基準に満たない */
  short: boolean;
}

export interface InsuranceResult {
  enrolled: boolean;
  eligible: boolean;
  currentGrade: number | null;
  currentStandard: number | null;
  newGrade: number | null;
  newStandard: number | null;
  diff: number | null;
  reason: string;
}

export type RevisionStatus = 'waiting' | 'eligible' | 'ineligible' | 'review';

export interface RevisionResult {
  status: RevisionStatus;
  kind: RevisionKind;
  startMonth: string;
  effectiveMonth: string;
  months: RevisionMonthRow[];
  minDays: number;
  /** 平均に使った月の報酬の合計と平均（円未満切捨て） */
  total: number | null;
  average: number | null;
  /** 遡及差額を含めた平均（届出の「修正平均額」の参考） */
  averageWithRetro: number | null;
  health: InsuranceResult;
  pension: InsuranceResult;
  /** 待っているもの・対象外の理由・確かめること */
  messages: string[];
}

const emptyInsurance = (enrolled: boolean, current: CurrentGrade | null, kind: InsuranceKind, reason: string): InsuranceResult => ({
  enrolled, eligible: false,
  currentGrade: current ? (kind === 'health' ? current.healthGrade : current.pensionGrade) : null,
  currentStandard: current ? (kind === 'health' ? current.healthStandard : current.pensionStandard) : null,
  newGrade: null, newStandard: null, diff: null, reason,
});

export function judgeRevision(i: RevisionInput): RevisionResult {
  const months = revisionMonths(i.startMonth);
  const leaveEnd = i.kind !== 'occasional';
  const minDays = occasionalRevisionMinDays(i.insuredCategory);
  const rows: RevisionMonthRow[] = months.map((m, idx) => {
    const s = i.salaries[idx];
    if (!s) return { yearMonth: m, status: 'missing', totalSalary: null, inKind: null, retroactive: null, remuneration: null, paymentBasisDays: null, used: false, short: false };
    return {
      yearMonth: m, status: s.confirmed ? 'ok' : 'unconfirmed',
      totalSalary: s.totalSalary, inKind: s.inKind, retroactive: s.retroactive,
      remuneration: remunerationForJudgement({ totalSalary: s.totalSalary, inKind: s.inKind, retroactiveAmount: s.retroactive }),
      paymentBasisDays: s.paymentBasisDays, used: false, short: false,
    };
  });
  const base = {
    kind: i.kind, startMonth: i.startMonth, effectiveMonth: effectiveMonthOf(i.startMonth), months: rows, minDays,
    total: null as number | null, average: null as number | null, averageWithRetro: null as number | null,
  };
  const messages: string[] = [];
  const result = (status: RevisionStatus, health?: InsuranceResult, pension?: InsuranceResult): RevisionResult => ({
    ...base, status, messages,
    health: health ?? emptyInsurance(i.enrolled.health, i.current, 'health', ''),
    pension: pension ?? emptyInsurance(i.enrolled.pension, i.current, 'pension', ''),
  });

  // 要件の段階で決まるもの
  if (leaveEnd && i.leaveEnd?.blocking.length) {
    messages.push(...i.leaveEnd.blocking);
    return result('ineligible');
  }
  if (!leaveEnd && i.fixedWageUnchanged) {
    messages.push('固定的賃金が変わっていないため、随時改定の対象ではありません');
    return result('ineligible');
  }
  if (!i.current) {
    messages.push('今の等級がありません。資格取得時決定などで等級を決めてから判定してください');
    return result('review');
  }

  // 給与がそろうのを待つ
  const waiting = rows.filter(r => r.status !== 'ok');
  if (waiting.length) {
    for (const r of waiting) messages.push(`${ym(r.yearMonth)}支給の給与${r.status === 'missing' ? 'がまだありません' : 'が承認されていません'}`);
    return result('waiting');
  }

  // 平均に使う月
  const monthly = rows.map(r => ({ yearMonth: r.yearMonth, paymentBasisDays: r.paymentBasisDays!, remuneration: r.remuneration! }));
  let used: string[];
  if (leaveEnd) {
    const sel = selectSanteiMonths(monthly, i.insuredCategory);
    used = sel.usedMonths.map(m => m.yearMonth);
    const threshold = sel.basis === 'days15' ? 15 : sel.basis === 'days11' ? 11 : 17;
    for (const r of rows) r.short = r.paymentBasisDays! < threshold;
    if (sel.basis === 'none') {
      messages.push(`3か月とも支払基礎日数が基準（${minDays}日）に満たないため、終了時の改定はできません`);
      return result('ineligible');
    }
    if (sel.basis === 'days15') messages.push('17日以上の月がないため、15日以上の月で平均しました（パートタイマーの特例）');
  } else {
    for (const r of rows) r.short = r.paymentBasisDays! < minDays;
    used = rows.filter(r => !r.short).map(r => r.yearMonth);
  }
  for (const r of rows) r.used = used.includes(r.yearMonth);
  const usedRows = rows.filter(r => r.used);
  base.total = usedRows.reduce((s, r) => s + r.remuneration!, 0);
  base.average = Math.floor(base.total / usedRows.length);
  base.averageWithRetro = Math.floor(usedRows.reduce((s, r) => s + r.remuneration! + (r.retroactive ?? 0), 0) / usedRows.length);
  const hasRetro = rows.some(r => (r.retroactive ?? 0) > 0);

  if (!leaveEnd) {
    const short = rows.filter(r => r.short);
    if (short.length) {
      for (const r of short) messages.push(`${ym(r.yearMonth)}の支払基礎日数（${r.paymentBasisDays}日）が基準（${minDays}日）に満たないため、随時改定の対象ではありません`);
      return result('ineligible');
    }
    if (!i.direction) {
      messages.push('固定的賃金が上がったか下がったかを確かめてください');
      return result('review');
    }
  }
  if (hasRetro) messages.push('遡及差額は平均から除いています（届出の修正平均額の欄に書きます）');

  const average = base.average;
  const judge = (kind: InsuranceKind): InsuranceResult & { review: boolean } => {
    const enrolled = kind === 'health' ? i.enrolled.health : i.enrolled.pension;
    if (!enrolled) return { ...emptyInsurance(false, i.current, kind, `${kind === 'health' ? '健康保険' : '厚生年金'}に加入していません`), review: false };
    const currentStandard = kind === 'health' ? i.current!.healthStandard : i.current!.pensionStandard;
    const j = judgeGradeChange({
      kind, table: i.tables[kind], currentStandard, averageRemuneration: average,
      // 終了時改定は向きを問わない（等級の動きの向きで判定する）
      direction: leaveEnd ? (average >= currentStandard ? 'up' : 'down') : i.direction!,
      minDiff: leaveEnd ? 1 : 2,
      previousRemuneration: i.previousRemuneration ?? i.current!.basisRemuneration,
    });
    return {
      enrolled: true, eligible: j.eligible,
      currentGrade: kind === 'health' ? i.current!.healthGrade : i.current!.pensionGrade, currentStandard,
      newGrade: j.newGrade.gradeNumber, newStandard: j.newGrade.standardRemuneration,
      diff: j.gradeDiff, reason: j.reason, review: j.needsReview,
    };
  };
  const { review: healthReview, ...health } = judge('health');
  const { review: pensionReview, ...pension } = judge('pension');
  const eligible = health.eligible || pension.eligible;
  for (const r of [health, pension]) {
    if (!r.enrolled || r.eligible) continue;
    // どちらかが改定対象なら、もう一方は「改定しない」として理由を残す
    messages.push(eligible ? `${r.reason}（この保険は今の等級のまま）` : r.reason);
  }
  if (healthReview || pensionReview) return result('review', health, pension);
  // 終了時改定は、等級差があっても本人の申出などが確かめられるまで決めない
  if (eligible && leaveEnd && i.leaveEnd?.missing.length) {
    messages.push(...i.leaveEnd.missing);
    return result('review', health, pension);
  }
  return result(eligible ? 'eligible' : 'ineligible', health, pension);
}

/** 毎月の処理などで「随時改定の可能性」を知らせるか。変動月から3か月目の給与が承認された時点で判定する */
export function revisionAlertText(name: string, r: RevisionResult): string {
  const h = r.health.eligible ? `健保${r.health.currentGrade}→${r.health.newGrade}等級` : null;
  const p = r.pension.eligible ? `厚年${r.pension.currentGrade}→${r.pension.newGrade}等級` : null;
  return `${name}さんについて随時改定の可能性があります。変動月：${ym(r.startMonth)}、3か月平均：${(r.average ?? 0).toLocaleString('ja-JP')}円、${[h, p].filter(Boolean).join('・')}`;
}
