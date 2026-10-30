import {
  addDays, ageReachDate, correspondingDayAfterMonths, correspondingDayNextMonth, daysInclusive, exemptMonths, isBonusPremiumExempt,
  LeaveKind, maternityLeavePeriod, monthOf,
} from '../insurance/calculator';

// 産休・育休の判定（カタログ 届出⑧⑨・保険料の免除）。画面の値は信用せず、サーバーでこの関数を通す

export const KIND_LABEL: Record<LeaveKind, string> = { maternity: '産前産後休業', childcare: '育児休業' };

/** 届出の種類。産休の変更届と終了届は同じ様式（産前産後休業取得者変更（終了）届） */
export type LeaveFilingKind = 'start' | 'change' | 'extend' | 'end';
export const FILING_TYPE: Record<LeaveKind, Record<LeaveFilingKind, string>> = {
  maternity: { start: 'maternityLeaveStart', change: 'maternityLeaveChange', extend: 'maternityLeaveChange', end: 'maternityLeaveChange' },
  childcare: { start: 'childcareLeaveStart', change: 'childcareLeaveStart', extend: 'childcareLeaveStart', end: 'childcareLeaveEnd' },
};
export const FILING_LABEL: Record<LeaveKind, Record<LeaveFilingKind, string>> = {
  maternity: { start: '産前産後休業取得者申出書', change: '産前産後休業取得者変更届', extend: '産前産後休業取得者変更届', end: '産前産後休業取得者終了届' },
  childcare: { start: '育児休業等取得者申出書', change: '育児休業等取得者申出書（延長）', extend: '育児休業等取得者申出書（延長）', end: '育児休業等取得者終了届' },
};

/** 産後休業は出産日の翌日から56日。42日（6週間）を過ぎれば、医師が認めた場合に早く戻れる */
const POSTNATAL_DAYS = 56;
const POSTNATAL_REQUIRED_DAYS = 42;

export interface MaternityInput {
  expectedBirthDate: string;
  actualBirthDate: string | null;
  multiple: boolean;
  /** 実際に休み始める日。空なら法律上いちばん早い日 */
  startDate: string;
}

/**
 * 産前産後休業の期間。産前は出産日以前42日（多胎98日）から取れ、出産の翌日から56日は休業する。
 * 開始日は産前のいちばん早い日から出産の翌日（産前に休まない場合）までの間で選べる。
 */
export function planMaternity(f: MaternityInput) {
  const errors: string[] = [];
  const legal = maternityLeavePeriod({ expectedBirthDate: f.expectedBirthDate, actualBirthDate: f.actualBirthDate, multiple: f.multiple });
  const birth = f.actualBirthDate ?? f.expectedBirthDate;
  const start = f.startDate || legal.start;
  if (start < legal.start) errors.push(`休み始める日は、産前休業を取れるいちばん早い日（${legal.start}）以降にしてください`);
  if (start > addDays(birth, 1)) errors.push('休み始める日は、出産の翌日までにしてください（産後休業は必ず休みます）');
  const end = addDays(birth, POSTNATAL_DAYS);
  const period = { kind: 'maternity' as const, start, end };
  return {
    start, end, legalStart: legal.start, errors,
    /** 届出の期限：産休中、または産休の終了から1か月以内 */
    deadline: correspondingDayNextMonth(end),
    ...exemptionOf(period),
  };
}

export interface ChildcareInput {
  childBirthDate: string;
  startDate: string;
  endDate: string;
  /** 本人が出産した子か（産後休業の56日は育休を取れない） */
  bornByEmployee: boolean;
}

/** 子の年齢で決まる育休の区切り（終了予定日の上限）。延長は1歳→1歳6か月→2歳、3歳までは育児休業に準ずる措置 */
export function childcareLimits(childBirthDate: string) {
  return [
    { label: '1歳まで', until: ageReachDate(childBirthDate, 1) },
    { label: '1歳6か月まで（延長）', until: addDays(correspondingDayAfterMonths(childBirthDate, 18), -1) },
    { label: '2歳まで（再延長）', until: ageReachDate(childBirthDate, 2) },
    { label: '3歳まで（育児休業に準ずる措置）', until: ageReachDate(childBirthDate, 3) },
  ];
}

/** 育児休業の期間の確かめ。届出の期限は「速やかに」のため日付では決めない */
export function planChildcare(f: ChildcareInput) {
  const errors: string[] = [];
  const notes: string[] = [];
  const limits = childcareLimits(f.childBirthDate);
  const start = f.startDate;
  const end = f.endDate || limits[0].until;
  const postnatalEnd = addDays(f.childBirthDate, POSTNATAL_DAYS);
  if (start < f.childBirthDate) errors.push('育休を始める日は、子の生年月日以降にしてください');
  if (f.bornByEmployee && start <= postnatalEnd) errors.push(`出産の翌日から56日（${postnatalEnd}まで）は産後休業です。育休はその翌日から始まります`);
  if (end < start) errors.push('育休を終える予定の日は、始める日以降にしてください');
  if (end > limits[3].until) errors.push(`育休を終える予定の日は、子が3歳に達する日（${limits[3].until}）までにしてください`);
  const stage = limits.find(l => end <= l.until)?.label ?? '';
  if (end > limits[0].until && end <= limits[1].until) notes.push('1歳を過ぎる育休は、保育所に入れないなどの事情があるときの延長です（パパ・ママ育休プラスは1歳2か月まで）');
  const period = { kind: 'childcare' as const, start, end };
  const ex = errors.length ? { exemptMonths: [], bonusExempt: false, shortLeave: false } : exemptionOf(period);
  if (!errors.length && !ex.exemptMonths.length) notes.push('月末をまたがず、同じ月の中で14日未満の育休のため、月々の保険料は免除されません');
  if (!errors.length && !ex.bonusExempt) notes.push('育休が1か月以下のため、賞与の保険料は免除されません');
  return { start, end, stage, limits, errors, notes, deadline: null as string | null, ...ex };
}

