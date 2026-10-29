import { addDays, addMonths, correspondingDayAfterMonths, eligibilityByAge, lossDateFromResignation, monthOf } from '../insurance/calculator';

/** 退職の手続きで扱う喪失の原因（年齢到達による喪失は年齢到達の手続きで扱う） */
export type LossReason = 'resignation' | 'death';
export const LOSS_CAUSE_LABEL: Record<LossReason, string> = { resignation: '退職等', death: '死亡' };

export interface ResignationFactsInput {
  resignationDate: string;
  reason: LossReason;
  birthDate: string | null;
  /** 資格取得日。社会保険に加入していなければ null */
  acquisitionDate: string | null;
  /** 退職の直前の加入区分（雇用条件） */
  enrolled: { health: boolean; pension: boolean };
  isForeign: boolean;
}

/**
 * 退職日から決まること（保存しない）。画面のプレビューと保存で同じ計算を使う。
 * - 資格喪失日：退職日（死亡日）の翌日
 * - 保険料：喪失日の属する月の前月分まで（月末退職は退職月も発生。同月得喪は1か月分）
 * - 喪失届の期限：喪失日から5日以内（初日は数えない。入社の資格取得届と同じ数え方）
 * - 退職後のアカウント：喪失日から閲覧専用。退職日から3か月（民法の期間計算で応当日の前日まで）閲覧でき、その翌日からログインを止める
 */
export function resignationFacts(input: ResignationFactsInput) {
  const lossDate = lossDateFromResignation(input.resignationDate);
  const lossMonth = monthOf(lossDate);
  const age = input.birthDate ? eligibilityByAge(input.birthDate, input.resignationDate) : null;
  // 70歳以上で厚生年金に加入していない人も、70歳以上被用者として届け出ている（退職時に不該当届が要る）
  const over70Worker = age !== null && !age.pension;
  const lost = {
    health: input.enrolled.health && (age?.health ?? true),
    pension: input.enrolled.pension && (age?.pension ?? true),
  };
  const insured = input.acquisitionDate !== null && (lost.health || lost.pension);
  const needsFiling = insured || (input.acquisitionDate !== null && over70Worker);

  let lastChargedMonth: string | null = null;
  let sameMonth = false;
  if (insured) {
    const acquisitionMonth = monthOf(input.acquisitionDate!);
    sameMonth = acquisitionMonth === lossMonth;
    const last = sameMonth ? acquisitionMonth : addMonths(lossMonth, -1);
    lastChargedMonth = last >= acquisitionMonth ? last : null;
  }

  const accessUntil = addDays(correspondingDayAfterMonths(lossDate, 3), -1);
  const notes: string[] = [];
  if (sameMonth) notes.push('入社した月に退職するため（同月得喪）、1か月分の保険料がかかります。同じ月に別の厚生年金・国民年金に入った場合、厚生年金保険料は後日年金事務所から還付されます');
  if (lossDate.endsWith('-01') && insured) notes.push('月末の退職のため、喪失日は翌月1日になり、退職した月の保険料もかかります');
  if (age && !age.health) notes.push('75歳以上のため健康保険には加入していません（後期高齢者医療制度）');
  if (over70Worker) notes.push('70歳以上のため厚生年金には加入していません。資格喪失届で「70歳以上被用者不該当」も届け出ます');
  if (input.reason === 'death') notes.push('死亡による喪失のため、喪失日は亡くなった日の翌日です');

  return {
    lossDate,
    lossCause: LOSS_CAUSE_LABEL[input.reason],
    lost,
    over70Worker,
    needsFiling,
    insured,
    sameMonth,
    lastChargedMonth,
    filingDeadline: needsFiling ? addDays(lossDate, 5) : null,
    account: { viewOnlyFrom: lossDate, accessUntil, loginStopsFrom: addDays(accessUntil, 1) },
    /** 外国人の退職時の案内（脱退一時金の請求手続きはこのシステムの対象外） */
    foreignNotice: input.isForeign && lost.pension
      ? '厚生年金の脱退一時金を請求できます。日本を出国した後、2年以内に日本年金機構へ請求します（請求の手続きは本人が行います）'
      : null,
    notes,
  };
}

