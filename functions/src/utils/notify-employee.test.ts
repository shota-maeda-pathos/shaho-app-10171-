jest.mock('../config', () => ({ db: {} }));
import { gradeChangeText } from './notify-employee';

const g = (effectiveMonth: string, health: number, pension: number) => ({
  effectiveMonth, healthGradeNumber: health, healthStandardRemuneration: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 300000, 0, 360000][health] ?? 0,
  pensionGradeNumber: pension, pensionStandardRemuneration: pension === 19 ? 300000 : pension === 21 ? 360000 : 0,
});

describe('等級変更のお知らせの文面', () => {
  it('新旧の等級・標準報酬月額・適用開始月を書く', () => {
    expect(gradeChangeText(g('2026-04', 22, 19), g('2026-09', 24, 21))).toBe(
      '2026年9月から、健康保険 22→24等級（標準報酬月額 30万円→36万円）、厚生年金 19→21等級（30万円→36万円）に変わりました。保険料の変わる額はポータルの「等級が変わりました」で確かめられます。',
    );
  });
  it('等級が同じなら出さない', () => {
    expect(gradeChangeText(g('2026-04', 22, 19), g('2026-09', 22, 19))).toBeNull();
  });
});

test('標準報酬月額が同じで等級の番号だけ変わったときは知らせない（番号の付け直し・データの訂正）', () => {
  const before = { effectiveMonth: '2026-04', healthGradeNumber: 22, healthStandardRemuneration: 300000, pensionGradeNumber: 20, pensionStandardRemuneration: 300000 };
  expect(gradeChangeText(before, { ...before, pensionGradeNumber: 19 })).toBeNull();
  expect(gradeChangeText(before, { ...before, pensionGradeNumber: 22, pensionStandardRemuneration: 360000 })).toContain('厚生年金 20→22等級');
});
