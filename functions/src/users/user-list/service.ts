import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { emailKey } from '../../auth-session/passwords';
import { isLocked, type LoginGuard } from '../../auth-session/rules';

interface UserListItem {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  officeIds: string[];
  isSuspended: boolean;
  /** ログインの失敗が続いてロック中か（ロック解除のボタンを出す） */
  isLocked: boolean;
}

/** 一覧の並び：管理者・担当者・承認者・閲覧者・従業員の順、同じなら名前の順 */
const ROLE_ORDER = ['admin', 'operator', 'approver', 'viewer', 'employee'];
const roleRank = (roles: string[]) => Math.min(...(roles ?? []).map(r => ROLE_ORDER.indexOf(r)).filter(i => i >= 0), ROLE_ORDER.length);

interface InvitationListItem {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  officeIds: string[];
  status: string;
  expiresAt: string;
}

export interface UserListResponse {
  users: UserListItem[];
  invitations: InvitationListItem[];
}

export async function listUsers(
  auth: AuthContext,
): Promise<UserListResponse> {
  const usersSnap = await db
    .collection(`companies/${auth.companyId}/users`)
    .orderBy('displayName', 'asc')
    .get();

  const guardSnaps = usersSnap.empty ? [] : await db.getAll(...usersSnap.docs.map(d => db.doc(`companies/${auth.companyId}/loginGuards/${emailKey(String(d.data().email ?? ''))}`)));
  const now = Date.now();
  const users: UserListItem[] = usersSnap.docs.map((d, i) => {
    const data = d.data();
    return {
      id: d.id,
      email: data.email,
      displayName: data.displayName,
      roles: data.roles,
      officeIds: data.officeIds ?? [],
      isSuspended: data.isSuspended ?? false,
      isLocked: guardSnaps[i]?.exists ? isLocked(guardSnaps[i].data() as LoginGuard, now) : false,
    };
  }).sort((a, b) => roleRank(a.roles) - roleRank(b.roles) || String(a.email ?? '').localeCompare(String(b.email ?? ''), 'ja', { numeric: true }));

  const invitationsSnap = await db
    .collection(`companies/${auth.companyId}/invitations`)
    .where('status', '==', 'pending')
    .get();

  const invitations: InvitationListItem[] = invitationsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      email: data.email,
      displayName: data.displayName ?? '',
      roles: data.roles,
      officeIds: data.officeIds ?? [],
      status: data.status,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() ?? '',
    };
  });

  return { users, invitations };
}
