import { ageAt, premiumOn, withRates } from './premium-core';
import { AllRates } from '../utils/insurance-rate';

const rate = (insuranceType: string, total: number) => ({ insuranceType, totalRate: total, employeeRate: total / 2, employerRate: total / 2, appliedFrom: '2026-03' }) as any;
const rates: AllRates = { health: rate('health', 100), pension: rate('pension', 183), longTermCare: rate('longTermCare', 16), childSupport: rate('childSupport', 3.6), childSupportPayment: null };

describe('試算の保険料', () => {
  it('年齢到達は誕生日の前日（その月の末日時点）', () => {
    expect(ageAt('1986-12-01', '2026-11')).toBe(40);
    expect(ageAt('1986-12-02', '2026-11')).toBe(39);
    expect(ageAt('1956-05-10', '2026-05')).toBe(70);
  });
  it('介護保険は40〜64歳、厚生年金は70歳未満', () => {
    expect(premiumOn(rates, 'statutory', 300000, 300000, 39, '2026-10').care.employee).toBe(0);
    expect(premiumOn(rates, 'statutory', 300000, 300000, 45, '2026-10').care.employee).toBe(2400);
    expect(premiumOn(rates, 'statutory', 300000, 300000, 70, '2026-10').pension.employee).toBe(0);
  });
  it('料率を差し替えると保険料が変わる（折半）', () => {
    const before = premiumOn(rates, 'statutory', 300000, 300000, 30, '2026-10');
    const after = premiumOn(withRates(rates, { health: 110 }), 'statutory', 300000, 300000, 30, '2026-10');
    expect(after.health.employee - before.health.employee).toBe(1500);
    expect(after.pension).toEqual(before.pension);
  });
});
