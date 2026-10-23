import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { alreadyExists, invalidArg } from '../../utils/errors';
import { toTimestamp } from '../../utils/firestore';
import { MutationResponse } from '../../types/response';
import { EmployeeCreateInput } from './schema';

export async function createEmployee(
  input: EmployeeCreateInput,
  auth: AuthContext,
): Promise<MutationResponse> {
  if (!auth.roles.includes('admin')) {
    requireOffice(auth, input.officeId);
  }

  const officeDoc = await db
    .doc(`companies/${auth.companyId}/offices/${input.officeId}`)
    .get();
  if (!officeDoc.exists) {
    throw invalidArg('指定された事業所が存在しません');
  }

  if (input.requestId) {
    const existing = await db
      .doc(`companies/${auth.companyId}/employeeRequests/${input.requestId}`)
      .get();
    if (existing.exists) {
      return { success: true, id: existing.data()!.employeeId };
    }
  }

  const result = await db.runTransaction(async (tx) => {
    const reserveRef = db.doc(
      `companies/${auth.companyId}/employeeNumbers/${input.employeeNumber}`,
    );
    const reserveDoc = await tx.get(reserveRef);
    if (reserveDoc.exists) {
      throw alreadyExists('この社員番号');
    }

    const now = Timestamp.now();
    const docRef = db
      .collection(`companies/${auth.companyId}/employees`)
      .doc();

    tx.set(reserveRef, {
      employeeId: docRef.id,
      createdAt: now,
    });

    tx.set(docRef, {
      employeeNumber: input.employeeNumber,
      lastName: input.lastName,
      firstName: input.firstName,
      lastNameKana: input.lastNameKana,
      firstNameKana: input.firstNameKana,
      birthDate: toTimestamp(input.birthDate),
      gender: input.gender,
      officeId: input.officeId,
      departmentId: input.departmentId ?? null,
      hireDate: toTimestamp(input.hireDate),
      resignationDate: null,
      userId: null,
      isActive: true,
      version: 1,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    if (input.requestId) {
      const reqRef = db.doc(
        `companies/${auth.companyId}/employeeRequests/${input.requestId}`,
      );
      tx.set(reqRef, { employeeId: docRef.id, createdAt: now });
    }

    const auditRef = db
      .collection(`companies/${auth.companyId}/auditLogs`)
      .doc();
    tx.set(auditRef, {
      entity: 'employee',
      entityId: docRef.id,
      action: 'create',
      changes: {},
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });

    return docRef.id;
  });

  return { success: true, id: result };
}
