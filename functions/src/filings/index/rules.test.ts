import { extendToOpenDay, fiveDayDeadline, isAdministrativeHoliday, nationalHolidays } from '../../insurance/calculator';
import { buildIndexEntry, employeeFilingStatus, filingDeadline, isOverdue, runFilingStatus } from './rules';
import { sourceOfPath } from './service';

jest.mock('../../config', () => ({ db: {} }));

describe('行政機関の休日', () => {
  it('2026年の祝日（振替休日・国民の休日を含む）', () => {
    const h = nationalHolidays(2026);
    for (const d of ['2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04',
      '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23']) {
      expect(h.has(d)).toBe(true);
    }
    // 5月6日は憲法記念日（日曜）の振替休日、9月22日は敬老の日と秋分の日に挟まれた国民の休日
    expect(h.size).toBe(18);
  });

  it('2027年の春分・秋分と振替休日', () => {
    const h = nationalHolidays(2027);
    expect(h.has('2027-03-21')).toBe(true);
    expect(h.has('2027-03-22')).toBe(true); // 春分の日が日曜 → 振替休日
    expect(h.has('2027-09-23')).toBe(true);
  });

  it('土日・年末年始は休日', () => {
    expect(isAdministrativeHoliday('2026-10-31')).toBe(true); // 土曜
    expect(isAdministrativeHoliday('2026-12-29')).toBe(true);
    expect(isAdministrativeHoliday('2027-01-03')).toBe(true);
    expect(isAdministrativeHoliday('2026-12-28')).toBe(false);
  });

  it('期限が休日なら翌開庁日まで延びる', () => {
    expect(extendToOpenDay('2026-11-21')).toBe('2026-11-24'); // 土・日・勤労感謝の日
    expect(extendToOpenDay('2026-05-02')).toBe('2026-05-07'); // 大型連休
    expect(fiveDayDeadline('2026-10-26')).toBe('2026-11-02'); // 31日は土曜
    expect(fiveDayDeadline('2026-11-02')).toBe('2026-11-09'); // 7日は土曜
  });
});

describe('届出の期限', () => {
  it('資格取得届・資格喪失届は5日', () => {
    expect(filingDeadline('acquisitionNotification', { formData: { '資格取得年月日': '2026-11-02' } }).deadline).toBe('2026-11-09');
    expect(filingDeadline('lossNotification', { effectiveDate: '2026-12-01' }).deadline).toBe('2026-12-07');
  });

  it('被扶養者異動届はいちばん早い異動日から', () => {
    const r = filingDeadline('dependentChange', { formData: { '被扶養者一覧': [{ '異動年月日': '2026-11-10' }, { '異動年月日': '2026-11-04' }] } });
    expect(r.deadline).toBe('2026-11-09');
  });

  it('算定基礎届は7月10日（休日なら翌開庁日）', () => {
    expect(filingDeadline('remunerationMonthlyAlgorithm', { year: 2026 }).deadline).toBe('2026-07-10');
    expect(filingDeadline('remunerationMonthlyAlgorithm', { year: 2027 }).deadline).toBe('2027-07-12'); // 10日は土曜
  });

  it('届出に期限が書かれていればそれを使う', () => {
    expect(filingDeadline('bonusPayment', { deadline: '2027-01-02' }).deadline).toBe('2027-01-04');
  });

  it('産休の届出は終了から1か月', () => {
    expect(filingDeadline('maternityLeaveStart', { formData: { '産前産後休業終了予定年月日': '2026-10-10' } }).deadline).toBe('2026-11-10');
  });

  it('速やかにの届出は日付なし', () => {
    expect(filingDeadline('remunerationMonthlyChange', {})).toEqual({ deadline: null, note: '速やかに' });
  });
});

describe('状態のそろえ方', () => {
  it('従業員の下の届出：3軸から画面の状態', () => {
    expect(employeeFilingStatus({ workflowStatus: 'draft', mockStatus: 'notStarted', submissionStatus: 'notSubmitted' })).toEqual({ status: 'draft', paperStatus: 'none' });
    expect(employeeFilingStatus({ workflowStatus: 'rejected', mockStatus: 'notStarted', submissionStatus: 'notSubmitted' }).status).toBe('rejected');
    expect(employeeFilingStatus({ workflowStatus: 'approved', mockStatus: 'completed', submissionStatus: 'notSubmitted' }).status).toBe('completed');
    expect(employeeFilingStatus({ workflowStatus: 'approved', mockStatus: 'failed', submissionStatus: 'notSubmitted' }).status).toBe('mockFailed');
    expect(employeeFilingStatus({ workflowStatus: 'approved', mockStatus: 'notStarted', submissionStatus: 'accepted' })).toEqual({ status: 'approved', paperStatus: 'accepted' });
    // 送信エラーのあと紙で出したら、送信エラーは状態に出さない
    expect(employeeFilingStatus({ workflowStatus: 'approved', mockStatus: 'failed', submissionStatus: 'submitted' })).toEqual({ status: 'approved', paperStatus: 'submitted' });
  });

  it('run の届出：status と submission から画面の状態', () => {
    expect(runFilingStatus({ status: 'draft', rejection: { comment: 'x' } }).status).toBe('rejected');
    expect(runFilingStatus({ status: 'submitted', submission: { method: 'mock' } }).status).toBe('completed');
    expect(runFilingStatus({ status: 'submitted', submission: { method: 'paper' } })).toEqual({ status: 'approved', paperStatus: 'submitted' });
    expect(runFilingStatus({ status: 'cancelled' }).status).toBe('cancelled');
  });
});

describe('索引の1件', () => {
  it('従業員の下の届出', () => {
    const e = buildIndexEntry(
      { filingType: 'lossNotification', workflowStatus: 'approved', mockStatus: 'notStarted', submissionStatus: 'notSubmitted', effectiveDate: '2026-12-01', version: 3 },
      { source: 'employee', path: 'companies/c/employees/e1/filings/f1', filingId: 'f1', parentId: 'e1',
        employee: { lastName: '山田', firstName: '太郎', employeeNumber: 'A-1', officeId: 'o1' }, office: { name: '本社' } },
    );
    expect(e).toMatchObject({ employeeId: 'e1', employeeName: '山田 太郎', officeId: 'o1', officeName: '本社', status: 'approved', open: true, deadline: '2026-12-07', version: 3 });
    expect(isOverdue(e, '2026-12-08')).toBe(true);
    expect(isOverdue(e, '2026-12-07')).toBe(false);
  });

  it('算定基礎届（run の届出）は人数と事業所を持つ', () => {
    const e = buildIndexEntry(
      { filingType: 'remunerationMonthlyAlgorithm', status: 'submitted', submission: { method: 'mock', date: '2026-10-30', acceptanceNumber: 'MOCK-1' }, officeId: 'o2', year: 2026, number: 2, employeeIds: ['a', 'b', 'c'] },
      { source: 'santei', path: 'companies/c/santeiRuns/o2_2026/filings/f2', filingId: 'f2', parentId: 'o2_2026', office: { name: '大阪' } },
    );
    expect(e).toMatchObject({ employeeId: null, personCount: 3, officeId: 'o2', status: 'completed', open: false, acceptanceNumber: 'MOCK-1', submittedDate: '2026-10-30', year: 2026, number: 2 });
  });

  it('パスから元を読み取る', () => {
    expect(sourceOfPath('companies/c/bonusRuns/o1_2026-12/filings/f')).toEqual({ companyId: 'c', source: 'bonus', parentId: 'o1_2026-12', filingId: 'f' });
    expect(sourceOfPath('companies/c/employees/e/approvalRequests/x')).toBeNull();
  });
});
