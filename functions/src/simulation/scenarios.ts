import { z } from 'zod';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { OfficeDoc } from '../types/firestore';
import { AllRates, findAllRates } from '../utils/insurance-rate';
import { toDateString } from '../utils/employment';
import { invalidArg, notFound } from '../utils/errors';
import { mapConcurrent } from '../utils/parallel';
import { RoundingRule, normalizeRoundingRule } from '../insurance/calculator';
import { bonusCaps, earlierMonthsInFiscalYear, toThousand } from '../bonus/bonus-calc';
import { getCostAnalysis } from '../dashboard/cost-analysis/service';
import { fiscalYearOf } from '../dashboard/cost-analysis/rules';
import { PremiumResult, ageAt, monthlyPremium, premiumOn, withRates } from './premium-core';

/**
 * 試算シミュレーション5種（カタログ13章）。実データは書き換えない。結果は画面で CSV にして手元に保存する。
 * 管理者・担当者だけが使える（functions.ts）
 */

const yen = z.number().int().min(0, '金額にマイナスは入れられません').max(1_000_000_000);
const id = z.string().regex(/^[^/]+$/);
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const RaiseSchema = z.object({
  companyId: z.string().min(1), yearMonth: ym, officeId: id.optional(), employeeIds: z.array(id).max(2000).optional(),
  method: z.enum(['amount', 'rate', 'individual']),
  amount: z.number().int().min(-10_000_000).max(10_000_000).optional(),
  rate: z.number().min(-100).max(1000).optional(),
  individual: z.record(id, yen).optional(),
});
export const HireSchema = z.object({ companyId: z.string().min(1), yearMonth: ym, officeId: id, monthlyRemuneration: yen, birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const AnnualSchema = z.object({ companyId: z.string().min(1), yearMonth: ym, officeId: id.optional(), departmentId: id.optional(), employeeId: id.optional(), bonusPerPayment: yen, bonusTimes: z.number().int().min(0).max(4) });
export const RateChangeSchema = z.object({
  companyId: z.string().min(1), yearMonth: ym, officeId: id.optional(),
  health: z.number().min(0).max(300).optional(), longTermCare: z.number().min(0).max(100).optional(), pension: z.number().min(0).max(300).optional(),
});
export const BonusSimSchema = z.object({ companyId: z.string().min(1), yearMonth: ym, officeId: id, employeeId: id.optional(), birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), amount: yen });

interface Person {
  id: string; name: string; officeId: string; officeName: string; departmentId: string | null;
  birthDate: string | null; remuneration: number | null; healthGrade: number | null; pensionGrade: number | null;
}

async function officeRates(auth: AuthContext, officeId: string, yearMonth: string, cache: Map<string, { rates: AllRates; rule: RoundingRule; name: string }>) {
  if (!cache.has(officeId)) {
    const snap = await db.doc(`companies/${auth.companyId}/offices/${officeId}`).get();
    if (!snap.exists) throw notFound('事業所');
    const o = snap.data() as OfficeDoc;
    const rates = await findAllRates(auth.companyId, yearMonth, o.prefectureCode, o.insurerId);
    if (!rates.health) throw notFound(`健康保険料率（${o.name}・${yearMonth}）`);
    cache.set(officeId, { rates, rule: normalizeRoundingRule(o.roundingRule), name: o.name });
  }
  return cache.get(officeId)!;
}

/** 試算の対象者（在籍中・担当事業所）と、今の報酬（等級を決めたときの報酬月額。なければ標準報酬月額） */
async function people(auth: AuthContext, f: { officeId?: string; departmentId?: string; employeeIds?: string[] }, yearMonth: string): Promise<Person[]> {
  if (f.officeId) requireOffice(auth, f.officeId);
  const snap = await db.collection(`companies/${auth.companyId}/employees`).where('deletedAt', '==', null).get();
  const offices = new Map((await db.collection(`companies/${auth.companyId}/offices`).get()).docs.map(o => [o.id, o.data().name as string]));
  const picked = snap.docs.filter(e => {
    const x = e.data();
    if (x.isActive !== true) return false;
    if (!auth.roles.includes('admin') && !auth.officeIds.includes(x.officeId)) return false;
    if (f.officeId && x.officeId !== f.officeId) return false;
    if (f.departmentId && x.departmentId !== f.departmentId) return false;
    if (f.employeeIds && !f.employeeIds.includes(e.id)) return false;
    return true;
  });
  return mapConcurrent(picked, 10, async e => {
    const x = e.data();
    const g = await e.ref.collection('grades').where('effectiveMonth', '<=', yearMonth).orderBy('effectiveMonth', 'desc').limit(1).get();
    const grade = g.docs[0]?.data();
    return {
      id: e.id, name: `${x.lastName} ${x.firstName}`, officeId: x.officeId, officeName: offices.get(x.officeId) ?? '', departmentId: x.departmentId ?? null,
      birthDate: toDateString(x.birthDate), remuneration: grade ? (grade.basisRemuneration ?? grade.healthStandardRemuneration ?? null) : null,
      healthGrade: grade?.healthGradeNumber ?? null, pensionGrade: grade?.pensionGradeNumber ?? null,
    };
  });
}

const pick = (p: PremiumResult) => ({ healthGrade: p.healthGrade, pensionGrade: p.pensionGrade, employee: p.employee, employer: p.employer, health: p.health, care: p.care, pension: p.pension, childSupport: p.childSupport });

function totalsBy<T extends { officeName: string; diffEmployee: number; diffEmployer: number }>(rows: T[]) {
  const m = new Map<string, { diffEmployee: number; diffEmployer: number; people: number }>();
  for (const r of rows) {
    const c = m.get(r.officeName) ?? { diffEmployee: 0, diffEmployer: 0, people: 0 };
    m.set(r.officeName, { diffEmployee: c.diffEmployee + r.diffEmployee, diffEmployer: c.diffEmployer + r.diffEmployer, people: c.people + 1 });
  }
  const offices = [...m.entries()].map(([officeName, v]) => ({ officeName, ...v }));
  return { offices, company: offices.reduce((a, o) => ({ diffEmployee: a.diffEmployee + o.diffEmployee, diffEmployer: a.diffEmployer + o.diffEmployer, people: a.people + o.people }), { diffEmployee: 0, diffEmployer: 0, people: 0 }) };
}

/** 昇給：今の等級・保険料と、昇給後の等級・保険料、差（月額・年額）、随時改定の可能性（等級差2以上） */
export async function simulateRaise(auth: AuthContext, input: z.infer<typeof RaiseSchema>) {
  if (input.method === 'amount' && input.amount === undefined) throw invalidArg('一律の金額を入れてください');
  if (input.method === 'rate' && input.rate === undefined) throw invalidArg('一律の率を入れてください');
  const cache = new Map();
  const list = await people(auth, { officeId: input.officeId, employeeIds: input.method === 'individual' ? Object.keys(input.individual ?? {}) : input.employeeIds }, input.yearMonth);
  const rows = [];
  for (const p of list) {
    if (p.remuneration === null || !p.birthDate) continue;
    const { rates, rule } = await officeRates(auth, p.officeId, input.yearMonth, cache);
    const next = input.method === 'amount' ? p.remuneration + input.amount!
      : input.method === 'rate' ? Math.round(p.remuneration * (1 + input.rate! / 100))
      : input.individual![p.id];
    if (next < 0) throw invalidArg(`${p.name}の昇給後の報酬がマイナスになります`);
    const age = ageAt(p.birthDate, input.yearMonth);
    const before = monthlyPremium(rates, rule, p.remuneration, age, input.yearMonth);
    const after = monthlyPremium(rates, rule, next, age, input.yearMonth);
    const gradeDiff = Math.abs((after.healthGrade ?? 0) - (before.healthGrade ?? 0));
    rows.push({
      employeeId: p.id, name: p.name, officeName: p.officeName, currentRemuneration: p.remuneration, newRemuneration: next,
      before: pick(before), after: pick(after),
      diffEmployee: after.employee - before.employee, diffEmployer: after.employer - before.employer,
      annualDiffEmployer: (after.employer - before.employer) * 12, annualDiffEmployee: (after.employee - before.employee) * 12,
      revision: gradeDiff >= 2 ? `等級が${gradeDiff}等級変わるため、随時改定の可能性があります（固定的賃金の変動と3か月の報酬で決まります）` : null,
    });
  }
  return { rows, skipped: list.length - rows.length, ...totalsBy(rows) };
}

/** 新規採用：等級・月額保険料・年間の会社負担の増加と、事業所全体の保険料の変化 */
export async function simulateHire(auth: AuthContext, input: z.infer<typeof HireSchema>) {
  const cache = new Map();
  const { rates, rule, name } = await officeRates(auth, input.officeId, input.yearMonth, cache);
  const p = monthlyPremium(rates, rule, input.monthlyRemuneration, ageAt(input.birthDate, input.yearMonth), input.yearMonth);
  const staff = await people(auth, { officeId: input.officeId }, input.yearMonth);
  let employee = 0, employer = 0;
  for (const s of staff) {
    if (s.remuneration === null || !s.birthDate) continue;
    const q = monthlyPremium(rates, rule, s.remuneration, ageAt(s.birthDate, input.yearMonth), input.yearMonth);
    employee += q.employee; employer += q.employer;
  }
  return {
    officeName: name, premium: pick(p), annualEmployerIncrease: p.employer * 12,
    office: { people: staff.length, before: { employee, employer }, after: { employee: employee + p.employee, employer: employer + p.employer } },
  };
}

/** 賞与1回分の会社・本人の保険料（年度の累計で健保の上限を判定） */
function bonusPremium(rates: AllRates, rule: RoundingRule, amount: number, prior: number, age: number, yearMonth: string) {
  const standard = toThousand(amount);
  const caps = bonusCaps(standard, prior);
  const p = premiumOn(rates, rule, caps.healthCapped, caps.pensionCapped, age, yearMonth);
  return { standard, caps, premium: p };
}

/** 年間コスト：今の等級の月額×12＋想定賞与の保険料（会社負担）。前年度の実績と比べる */
export async function simulateAnnual(auth: AuthContext, input: z.infer<typeof AnnualSchema>) {
  const cache = new Map();
  const list = await people(auth, { officeId: input.officeId, departmentId: input.departmentId, employeeIds: input.employeeId ? [input.employeeId] : undefined }, input.yearMonth);
  let monthly = 0, bonus = 0, counted = 0;
  for (const p of list) {
    if (p.remuneration === null || !p.birthDate) continue;
    const { rates, rule } = await officeRates(auth, p.officeId, input.yearMonth, cache);
    const age = ageAt(p.birthDate, input.yearMonth);
    monthly += monthlyPremium(rates, rule, p.remuneration, age, input.yearMonth).employer * 12;
    let prior = 0;
    for (let i = 0; i < input.bonusTimes; i++) {
      const b = bonusPremium(rates, rule, input.bonusPerPayment, prior, age, input.yearMonth);
      bonus += b.premium.employer;
      prior = b.caps.healthCumulative;
    }
    counted++;
  }
  const fy = fiscalYearOf(input.yearMonth);
  const previous = !input.departmentId && !input.employeeId ? (await getCostAnalysis(auth, fy, input.officeId)).previousAnnual : null;
  return { people: counted, monthlyEmployer: monthly, bonusEmployer: bonus, total: monthly + bonus, previousFiscalYear: fy - 1, previousActual: previous?.actual ?? null };
}

/** 料率改定：新しい料率（‰）を仮に入れ、今の料率との差を全員分と事業所合計で出す */
export async function simulateRateChange(auth: AuthContext, input: z.infer<typeof RateChangeSchema>) {
  if (input.health === undefined && input.longTermCare === undefined && input.pension === undefined) throw invalidArg('新しい料率を1つ以上入れてください');
  const cache = new Map();
  const list = await people(auth, { officeId: input.officeId }, input.yearMonth);
  const rows = [];
  for (const p of list) {
    if (p.remuneration === null || !p.birthDate) continue;
    const { rates, rule } = await officeRates(auth, p.officeId, input.yearMonth, cache);
    const age = ageAt(p.birthDate, input.yearMonth);
    const before = monthlyPremium(rates, rule, p.remuneration, age, input.yearMonth);
    const after = monthlyPremium(withRates(rates, input), rule, p.remuneration, age, input.yearMonth);
    rows.push({ employeeId: p.id, name: p.name, officeName: p.officeName, healthGrade: before.healthGrade, before: pick(before), after: pick(after), diffEmployee: after.employee - before.employee, diffEmployer: after.employer - before.employer });
  }
  return { rows, ...totalsBy(rows) };
}

/** 賞与：標準賞与額、健保の年度累計の上限（573万円）・厚年の1回の上限（150万円）を超えた分は保険料がかからない */
export async function simulateBonus(auth: AuthContext, input: z.infer<typeof BonusSimSchema>) {
  requireOffice(auth, input.officeId);
  const cache = new Map();
  const { rates, rule } = await officeRates(auth, input.officeId, input.yearMonth, cache);
  let birthDate = input.birthDate ?? null;
  let prior = 0;
  if (input.employeeId) {
    const emp = await db.doc(`companies/${auth.companyId}/employees/${input.employeeId}`).get();
    if (!emp.exists || emp.data()!.officeId !== input.officeId) throw notFound('従業員');
    birthDate = toDateString(emp.data()!.birthDate);
    const earlier = earlierMonthsInFiscalYear(input.yearMonth);
    const snap = await emp.ref.collection('bonuses').get();
    prior = snap.docs.map(d => d.data()).filter(b => earlier.includes(b.yearMonth))
      .reduce((a, b) => a + (typeof b.standardBonusAmount === 'number' ? b.standardBonusAmount : toThousand(b.totalAmount ?? 0)), 0);
  }
  if (!birthDate) throw invalidArg('従業員を選ぶか、生年月日を入れてください');
  const b = bonusPremium(rates, rule, input.amount, prior, ageAt(birthDate, input.yearMonth), input.yearMonth);
  return {
    amount: input.amount, standard: b.standard, priorHealthCumulative: prior, caps: b.caps,
    uncharged: { health: b.standard - b.caps.healthCapped, pension: b.standard - b.caps.pensionCapped },
    premium: pick(b.premium),
  };
}
