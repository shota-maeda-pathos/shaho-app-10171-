import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { InvitationListInput } from './schema';

export async function listInvitations(input: InvitationListInput, auth: AuthContext) {
  let q: FirebaseFirestore.Query = db
    .collection(`companies/${auth.companyId}/invitations`)
    .orderBy('createdAt', 'desc');

  if (input.status && input.status !== 'all') {
    q = q.where('status', '==', input.status);
  }

  const snap = await q.limit(input.limit).get();

  const items = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      email: d.email,
      roles: d.roles,
      officeIds: d.officeIds ?? [],
      employeeId: d.employeeId ?? null,
      status: d.status,
      invitedBy: d.invitedBy,
      expiresAt: d.expiresAt?.toDate?.()?.toISOString() ?? null,
      createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
    };
  });

  return { items, count: items.length };
}
