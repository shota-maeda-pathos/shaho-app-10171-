import { forApprover } from './rules';
import { monthlyProgress } from './monthly-progress';

test('承認者だけの人には、承認を頼まれた件だけを出す', () => {
  expect(forApprover({ tone: 'yours', approve: true })).toBe(true);
  // 担当者の作業（最後の保険料の集め方を決める など）は「あなたの番」でも出さない
  expect(forApprover({ tone: 'yours' })).toBe(false);
  expect(forApprover({ tone: 'action', approve: true })).toBe(false);
  expect(forApprover({ tone: 'waiting' })).toBe(false);
});

test('毎月の処理の進み具合：承認を頼まれた件だけ approve が付く', () => {
  const p = monthlyProgress({ rows: [], reviews: {} as any, canApprove: true });
  expect(p === null || p.approve !== true).toBe(true);
});
