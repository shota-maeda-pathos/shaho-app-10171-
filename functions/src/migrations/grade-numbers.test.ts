import { gradeNumberFix, gradeNumberFor } from './grade-numbers';
import { HEALTH_GRADE_TABLE, PENSION_GRADE_TABLE } from '../insurance/calculator';

jest.mock('../config', () => ({ db: {} }));

describe('等級番号の引き直し', () => {
  it('標準報酬月額から公式の等級番号を引く', () => {
    expect(gradeNumberFor(HEALTH_GRADE_TABLE, 300_000)).toBe(22);
    expect(gradeNumberFor(PENSION_GRADE_TABLE, 300_000)).toBe(19);
    expect(gradeNumberFor(PENSION_GRADE_TABLE, 500_000)).toBe(27);
    expect(gradeNumberFor(HEALTH_GRADE_TABLE, 123_456)).toBeNull();
  });

  it('ずれている番号だけを直す（例：30万円の厚年20→19）', () => {
    expect(gradeNumberFix({ healthStandardRemuneration: 300_000, healthGradeNumber: 22, pensionStandardRemuneration: 300_000, pensionGradeNumber: 20 }))
      .toEqual({ pensionGradeNumber: 19 });
    expect(gradeNumberFix({ healthStandardRemuneration: 500_000, healthGradeNumber: 32, pensionStandardRemuneration: 500_000, pensionGradeNumber: 30 }))
      .toEqual({ healthGradeNumber: 30, pensionGradeNumber: 27 });
    expect(gradeNumberFix({ healthStandardRemuneration: 300_000, healthGradeNumber: 22, pensionStandardRemuneration: 300_000, pensionGradeNumber: 19 })).toBeNull();
  });
});
