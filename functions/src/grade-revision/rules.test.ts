import { HEALTH_GRADE_TABLE, lookupGrade, PENSION_GRADE_TABLE } from '../insurance/calculator';
import {
  CurrentGrade, effectiveMonthOf, fixedWageChange, judgeRevision, leaveEndCheck, leaveEndStartMonth, RevisionInput, RevisionSalary,
} from './rules';
import { buildRevisionSample } from './sample';

const tables = { health: HEALTH_GRADE_TABLE, pension: PENSION_GRADE_TABLE };

function gradeOf(remuneration: number, basis: number | null = remuneration): CurrentGrade {
  const h = lookupGrade(HEALTH_GRADE_TABLE, remuneration);
  const p = lookupGrade(PENSION_GRADE_TABLE, remuneration);
  return {
    effectiveMonth: '2026-04', healthGrade: h.gradeNumber, healthStandard: h.standardRemuneration,
    pensionGrade: p.gradeNumber, pensionStandard: p.standardRemuneration, basisRemuneration: basis,
  };
}

const sal = (yearMonth: string, totalSalary: number, days = 20, extra: Partial<RevisionSalary> = {}): RevisionSalary => ({
  yearMonth, confirmed: true, totalSalary, inKind: 0, retroactive: 0, paymentBasisDays: days, ...extra,
});

function input(over: Partial<RevisionInput>): RevisionInput {
  return {
    kind: 'occasional', startMonth: '2026-06', salaries: [], insuredCategory: 'general', current: gradeOf(300_000),
    direction: 'up', enrolled: { health: true, pension: true }, tables, previousRemuneration: null, ...over,
  };
}

describe('固定的賃金の変動', () => {
  it('前月と比べて上がった・下がった・変わらない', () => {
    expect(fixedWageChange({ before: 300_000, after: 340_000, manualDirection: null })).toMatchObject({ changed: true, direction: 'up' });
    expect(fixedWageChange({ before: 300_000, after: 280_000, manualDirection: null })).toMatchObject({ changed: true, direction: 'down' });
    expect(fixedWageChange({ before: 300_000, after: 300_000, manualDirection: null })).toMatchObject({ changed: false });
  });
  it('前月の給与がなければ担当者が向きを選ぶ', () => {
    expect(fixedWageChange({ before: null, after: 300_000, manualDirection: null }).needsInput).toBe(true);
    expect(fixedWageChange({ before: null, after: 300_000, manualDirection: 'down' })).toMatchObject({ changed: true, direction: 'down', needsInput: false });
  });
});