function exemptionOf(period: { kind: LeaveKind; start: string; end: string }) {
  const months = exemptMonths(period);
  // 賞与の免除は、休業期間の末日を含む月に賞与を払ったとき。期間の中に1か月でもあるかを目安として示す
  const bonusExempt = months.some(m => isBonusPremiumExempt(period, m));
  return { exemptMonths: months, bonusExempt, shortLeave: daysInclusive(period.start, period.end) < 14 };
}

export type LeaveEventType = 'birth' | 'extend' | 'end';

export interface LeaveFacts {
  kind: LeaveKind;
  start: string;
  /** 届け出た終了予定日 */
  plannedEnd: string;
  expectedBirthDate: string | null;
  actualBirthDate: string | null;
  multiple: boolean;
  childBirthDate: string | null;
  /** 申出書に出産年月日を書いて出したか（出産後に申し出た） */
  filedWithBirth: boolean;
}

/**
 * 休業中に起きたことから、新しい期間と出す届出を決める。
 * 予定どおり終わった場合は届出は要らない（申出書で届け出た期間で完結する）。
 */
export function judgeLeaveEvent(f: LeaveFacts, event: { type: LeaveEventType; date: string }) {
  const errors: string[] = [];
  let start = f.start;
  let end = f.plannedEnd;
  let filing: LeaveFilingKind | null = null;
  let ended = false;
  let actualBirthDate = f.actualBirthDate;
  const notes: string[] = [];

  if (f.kind === 'maternity') {
    if (event.type === 'birth') {
      actualBirthDate = event.date;
      end = addDays(event.date, POSTNATAL_DAYS);
      if (event.date < start) start = event.date;
      if (event.date !== f.expectedBirthDate && !f.filedWithBirth) {
        filing = 'change';
        notes.push(`出産日が予定日（${f.expectedBirthDate}）と違うため、変更届を出します。産後休業の終わりは${end}になります`);
      } else notes.push('出産日が予定日と同じため、届出は要りません');
      const legal = maternityLeavePeriod({ expectedBirthDate: f.expectedBirthDate!, actualBirthDate: event.date, multiple: f.multiple });
      if (start < legal.start) errors.push('出産日から見て、休み始めた日が産前休業を取れる日より前です。出産日を確かめてください');
    } else if (event.type === 'end') {
      if (!actualBirthDate) errors.push('先に出産日を記録してください');
      else if (event.date < addDays(actualBirthDate, POSTNATAL_REQUIRED_DAYS)) errors.push(`産後6週間（${addDays(actualBirthDate, POSTNATAL_REQUIRED_DAYS)}まで）は休業します`);
      ended = true;
      if (event.date < end) {
        filing = 'end';
        notes.push('予定より早く産休を終えたため、終了届を出します');
        end = event.date;
      } else if (event.date > end) errors.push(`産休の終わりは${end}です（それより後は育休などになります）`);
      else notes.push('予定どおりの終了のため、届出は要りません');
    } else errors.push('産休は延長できません。続けて休む場合は育休の手続きをしてください');
  } else {
    const limits = childcareLimits(f.childBirthDate!);
    if (event.type === 'extend') {
      if (event.date <= f.plannedEnd) errors.push(`延長後の終了予定日は、今の終了予定日（${f.plannedEnd}）より後にしてください`);
      if (event.date > limits[3].until) errors.push(`子が3歳に達する日（${limits[3].until}）までにしてください`);
      end = event.date;
      filing = 'extend';
      notes.push(`${limits.find(l => event.date <= l.until)?.label ?? ''}の延長として、育児休業等取得者申出書（延長）を出します`);
    } else if (event.type === 'end') {
      ended = true;
      if (event.date < start) errors.push('育休を終えた日は、始めた日以降にしてください');
      if (event.date < end) {
        filing = 'end';
        notes.push('予定より早く育休を終えたため、終了届を出します');
        end = event.date;
      } else if (event.date > end) errors.push(`終了予定日（${end}）より後に終える場合は、先に延長を記録してください`);
      else notes.push('予定どおりの終了のため、届出は要りません');
    } else errors.push('育休では出産日は記録しません');
  }
  const period = { kind: f.kind, start, end };
  return { start, end, actualBirthDate, filing, ended, errors, notes, ...(errors.length ? { exemptMonths: [], bonusExempt: false, shortLeave: false } : exemptionOf(period)) };
}

/** 休業を終えて戻った月（終了時改定の起点）。休業の最終日の翌日が属する月 */
export function returnMonth(end: string): string {
  return monthOf(addDays(end, 1));
}
