import { contentHash, filingContentHash } from '../../utils/hash';
import { buildRequestEntry, buildRunFilingEntry, diffSnapshots, isDueSoon, isOverdue, isStale, runApprovalStatus, summaryOf } from './rules';

describe('内容の指紋', () => {
  it('キーの順が違っても同じ内容なら同じ', () => {
    expect(contentHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(contentHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  it('届出は記入内容だけを見る（状態や版が変わっても同じ）', () => {
    const f = { filingType: 'lossNotification', formData: { 氏名: '山田' }, workflowStatus: 'approved', version: 3 };
    expect(filingContentHash(f)).toBe(filingContentHash({ ...f, workflowStatus: 'draft', version: 9, mock: { status: 'sent' } }));
    expect(filingContentHash(f)).not.toBe(filingContentHash({ ...f, formData: { 氏名: '山田 太郎' } }));
  });

  it('算定基礎届・賞与支払届は header と persons を見る', () => {
    const f = { header: { 事業所名称: '本社' }, persons: [{ 被保険者氏名: 'A' }], status: 'approved' };
    expect(filingContentHash(f)).toBe(filingContentHash({ ...f, status: 'submitted' }));
    expect(filingContentHash(f)).not.toBe(filingContentHash({ ...f, persons: [{ 被保険者氏名: 'B' }] }));
  });
});

describe('承認の索引', () => {
  const ts = (iso: string) => ({ toDate: () => new Date(iso) });

  it('届出の承認申請：期限・要点・依頼者を持つ', () => {
    const e = buildRequestEntry({
      requestId: 'r1', employeeId: 'e1',
      data: {
        requestType: 'filing', status: 'pending', requestedBy: 'u1', requestedAt: ts('2026-10-30T01:00:00Z'), targetVersion: 2,
        targetPath: 'companies/c/employees/e1/filings/f1', snapshotData: {}, metadata: { source: 'onboarding', grade: { healthGradeNumber: 22, pensionGradeNumber: 19, effectiveMonth: '2026-11' } },
      },
      employee: { lastName: '山田', firstName: '太郎', employeeNumber: 'A-1', officeId: 'o1' }, office: { name: '本社' },
      requester: { displayName: '担当 一郎' }, target: { filingType: 'acquisitionNotification', formData: { '資格取得年月日': '2026-11-02' } },
    });
    expect(e).toMatchObject({
      kind: 'request', employeeName: '山田 太郎', officeName: '本社', filingType: 'acquisitionNotification', filingId: 'f1', deadline: '2026-11-09',
      requestedByName: '担当 一郎', requestedAt: '2026-10-30T01:00:00.000Z', origin: 'onboarding',
    });
    expect(e.summary).toContain('健保22');
  });

  it('給与・保険料の要点', () => {
    expect(summaryOf('salary', { yearMonth: '2026-11', totalSalary: 300000 }, null)).toBe('2026-11支給 支給額 300,000円');
    expect(summaryOf('monthlyInsurance', { yearMonth: '2026-10', totalEmployeeAmount: 15000, totalEmployerAmount: 15500 }, null)).toContain('本人 15,000円');
  });

  it('run の届出：依頼前は載せない、差し戻し・承認取消を区別する', () => {
    expect(runApprovalStatus({ status: 'draft' })).toBeNull();
    expect(runApprovalStatus({ status: 'pending', requestedAt: ts('2026-10-30T00:00:00Z') })).toBe('pending');
    expect(runApprovalStatus({ status: 'draft', requestedAt: 1, rejection: { comment: 'x' } })).toBe('rejected');
    expect(runApprovalStatus({ status: 'draft', requestedAt: 1, approvalCancelledAt: 1 })).toBe('cancelled');
    expect(runApprovalStatus({ status: 'submitted', requestedAt: 1 })).toBe('approved');
    const e = buildRunFilingEntry({
      source: 'santei', parentId: 'o2_2026', filingId: 'f2', path: 'p',
      data: { status: 'pending', requestedAt: ts('2026-07-01T00:00:00Z'), filingType: 'remunerationMonthlyAlgorithm', year: 2026, number: 1, employeeIds: ['a', 'b'], officeId: 'o2', version: 4 },
      office: { name: '大阪' }, requester: null,
    });
    expect(e).toMatchObject({ kind: 'runFiling', personCount: 2, deadline: '2026-07-10', targetVersion: 4, summary: '2026年の算定基礎届（1件目・2名）' });
  });

  it('期限超過・期限が近い・止まっている', () => {
    const e = { status: 'pending' as const, deadline: '2026-11-02', requestedAt: '2026-10-25T00:00:00Z' };
    expect(isOverdue(e, '2026-11-03')).toBe(true);
    expect(isOverdue(e, '2026-11-02')).toBe(false);
    expect(isDueSoon(e, '2026-10-31')).toBe(true);
    expect(isDueSoon(e, '2026-10-29')).toBe(false);
    expect(isStale(e, new Date('2026-10-28T00:00:00Z'), 3)).toBe(true);
    expect(isStale(e, new Date('2026-10-27T00:00:00Z'), 3)).toBe(false);
    expect(isStale({ ...e, status: 'approved' }, new Date('2026-11-30T00:00:00Z'), 3)).toBe(false);
  });
});

describe('前回の版との差分', () => {
  it('届出は記入内容の項目ごとに比べ、状態や版は比べない', () => {
    const before = { formData: { 氏名: '山田', 報酬月額: 280000, 被扶養者一覧: [{ 氏名: '花子' }] }, version: 1, workflowStatus: 'rejected' };
    const after = { formData: { 氏名: '山田', 報酬月額: 300000, 被扶養者一覧: [{ 氏名: 'はな子' }], 備考: '再提出' }, version: 3, workflowStatus: 'draft' };
    const rows = diffSnapshots(before, after);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([
      { field: '備考', before: '', after: '再提出' },
      { field: '被扶養者一覧[1].氏名', before: '花子', after: 'はな子' },
      { field: '報酬月額', before: '280,000', after: '300,000' },
    ]));
  });

  it('前回がなければ差分なし', () => {
    expect(diffSnapshots(null, { a: 1 })).toEqual([]);
  });
});
