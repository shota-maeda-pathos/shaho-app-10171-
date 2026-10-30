import { correspondingDayNextMonth, extendToOpenDay, fiveDayDeadline } from '../../insurance/calculator';
import { stateOf } from '../submission/rules';

// 届出の索引（横断一覧・検索用）の中身を決める純粋関数。
// 届出は3か所（従業員の下・算定基礎届の run・賞与の run）にあり、状態の持ち方も違うため、ここで1つの形にそろえる。

export type FilingSource = 'employee' | 'santei' | 'bonus';

/** 画面に出す状態（カタログの状態名）。紙の提出は paperStatus で別に持つ */
export type FilingStatus =
  | 'draft' | 'rejected' | 'pending' | 'approved'
  | 'sent' | 'received' | 'processing' | 'completed' | 'mockFailed' | 'returned' | 'cancelled';

export type PaperStatus = 'none' | 'submitted' | 'accepted' | 'returned';

/** 提出期限が「速やかに」の届出 */
const PROMPTLY = new Set([
  'remunerationMonthlyChange', 'maternityLeaveEndChange', 'childcareLeaveEndChange',
  'childcareLeaveStart', 'childcareLeaveEnd', 'bonusNonPayment', 'correction', 'cancellation',
]);

type Data = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * 届出の法定の期限（YYYY-MM-DD。休日なら翌開庁日）。日付で決まらない届出は null と note を返す。
 * 届出に期限が書かれていればそれを使い、なければ種類と記入内容から計算する。
 */
export function filingDeadline(filingType: string, data: Data): { deadline: string | null; note: string | null } {
  const stored = str(data.deadline);
  if (stored) return { deadline: extendToOpenDay(stored), note: null };
  const form = (data.formData ?? {}) as Data;
  const effective = str(data.effectiveDate);
  switch (filingType) {
    case 'acquisitionNotification': {
      const d = str(form['資格取得年月日']) ?? effective;
      return { deadline: d ? fiveDayDeadline(d) : null, note: d ? null : '取得日から5日' };
    }
    case 'lossNotification':
    case 'pensionLoss70': {
      const d = str(form['資格喪失年月日']) ?? effective;
      return { deadline: d ? fiveDayDeadline(d) : null, note: d ? null : '喪失日から5日' };
    }
    case 'dependentChange': {
      const list = Array.isArray(form['被扶養者一覧']) ? (form['被扶養者一覧'] as Data[]) : [];
      const dates = list.map(i => str(i['異動年月日'])).filter((d): d is string => !!d).sort();
      const d = dates[0] ?? str(form['届出年月日']) ?? effective;
      return { deadline: d ? fiveDayDeadline(d) : null, note: d ? null : '異動日から5日' };
    }
    case 'bonusPayment': {
      const d = str(form['賞与支払年月日']) ?? effective;
      return { deadline: d ? fiveDayDeadline(d) : null, note: d ? null : '支給日から5日' };
    }
    case 'remunerationMonthlyAlgorithm': {
      const year = Number(data.year ?? form['対象年']);
      return year ? { deadline: extendToOpenDay(`${year}-07-10`), note: null } : { deadline: null, note: '7月10日' };
    }
    case 'maternityLeaveStart':
    case 'maternityLeaveChange': {
      // 産休中、または産休の終了から1か月以内
      const end = str(form['産前産後休業終了年月日']) ?? str(form['産前産後休業終了予定年月日']);
      return end ? { deadline: extendToOpenDay(correspondingDayNextMonth(end)), note: null } : { deadline: null, note: '産休の終了から1か月' };
    }
    default:
      return { deadline: null, note: PROMPTLY.has(filingType) ? '速やかに' : null };
  }
}

const MOCK_TO_STATUS: Record<string, FilingStatus | null> = {
  sent: 'sent', received: 'received', processing: 'processing', completed: 'completed', failed: 'mockFailed', returned: 'returned', cancelled: null,
};

/** 提出（模擬電子申請・紙）の状態を画面の状態にする。承認済みでなければ null */
function submissionStatusOf(source: FilingSource, data: Data): { status: FilingStatus | null; paperStatus: PaperStatus } {
  const { mock, paper } = stateOf(source, data);
  const paperStatus = paper?.status ?? 'none';
  // 模擬電子申請が送信エラーのまま紙で出したときは、送信エラーを状態に出さない（紙の提出の欄で見せる）
  const status = mock ? MOCK_TO_STATUS[mock.status] : null;
  return { status: status === 'mockFailed' && (paperStatus === 'submitted' || paperStatus === 'accepted') ? null : status, paperStatus };
}

/** 従業員の下の届出（社内承認・模擬申請・紙提出の3軸）を画面の状態にする */
export function employeeFilingStatus(data: Data): { status: FilingStatus; paperStatus: PaperStatus } {
  const workflow = data.workflowStatus as string;
  const sub = submissionStatusOf('employee', data);
  const paperStatus = sub.paperStatus;
  if (data.cancelledAt || workflow === 'cancelled') return { status: 'cancelled', paperStatus };
  if (workflow === 'approved') return { status: sub.status ?? 'approved', paperStatus };
  if (workflow === 'pending') return { status: 'pending', paperStatus };
  if (workflow === 'rejected') return { status: 'rejected', paperStatus };
  return { status: 'draft', paperStatus };
}

