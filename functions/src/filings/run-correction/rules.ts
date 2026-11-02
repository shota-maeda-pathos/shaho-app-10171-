import { stateOf } from '../submission/rules';

// 算定基礎届・賞与支払届（run の届出）の訂正届・取消届（カタログ 届出⑩）。
// 提出済みの届出から対象の人を選び、その人の行だけを写した届出を同じ run の届出として作る。
// 訂正届は写した行を直し、元の行との差分を「訂正箇所」として持つ。取消届は元の行をそのまま持つ。

export type RunSource = 'santei' | 'bonus';
export type RunCorrectionKind = 'correction' | 'cancellation';
type Person = Record<string, any>;
type Flat = Record<string, string | number | null>;

export const isRunCorrection = (f: Record<string, any> | undefined | null) => f?.filingType === 'correction' || f?.filingType === 'cancellation';
export const KIND_LABEL: Record<RunCorrectionKind, string> = { correction: '訂正届', cancellation: '取消届' };

/** 元の届出を提出し終えているか（模擬電子申請の完了か、紙で提出・受理） */
export function isSubmittedRunFiling(source: RunSource, f: Record<string, any>): boolean {
  const { mock, paper } = stateOf(source, f);
  return mock?.status === 'completed' || paper?.status === 'submitted' || paper?.status === 'accepted';
}

/** 訂正届・取消届を作れるか。作れないときは理由 */
export function runCorrectionBlocker(source: RunSource, original: Record<string, any>): string | null {
  if (isRunCorrection(original)) return '訂正届・取消届をさらに訂正・取消することはできません。元の届出から作り直してください';
  if (original.filingType === 'bonusNonPayment') return '賞与不支給報告書は訂正届・取消届の対象ではありません';
  if (original.status === 'cancelled') return 'この届出は取り消し済みです';
  if (!isSubmittedRunFiling(source, original)) return 'まだ提出していない届出は、承認を取り消すか差し戻して直します';
  return null;
}

/**
 * 選んだ人が訂正届・取消届に載せられるか。載せられない人がいれば理由の一覧。
 * 元の届出に載っていない人、取消届を出した人、同じ種類の作りかけ（提出前）の届出に載っている人は載せない
 */
export function personBlockers(input: {
  kind: RunCorrectionKind; employeeIds: string[]; original: Record<string, any>; siblings: Record<string, any>[];
}): string[] {
  const persons = (input.original.persons ?? []) as Person[];
  const nameOf = (id: string) => persons.find(p => p.employeeId === id)?.被保険者氏名 ?? id;
  const cancelled = new Set<string>(input.original.cancelledEmployeeIds ?? []);
  const open = input.siblings.filter(s => s.filingType === input.kind && s.status !== 'cancelled' && !s.appliedToOriginal);
  const errors: string[] = [];
  for (const id of input.employeeIds) {
    if (!persons.some(p => p.employeeId === id)) errors.push(`${id}：元の届出に載っていません`);
    else if (cancelled.has(id)) errors.push(`${nameOf(id)}：取消届を提出済みです`);
    else if (open.some(s => (s.employeeIds ?? []).includes(id))) errors.push(`${nameOf(id)}：作りかけの${KIND_LABEL[input.kind]}に載っています`);
  }
  return errors;
}

// ---- 直せる項目 ----

/** 1人分の行を、画面で直す項目（項目名→値）に開く。一覧の項目（月ごとの報酬）は「4月_通貨」の形にする */
export function flattenPerson(source: RunSource, p: Person): Flat {
  if (source === 'santei') {
    const flat: Flat = {};
    for (const m of (p.months ?? []) as Person[]) {
      flat[`${m.月}月_支払基礎日数`] = m.支払基礎日数 ?? null;
      flat[`${m.月}月_通貨`] = m.通貨 ?? null;
      flat[`${m.月}月_現物`] = m.現物 ?? null;
    }
    for (const k of SANTEI_FIELDS) flat[k] = p[k] ?? null;
    return flat;
  }
  const flat: Flat = {};
  for (const k of BONUS_FIELDS) flat[k] = p[k] ?? null;
  return flat;
}

const SANTEI_FIELDS = [
  '被保険者整理番号', '被保険者氏名', '生年月日', '従前の標準報酬月額_健康保険', '従前の標準報酬月額_厚生年金', '従前の改定月',
  '総計', '平均額', '修正平均額', '決定_健康保険等級', '決定_健康保険標準報酬月額', '決定_厚生年金等級', '決定_厚生年金標準報酬月額', '備考その他',
];
const BONUS_FIELDS = ['被保険者整理番号', '被保険者氏名', '生年月日', '賞与支払年月日', '賞与額_通貨', '賞与額_現物'];

/** 文字の項目（ほかは数値） */
const TEXT_FIELDS = new Set(['被保険者整理番号', '被保険者氏名', '生年月日', '従前の改定月', '備考その他', '賞与支払年月日']);
const isTextField = (key: string) => TEXT_FIELDS.has(key);

