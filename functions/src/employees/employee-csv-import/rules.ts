import { isValidMyNumber } from '../../utils/check-digit';
import { splitCsvLine } from '../../monthly/rules';

/**
 * 従業員CSVの一括取込（カタログ2章 CSV一括取込）の判定。純粋関数。
 * 社員番号が台帳にあれば「更新」、なければ「新規」。更新では空欄の項目は変えない。
 * 誤りのある行は取り込まず、行番号つきで返す（正常な行だけ取り込める）。
 */

export type CsvField =
  | 'employeeNumber' | 'lastName' | 'firstName' | 'lastNameKana' | 'firstNameKana' | 'birthDate' | 'gender'
  | 'office' | 'department' | 'hireDate' | 'formerLastName' | 'postalCode' | 'prefecture' | 'city' | 'addressLine'
  | 'building' | 'phone' | 'email' | 'insuredPersonNumber' | 'basicPensionNumber' | 'myNumber';

/** 列の並び（テンプレートと従業員のCSV出力もこの順）。required は新規の行で必須 */
export const EMPLOYEE_CSV_COLUMNS: { field: CsvField; label: string; required?: boolean }[] = [
  { field: 'employeeNumber', label: '社員番号', required: true },
  { field: 'lastName', label: '姓', required: true },
  { field: 'firstName', label: '名', required: true },
  { field: 'lastNameKana', label: '姓カナ', required: true },
  { field: 'firstNameKana', label: '名カナ', required: true },
  { field: 'birthDate', label: '生年月日', required: true },
  { field: 'gender', label: '性別', required: true },
  { field: 'office', label: '事業所', required: true },
  { field: 'department', label: '部署' },
  { field: 'hireDate', label: '入社日', required: true },
  { field: 'formerLastName', label: '旧姓' },
  { field: 'postalCode', label: '郵便番号' },
  { field: 'prefecture', label: '都道府県' },
  { field: 'city', label: '市区町村' },
  { field: 'addressLine', label: '番地' },
  { field: 'building', label: '建物名' },
  { field: 'phone', label: '電話番号' },
  { field: 'email', label: 'メールアドレス' },
  { field: 'insuredPersonNumber', label: '被保険者整理番号' },
  { field: 'basicPensionNumber', label: '基礎年金番号' },
  { field: 'myNumber', label: '個人番号' },
];

/** 従業員のCSV出力にだけある列（取込では読まない） */
export const EXPORT_ONLY_COLUMNS = ['退職日', '在籍状況'];

const LABEL_TO_FIELD = new Map(EMPLOYEE_CSV_COLUMNS.map(c => [c.label, c.field]));
const MAX_ROWS = 3000;

export interface CsvOffice { id: string; name: string; officeNumber?: string | null; abolished?: boolean }
export interface CsvDepartment { id: string; officeId: string; name: string; isActive: boolean }

/** 台帳の今の値（比べるため。日付は YYYY-MM-DD、なければ null） */
export interface CsvExisting {
  id: string;
  employeeNumber: string;
  officeId: string;
  departmentId: string | null;
  version: number;
  isActive: boolean;
  values: Partial<Record<Exclude<CsvField, 'office' | 'department' | 'myNumber' | 'employeeNumber'>, string | null>>;
  hasMyNumber: boolean;
}

export interface CsvContext {
  offices: CsvOffice[];
  departments: CsvDepartment[];
  existing: CsvExisting[];
  /** 個人番号の重複を確かめるための、登録済みの個人番号（従業員ID→番号）。サーバーの中だけで使い、画面には返さない */
  myNumbers?: Map<string, string>;
  /** 担当事業所だけを扱える人は、その事業所のID。管理者は null */
  allowedOfficeIds: string[] | null;
}

export interface CsvError { line: number; employeeNumber: string; message: string }
export interface CsvChange { label: string; from: string; to: string }

/** 書き込む値。個人番号は myNumber（値は画面に返さない） */
export interface CsvRowPlan {
  line: number;
  employeeNumber: string;
  name: string;
  kind: 'create' | 'update';
  employeeId: string | null;
  expectedVersion: number | null;
  officeId: string;
  fields: Record<string, string | null>;
  departmentId?: string | null;
  myNumber: string | null;
  changes: CsvChange[];
}

export interface CsvPlan {
  creates: CsvRowPlan[];
  updates: CsvRowPlan[];
  unchanged: { line: number; employeeNumber: string; name: string }[];
  errors: CsvError[];
}

const MASK = '（伏せています）';

