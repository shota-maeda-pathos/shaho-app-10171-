import { KYOKAI_HEALTH_RATES, kyokaiRateRows, missingKyokaiCsv } from './kyokai-rates';
import { CSV_HEADER, parseRateCsv } from './rules';

const split = (l: string) => l.split(',');

describe('協会けんぽの料率表', () => {
  it('47都道府県がコード順にそろい、公表値と一致する（東京・大阪・兵庫・北海道・沖縄）', () => {
    expect(KYOKAI_HEALTH_RATES.map(r => r[0])).toEqual(Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0')));
    const get = (code: string) => KYOKAI_HEALTH_RATES.find(r => r[0] === code)!.slice(2);
    expect(get('13')).toEqual([99.8, 99.1, 98.5]);
    expect(get('27')).toEqual([103.4, 102.4, 101.3]);
    expect(get('28')).toEqual([101.8, 101.6, 101.2]);
    expect(get('01')).toEqual([102.1, 103.1, 102.8]);
    expect(get('47')).toEqual([95.2, 94.4, 94.4]);
    expect(kyokaiRateRows()).toHaveLength(47 * 3 + 3);
  });
  it('まだ登録していない分だけを、そのまま取り込める CSV にする', () => {
    const existing = [
      { insuranceType: 'health', prefectureCode: '13', insurerId: '', appliedFrom: '2026-03' },
      { insuranceType: 'longTermCare', prefectureCode: '', insurerId: '', appliedFrom: '2026-03' },
      // 組合健保の料率は別物なので、協会けんぽの分を飛ばす理由にしない
      { insuranceType: 'health', prefectureCode: '28', insurerId: '06139901', appliedFrom: '2026-03' },
    ];
    const out = missingKyokaiCsv(existing, CSV_HEADER);
    expect(out.rows).toBe(47 * 3 + 3 - 2);
    expect(out.prefectures).toBe(47);
    const { rows, errors } = parseRateCsv(out.csv, split);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(out.rows);
    expect(rows.find(r => r.prefectureCode === '28' && r.appliedFrom === '2026-03')).toMatchObject({ insuranceType: 'health', totalRate: 101.2, employeeRate: 50.6, employerRate: 50.6 });
    expect(rows.some(r => r.prefectureCode === '13' && r.appliedFrom === '2026-03')).toBe(false);
  });
  it('すべて登録済みなら空', () => {
    const all = kyokaiRateRows().map(r => ({ ...r, insurerId: '' }));
    expect(missingKyokaiCsv(all, CSV_HEADER)).toEqual({ csv: '', rows: 0, prefectures: 0 });
  });
});
