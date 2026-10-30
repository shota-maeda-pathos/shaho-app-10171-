// 提出（模擬電子申請と紙の提出）の状態遷移。Firestore に依存しない純粋関数だけを置く。
// 模擬電子申請：送信済み → 受付済み → 処理中 → 完了。送信済み（受付前）なら取り消せる。受付後は返戻になることがある。
// 紙の提出：提出済み → 受理／返戻。模擬電子申請とは別に持ち、混ぜない。

export type MockStatus = 'sent' | 'received' | 'processing' | 'completed' | 'failed' | 'returned' | 'cancelled';
export type MockScenario = 'normal' | 'timeout' | 'serverError' | 'validationError' | 'outOfHours';
export type PaperStatus = 'submitted' | 'accepted' | 'returned';

export interface HistoryEntry {
  status: string;
  /** ISO 8601 */
  at: string;
  by: string;
  note: string | null;
}

export interface MockState {
  status: MockStatus;
  scenario: MockScenario;
  acceptanceNumber: string | null;
  /** 送信した日時（ISO）と日付（東京の YYYY-MM-DD） */
  sentAt: string;
  sentDate: string;
  /** 自動で進めるか。手動で進めたら以後は自動で進めない */
  auto: boolean;
  /** 次の状態へ進む予定の日時（ISO）。進まない状態では null */
  nextAt: string | null;
  error: { code: MockScenario; message: string; details: string[] } | null;
  returnReason: string | null;
  history: HistoryEntry[];
}

export interface PaperState {
  status: PaperStatus;
  submittedDate: string;
  /** 提出先（年金事務所名など） */
  office: string;
  method: 'counter' | 'mail';
  resultDate: string | null;
  /** 決定通知の内容・返戻の理由 */
  resultNote: string | null;
  history: HistoryEntry[];
}

export interface MockSettings {
  auto: boolean;
  /** 送信から受付、受付から処理中、処理中から完了までの秒数 */
  receiveSeconds: number;
  processSeconds: number;
  completeSeconds: number;
}

export const DEFAULT_MOCK_SETTINGS: MockSettings = { auto: true, receiveSeconds: 10, processSeconds: 10, completeSeconds: 10 };

export const MOCK_STATUS_LABELS: Record<MockStatus, string> = {
  sent: '送信済み', received: '受付済み', processing: '処理中', completed: '完了',
  failed: '送信エラー', returned: '返戻', cancelled: '送信取消',
};

/** エラーのシミュレーションで出すメッセージ（模擬） */
export const SCENARIO_ERRORS: Record<Exclude<MockScenario, 'normal'>, string> = {
  timeout: '通信がタイムアウトしました（模擬）。時間をおいて、もう一度送信してください。',
  serverError: '申請先のサーバーでエラーが起きました（模擬・500系）。時間をおいて、もう一度送信してください。',
  validationError: '届出の内容に誤りがあるため受け付けられませんでした（模擬・データ形式エラー）。',
  outOfHours: '受付時間外のため送信できませんでした（模擬）。受付時間内に、もう一度送信してください。',
};

const IN_TRANSIT: MockStatus[] = ['sent', 'received', 'processing'];
export const isInTransit = (m: Pick<MockState, 'status'> | null | undefined) => !!m && IN_TRANSIT.includes(m.status);

/** 新しく送信できるか（未送信・送信エラー・送信取消のあと） */
export const canSend = (m: MockState | null | undefined) => !m || m.status === 'failed' || m.status === 'cancelled';

const plus = (iso: string, seconds: number) => new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
const jstDate = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

function delayAfter(status: MockStatus, s: MockSettings): number | null {
  if (status === 'sent') return s.receiveSeconds;
  if (status === 'received') return s.processSeconds;
  if (status === 'processing') return s.completeSeconds;
  return null;
}

const NEXT: Partial<Record<MockStatus, MockStatus>> = { sent: 'received', received: 'processing', processing: 'completed' };

/**
 * 送信する。必須項目が足りなければデータ形式エラー、シナリオがエラーならそのエラーで失敗にする。
 * 前回までの履歴は引き継ぐ
 */