export type ResignationFacts = ReturnType<typeof resignationFacts>;

/** 精算を確かめる保険料の月（最後の月とその前の2か月。資格取得月より前は含めない） */
export function settlementMonths(acquisitionDate: string, lastChargedMonth: string): string[] {
  const first = monthOf(acquisitionDate);
  const months: string[] = [];
  for (let m = addMonths(lastChargedMonth, -2); m <= lastChargedMonth; m = addMonths(m, 1)) {
    if (m >= first) months.push(m);
  }
  return months;
}

export interface SettlementMonthInput {
  month: string;
  /** 本人負担の保険料 */
  due: number;
  /** confirmed：承認済み、calculated：計算済み（未承認）、estimate：未計算のため最新の等級からの見込み、noGrade：等級がなく計算できない */
  dueSource: 'confirmed' | 'calculated' | 'estimate' | 'noGrade';
  /** 控除済み・入金済みの額（返金を差し引いた額） */
  collected: number;
}

export type SettlementPlan = 'unknown' | 'none' | 'collected' | 'over' | 'payroll' | 'final' | 'transfer';

/**
 * 最後の保険料の集め方。
 * - いつもの控除月（翌月控除なら翌月支給、当月控除なら当月支給）の給与があれば、その給与から控除する
 * - いつもの控除月の給与がなくても、最後の給与の月の分は最後の給与からまとめて控除できる
 *   （健康保険法167条・厚生年金保険法84条：使用されなくなった場合は前月分とその月分を控除できる）
 * - どちらもできなければ、別途入金で集める（担当者に知らせる）
 * finalSalaryLeft が false（退職後に支給する給与がなく、最後の給与も支給済み）なら、まとめての控除はできない
 */
export function settlementPlan(months: SettlementMonthInput[], deductionMethod: 'previous' | 'current', lastPayMonth: string, finalSalaryLeft = true) {
  const rows = months.map(m => {
    const remaining = m.due - m.collected;
    const normalPayMonth = deductionMethod === 'previous' ? addMonths(m.month, 1) : m.month;
    let plan: SettlementPlan;
    let payMonth: string | null = null;
    if (m.dueSource === 'noGrade') plan = 'unknown';
    else if (m.due <= 0 && m.collected <= 0) plan = 'none';
    else if (remaining === 0) plan = 'collected';
    else if (remaining < 0) plan = 'over';
    else if (normalPayMonth <= lastPayMonth) { plan = 'payroll'; payMonth = normalPayMonth; }
    else if (finalSalaryLeft && m.month <= lastPayMonth) { plan = 'final'; payMonth = lastPayMonth; }
    else plan = 'transfer';
    return { ...m, remaining, normalPayMonth, plan, payMonth };
  });
  const sum = (plans: SettlementPlan[]) => rows.filter(r => plans.includes(r.plan)).reduce((a, r) => a + Math.abs(r.remaining), 0);
  return {
    rows,
    totals: {
      due: rows.reduce((a, r) => a + r.due, 0),
      collected: rows.reduce((a, r) => a + r.collected, 0),
      payroll: sum(['payroll']),
      final: sum(['final']),
      transfer: sum(['transfer']),
      over: sum(['over']),
    },
    /** 見込みの額を含む（月次の計算が済んだら額が変わることがある） */
    hasEstimate: rows.some(r => r.dueSource !== 'confirmed' && r.plan !== 'none' && r.plan !== 'unknown'),
    /** 等級がなく保険料を計算できない月（決める前に台帳で等級を登録する） */
    unknownMonths: rows.filter(r => r.plan === 'unknown').map(r => r.month),
  };
}

export type SettlementResult = ReturnType<typeof settlementPlan>;
