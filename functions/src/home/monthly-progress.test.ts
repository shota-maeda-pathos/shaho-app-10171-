import type { MonthlyRow } from '../monthly/service';
import { monthlyProgress } from './monthly-progress';

const row = (patch: Partial<MonthlyRow> = {}): MonthlyRow => ({
  employeeId: 'e', employeeNumber: '1', name: 'テスト', salaryRequired: true, premiumDue: true, premiumNote: '',
  salary: null, premium: null, previous: null, diff: null, diffReasons: [], issues: [], warnings: [],
  collection: { plan: 'payroll', due: 0, collected: null, status: 'none' as never, version: 0, entries: [] },
  hold: null, stale: false, rejected: { salary: null, premium: null }, revision: null, ...patch,
});
const salary = (patch = {}) => ({ total: 300000, inKind: 0, basisDays: 30, noPay: false, noPayReason: '', confirmed: false, pending: false, published: false, version: 1, ...patch });
const premium = (patch = {}) => ({ employee: 15000, employer: 15000, healthGrade: 22, pensionGrade: 19, exempted: false, confirmed: false, pending: false, version: 1, ...patch });
const noReviews = { salary: null, premium: null };

describe('ホーム：毎月の処理で次にやること', () => {
  it('給与が未登録の人がいれば、給与の取り込みが要対応', () => {
    const p = monthlyProgress({ rows: [row(), row({ salary: salary() })], reviews: noReviews, canApprove: false });
    expect(p).toEqual({ next: '給与を取り込む（残り1名）', tone: 'action', detail: '要対応 1名' });
  });
  it('給与の確認が済んでいれば、保険料の計算に進む（承認待ちと誤らない）', () => {
    const p = monthlyProgress({ rows: [row({ salary: salary({ confirmed: true }) })], reviews: { salary: { mine: true }, premium: null }, canApprove: true });
    expect(p?.next).toBe('保険料を計算する（残り1名）');
  });
  it('承認待ちは、依頼した本人には待ち、別の承認者にはあなたの番', () => {
    // 保険料の計算は給与の承認を待たないので、計算の要らない人で確かめる
    const rows = [row({ premiumDue: false, salary: salary({ pending: true }) })];
    expect(monthlyProgress({ rows, reviews: { salary: { mine: true }, premium: null }, canApprove: true })?.tone).toBe('waiting');
    expect(monthlyProgress({ rows, reviews: { salary: { mine: false }, premium: null }, canApprove: true })).toMatchObject({ next: '給与を承認する（1名）', tone: 'yours' });
  });
  it('保留の人は数えず、全員が終わっていれば出さない', () => {
    const done = row({
      salary: salary({ confirmed: true, published: true }), premium: premium({ confirmed: true }),
      collection: { plan: 'payroll', due: 15000, collected: 15000, status: 'done', version: 1, entries: [] },
    });
    expect(monthlyProgress({ rows: [done, row({ hold: { reason: '休職' } })], reviews: noReviews, canApprove: false })).toBeNull();
  });
});