function toHalfWidth(v: string): string {
  return v.replace(/[０-９Ａ-Ｚａ-ｚ－]/g, c => (c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

/** YYYY-MM-DD・YYYY/M/D を YYYY-MM-DD に。実在しない日付は null */
export function normalizeDate(raw: string): string | null {
  const m = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/.exec(toHalfWidth(raw.trim()));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function normalizeGender(raw: string): 'male' | 'female' | null {
  const v = raw.trim().toLowerCase();
  if (['男', '男性', 'male', 'm', '1'].includes(v)) return 'male';
  if (['女', '女性', 'female', 'f', '2'].includes(v)) return 'female';
  return null;
}

const GENDER_LABEL: Record<string, string> = { male: '男', female: '女' };

/** 1行ずつの値の形を確かめて直す。誤りは message で返す */
function normalizeCell(field: CsvField, raw: string): { value: string | null } | { message: string } {
  // 表計算ソフトの数式よけ（CSV出力が先頭に付ける '）を外す
  const v = raw.replace(/^'/, '').trim();
  if (v === '') return { value: null };
  switch (field) {
    case 'birthDate':
    case 'hireDate': {
      const d = normalizeDate(v);
      return d ? { value: d } : { message: `${field === 'birthDate' ? '生年月日' : '入社日'}は 2026-04-01 または 2026/4/1 の形で入れてください（「${v}」）` };
    }
    case 'gender': {
      const g = normalizeGender(v);
      return g ? { value: g } : { message: `性別は「男」か「女」で入れてください（「${v}」）` };
    }
    case 'postalCode': {
      const p = toHalfWidth(v);
      return /^\d{3}-?\d{4}$/.test(p) ? { value: p.includes('-') ? p : `${p.slice(0, 3)}-${p.slice(3)}` } : { message: `郵便番号は7桁の数字で入れてください（「${v}」）` };
    }
    case 'phone': {
      const p = toHalfWidth(v);
      return /^[0-9-]{10,13}$/.test(p) ? { value: p } : { message: `電話番号の形が正しくありません（「${v}」）` };
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { value: v } : { message: `メールアドレスの形が正しくありません（「${v}」）` };
    case 'basicPensionNumber': {
      const p = toHalfWidth(v).replace(/[-\s]/g, '');
      return /^\d{10}$/.test(p) ? { value: `${p.slice(0, 4)}-${p.slice(4)}` } : { message: `基礎年金番号は10桁の数字です（「${v}」）` };
    }
    case 'myNumber': {
      const p = toHalfWidth(v).replace(/[-\s]/g, '');
      if (!/^\d{12}$/.test(p)) return { message: '個人番号は12桁の数字です' };
      return isValidMyNumber(p) ? { value: p } : { message: '個人番号が正しくありません（最後の検査用数字が合いません）' };
    }
    case 'insuredPersonNumber':
      return v.length <= 10 ? { value: toHalfWidth(v) } : { message: '被保険者整理番号は10文字までです' };
    case 'employeeNumber':
      return v.length <= 20 ? { value: toHalfWidth(v) } : { message: '社員番号は20文字までです' };
    case 'prefecture':
      return v.length <= 10 ? { value: v } : { message: '都道府県が長すぎます' };
    default:
      return v.length <= 200 ? { value: v } : { message: `${EMPLOYEE_CSV_COLUMNS.find(c => c.field === field)?.label}が長すぎます（200文字まで）` };
  }
}

const shown = (field: CsvField, value: string | null | undefined): string =>
  value === null || value === undefined || value === '' ? '（空欄）' : field === 'gender' ? GENDER_LABEL[value] ?? value : value;

/** CSVの見出しと行を読む（行番号は1から。1行目は見出し） */
export function readEmployeeCsv(text: string): { header: string[]; rows: { line: number; cells: Map<CsvField, string> }[]; error: string | null } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? '').map(h => h.replace(/[*＊]$/, '').trim());
  if (!header.includes('社員番号')) return { header, rows: [], error: '1行目に見出し（社員番号・姓・名など）を入れてください。テンプレートを使うと確実です' };
  const unknown = header.filter(h => h && !LABEL_TO_FIELD.has(h) && !EXPORT_ONLY_COLUMNS.includes(h));
  if (unknown.length) return { header, rows: [], error: `読めない列があります：${unknown.join('、')}（テンプレートの見出しに合わせてください）` };
  const dup = header.find((h, i) => h && header.indexOf(h) !== i);
  if (dup) return { header, rows: [], error: `「${dup}」の列が2つあります` };
  const rows: { line: number; cells: Map<CsvField, string> }[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim() || /^,*$/.test(lines[i].trim())) continue;
    const cells = splitCsvLine(lines[i]);
    const map = new Map<CsvField, string>();
    header.forEach((h, j) => { const f = LABEL_TO_FIELD.get(h); if (f) map.set(f, cells[j] ?? ''); });
    rows.push({ line: i + 1, cells: map });
  }
  if (rows.length > MAX_ROWS) return { header, rows: [], error: `一度に取り込めるのは${MAX_ROWS}行までです（${rows.length}行あります）。分けて取り込んでください` };
  return { header, rows, error: null };
}

/** CSVに個人番号が1件でも入っているか（入っていれば、サーバーは登録済みの番号と重複を確かめる） */
export function csvHasMyNumber(text: string): boolean {
  const { rows } = readEmployeeCsv(text);
  return rows.some(r => (r.cells.get('myNumber') ?? '').trim() !== '');
}

const PROFILE_FIELDS = ['lastName', 'firstName', 'lastNameKana', 'firstNameKana', 'birthDate', 'gender', 'hireDate', 'formerLastName', 'postalCode', 'prefecture', 'city', 'addressLine', 'building', 'phone', 'email', 'insuredPersonNumber', 'basicPensionNumber'] as const;

/** 取込の計画を立てる（新規・更新と変わる項目・変わらない行・誤りの行） */
export function planEmployeeCsv(text: string, ctx: CsvContext): CsvPlan {
  const plan: CsvPlan = { creates: [], updates: [], unchanged: [], errors: [] };
  const read = readEmployeeCsv(text);
  if (read.error) { plan.errors.push({ line: 1, employeeNumber: '', message: read.error }); return plan; }

  const byNumber = new Map(ctx.existing.map(e => [e.employeeNumber, e]));
  const nameBirth = (last: string, first: string, birth: string) => `${last.replace(/\s/g, '')}|${first.replace(/\s/g, '')}|${birth}`;
  const byNameBirth = new Map<string, CsvExisting>();
  for (const e of ctx.existing) {
    if (e.values.lastName && e.values.firstName && e.values.birthDate) byNameBirth.set(nameBirth(e.values.lastName, e.values.firstName, e.values.birthDate), e);
  }
  const myNumberOwner = new Map<string, string>();
  for (const [id, n] of ctx.myNumbers ?? []) myNumberOwner.set(n, id);
  const numberOf = new Map(ctx.existing.map(e => [e.id, e.employeeNumber]));

  // ファイルの中の重複（最初の行は通し、2行目以降を誤りにする）
  const seenNumber = new Map<string, number>();
  const seenMyNumber = new Map<string, number>();
  const seenNameBirth = new Map<string, number>();

  const findOffice = (raw: string): CsvOffice | null => {
    const v = raw.trim();
    return ctx.offices.find(o => o.name === v) ?? ctx.offices.find(o => !!o.officeNumber && o.officeNumber === v) ?? ctx.offices.find(o => o.id === v) ?? null;
  };

  for (const row of read.rows) {
    const errs: string[] = [];
    const val: Partial<Record<CsvField, string | null>> = {};
    for (const col of EMPLOYEE_CSV_COLUMNS) {
      if (!row.cells.has(col.field)) continue;
      const r = normalizeCell(col.field, row.cells.get(col.field) ?? '');
      if ('message' in r) errs.push(r.message); else val[col.field] = r.value;
    }
    const employeeNumber = val.employeeNumber ?? (row.cells.get('employeeNumber') ?? '').trim();
    const pushErr = (message: string) => plan.errors.push({ line: row.line, employeeNumber, message });
    if (!val.employeeNumber) { pushErr(errs[0] ?? '社員番号を入れてください'); continue; }

    const current = byNumber.get(employeeNumber) ?? null;
    if (current && !current.isActive) errs.push('退職した従業員は取込で直せません（従業員の画面で直してください）');
    if (!current) {
      const missing = EMPLOYEE_CSV_COLUMNS.filter(c => c.required && !val[c.field]).map(c => c.label);
      if (missing.length) errs.push(`新しく登録するには、次の項目が要ります：${missing.join('・')}`);
    }

    // 事業所と部署（名前で書く。整理記号も可）
    let officeId = current?.officeId ?? '';
    if (val.office) {
      const office = findOffice(val.office);
      if (!office) errs.push(`事業所「${val.office}」が見つかりません（設定の事業所名で書いてください）`);
      else if (office.abolished) errs.push(`事業所「${office.name}」は廃止しています`);
      else if (current && office.id !== current.officeId) errs.push('事業所を変えるときは、異動の手続き（従業員の画面の「異動」）で行ってください');
      else officeId = office.id;
    }
    if (officeId && ctx.allowedOfficeIds && !ctx.allowedOfficeIds.includes(officeId)) errs.push('担当事業所外の従業員です');
    let departmentId: string | null | undefined;
    if (val.department && officeId) {
      const dep = ctx.departments.find(d => d.officeId === officeId && d.name === val.department);
      if (!dep) errs.push(`部署「${val.department}」はこの事業所にありません（設定の部署で作ってください）`);
      else if (!dep.isActive) errs.push(`部署「${dep.name}」は使わない部署にしてあります`);
      else departmentId = dep.id;
    }

    // 重複：社員番号・個人番号・氏名＋生年月日
    if (seenNumber.has(employeeNumber)) errs.push(`同じ社員番号の行がもう1つあります（${seenNumber.get(employeeNumber)}行目）`);
    else seenNumber.set(employeeNumber, row.line);
    const last = val.lastName ?? current?.values.lastName ?? '';
    const first = val.firstName ?? current?.values.firstName ?? '';
    const birth = val.birthDate ?? current?.values.birthDate ?? '';
    if (last && first && birth) {
      const key = nameBirth(last, first, birth);
      if (seenNameBirth.has(key)) errs.push(`氏名と生年月日が同じ行がもう1つあります（${seenNameBirth.get(key)}行目）`);
      else seenNameBirth.set(key, row.line);
      const other = byNameBirth.get(key);
      if (other && other.id !== current?.id) errs.push(`氏名と生年月日が同じ従業員がもう登録されています（社員番号 ${other.employeeNumber}）`);
    }
    if (val.myNumber) {
      if (seenMyNumber.has(val.myNumber)) errs.push(`同じ個人番号の行がもう1つあります（${seenMyNumber.get(val.myNumber)}行目）`);
      else seenMyNumber.set(val.myNumber, row.line);
      const owner = myNumberOwner.get(val.myNumber);
      if (owner && owner !== current?.id) errs.push(`この個人番号は別の従業員（社員番号 ${numberOf.get(owner) ?? '不明'}）に登録されています`);
    }

    if (errs.length) { for (const m of errs) pushErr(m); continue; }

    const name = `${last} ${first}`.trim();
    const fields: Record<string, string | null> = {};
    const changes: CsvChange[] = [];
    for (const f of PROFILE_FIELDS) {
      const v = val[f];
      if (v === undefined || v === null) continue; // 空欄は変えない（新規では入れない）
      const before = current?.values[f] ?? null;
      if (!current || before !== v) {
        fields[f] = v;
        changes.push({ label: EMPLOYEE_CSV_COLUMNS.find(c => c.field === f)!.label, from: current ? shown(f, before) : '', to: shown(f, v) });
      }
    }
    if (departmentId !== undefined && (!current || current.departmentId !== departmentId)) {
      changes.push({ label: '部署', from: current ? (ctx.departments.find(d => d.id === current.departmentId)?.name ?? '（なし）') : '', to: val.department ?? '' });
    }
    let myNumber: string | null = null;
    if (val.myNumber) {
      const same = current ? ctx.myNumbers?.get(current.id) === val.myNumber : false;
      if (!same) {
        myNumber = val.myNumber;
        changes.push({ label: '個人番号', from: current ? (current.hasMyNumber ? MASK : '（未登録）') : '', to: current?.hasMyNumber ? '新しい番号（伏せています）' : '登録する（伏せています）' });
      }
    }

    const entry: CsvRowPlan = {
      line: row.line, employeeNumber, name, kind: current ? 'update' : 'create', employeeId: current?.id ?? null,
      expectedVersion: current?.version ?? null, officeId, fields, myNumber, changes,
      ...(departmentId !== undefined && (!current || current.departmentId !== departmentId) ? { departmentId } : {}),
    };
    if (!current) plan.creates.push(entry);
    else if (changes.length) plan.updates.push(entry);
    else plan.unchanged.push({ line: row.line, employeeNumber, name });
  }
  return plan;
}

/** テンプレート（見出し＋見本1行）。見出しの * は新規で必須 */
export function employeeCsvTemplate(): string {
  const header = EMPLOYEE_CSV_COLUMNS.map(c => (c.required ? `${c.label}*` : c.label));
  const sample = ['1001', '山田', '太郎', 'ヤマダ', 'タロウ', '1990-04-01', '男', '本社', '', '2026-04-01', '', '100-0001', '東京都', '千代田区', '千代田1-1', '', '03-1234-5678', 'yamada@example.com', '', '', ''];
  return '﻿' + [header.join(','), sample.join(',')].join('\r\n') + '\r\n';
}
