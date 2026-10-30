import { transferFacts, OfficeFacts } from './rules';

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
