import {
  advanceDue, cancelMock, DEFAULT_MOCK_SETTINGS, employeeMirror, formatAcceptanceNumber, recordPaperResult, returnMock, runMirror, sendMock,
  stepMock, submitPaper,
} from './rules';

const T0 = '2026-10-30T03:00:00.000Z';
const at = (sec: number) => new Date(new Date(T0).getTime() + sec * 1000).toISOString();
const settings = DEFAULT_MOCK_SETTINGS;
let seq = 0;
const number = () => formatAcceptanceNumber('2026-10-30', ++seq);

describe('模擬電子申請', () => {
  beforeEach(() => { seq = 0; });

  it('送信すると送信済みになり、10秒ごとに受付済み→処理中→完了へ進む', () => {
    const sent = sendMock({ prev: null, scenario: 'normal', missing: [], settings, now: T0, uid: 'u1' });
    expect(sent).toMatchObject({ status: 'sent', sentDate: '2026-10-30', nextAt: at(10), acceptanceNumber: null });
    expect(advanceDue(sent, { now: at(9), settings, acceptanceNumber: number }).status).toBe('sent');
    const received = advanceDue(sent, { now: at(15), settings, acceptanceNumber: number });
    expect(received).toMatchObject({ status: 'received', acceptanceNumber: 'MOCK-20261030-0001', nextAt: at(20) });
    // しばらく誰も見ていなくても、まとめて完了まで進む
    const done = advanceDue(sent, { now: at(60), settings, acceptanceNumber: number });
    expect(done.status).toBe('completed');
    expect(done.nextAt).toBeNull();
    expect(done.history.map(h => h.status)).toEqual(['sent', 'received', 'processing', 'completed']);
  });

  it('必須項目が足りなければデータ形式エラー', () => {
    const m = sendMock({ prev: null, scenario: 'normal', missing: ['生年月日'], settings, now: T0, uid: 'u1' });
    expect(m.status).toBe('failed');
    expect(m.error).toMatchObject({ code: 'validationError', details: ['生年月日'] });
  });

  it('エラーのシミュレーションで失敗し、送り直せる', () => {
    const failed = sendMock({ prev: null, scenario: 'timeout', missing: [], settings, now: T0, uid: 'u1' });
    expect(failed.error?.code).toBe('timeout');
    const retry = sendMock({ prev: failed, scenario: 'normal', missing: [], settings, now: at(30), uid: 'u1' });
    expect(retry.status).toBe('sent');
    expect(retry.history.map(h => h.status)).toEqual(['failed', 'sent']);
  });

  it('送信済み（受付前）だけ取り消せる。取り消したら送り直せる', () => {
    const sent = sendMock({ prev: null, scenario: 'normal', missing: [], settings, now: T0, uid: 'u1' });
    const cancelled = cancelMock(sent, at(3), 'u1');
    expect(cancelled.status).toBe('cancelled');
    expect(() => sendMock({ prev: sent, scenario: 'normal', missing: [], settings, now: T0, uid: 'u1' })).toThrow();
    expect(sendMock({ prev: cancelled, scenario: 'normal', missing: [], settings, now: at(5), uid: 'u1' }).status).toBe('sent');
    const received = stepMock(sent, { now: at(10), by: 'system', settings, acceptanceNumber: number });
    expect(() => cancelMock(received, at(11), 'u1')).toThrow('受付済み以降は取り消せません');
  });

  it('手動で進めると、以後は自動で進まない', () => {
    const sent = sendMock({ prev: null, scenario: 'normal', missing: [], settings, now: T0, uid: 'u1' });
    const m = stepMock(sent, { now: at(2), by: 'admin', settings, acceptanceNumber: number, manual: true });
    expect(m).toMatchObject({ status: 'received', auto: false, nextAt: null, acceptanceNumber: 'MOCK-20261030-0001' });
    expect(advanceDue(m, { now: at(100), settings, acceptanceNumber: number }).status).toBe('received');
  });

  it('自動で進めない設定なら送信済みのまま', () => {
    const m = sendMock({ prev: null, scenario: 'normal', missing: [], settings: { ...settings, auto: false }, now: T0, uid: 'u1' });
    expect(m.nextAt).toBeNull();
    expect(advanceDue(m, { now: at(100), settings, acceptanceNumber: number }).status).toBe('sent');
  });

  it('受付後に返戻にできる（理由が要る）', () => {
    const sent = sendMock({ prev: null, scenario: 'normal', missing: [], settings, now: T0, uid: 'u1' });
    expect(() => returnMock(sent, '記載誤り', at(1), 'admin')).toThrow();
    const received = stepMock(sent, { now: at(10), by: 'system', settings, acceptanceNumber: number });
    expect(() => returnMock(received, ' ', at(11), 'admin')).toThrow('理由');
    expect(returnMock(received, '生年月日の誤り', at(11), 'admin')).toMatchObject({ status: 'returned', returnReason: '生年月日の誤り', nextAt: null });
  });

  it('受付番号は日ごとの4桁の連番', () => {
    expect(formatAcceptanceNumber('2026-10-30', 12)).toBe('MOCK-20261030-0012');
  });
});