export function editableKeys(source: RunSource, p: Person): string[] {
  return Object.keys(flattenPerson(source, p));
}

/**
 * 直した内容を1人分の行に当てはめる。直せない項目、数字でない値は rejected に返す。
 * 合計（通貨＋現物）と、賞与の標準賞与額（千円未満を切り捨て）は計算し直す
 */
export function applyPersonPatch(source: RunSource, current: Person, patch: Record<string, unknown>): { person: Person; rejected: string[] } {
  const allowed = new Set(editableKeys(source, current));
  const person: Person = JSON.parse(JSON.stringify(current));
  const rejected: string[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!allowed.has(key)) { rejected.push(key); continue; }
    let value: string | number | null;
    if (isTextField(key)) {
      value = raw === null || raw === undefined ? '' : String(raw).trim();
    } else {
      const text = String(raw ?? '').replace(/[,\s円]/g, '');
      if (text === '') value = null;
      else if (!Number.isFinite(Number(text))) { rejected.push(key); continue; }
      else value = Number(text);
    }
    const month = key.match(/^(\d{1,2})月_(支払基礎日数|通貨|現物)$/);
    if (month) {
      const m = (person.months as Person[]).find(x => x.月 === Number(month[1]));
      if (!m) { rejected.push(key); continue; }
      m[month[2]] = value ?? 0;
      m.合計 = Number(m.通貨 ?? 0) + Number(m.現物 ?? 0);
    } else {
      person[key] = value;
    }
  }
  if (source === 'bonus') {
    person.賞与額_合計 = Number(person.賞与額_通貨 ?? 0) + Number(person.賞与額_現物 ?? 0);
    person.標準賞与額 = Math.floor(person.賞与額_合計 / 1000) * 1000;
  }
  return { person, rejected };
}

export interface RunCorrectionRow {
  employeeId: string;
  /** PDF・画面の「項目」の列（「山田 太郎：4月_通貨」） */
  field: string;
  before: string;
  after: string;
}

const show = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** 訂正箇所（元の行との差分）。合計など計算し直した項目も含める */
export function runCorrectionsOf(source: RunSource, originals: Person[], persons: Person[]): RunCorrectionRow[] {
  const rows: RunCorrectionRow[] = [];
  for (const p of persons) {
    const o = originals.find(x => x.employeeId === p.employeeId);
    if (!o) continue;
    const a = withTotals(source, o);
    const b = withTotals(source, p);
    for (const key of Object.keys(b)) {
      if (show(a[key]) !== show(b[key])) rows.push({ employeeId: p.employeeId, field: `${o.被保険者氏名}：${key}`, before: show(a[key]), after: show(b[key]) });
    }
  }
  return rows;
}

function withTotals(source: RunSource, p: Person): Flat {
  const flat = flattenPerson(source, p);
  if (source === 'santei') for (const m of (p.months ?? []) as Person[]) flat[`${m.月}月_合計`] = m.合計 ?? null;
  else { flat['賞与額_合計'] = p.賞与額_合計 ?? null; flat['標準賞与額'] = p.標準賞与額 ?? null; }
  return flat;
}

/** 模擬電子申請の前に確かめること（元の様式の必須項目は別に確かめる） */
export function runCorrectionErrors(f: Record<string, any>): string[] {
  const errors: string[] = [];
  if (!String(f.reason ?? '').trim()) errors.push(f.filingType === 'correction' ? '訂正の理由がありません' : '取消の理由がありません');
  if (f.filingType === 'correction' && !(f.corrections ?? []).length) errors.push('訂正箇所がありません（元の届出から直した項目がありません）');
  if (!(f.persons ?? []).length) errors.push('対象の人がいません');
  return errors;
}

export interface RunCorrectionSummary {
  /** この届出が訂正届・取消届なら、その種類と元の届出 */
  kind: RunCorrectionKind | null;
  originalFilingId: string | null;
  originalNumber: number | null;
  reason: string | null;
  correctionCount: number;
  /** 元の届出の側：提出した訂正届・取消届と、取消届を出した人 */
  correctedByFilingIds: string[];
  cancelledByFilingIds: string[];
  cancelledEmployeeIds: string[];
}

/** 一括型の画面の届出の一覧に出す、訂正届・取消届まわりの情報 */
export function runCorrectionSummary(f: Record<string, any>): RunCorrectionSummary {
  return {
    kind: isRunCorrection(f) ? f.filingType : null,
    originalFilingId: f.originalFilingId ?? null,
    originalNumber: f.originalNumber ?? null,
    reason: isRunCorrection(f) ? f.reason ?? '' : null,
    correctionCount: (f.corrections ?? []).length,
    correctedByFilingIds: f.correctedByFilingIds ?? [],
    cancelledByFilingIds: f.cancelledByFilingIds ?? [],
    cancelledEmployeeIds: f.cancelledEmployeeIds ?? [],
  };
}
