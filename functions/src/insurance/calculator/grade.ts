import { GradeTableEntry } from '../../types/firestore';

/**
 * 報酬月額を等級表に当てはめる。
 * 各等級の範囲は「下限以上・上限未満」。上限を超える額は最高等級、下限を下回る額は最低等級とする。
 */
export function lookupGrade(table: GradeTableEntry[], remuneration: number): GradeTableEntry {
  if (table.length === 0) throw new RangeError('等級表が空です');
  if (!Number.isFinite(remuneration) || remuneration < 0) throw new RangeError('報酬月額は0以上で指定してください');
  const sorted = [...table].sort((a, b) => a.gradeNumber - b.gradeNumber);
  const hit = sorted.find(e => remuneration >= e.lowerBound && remuneration < e.upperBound);
  if (hit) return hit;
  return remuneration < sorted[0].lowerBound ? sorted[0] : sorted[sorted.length - 1];
}

export function findGradeByNumber(table: GradeTableEntry[], gradeNumber: number): GradeTableEntry | null {
  return table.find(e => e.gradeNumber === gradeNumber) ?? null;
}

export type InsuranceKind = 'health' | 'pension';
export type ChangeDirection = 'up' | 'down';

/**
 * 上限・下限の特例（日本年金機構「随時改定」）。
 * 等級表の最高・最低等級付近では2等級差が生じなくても改定対象になる場合がある。
 * 判定に使う金額は等級表に依存するため、表の端の標準報酬月額が一致する場合だけ適用する。
 */
interface BoundaryRule {
  kind: InsuranceKind;
  direction: ChangeDirection;
  fromStandard: number;
  toStandard: number;
  /** 改定後の報酬月額（3か月平均）の条件 */
  newRemuneration: { min?: number; maxExclusive?: number };
  /** 従前の報酬月額（従前等級の決定に用いた額）の条件。満たすか確認できない場合は要確認とする */
  previousRemuneration?: { min?: number; maxExclusive?: number };
}

const BOUNDARY_RULES: BoundaryRule[] = [
  { kind: 'health', direction: 'up', fromStandard: 1_330_000, toStandard: 1_390_000, newRemuneration: { min: 1_415_000 } },
  { kind: 'health', direction: 'up', fromStandard: 58_000, toStandard: 68_000, newRemuneration: { min: 63_000 }, previousRemuneration: { maxExclusive: 53_000 } },
  { kind: 'health', direction: 'down', fromStandard: 1_390_000, toStandard: 1_330_000, newRemuneration: { maxExclusive: 1_355_000 }, previousRemuneration: { min: 1_415_000 } },
  { kind: 'health', direction: 'down', fromStandard: 68_000, toStandard: 58_000, newRemuneration: { maxExclusive: 53_000 } },
  { kind: 'pension', direction: 'up', fromStandard: 620_000, toStandard: 650_000, newRemuneration: { min: 665_000 } },
  { kind: 'pension', direction: 'up', fromStandard: 88_000, toStandard: 98_000, newRemuneration: { min: 93_000 }, previousRemuneration: { maxExclusive: 83_000 } },
  { kind: 'pension', direction: 'down', fromStandard: 650_000, toStandard: 620_000, newRemuneration: { maxExclusive: 635_000 }, previousRemuneration: { min: 665_000 } },
  { kind: 'pension', direction: 'down', fromStandard: 98_000, toStandard: 88_000, newRemuneration: { maxExclusive: 83_000 } },
];

function inRange(value: number, range: { min?: number; maxExclusive?: number }): boolean {
  return (range.min === undefined || value >= range.min)
    && (range.maxExclusive === undefined || value < range.maxExclusive);
}

export interface RevisionJudgement {
  /** 改定対象か */
  eligible: boolean;
  /** 自動では決められず、担当者の確認が必要 */
  needsReview: boolean;
  newGrade: GradeTableEntry;
  gradeDiff: number;
  reason: string;
}

/**
 * 1つの保険（健保または厚年）について、随時改定・終了時改定の等級差を判定する。
 * minDiff: 随時改定は2、産休・育休終了時改定は1。
 */
export function judgeGradeChange(params: {
  kind: InsuranceKind;
  table: GradeTableEntry[];
  currentStandard: number;
  averageRemuneration: number;
  direction: ChangeDirection;
  minDiff: number;
  previousRemuneration?: number | null;
}): RevisionJudgement {
  const { kind, table, currentStandard, averageRemuneration, direction, minDiff } = params;
  const label = kind === 'health' ? '健康保険' : '厚生年金';
  const current = table.find(e => e.standardRemuneration === currentStandard);
  const newGrade = lookupGrade(table, averageRemuneration);
  if (!current) {
    return { eligible: false, needsReview: true, newGrade, gradeDiff: 0, reason: `${label}：現在の標準報酬月額が等級表にありません` };
  }
  const gradeDiff = newGrade.gradeNumber - current.gradeNumber;
  if (gradeDiff !== 0 && (gradeDiff > 0) !== (direction === 'up')) {
    return { eligible: false, needsReview: false, newGrade, gradeDiff, reason: `${label}：固定的賃金の変動方向と等級の変動方向が一致しません` };
  }
  if (Math.abs(gradeDiff) >= minDiff) {
    return { eligible: true, needsReview: false, newGrade, gradeDiff, reason: `${label}：${Math.abs(gradeDiff)}等級の差があります` };
  }

  if (minDiff >= 2) {
    const rule = BOUNDARY_RULES.find(r => r.kind === kind && r.direction === direction && r.fromStandard === currentStandard);
    const target = rule ? table.find(e => e.standardRemuneration === rule.toStandard) : undefined;
    if (rule && target && inRange(averageRemuneration, rule.newRemuneration)) {
      if (rule.previousRemuneration) {
        const previous = params.previousRemuneration;
        if (previous == null) {
          return { eligible: false, needsReview: true, newGrade: target, gradeDiff: target.gradeNumber - current.gradeNumber, reason: `${label}：上限・下限の特例に該当する可能性があります。従前の報酬月額を確認してください` };
        }
        if (!inRange(previous, rule.previousRemuneration)) {
          return { eligible: false, needsReview: false, newGrade, gradeDiff, reason: `${label}：等級差が${minDiff}等級未満です` };
        }
      }
      return { eligible: true, needsReview: false, newGrade: target, gradeDiff: target.gradeNumber - current.gradeNumber, reason: `${label}：上限・下限の特例により改定対象です` };
    }
  }
  return { eligible: false, needsReview: false, newGrade, gradeDiff, reason: `${label}：等級差が${minDiff}等級未満です` };
}
