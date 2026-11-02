// 在籍ステータス（カタログ2章 在籍ステータスの管理）。
// 退職日と休業の記録（産休・育休・介護休業）から自動で決め、記録のない「休職中（傷病休職・私傷病）」だけを
// 従業員の休職の記録（absences）で持つ。保険料の免除は今どおり申出書の承認で効く（ここでは表示だけ）。

export type EmploymentStatusKind = 'active' | 'sickLeave' | 'maternityLeave' | 'childcareLeave' | 'careLeave' | 'resigned';

export const STATUS_LABELS: Record<EmploymentStatusKind, string> = {
  active: '在籍中', sickLeave: '休職中', maternityLeave: '産前産後休業中', childcareLeave: '育児休業中', careLeave: '介護休業中', resigned: '退職済み',
};

export const SICK_REASON_LABELS = { injury: '傷病休職', personal: '私傷病' } as const;
export type SickReason = keyof typeof SICK_REASON_LABELS;

/** 重なったときにどれを今の状態にするか（大きいほうが優先） */
const PRIORITY: Record<EmploymentStatusKind, number> = { active: 0, sickLeave: 1, careLeave: 2, childcareLeave: 3, maternityLeave: 4, resigned: 5 };

export interface StatusPeriod {
  kind: Exclude<EmploymentStatusKind, 'active'>;
  /** YYYY-MM-DD（この日から） */
  start: string;
  /** YYYY-MM-DD（この日まで。決まっていなければ null） */
  end: string | null;
  source: 'leave' | 'absence' | 'resignation';
  /** 休職の記録・休業の記録のID */
  id: string | null;
  note: string | null;
  /** 予定の日付（実際の日付がまだない） */
  planned: boolean;
}

type Data = Record<string, any>;
const day = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  const t = v as { toDate?: () => Date };
  return typeof t.toDate === 'function' ? t.toDate().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) : null;
};
const nextDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

const LEAVE_KIND: Record<string, StatusPeriod['kind']> = { maternity: 'maternityLeave', childcare: 'childcareLeave', nursing: 'careLeave', care: 'careLeave' };

/** 記録から期間の一覧を作る（古い順） */
export function statusPeriods(input: { resignationDate?: unknown; leaves: { id: string; data: Data }[]; absences: { id: string; data: Data }[] }): StatusPeriod[] {
  const out: StatusPeriod[] = [];
  for (const { id, data } of input.leaves) {
    const kind = LEAVE_KIND[data.leaveType];
    const start = day(data.actualStartDate) ?? day(data.expectedStartDate);
    if (!kind || !start || data.deletedAt) continue;
    const end = day(data.actualEndDate) ?? day(data.expectedEndDate);
    out.push({ kind, start, end, source: 'leave', id, note: null, planned: !day(data.actualStartDate) || !day(data.actualEndDate) });
  }
  for (const { id, data } of input.absences) {
    const start = day(data.startDate);
    if (!start || data.deletedAt) continue;
    const reason = SICK_REASON_LABELS[data.reason as SickReason] ?? '休職';
    out.push({ kind: 'sickLeave', start, end: day(data.endDate), source: 'absence', id, note: [reason, data.note].filter(Boolean).join('：'), planned: false });
  }
  const resigned = day(input.resignationDate);
  // 退職日の翌日から退職済み
  if (resigned) out.push({ kind: 'resigned', start: nextDay(resigned), end: null, source: 'resignation', id: null, note: `退職日 ${resigned}`, planned: false });
  return out.sort((a, b) => a.start.localeCompare(b.start) || PRIORITY[a.kind] - PRIORITY[b.kind]);
}

/** その日の状態。重なっていれば優先の高いほう */
export function statusOn(periods: StatusPeriod[], date: string): { kind: EmploymentStatusKind; period: StatusPeriod | null } {
  let best: StatusPeriod | null = null;
  for (const p of periods) {
    if (p.start > date || (p.end !== null && p.end < date)) continue;
    if (!best || PRIORITY[p.kind] > PRIORITY[best.kind]) best = p;
  }
  return { kind: best?.kind ?? 'active', period: best };
}

/** 画面に出す説明（産休・育休は保険料免除の対象であることを示す） */
export function statusNote(kind: EmploymentStatusKind): string | null {
  if (kind === 'maternityLeave' || kind === 'childcareLeave') return '保険料免除の対象です（申出書が承認されると、毎月の計算で免除します）';
  if (kind === 'sickLeave') return '休職中も社会保険料はかかります';
  if (kind === 'careLeave') return '介護休業中も社会保険料はかかります';
  return null;
}

/** 休職の記録の入力を確かめる */
export function absenceErrors(input: { startDate: string; endDate: string | null }, others: StatusPeriod[]): string[] {
  const errors: string[] = [];
  if (input.endDate && input.endDate < input.startDate) errors.push('終了日は開始日より後にしてください');
  const overlap = others.find(p => p.kind === 'sickLeave'
    && p.start <= (input.endDate ?? '9999-12-31') && (p.end ?? '9999-12-31') >= input.startDate);
  if (overlap) errors.push(`ほかの休職の記録（${overlap.start}〜${overlap.end ?? ''}）と期間が重なっています`);
  return errors;
}
