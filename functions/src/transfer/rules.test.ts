import { transferAcquisitionGrade, transferFacts, transferMoveBlocker, lastMonthBeforeTransfer, OfficeFacts } from './rules';

const office = (o: Partial<OfficeFacts>): OfficeFacts => ({
  id: 'a', name: '本社', officeNumber: '12-アイ', prefectureCode: '13', insurerId: '01130012', pensionOfficeName: '新宿', ...o,
});

describe('事業所間異動の影響', () => {
  it('都道府県が違う別の適用事業所への異動', () => {
    const f = transferFacts(office({}), office({ id: 'b', name: '大阪支社', officeNumber: '27-ウエ', prefectureCode: '27', insurerId: '01270019', pensionOfficeName: '天満' }), '2026-12-01');
    expect(f).toMatchObject({ healthRateChanges: true, filingRequired: true, pensionOfficeChanges: true, newRateMonth: '2026-12' });
  });
  it('同じ適用事業所（一括適用）の中の異動は届出なし', () => {
    const f = transferFacts(office({}), office({ id: 'b', name: '新宿店' }), '2026-12-15');
    expect(f).toMatchObject({ healthRateChanges: false, filingRequired: false, pensionOfficeChanges: false, newRateMonth: '2026-12' });
  });
  it('事業所整理記号が未登録なら、別の適用事業所として届け出る', () => {
    expect(transferFacts(office({ officeNumber: '' }), office({ id: 'b' }), '2026-12-01').filingRequired).toBe(true);
  });
});

describe('異動の完了で所属を変えてよいか', () => {
  const base = { transferDate: '2026-12-01', hasLastMonthPremium: true, skipPremiumCheck: false };
  it('異動日より前は変えない', () => {
    expect(transferMoveBlocker({ ...base, today: '2026-11-30' })).toContain('異動日（2026-12-01）');
  });
  it('異動日を過ぎ、前の月の保険料があれば変えられる', () => {
    expect(transferMoveBlocker({ ...base, today: '2026-12-01' })).toBeNull();
  });
  it('前の月の保険料がまだなら変えない（印を付ければ進める）', () => {
    expect(transferMoveBlocker({ ...base, today: '2026-12-10', hasLastMonthPremium: false })).toContain('2026-11分の保険料');
    expect(transferMoveBlocker({ ...base, today: '2026-12-10', hasLastMonthPremium: false, skipPremiumCheck: true })).toBeNull();
  });
  it('前の月は年をまたぐ', () => {
    expect(lastMonthBeforeTransfer('2027-01-15')).toBe('2026-12');
    expect(lastMonthBeforeTransfer('2026-12-01')).toBe('2026-11');
  });
});

describe('異動先での資格取得時決定', () => {
  it('前の等級は引き継がず、異動日現在の報酬月額から決め直す', () => {
    expect(transferAcquisitionGrade({ currency: 300000, inKind: 0 })).toEqual({
      remuneration: 300000, health: { gradeNumber: 22, standardRemuneration: 300000 }, pension: { gradeNumber: 19, standardRemuneration: 300000 },
    });
  });
  it('現物給与も足して決める', () => {
    const g = transferAcquisitionGrade({ currency: 290000, inKind: 30000 });
    expect(g.remuneration).toBe(320000);
    expect(g.health.standardRemuneration).toBe(320000);
  });
});
