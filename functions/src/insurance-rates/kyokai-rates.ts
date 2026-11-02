// 協会けんぽの都道府県単位の健康保険料率と、全国一律の介護保険料率（‰）。協会けんぽの公表値
// （令和6年度・7年度・8年度。いずれも3月分＝4月納付分から）。料率の画面で、まだ登録していない分を CSV にして取り込めるようにする

/** 年度ごとの適用開始年月 */
export const KYOKAI_FISCAL_FROM = ['2024-03', '2025-03', '2026-03'] as const;

/** [都道府県コード, 都道府県名, 令和6年度, 令和7年度, 令和8年度]（健康保険料率 ‰） */
export const KYOKAI_HEALTH_RATES: readonly [string, string, number, number, number][] = [
  ['01', '北海道', 102.1, 103.1, 102.8],
  ['02', '青森県', 94.9, 98.5, 98.5],
  ['03', '岩手県', 96.3, 96.2, 95.1],
  ['04', '宮城県', 100.1, 101.1, 101],
  ['05', '秋田県', 98.5, 100.1, 100.1],
  ['06', '山形県', 98.4, 97.5, 97.5],
  ['07', '福島県', 95.9, 96.2, 95],
  ['08', '茨城県', 96.6, 96.7, 95.2],
  ['09', '栃木県', 97.9, 98.2, 98.2],
  ['10', '群馬県', 98.1, 97.7, 96.8],
  ['11', '埼玉県', 97.8, 97.6, 96.7],
  ['12', '千葉県', 97.7, 97.9, 97.3],
  ['13', '東京都', 99.8, 99.1, 98.5],
  ['14', '神奈川県', 100.2, 99.2, 99.2],
  ['15', '新潟県', 93.5, 95.5, 92.1],
  ['16', '富山県', 96.2, 96.5, 95.9],
  ['17', '石川県', 99.4, 98.8, 97],
  ['18', '福井県', 100.7, 99.4, 97.1],
  ['19', '山梨県', 99.4, 98.9, 95.5],
  ['20', '長野県', 95.5, 96.9, 96.3],
  ['21', '岐阜県', 99.1, 99.3, 98],
  ['22', '静岡県', 98.5, 98, 96.1],
  ['23', '愛知県', 100.2, 100.3, 99.3],
  ['24', '三重県', 99.4, 99.9, 97.7],
  ['25', '滋賀県', 98.9, 99.7, 98.8],
  ['26', '京都府', 101.3, 100.3, 98.9],
  ['27', '大阪府', 103.4, 102.4, 101.3],
  ['28', '兵庫県', 101.8, 101.6, 101.2],
  ['29', '奈良県', 102.2, 100.2, 99.1],
  ['30', '和歌山県', 100, 101.9, 100.6],
  ['31', '鳥取県', 96.8, 99.3, 98.6],
  ['32', '島根県', 99.2, 99.4, 99.4],
  ['33', '岡山県', 100.2, 101.7, 100.5],
  ['34', '広島県', 99.5, 99.7, 97.8],
  ['35', '山口県', 102, 103.6, 101.5],
  ['36', '徳島県', 101.9, 104.7, 102.4],
  ['37', '香川県', 103.3, 102.1, 100.2],
  ['38', '愛媛県', 100.3, 101.8, 99.8],
  ['39', '高知県', 98.9, 101.3, 100.5],
  ['40', '福岡県', 103.5, 103.1, 101.1],
  ['41', '佐賀県', 104.2, 107.8, 105.5],
  ['42', '長崎県', 101.7, 104.1, 100.6],
  ['43', '熊本県', 103, 101.2, 100.8],
  ['44', '大分県', 102.5, 102.5, 100.8],
  ['45', '宮崎県', 98.5, 100.9, 97.7],
  ['46', '鹿児島県', 101.3, 103.1, 101.3],
  ['47', '沖縄県', 95.2, 94.4, 94.4],
];

/** 介護保険料率（全国一律、‰）。令和6年度・7年度・8年度 */
export const KYOKAI_CARE_RATES = [16, 15.9, 16.2] as const;

export interface KyokaiRateRow { insuranceType: 'health' | 'longTermCare'; prefectureCode: string; appliedFrom: string; totalRate: number; note: string }

/** 協会けんぽの公表値を1行ずつにする（健康保険は都道府県ごと、介護保険は全国一律） */
export function kyokaiRateRows(): KyokaiRateRow[] {
  const out: KyokaiRateRow[] = [];
  KYOKAI_FISCAL_FROM.forEach((from, y) => {
    for (const [code, name, ...rates] of KYOKAI_HEALTH_RATES) out.push({ insuranceType: 'health', prefectureCode: code, appliedFrom: from, totalRate: rates[y], note: `協会けんぽ ${name}` });
    out.push({ insuranceType: 'longTermCare', prefectureCode: '', appliedFrom: from, totalRate: KYOKAI_CARE_RATES[y], note: '協会けんぽ 全国一律' });
  });
  return out;
}

/**
 * まだ登録していない協会けんぽの料率を、料率の CSV（rules.ts の CSV_HEADER の並び）にする。
 * 同じ種類・都道府県・開始月の料率（保険者の指定なし）があれば飛ばす。会社が自分で登録した料率は変えない
 */
export function missingKyokaiCsv(existing: { insuranceType: string; prefectureCode?: string | null; insurerId?: string | null; appliedFrom: string }[], header: string): { csv: string; rows: number; prefectures: number } {
  const have = new Set(existing.filter(r => !r.insurerId || r.insurerId === 'kyokai').map(r => `${r.insuranceType}|${r.prefectureCode || ''}|${r.appliedFrom}`));
  const rows = kyokaiRateRows().filter(r => !have.has(`${r.insuranceType}|${r.prefectureCode}|${r.appliedFrom}`));
  const label = { health: '健康保険', longTermCare: '介護保険' } as const;
  return {
    csv: rows.length ? [header, ...rows.map(r => `${label[r.insuranceType]},${r.prefectureCode},,${r.appliedFrom},${r.totalRate},,,${r.note}`)].join('\n') + '\n' : '',
    rows: rows.length,
    prefectures: new Set(rows.filter(r => r.insuranceType === 'health').map(r => r.prefectureCode)).size,
  };
}