/** 算定基礎届・賞与支払届（run の下。status 1本と submission）を画面の状態にする */
export function runFilingStatus(data: Data): { status: FilingStatus; paperStatus: PaperStatus } {
  const s = data.status as string;
  if (s === 'cancelled') return { status: 'cancelled', paperStatus: 'none' };
  if (s === 'approved' || s === 'submitted') {
    const sub = submissionStatusOf('santei', data);
    return { status: sub.status ?? 'approved', paperStatus: sub.paperStatus };
  }
  if (s === 'pending') return { status: 'pending', paperStatus: 'none' };
  return { status: data.rejection ? 'rejected' : 'draft', paperStatus: 'none' };
}

/** まだ提出していない（期限超過の対象になる）か。完了・送信中・紙で提出済み・取消は対象外 */
export function isOpen(status: FilingStatus, paperStatus: PaperStatus): boolean {
  if (status === 'cancelled') return false;
  if (paperStatus === 'submitted' || paperStatus === 'accepted') return false;
  return ['draft', 'rejected', 'pending', 'approved', 'mockFailed', 'returned'].includes(status);
}

const dateOf = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return str(v);
  const t = v as { toDate?: () => Date };
  if (typeof t.toDate === 'function') return t.toDate().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  return null;
};

export interface FilingIndexEntry {
  source: FilingSource;
  path: string;
  filingId: string;
  /** 従業員の下の届出なら従業員ID、run の届出なら run のID */
  parentId: string;
  employeeId: string | null;
  employeeName: string;
  employeeNumber: string;
  personCount: number;
  officeId: string;
  officeName: string;
  filingType: string;
  /** run の届出の番号（何件目か） */
  number: number | null;
  /** 算定基礎届の年・賞与の支給月（画面のリンク用） */
  year: number | null;
  payMonth: string | null;
  status: FilingStatus;
  paperStatus: PaperStatus;
  open: boolean;
  deadline: string | null;
  deadlineNote: string | null;
  effectiveDate: string | null;
  acceptanceNumber: string | null;
  createdDate: string | null;
  submittedDate: string | null;
  rejection: string | null;
  version: number;
}

export interface IndexContext {
  source: FilingSource;
  path: string;
  filingId: string;
  parentId: string;
  employee?: { lastName?: string; firstName?: string; employeeNumber?: string; officeId?: string } | null;
  office?: { name?: string } | null;
  /** run の届出の事業所（run のIDは `{officeId}_{年 or 支給月}`） */
  runOfficeId?: string;
}

/** 届出1件から索引の1件を作る */
export function buildIndexEntry(data: Data, ctx: IndexContext): FilingIndexEntry {
  const filingType = String(data.filingType ?? '');
  const { status, paperStatus } = ctx.source === 'employee' ? employeeFilingStatus(data) : runFilingStatus(data);
  const { deadline, note } = filingDeadline(filingType, data);
  const persons = Array.isArray(data.employeeIds) ? (data.employeeIds as string[]).length : 1;
  const submission = (data.submission ?? null) as { date?: string; acceptanceNumber?: string | null } | null;
  const rejection = data.rejection as { comment?: string } | string | null | undefined;
  const e = ctx.employee ?? null;
  const { mock: mockState, paper: paperState } = stateOf(ctx.source, data);
  // 送信取消・送信エラーの受付番号・送信日は出さない
  const liveMock = mockState && mockState.status !== 'cancelled' && mockState.status !== 'failed' ? mockState : null;
  return {
    source: ctx.source,
    path: ctx.path,
    filingId: ctx.filingId,
    parentId: ctx.parentId,
    employeeId: ctx.source === 'employee' ? ctx.parentId : null,
    employeeName: e ? `${e.lastName ?? ''} ${e.firstName ?? ''}`.trim() : '',
    employeeNumber: e?.employeeNumber ?? '',
    personCount: persons,
    officeId: (ctx.source === 'employee' ? e?.officeId : (data.officeId as string) ?? ctx.runOfficeId) ?? '',
    officeName: ctx.office?.name ?? '',
    filingType,
    number: typeof data.number === 'number' ? data.number : null,
    year: typeof data.year === 'number' ? data.year : null,
    payMonth: typeof data.payMonth === 'string' ? data.payMonth : null,
    status,
    paperStatus,
    open: isOpen(status, paperStatus),
    deadline,
    deadlineNote: note,
    effectiveDate: dateOf(data.effectiveDate),
    acceptanceNumber: liveMock?.acceptanceNumber ?? (data.mockAcceptanceNumber as string) ?? submission?.acceptanceNumber ?? null,
    createdDate: dateOf(data.createdAt),
    submittedDate: liveMock?.sentDate || paperState?.submittedDate || dateOf(data.mockSubmittedAt) || dateOf(data.submittedAt) || str(submission?.date) || null,
    rejection: typeof rejection === 'string' ? rejection : rejection?.comment ?? null,
    version: typeof data.version === 'number' ? data.version : 0,
  };
}

/** 索引のドキュメントID */
export function indexIdOf(source: FilingSource, parentId: string, filingId: string): string {
  return `${source}_${parentId}_${filingId}`;
}

/** 期限超過か（期限があり、まだ提出しておらず、今日が期限より後） */
export function isOverdue(entry: Pick<FilingIndexEntry, 'deadline' | 'open'>, today: string): boolean {
  return !!entry.deadline && entry.open && entry.deadline < today;
}