export function sendMock(input: {
  prev: MockState | null; scenario: MockScenario; missing: string[]; settings: MockSettings; now: string; uid: string;
}): MockState {
  const { prev, scenario, missing, settings, now, uid } = input;
  if (!canSend(prev)) throw new Error('この届出は送信中か、すでに受け付けられています');
  const history = [...(prev?.history ?? [])];
  const failure: MockScenario | null = missing.length ? 'validationError' : scenario !== 'normal' ? scenario : null;
  if (failure) {
    const message = failure === 'validationError' && missing.length
      ? `必須項目が不足しているため受け付けられませんでした（模擬）：${missing.join('、')}`
      : SCENARIO_ERRORS[failure as Exclude<MockScenario, 'normal'>];
    history.push({ status: 'failed', at: now, by: uid, note: message });
    return {
      status: 'failed', scenario, acceptanceNumber: null, sentAt: now, sentDate: jstDate(now), auto: settings.auto, nextAt: null,
      error: { code: failure, message, details: missing }, returnReason: null, history,
    };
  }
  history.push({ status: 'sent', at: now, by: uid, note: null });
  return {
    status: 'sent', scenario, acceptanceNumber: null, sentAt: now, sentDate: jstDate(now), auto: settings.auto,
    nextAt: settings.auto ? plus(now, settings.receiveSeconds) : null, error: null, returnReason: null, history,
  };
}

/** 送信を取り消す（受付前だけ） */
export function cancelMock(m: MockState, now: string, uid: string): MockState {
  if (m.status !== 'sent') throw new Error(m.status === 'failed' ? '送信エラーの届出は取り消す必要がありません' : '受付済み以降は取り消せません（誤りは訂正届で直します）');
  return { ...m, status: 'cancelled', nextAt: null, history: [...m.history, { status: 'cancelled', at: now, by: uid, note: null }] };
}

/**
 * 1つ先の状態へ進める。受付済みになるときに受付番号を付ける（番号は呼び出し側が採番して渡す）。
 * manual のときは自動で進めるのをやめる
 */
export function stepMock(m: MockState, input: { now: string; by: string; settings: MockSettings; acceptanceNumber?: () => string; manual?: boolean }): MockState {
  const next = NEXT[m.status];
  if (!next) throw new Error('これ以上進められない状態です');
  const auto = input.manual ? false : m.auto;
  const delay = delayAfter(next, input.settings);
  const at = input.manual ? input.now : (m.nextAt ?? input.now);
  return {
    ...m,
    status: next,
    auto,
    acceptanceNumber: next === 'received' ? (input.acceptanceNumber?.() ?? m.acceptanceNumber) : m.acceptanceNumber,
    nextAt: auto && delay !== null ? plus(at, delay) : null,
    history: [...m.history, { status: next, at, by: input.by, note: input.manual ? '手動で進めた' : null }],
  };
}

/** 予定の時刻を過ぎた分だけ自動で進める（複数段階まとめて進むことがある） */
export function advanceDue(m: MockState, input: { now: string; settings: MockSettings; acceptanceNumber: () => string }): MockState {
  let cur = m;
  while (cur.auto && cur.nextAt && cur.nextAt <= input.now && NEXT[cur.status]) {
    cur = stepMock(cur, { now: input.now, by: 'system', settings: input.settings, acceptanceNumber: input.acceptanceNumber });
  }
  return cur;
}

/** 返戻にする（模擬。受付済み・処理中のときに管理者が行う） */
export function returnMock(m: MockState, reason: string, now: string, uid: string): MockState {
  if (m.status !== 'received' && m.status !== 'processing') throw new Error('受付済み・処理中の届出だけ返戻にできます');
  if (!reason.trim()) throw new Error('返戻の理由を入れてください');
  return { ...m, status: 'returned', auto: false, nextAt: null, returnReason: reason.trim(), history: [...m.history, { status: 'returned', at: now, by: uid, note: reason.trim() }] };
}

