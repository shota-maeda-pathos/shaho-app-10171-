import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';

interface UserListItem {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  officeIds: string[];
  isSuspended: boolean;
}

interface InvitationListItem {
  id: string;
  email: string;
  roles: string[];
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

  const users: UserListItem[] = usersSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      email: data.email,
      displayName: data.displayName,
      roles: data.roles,
      officeIds: data.officeIds ?? [],
      isSuspended: data.isSuspended ?? false,
    };
  });

  const invitationsSnap = await db
    .collection(`companies/${auth.companyId}/invitations`)
    .where('status', '==', 'pending')
    .get();

  const invitations: InvitationListItem[] = invitationsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      email: data.email,
      roles: data.roles,
      status: data.status,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() ?? '',
    };
  });

  return { users, invitations };
}
