import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { MutationResponse } from '../../types/response';
import { invalidArg } from '../../utils/errors';
import { UserInviteInput } from './schema';

const INVITATION_EXPIRY_DAYS = 7;

export async function inviteUser(
  input: UserInviteInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  const result = await db.runTransaction(async (tx) => {
    const existingUsersSnap = await db
      .collection(`companies/${auth.companyId}/users`)
      .where('email', '==', input.email)
      .limit(1)
      .get();

    if (!existingUsersSnap.empty) {
      throw invalidArg('このメールアドレスは既に登録されています');
    }

    const pendingInvitesSnap = await db
      .collection(`companies/${auth.companyId}/invitations`)
      .where('email', '==', input.email)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!pendingInvitesSnap.empty) {
      throw invalidArg('このメールアドレスには既に招待が送信されています');
    }

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(
      now.toMillis() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    const inviteRef = db
      .collection(`companies/${auth.companyId}/invitations`)
      .doc();

    tx.set(inviteRef, {
      email: input.email,
      roles: input.roles,
      officeIds: input.officeIds ?? [],
      employeeId: input.employeeId ?? null,
      status: 'pending',
      invitedBy: auth.uid,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'invitation',
      entityId: inviteRef.id,
      action: 'invite',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return inviteRef.id;
  });

  return { success: true, id: result };
}
