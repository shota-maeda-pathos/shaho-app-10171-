import { addDays } from '../../insurance/calculator';
import { filingDeadline } from '../../filings/index/rules';

// 承認の索引（横断の承認一覧用）の中身を決める純粋関数。
// 承認は2か所にある：従業員の下の承認申請（給与・保険料・賞与・等級・雇用条件・届出）と、
// 算定基礎届・賞与支払届（run の届出が status で承認待ち・承認済みを持つ）。ここで1つの形にそろえる。

export type ApprovalKind = 'request' | 'runFiling';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

type Data = Record<string, any>;

export interface ApprovalIndexEntry {
  kind: ApprovalKind;
  /** 承認申請のID（run の届出は届出のID） */
  requestId: string;
  employeeId: string | null;
  employeeName: string;
  employeeNumber: string;
  officeId: string;
  officeName: string;
  requestType: string;
  /** 届出の承認なら届出の種類 */
  filingType: string | null;
  source: 'employee' | 'santei' | 'bonus' | null;
  /** run の届出：run のID・届出のID・年・支給月・人数 */
  parentId: string | null;
  filingId: string | null;
  year: number | null;
  payMonth: string | null;
  personCount: number;
  status: ApprovalStatus;
  requestedBy: string | null;
  requestedByName: string;
  requestedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  comment: string | null;
  targetPath: string;
  targetVersion: number;
  /** 届出の提出期限（届出の承認だけ） */
  deadline: string | null;
  deadlineNote: string | null;
  /** 承認者が一覧で目にする要点（金額・対象月など） */
  summary: string;
  /** どの手続き・画面からの依頼か */
  origin: string | null;
}

const iso = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  const t = v as { toDate?: () => Date };
  return typeof t.toDate === 'function' ? t.toDate().toISOString() : null;
};

const yen = (n: unknown) => (typeof n === 'number' ? `${n.toLocaleString('ja-JP')}円` : '—');

/** 承認者が一覧で目にする要点 */
export function summaryOf(requestType: string, snap: Data, meta: Data | null): string {
  switch (requestType) {
    case 'salary':
      return `${snap.yearMonth ?? ''}支給 ${snap.noPay ? '無給' : `支給額 ${yen(snap.totalSalary)}`}`;
    case 'monthlyInsurance':
      return `${snap.yearMonth ?? ''}分 本人 ${yen(snap.totalEmployeeAmount)}／会社 ${yen(snap.totalEmployerAmount)}`;
    case 'bonus':
      return `${snap.yearMonth ?? ''} 賞与額 ${yen(snap.totalAmount ?? snap.totalBonusAmount)}`;
    case 'bonusInsurance':
      return `${snap.yearMonth ?? ''} 賞与の保険料 本人 ${yen(snap.totalEmployeeAmount)}／会社 ${yen(snap.totalEmployerAmount)}`;
    case 'grade': {
      const m = meta ?? {};
      return `${m.effectiveMonth ?? ''}から 健保${m.healthGradeNumber ?? '—'}等級・厚年${m.pensionGradeNumber ?? '—'}等級${m.basisRemuneration ? `（報酬月額 ${yen(m.basisRemuneration)}）` : ''}`;
    }
    case 'employment':
      return `雇用条件 ${snap.employmentType ?? ''} ${snap.plannedEffectiveDate ?? iso(snap.effectiveDate)?.slice(0, 10) ?? ''}`.trim();
    case 'filing': {
      const g = meta?.grade as Data | undefined;
      return g ? `等級も確定：健保${g.healthGradeNumber}・厚年${g.pensionGradeNumber}（${g.effectiveMonth}から）` : '';
    }
    default:
      return '';
  }
}

/** 従業員の下の承認申請から索引の1件を作る */
export function buildRequestEntry(input: {
  requestId: string; employeeId: string; data: Data;
  employee: Data | null; office: Data | null; requester: Data | null; target: Data | null;
}): ApprovalIndexEntry {
  const d = input.data;
  const e = input.employee;
  const snap = (d.snapshotData ?? {}) as Data;
  const target = input.target ?? snap;
  const isFiling = d.requestType === 'filing';
  const { deadline, note } = isFiling ? filingDeadline(String(target.filingType ?? ''), target) : { deadline: null, note: null };
  return {
    kind: 'request',
    requestId: input.requestId,
    employeeId: input.employeeId,
    employeeName: e ? `${e.lastName ?? ''} ${e.firstName ?? ''}`.trim() : '',
    employeeNumber: e?.employeeNumber ?? '',
    officeId: e?.officeId ?? '',
    officeName: input.office?.name ?? '',
    requestType: d.requestType,
    filingType: isFiling ? (target.filingType ?? null) : null,
    source: isFiling ? 'employee' : null,
    parentId: isFiling ? input.employeeId : null,
    filingId: isFiling ? String(d.targetPath ?? '').split('/').pop() ?? null : null,
    year: null,
    payMonth: null,
    personCount: 1,
    status: d.status,
    requestedBy: d.requestedBy ?? null,
    requestedByName: input.requester?.displayName ?? '',
    requestedAt: iso(d.requestedAt),
    reviewedBy: d.reviewedBy ?? null,
    reviewedAt: iso(d.reviewedAt),
    comment: d.comment ?? null,
    targetPath: d.targetPath,
    targetVersion: d.targetVersion ?? 0,
    deadline,
    deadlineNote: note,
    summary: summaryOf(d.requestType, snap, (d.metadata ?? null) as Data | null),
    origin: (d.metadata?.source as string | undefined) ?? null,
  };
}