/** 模擬受付番号 MOCK-YYYYMMDD-0001（日ごとの連番） */
export function formatAcceptanceNumber(date: string, seq: number): string {
  return `MOCK-${date.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;
}

/** 紙で提出したことを記録する */
export function submitPaper(prev: PaperState | null, input: { date: string; office: string; method: 'counter' | 'mail'; now: string; uid: string }): PaperState {
  if (prev && prev.status !== 'returned') throw new Error('紙の提出はすでに記録されています');
  if (!input.office.trim()) throw new Error('提出先を入れてください');
  return {
    status: 'submitted', submittedDate: input.date, office: input.office.trim(), method: input.method, resultDate: null, resultNote: null,
    history: [...(prev?.history ?? []), { status: 'submitted', at: input.now, by: input.uid, note: `${input.date} ${input.office.trim()}（${input.method === 'counter' ? '窓口' : '郵送'}）` }],
  };
}

/** 紙の提出の結果（決定通知の受領・返戻）を記録する */
export function recordPaperResult(prev: PaperState | null, input: { result: 'accepted' | 'returned'; date: string; note: string; now: string; uid: string }): PaperState {
  if (!prev || prev.status !== 'submitted') throw new Error('提出済み（結果待ち）の届出だけ結果を記録できます');
  if (input.result === 'returned' && !input.note.trim()) throw new Error('返戻の理由を入れてください');
  return {
    ...prev, status: input.result, resultDate: input.date, resultNote: input.note.trim() || null,
    history: [...prev.history, { status: input.result, at: input.now, by: input.uid, note: input.note.trim() || null }],
  };
}

/** 提出を終えたか（模擬電子申請の完了、または紙の受理） */
export const isSubmitted = (mock: MockState | null | undefined, paper: PaperState | null | undefined) =>
  mock?.status === 'completed' || paper?.status === 'accepted';

/**
 * 従業員の下の届出に書く、旧来の項目（手続きの判定・ホームが読む）。
 * mockStatus：notStarted／sent／received／processing／completed／failed／returned
 */
export function employeeMirror(mock: MockState | null, paper: PaperState | null) {
  const mockStatus = !mock || mock.status === 'cancelled' ? 'notStarted' : mock.status;
  return {
    mockStatus,
    mockAcceptanceNumber: mock && mock.status !== 'cancelled' ? mock.acceptanceNumber : null,
    mockValidationErrors: mock?.status === 'failed' ? mock.error?.details ?? [] : [],
    submissionStatus: paper?.status ?? 'notSubmitted',
    resultNote: paper?.status === 'returned' || paper?.status === 'accepted' ? paper.resultNote : null,
  };
}

/**
 * 算定基礎届・賞与支払届（run の届出）に書く status と submission。
 * 提出済み（submitted）は、模擬電子申請の完了か紙で提出したとき。送信中は承認済みのまま
 */
export function runMirror(mock: MockState | null, paper: PaperState | null) {
  if (mock?.status === 'completed') {
    return { status: 'submitted', submission: { method: 'mock', date: mock.sentDate, acceptanceNumber: mock.acceptanceNumber } };
  }
  if (paper && paper.status !== 'returned') {
    return { status: 'submitted', submission: { method: 'paper', date: paper.submittedDate, acceptanceNumber: null } };
  }
  return { status: 'approved', submission: null };
}

const dateOfTs = (v: unknown): string | null => {
  const t = v as { toDate?: () => Date } | null;
  return t?.toDate ? t.toDate().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) : null;
};

/**
 * 提出の状態。段階7より前に提出した届出（mock・paper を持たない）は、旧来の項目から組み立てる
 */
export function stateOf(source: 'employee' | 'santei' | 'bonus', data: Record<string, any>): { mock: MockState | null; paper: PaperState | null } {
  let mock = (data.mock ?? null) as MockState | null;
  let paper = (data.paper ?? null) as PaperState | null;
  const legacy = (status: MockState['status'], number: string | null, date: string | null, errors: string[] = []): MockState => ({
    status, scenario: 'normal', acceptanceNumber: number, sentAt: date ? `${date}T00:00:00+09:00` : '', sentDate: date ?? '', auto: false, nextAt: null,
    error: status === 'failed' ? { code: 'validationError', message: `必須項目が不足しています：${errors.join('、')}`, details: errors } : null,
    returnReason: null, history: [],
  });
  const legacyPaper = (status: PaperState['status'], date: string | null, note: string | null): PaperState => ({
    status, submittedDate: date ?? '', office: '', method: 'counter', resultDate: null, resultNote: note, history: [],
  });
  if (source === 'employee') {
    if (!mock && (data.mockStatus === 'completed' || data.mockStatus === 'failed')) {
      mock = legacy(data.mockStatus, data.mockAcceptanceNumber ?? null, dateOfTs(data.mockSubmittedAt), data.mockValidationErrors ?? []);
    }
    if (!paper && ['submitted', 'accepted', 'returned'].includes(data.submissionStatus)) {
      paper = legacyPaper(data.submissionStatus, dateOfTs(data.submittedAt), data.resultNote ?? null);
    }
  } else if (!mock && !paper && data.status === 'submitted' && data.submission) {
    if (data.submission.method === 'mock') mock = legacy('completed', data.submission.acceptanceNumber ?? null, data.submission.date ?? null);
    else paper = legacyPaper('submitted', data.submission.date ?? null, null);
  }
  return { mock, paper };
}
