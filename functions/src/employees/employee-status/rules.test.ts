import { absenceErrors, statusNote, statusOn, statusPeriods } from './rules';

const leave = (leaveType: string, s: string, e: string | null, actual = true) => ({
  id: leaveType, data: { leaveType, expectedStartDate: s, expectedEndDate: e, actualStartDate: actual ? s : null, actualEndDate: actual ? e : null },
});

describe('在籍ステータス', () => {
  it('記録がなければ在籍中', () => {
    expect(statusOn(statusPeriods({ leaves: [], absences: [] }), '2026-11-02').kind).toBe('active');
  });

  it('休業の記録から産休・育休・介護休業中を決める', () => {
    const periods = statusPeriods({ leaves: [leave('maternity', '2026-07-01', '2026-10-10'), leave('childcare', '2026-10-11', '2027-08-19'), leave('nursing', '2025-01-01', '2025-03-31')], absences: [] });
    expect(statusOn(periods, '2026-08-01').kind).toBe('maternityLeave');
    expect(statusOn(periods, '2026-11-02').kind).toBe('childcareLeave');
    expect(statusOn(periods, '2025-02-01').kind).toBe('careLeave');
    expect(statusOn(periods, '2026-06-30').kind).toBe('active');
  });

  it('休職の記録（終了日なしは続いている）と、重なったときの優先', () => {
    const absences = [{ id: 'a1', data: { reason: 'personal', startDate: '2026-09-01', endDate: null } }];
    const periods = statusPeriods({ leaves: [leave('childcare', '2026-10-01', '2026-12-31')], absences });
    expect(statusOn(periods, '2026-09-15').kind).toBe('sickLeave');
    expect(statusOn(periods, '2026-10-15').kind).toBe('childcareLeave');
    expect(statusOn(periods, '2027-02-01').kind).toBe('sickLeave');
    expect(periods.find(p => p.kind === 'sickLeave')?.note).toBe('私傷病');
  });

  it('退職日の翌日から退職済み（休業より優先）', () => {
    const periods = statusPeriods({ resignationDate: '2026-11-30', leaves: [leave('childcare', '2026-10-01', '2027-03-31')], absences: [] });
    expect(statusOn(periods, '2026-11-30').kind).toBe('childcareLeave');
    expect(statusOn(periods, '2026-12-01').kind).toBe('resigned');
  });

  it('消した記録は数えない', () => {
    const periods = statusPeriods({ leaves: [], absences: [{ id: 'a', data: { reason: 'injury', startDate: '2026-01-01', endDate: null, deletedAt: 1 } }] });
    expect(periods).toEqual([]);
  });

  it('産休・育休は免除の対象と表示する', () => {
    expect(statusNote('childcareLeave')).toContain('保険料免除');
    expect(statusNote('active')).toBeNull();
  });

  it('休職の記録の入力：終了日は開始日より後・休職どうしは重ねない', () => {
    const others = statusPeriods({ leaves: [], absences: [{ id: 'a', data: { reason: 'injury', startDate: '2026-01-01', endDate: '2026-03-31' } }] });
    expect(absenceErrors({ startDate: '2026-05-01', endDate: '2026-04-01' }, [])[0]).toContain('終了日');
    expect(absenceErrors({ startDate: '2026-03-01', endDate: null }, others)[0]).toContain('重なって');
    expect(absenceErrors({ startDate: '2026-04-01', endDate: null }, others)).toEqual([]);
  });
});