describe('紙の提出', () => {
  it('提出→受理を記録する', () => {
    const p = submitPaper(null, { date: '2026-10-30', office: '品川年金事務所', method: 'counter', now: T0, uid: 'u1' });
    expect(p).toMatchObject({ status: 'submitted', office: '品川年金事務所', method: 'counter' });
    expect(() => submitPaper(p, { date: '2026-10-31', office: 'x', method: 'mail', now: T0, uid: 'u1' })).toThrow();
    const r = recordPaperResult(p, { result: 'accepted', date: '2026-11-05', note: '決定通知書を受領', now: T0, uid: 'u1' });
    expect(r).toMatchObject({ status: 'accepted', resultDate: '2026-11-05', resultNote: '決定通知書を受領' });
  });

  it('返戻は理由が要り、返戻のあとは出し直せる', () => {
    const p = submitPaper(null, { date: '2026-10-30', office: '品川年金事務所', method: 'mail', now: T0, uid: 'u1' });
    expect(() => recordPaperResult(p, { result: 'returned', date: '2026-11-05', note: '', now: T0, uid: 'u1' })).toThrow();
    const r = recordPaperResult(p, { result: 'returned', date: '2026-11-05', note: '添付書類不足', now: T0, uid: 'u1' });
    expect(submitPaper(r, { date: '2026-11-06', office: '品川年金事務所', method: 'mail', now: T0, uid: 'u1' }).history).toHaveLength(3);
  });
});

describe('旧来の項目への反映', () => {
  it('従業員の届出：送信取消は未送信に戻る', () => {
    const sent = sendMock({ prev: null, scenario: 'normal', missing: [], settings, now: T0, uid: 'u1' });
    expect(employeeMirror(sent, null)).toMatchObject({ mockStatus: 'sent', submissionStatus: 'notSubmitted' });
    expect(employeeMirror(cancelMock(sent, T0, 'u1'), null).mockStatus).toBe('notStarted');
  });

  it('run の届出：完了か紙の提出で提出済み、送信中は承認済み', () => {
    const sent = sendMock({ prev: null, scenario: 'normal', missing: [], settings, now: T0, uid: 'u1' });
    expect(runMirror(sent, null)).toEqual({ status: 'approved', submission: null });
    const done = advanceDue(sent, { now: at(60), settings, acceptanceNumber: number });
    expect(runMirror(done, null).status).toBe('submitted');
    const paper = submitPaper(null, { date: '2026-10-30', office: '品川年金事務所', method: 'mail', now: T0, uid: 'u1' });
    expect(runMirror(null, paper).submission).toMatchObject({ method: 'paper', date: '2026-10-30' });
  });
});
