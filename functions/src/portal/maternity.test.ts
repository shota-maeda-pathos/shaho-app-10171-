import { maternityBlocked } from './requests';

test('産休の申請は男性なら断り、女性・未登録・育休は通す', () => {
  expect(maternityBlocked({ type: 'leave', kind: 'maternity' }, 'male')).toBe(true);
  expect(maternityBlocked({ type: 'leave', kind: 'maternity' }, 'female')).toBe(false);
  expect(maternityBlocked({ type: 'leave', kind: 'maternity' }, undefined)).toBe(false);
  expect(maternityBlocked({ type: 'leave', kind: 'childcare' }, 'male')).toBe(false);
  expect(maternityBlocked({ type: 'address' }, 'male')).toBe(false);
});
