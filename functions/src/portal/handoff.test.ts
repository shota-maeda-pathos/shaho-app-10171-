import { dependentItemFromRequest, leaveStateFromRequest } from './handoff';

const family = [{ id: 'd1', lastName: '山田', firstName: '花子', birthDate: '1990-04-01', gender: 'female' as const, relationship: 'spouse' }];

describe('本人の申請をウィザードに引き継ぐ', () => {
  it('扶養の追加：申請の氏名・続柄・収入・日付を項目にする', () => {
    const item = dependentItemFromRequest('dependentAdd', {
      lastName: '山田', firstName: '太郎', birthDate: '2026-10-01', gender: 'male', relationship: 'child', coResident: true, annualIncome: 0, since: '2026-10-01',
    }, family);
    expect(item).toMatchObject({ kind: 'add', dependentId: null, lastName: '山田', firstName: '太郎', gender: 'male', relationship: 'child', eventDate: '2026-10-01', income: 0 });
  });

  it('扶養から外す：台帳の家族を氏名で探す（空白は無視）', () => {
    expect(dependentItemFromRequest('dependentRemove', { dependentName: '山田　花子', reason: '就職', since: '2026-11-01' }, family))
      .toMatchObject({ kind: 'remove', dependentId: 'd1', reason: '就職', eventDate: '2026-11-01' });
  });

  it('扶養から外す：見つからなければ項目を作らない（担当者が選ぶ）', () => {
    expect(dependentItemFromRequest('dependentRemove', { dependentName: '佐藤 一郎', reason: '就職', since: '2026-11-01' }, family)).toBeNull();
  });

  it('産休：出産予定日と期間を入れる', () => {
    expect(leaveStateFromRequest('maternity', { startDate: '2026-12-01', endDate: '2027-03-01', expectedBirthDate: '2027-01-11' })).toEqual({
      expectedBirthDate: '2027-01-11', child: null, period: { startDate: '2026-12-01', plannedEnd: '2027-03-01', actualBirthDate: null, actualEndDate: null },
    });
  });

  it('育休：子の氏名・生年月日を入れる。子の欄が空なら子は入れない', () => {
    expect(leaveStateFromRequest('childcare', { startDate: '2027-03-02', endDate: '2027-12-31', childLastName: '山田', childFirstName: '一花', childBirthDate: '2027-01-10' }).child)
      .toEqual({ lastName: '山田', firstName: '一花', birthDate: '2027-01-10', bornByEmployee: false });
    expect(leaveStateFromRequest('childcare', { startDate: '2027-03-02', endDate: '2027-12-31' }).child).toBeNull();
  });
});
