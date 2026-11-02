import { Role } from '../services/auth.service';

/**
 * 画面ごとに開けるロール（app.routes.ts の roleGuard と同じ）。先頭が一致する最初の行を使う。
 * 手続きの詳細（/procedures/:id）はウィザードの画面へ移るので、ウィザードと同じく管理者・担当者だけにする。
 * リンクやお知らせが、押しても開けない画面（ガードでホームに戻される）を指さないように使う
 */
const ROUTE_ROLES: [prefix: string, roles: Role[]][] = [
  ['/procedures/', ['admin', 'operator']],
  ['/procedures', ['admin', 'operator', 'approver']],
  ['/approvals', ['admin', 'operator', 'approver']],
  ['/filings/', ['admin', 'operator', 'approver']],
  ['/monthly', ['admin', 'operator', 'approver']],
  ['/santei', ['admin', 'operator', 'approver']],
  ['/bonus', ['admin', 'operator', 'approver']],
  ['/reports', ['admin', 'operator', 'approver', 'viewer']],
  ['/grade-table', ['admin', 'operator', 'approver', 'viewer']],
  ['/analytics', ['admin', 'operator', 'viewer']],
  ['/settings', ['admin']],
  ['/portal', ['employee']],
];

/** 担当者の業務の画面（従業員・届出・手続きのウィザード・カレンダーなど）は、表にないものを管理者・担当者だけとみなす */
const STAFF_ONLY: Role[] = ['admin', 'operator'];

export function canOpenRoute(route: string, auth: { hasAnyRole(...roles: Role[]): boolean }): boolean {
  if (route === '/home' || route === '/' || route === '/account') return true;
  const row = ROUTE_ROLES.find(([prefix]) => route === prefix || route.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
  return auth.hasAnyRole(...(row ? row[1] : STAFF_ONLY));
}