describe('随時改定', () => {
  it('2等級以上上がれば対象。4か月目から適用', () => {
    const r = judgeRevision(input({ salaries: [sal('2026-06', 360_000), sal('2026-07', 365_000), sal('2026-08', 370_000)] }));
    expect(r.status).toBe('eligible');
    expect(r.average).toBe(365_000);
    expect(r.health.eligible).toBe(true);
    expect(r.health.newGrade! - r.health.currentGrade!).toBeGreaterThanOrEqual(2);
    expect(r.effectiveMonth).toBe('2026-09');
  });

  it('1等級の差では対象外', () => {
    const r = judgeRevision(input({ salaries: [sal('2026-06', 315_000), sal('2026-07', 315_000), sal('2026-08', 315_000)] }));
    expect(r.status).toBe('ineligible');
  });

  it('昇給なのに等級が下がるときは対象外（変動の向き）', () => {
    const r = judgeRevision(input({ direction: 'up', salaries: [sal('2026-06', 230_000), sal('2026-07', 230_000), sal('2026-08', 230_000)] }));
    expect(r.status).toBe('ineligible');
    expect(r.messages.join()).toContain('変動方向');
  });

  it('1か月でも支払基礎日数が17日未満なら対象外。短時間労働者は11日', () => {
    const months = [sal('2026-06', 400_000), sal('2026-07', 400_000, 16), sal('2026-08', 400_000)];
    expect(judgeRevision(input({ salaries: months })).status).toBe('ineligible');
    expect(judgeRevision(input({ salaries: months, insuredCategory: 'shortTime' })).status).toBe('eligible');
  });

  it('給与が未承認・未登録の月があれば待つ', () => {
    const r = judgeRevision(input({ salaries: [sal('2026-06', 400_000), sal('2026-07', 400_000, 20, { confirmed: false }), null] }));
    expect(r.status).toBe('waiting');
    expect(r.messages).toHaveLength(2);
  });

  it('遡及差額は平均から除く', () => {
    const r = judgeRevision(input({ salaries: [sal('2026-06', 400_000, 20, { retroactive: 60_000 }), sal('2026-07', 340_000), sal('2026-08', 340_000)] }));
    expect(r.average).toBe(340_000);
    expect(r.averageWithRetro).toBe(360_000);
  });

  it('現物給与は報酬に含める', () => {
    const r = judgeRevision(input({ salaries: [sal('2026-06', 330_000, 20, { inKind: 30_000 }), sal('2026-07', 360_000), sal('2026-08', 360_000)] }));
    expect(r.average).toBe(360_000);
  });

  it('固定的賃金が変わっていなければ対象外。向きが分からなければ確認が要る', () => {
    const months = [sal('2026-06', 400_000), sal('2026-07', 400_000), sal('2026-08', 400_000)];
    expect(judgeRevision(input({ salaries: months, fixedWageUnchanged: true })).status).toBe('ineligible');
    expect(judgeRevision(input({ salaries: months, direction: null })).status).toBe('review');
  });

  it('健保だけ対象（厚年は上限で等級が変わらない）', () => {
    const r = judgeRevision(input({ current: gradeOf(700_000), salaries: [sal('2026-06', 900_000), sal('2026-07', 900_000), sal('2026-08', 900_000)] }));
    expect(r.status).toBe('eligible');
    expect(r.health.eligible).toBe(true);
    expect(r.pension.eligible).toBe(false);
  });

  it('厚年の上限の特例：62万円→65万円は1等級でも対象', () => {
    const cur = gradeOf(620_000);
    const r = judgeRevision(input({ current: cur, salaries: [sal('2026-06', 670_000), sal('2026-07', 670_000), sal('2026-08', 670_000)] }));
    expect(r.pension.eligible).toBe(true);
    expect(r.pension.newStandard).toBe(650_000);
  });

  it('下限の特例は従前の報酬月額で決める（なければ確認が要る）', () => {
    const cur = gradeOf(80_000, null);
    const months = [sal('2026-06', 95_000), sal('2026-07', 95_000), sal('2026-08', 95_000)];
    expect(cur.pensionStandard).toBe(88_000);
    expect(judgeRevision(input({ current: cur, salaries: months })).status).toBe('review');
    const ok = judgeRevision(input({ current: cur, salaries: months, previousRemuneration: 80_000 }));
    expect(ok.pension.eligible).toBe(true);
    expect(ok.pension.newStandard).toBe(98_000);
  });

  it('加入していない保険は判定しない', () => {
    const r = judgeRevision(input({ enrolled: { health: true, pension: false }, salaries: [sal('2026-06', 400_000), sal('2026-07', 400_000), sal('2026-08', 400_000)] }));
    expect(r.pension.enrolled).toBe(false);
    expect(r.pension.eligible).toBe(false);
    expect(r.health.eligible).toBe(true);
  });

  it('今の等級がなければ確認が要る', () => {
    expect(judgeRevision(input({ current: null, salaries: [sal('2026-06', 400_000), sal('2026-07', 400_000), sal('2026-08', 400_000)] })).status).toBe('review');
  });
});

