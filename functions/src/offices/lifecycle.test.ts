jest.mock('../config', () => ({ db: {} }));
import { fieldIssues } from './lifecycle';

describe('事業所の設定の不足（配属できるか）', () => {
  it('都道府県と管轄年金事務所が要る', () => {
    expect(fieldIssues({ prefectureCode: '', pensionOfficeName: null, insurerId: '', healthInsuranceType: null })).toEqual(['都道府県', '管轄年金事務所']);
    expect(fieldIssues({ prefectureCode: '13', pensionOfficeName: '新宿年金事務所', insurerId: '', healthInsuranceType: 'kyokai' })).toEqual([]);
  });
  it('組合健保は保険者番号も要る', () => {
    expect(fieldIssues({ prefectureCode: '13', pensionOfficeName: '新宿年金事務所', insurerId: ' ', healthInsuranceType: 'union' })).toEqual(['保険者番号（組合健保）']);
  });
});
