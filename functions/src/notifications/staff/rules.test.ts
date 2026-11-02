import { noticeLink, noticeOfficeId, staffCanSee } from './rules';

const admin = { roles: ['admin'], officeIds: [] };
const operator = { roles: ['operator'], officeIds: ['tigers'] };
const approver = { roles: ['approver', 'employee'], officeIds: ['tigers'] };
const viewer = { roles: ['viewer'], officeIds: ['tigers'] };

test('事業所は書いたときの officeId、なければ一括型の run のIDから', () => {
  expect(noticeOfficeId({ officeId: 'a' })).toBe('a');
  expect(noticeOfficeId({ targetType: 'santeiRun', targetId: 'sample-santei-office_2026' })).toBe('sample-santei-office');
  expect(noticeOfficeId({ targetType: 'monthlyRun', targetId: 'tigers_2026-10' })).toBe('tigers');
  expect(noticeOfficeId({ targetType: 'approvalRequest', targetId: 'r1' })).toBeNull();
});

test('管理者はすべて、担当者・承認者は担当事業所だけ、閲覧者・全員あては出さない', () => {
  const own = { targetType: 'approvalRequest', officeId: 'tigers' };
  const other = { targetType: 'approvalRequest', officeId: 'osaka' };
  const unknown = { targetType: 'approvalRequest' };
  expect(staffCanSee(own, admin) && staffCanSee(other, admin) && staffCanSee(unknown, admin)).toBe(true);
  expect([staffCanSee(own, operator), staffCanSee(other, operator), staffCanSee(unknown, operator)]).toEqual([true, false, false]);
  expect(staffCanSee(own, approver)).toBe(true);
  expect(staffCanSee(own, viewer)).toBe(false);
  expect(staffCanSee({ targetType: 'all' }, admin)).toBe(false);
  expect(staffCanSee({ targetType: 'employee', targetId: 'e1' }, admin)).toBe(false);
});

test('お知らせを押したときに開く画面', () => {
  expect(noticeLink({ link: { route: '/filings/f1', queryParams: { employeeId: 'e1' } }, targetType: 'filing' })).toEqual({ route: '/filings/f1', queryParams: { employeeId: 'e1' } });
  expect(noticeLink({ targetType: 'procedure', targetId: 'p1' })).toEqual({ route: '/procedures/p1', queryParams: {} });
  expect(noticeLink({ targetType: 'santeiRun', targetId: 'sample-santei-office_2026' })).toEqual({ route: '/santei', queryParams: { officeId: 'sample-santei-office', year: '2026' } });
  expect(noticeLink({ targetType: 'bonusRun', targetId: 'sample-bonus-office_2026-12' })).toEqual({ route: '/bonus', queryParams: { officeId: 'sample-bonus-office', month: '2026-12' } });
  expect(noticeLink({ targetType: 'monthlyRun', targetId: 'tigers_2026-10' })).toEqual({ route: '/monthly', queryParams: { officeId: 'tigers', payMonth: '2026-10' } });
  expect(noticeLink({ targetType: 'approvalRequest', targetId: 'r1' })?.route).toBe('/approvals');
  expect(noticeLink({ targetType: 'approvalAutoCancel' })?.route).toBe('/filings');
  expect(noticeLink({ targetType: 'something' })).toBeNull();
});