describe('産休・育休終了時の改定', () => {
  const ok = { missing: [], blocking: [] };

  it('起点は休業を終えた日の翌日が属する月', () => {
    expect(leaveEndStartMonth('2026-10-29')).toBe('2026-10');
    expect(leaveEndStartMonth('2026-10-31')).toBe('2026-11');
    expect(effectiveMonthOf('2026-11')).toBe('2027-02');
  });

  it('1等級の差でも改定できる（下がる場合も上がる場合も）', () => {
    const down = judgeRevision(input({ kind: 'childcareEnd', direction: null, leaveEnd: ok, salaries: [sal('2026-11', 285_000), sal('2026-12', 285_000), sal('2027-01', 285_000)], startMonth: '2026-11' }));
    expect(down.status).toBe('eligible');
    expect(down.health.diff).toBe(-1);
    const up = judgeRevision(input({ kind: 'maternityEnd', direction: null, leaveEnd: ok, salaries: [sal('2026-11', 315_000), sal('2026-12', 315_000), sal('2027-01', 315_000)], startMonth: '2026-11' }));
    expect(up.status).toBe('eligible');
  });

  it('17日未満の月を除いて平均する。パートは17日の月がなければ15日', () => {
    const r = judgeRevision(input({ kind: 'childcareEnd', direction: null, leaveEnd: ok, startMonth: '2026-11',
      salaries: [sal('2026-11', 100_000, 8), sal('2026-12', 260_000), sal('2027-01', 270_000)] }));
    expect(r.average).toBe(265_000);
    expect(r.months.map(m => m.used)).toEqual([false, true, true]);
    const part = judgeRevision(input({ kind: 'childcareEnd', direction: null, leaveEnd: ok, startMonth: '2026-11', insuredCategory: 'partTimer',
      salaries: [sal('2026-11', 100_000, 10), sal('2026-12', 150_000, 16), sal('2027-01', 160_000, 15)] }));
    expect(part.average).toBe(155_000);
    const none = judgeRevision(input({ kind: 'childcareEnd', direction: null, leaveEnd: ok, startMonth: '2026-11',
      salaries: [sal('2026-11', 100_000, 10), sal('2026-12', 150_000, 16), sal('2027-01', 160_000, 15)] }));
    expect(none.status).toBe('ineligible');
  });

  it('本人の申出がなければ決めない', () => {
    const check = leaveEndCheck({ kind: 'childcareEnd', endDate: '2026-10-31', childBirthDate: '2025-08-15', nextLeaveFromNextDay: false, applied: false });
    expect(check.missing).toHaveLength(1);
    const r = judgeRevision(input({ kind: 'childcareEnd', direction: null, leaveEnd: check, startMonth: '2026-11',
      salaries: [sal('2026-11', 250_000), sal('2026-12', 250_000), sal('2027-01', 250_000)] }));
    expect(r.status).toBe('review');
  });

  it('子が3歳に達していれば・次の休業に続けて入るならできない', () => {
    expect(leaveEndCheck({ kind: 'childcareEnd', endDate: '2028-08-14', childBirthDate: '2025-08-15', nextLeaveFromNextDay: false, applied: true }).blocking).toHaveLength(1);
    expect(leaveEndCheck({ kind: 'childcareEnd', endDate: '2028-08-13', childBirthDate: '2025-08-15', nextLeaveFromNextDay: false, applied: true }).blocking).toHaveLength(0);
    const next = leaveEndCheck({ kind: 'maternityEnd', endDate: '2026-10-10', childBirthDate: '2026-08-15', nextLeaveFromNextDay: true, applied: true });
    expect(judgeRevision(input({ kind: 'maternityEnd', direction: null, leaveEnd: next, startMonth: '2026-10', salaries: [] })).status).toBe('ineligible');
  });
});

describe('サンプルの場合分け', () => {
  it('サンプルの従業員が想定どおりに判定される', () => {
    const results = buildRevisionSample().map(e => {
      const [prev, ...three] = e.months;
      const fw = fixedWageChange({ before: prev.fixed, after: three[0].fixed, manualDirection: null });
      return judgeRevision(input({
        current: gradeOf(e.gradeRemuneration, e.basisRemuneration), insuredCategory: e.category, startMonth: '2026-07',
        direction: fw.direction, fixedWageUnchanged: fw.changed === false,
        salaries: three.map((m, i) => sal(['2026-07', '2026-08', '2026-09'][i], m.total, m.days ?? 20, { retroactive: m.retro ?? 0, confirmed: m.confirmed !== false })),
      })).status;
    });
    expect(results).toEqual(['eligible', 'eligible', 'ineligible', 'ineligible', 'ineligible', 'eligible', 'eligible', 'review', 'eligible', 'waiting', 'ineligible']);
  });
});
