import { GradeTableEntry } from '../../types/firestore';
import { InsuranceKind } from './grade';

// 標準報酬月額等級表（2026年度。健康保険は全国共通、厚生年金は全国一律）
// [標準報酬月額, 報酬月額の下限（以上）]。上限は次の等級の下限（未満）、最高等級は上限なし
const HEALTH: [number, number][] = [
  [58_000, 0], [68_000, 63_000], [78_000, 73_000], [88_000, 83_000], [98_000, 93_000],
  [104_000, 101_000], [110_000, 107_000], [118_000, 114_000], [126_000, 122_000], [134_000, 130_000],
  [142_000, 138_000], [150_000, 146_000], [160_000, 155_000], [170_000, 165_000], [180_000, 175_000],
  [190_000, 185_000], [200_000, 195_000], [220_000, 210_000], [240_000, 230_000], [260_000, 250_000],
  [280_000, 270_000], [300_000, 290_000], [320_000, 310_000], [340_000, 330_000], [360_000, 350_000],
  [380_000, 370_000], [410_000, 395_000], [440_000, 425_000], [470_000, 455_000], [500_000, 485_000],
  [530_000, 515_000], [560_000, 545_000], [590_000, 575_000], [620_000, 605_000], [650_000, 635_000],
  [680_000, 665_000], [710_000, 695_000], [750_000, 730_000], [790_000, 770_000], [830_000, 810_000],
  [880_000, 855_000], [930_000, 905_000], [980_000, 955_000], [1_030_000, 1_005_000], [1_090_000, 1_055_000],
  [1_150_000, 1_115_000], [1_210_000, 1_175_000], [1_270_000, 1_235_000], [1_330_000, 1_295_000], [1_390_000, 1_355_000],
];

function build(rows: [number, number][]): GradeTableEntry[] {
  return rows.map(([standardRemuneration, lowerBound], i) => ({
    gradeNumber: i + 1,
    standardRemuneration,
    lowerBound: i === 0 ? 0 : lowerBound,
    upperBound: i + 1 < rows.length ? rows[i + 1][1] : Number.POSITIVE_INFINITY,
  }));
}

export const HEALTH_GRADE_TABLE: GradeTableEntry[] = build(HEALTH);
// 厚生年金の1等級（88,000円）は健保4等級、32等級（650,000円）は健保35等級に対応する
export const PENSION_GRADE_TABLE: GradeTableEntry[] = build(HEALTH.slice(3, 35));

/** 等級表として使える形か（昇順・切れ目なし・下限0から始まる） */
export function isValidGradeTable(table: unknown): table is GradeTableEntry[] {
  if (!Array.isArray(table) || table.length === 0) return false;
  const sorted = [...table].sort((a, b) => a.gradeNumber - b.gradeNumber);
  if (sorted[0].lowerBound !== 0) return false;
  return sorted.every((e, i) =>
    Number.isFinite(e.standardRemuneration) && e.gradeNumber === i + 1
    && (i === 0 || e.lowerBound === sorted[i - 1].upperBound));
}

/**
 * 料率マスタに等級表があればそれを使い（組合健保・将来の改定に対応）、なければ公式の等級表を使う。
 * 形の崩れた等級表は使わない。
 */
export function resolveGradeTable(kind: InsuranceKind, configured?: GradeTableEntry[] | null): GradeTableEntry[] {
  if (configured && isValidGradeTable(configured)) {
    // Firestore には Infinity を保存できないため、最高等級の上限は無限大として扱う
    const sorted = [...configured].sort((a, b) => a.gradeNumber - b.gradeNumber);
    return sorted.map((e, i) => i === sorted.length - 1 ? { ...e, upperBound: Number.POSITIVE_INFINITY } : e);
  }
  return kind === 'health' ? HEALTH_GRADE_TABLE : PENSION_GRADE_TABLE;
}