/**
 * 算定基礎届・賞与支払届（run の届出）の承認の状態。承認を依頼したことのない下書き・取り消しは索引に載せない（null）
 */
export function runApprovalStatus(f: Data): ApprovalStatus | null {
  if (!f.requestedAt) return null;
  if (f.status === 'pending') return 'pending';
  if (f.status === 'approved' || f.status === 'submitted') return 'approved';
  if (f.status === 'draft' && f.rejection) return 'rejected';
  if (f.status === 'draft' && f.approvalCancelledAt) return 'cancelled';
  return null;
}

export function buildRunFilingEntry(input: {
  source: 'santei' | 'bonus'; parentId: string; filingId: string; path: string; data: Data; office: Data | null; requester: Data | null;
}): ApprovalIndexEntry | null {
  const f = input.data;
  const status = runApprovalStatus(f);
  if (!status) return null;
  const { deadline, note } = filingDeadline(String(f.filingType ?? ''), f);
  const persons = Array.isArray(f.employeeIds) ? f.employeeIds.length : 0;
  const label = input.source === 'santei' ? `${f.year}年の算定基礎届` : `${f.payMonth}支給の賞与支払届`;
  return {
    kind: 'runFiling',
    requestId: input.filingId,
    employeeId: null,
    employeeName: '',
    employeeNumber: '',
    officeId: f.officeId ?? input.parentId.replace(/_[^_]+$/, ''),
    officeName: input.office?.name ?? '',
    requestType: 'filing',
    filingType: f.filingType ?? null,
    source: input.source,
    parentId: input.parentId,
    filingId: input.filingId,
    year: typeof f.year === 'number' ? f.year : null,
    payMonth: typeof f.payMonth === 'string' ? f.payMonth : null,
    personCount: persons,
    status,
    requestedBy: f.requestedBy ?? null,
    requestedByName: input.requester?.displayName ?? '',
    requestedAt: iso(f.requestedAt),
    reviewedBy: f.approvedBy ?? f.rejection?.by ?? null,
    reviewedAt: iso(f.approvedAt) ?? iso(f.rejection?.at),
    comment: f.rejection?.comment ?? null,
    targetPath: input.path,
    targetVersion: f.version ?? 0,
    deadline,
    deadlineNote: note,
    summary: `${label}（${f.number}件目・${persons}名）`,
    origin: input.source,
  };
}

/** 期限を過ぎた承認待ちか */
export const isOverdue = (e: Pick<ApprovalIndexEntry, 'deadline' | 'status'>, today: string) =>
  e.status === 'pending' && !!e.deadline && e.deadline < today;

/** 期限が近い（今日から days 日以内）承認待ちか */
export const isDueSoon = (e: Pick<ApprovalIndexEntry, 'deadline' | 'status'>, today: string, days = 2) =>
  e.status === 'pending' && !!e.deadline && e.deadline >= today && e.deadline <= addDays(today, days);

/** 一定の日数より長く止まっている承認待ちか（依頼した日から数える） */
export function isStale(e: Pick<ApprovalIndexEntry, 'requestedAt' | 'status'>, now: Date, staleDays: number): boolean {
  if (e.status !== 'pending' || !e.requestedAt) return false;
  return now.getTime() - new Date(e.requestedAt).getTime() >= staleDays * 86400_000;
}

/** 差分を比べない項目（状態・版・日時など、提出する中身でないもの） */
const IGNORED = new Set([
  'version', 'createdAt', 'updatedAt', 'workflowStatus', 'mockStatus', 'mockAcceptanceNumber', 'mockSubmittedAt', 'mockValidationErrors',
  'submissionStatus', 'submittedAt', 'resultReceivedAt', 'resultNote', 'mock', 'paper', 'approvalPending', 'isConfirmed', 'confirmedAt',
  'confirmedBy', 'lastRejection', 'approvedHash', 'approvedAt', 'approvedBy', 'requestedAt', 'requestedBy', 'status', 'rejection',
  'submission', 'cancelledAt', 'cancelledBy', 'approvalCancelledAt', 'approvalCancelledBy', 'calculatedAt', 'calculatedBy',
]);

function flatten(value: unknown, prefix: string, out: Map<string, string>) {
  if (value === null || value === undefined) { if (prefix) out.set(prefix, ''); return; }
  const t = value as { toDate?: () => Date };
  if (typeof t.toDate === 'function') { out.set(prefix, t.toDate().toISOString().slice(0, 10)); return; }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i + 1}]`, out));
    if (!value.length && prefix) out.set(prefix, '');
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Data)) {
      if (!prefix && IGNORED.has(k)) continue;
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return;
  }
  out.set(prefix, typeof value === 'number' ? value.toLocaleString('ja-JP') : String(value));
}

export interface DiffRow { field: string; before: string; after: string }

/**
 * 前回の版との差分。届出は記入内容（formData）を、それ以外は対象の中身を比べる。
 * 項目名は「formData.」を外して届出の項目名のまま出す
 */
export function diffSnapshots(before: Data | null, after: Data | null): DiffRow[] {
  if (!before || !after) return [];
  const pick = (d: Data) => (d.formData ? { ...d.formData } : d);
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(pick(before), '', a);
  flatten(pick(after), '', b);
  const rows: DiffRow[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) ?? '';
    const y = b.get(key) ?? '';
    if (x !== y) rows.push({ field: key, before: x, after: y });
  }
  return rows.sort((p, q) => p.field.localeCompare(q.field, 'ja'));
}
