import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { alreadyExists, invalidArg } from '../../utils/errors';
import { toTimestamp } from '../../utils/firestore';
import { MutationResponse } from '../../types/response';
import { EmployeeCreateInput } from './schema';
import { pickProfile } from '../../types/catalog-schemas';
import { assertAssignable } from '../../offices/lifecycle';
import { assertDepartment } from '../../offices/departments';
import { insuredCounterPath, nextInsuredNumber } from '../../offices/insured-number';

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
  // 設定が終わっていない事業所・廃止した事業所には配属しない（カタログ1章 事業所ライフサイクル）
  await assertAssignable(auth.companyId, input.officeId);
  await assertDepartment(auth.companyId, input.departmentId, input.officeId);

  if (input.requestId) {
    const existing = await db
      .doc(`companies/${auth.companyId}/employeeRequests/${input.requestId}`)
      .get();
    if (existing.exists) {
      return { success: true, id: existing.data()!.employeeId };
    }
  }

  // 事業所の設定が「自動」で番号の指定がなければ、被保険者整理番号を付ける（カタログ1章 整理番号の採番）
  const autoNumber = officeDoc.data()!.insuredNumberMode === 'auto' && !input.insuredPersonNumber;
  const usedNumbers = autoNumber
    ? (await db.collection(`companies/${auth.companyId}/employees`).where('officeId', '==', input.officeId).select('insuredPersonNumber').get())
      .docs.map((d) => d.data().insuredPersonNumber as string | null | undefined)
    : [];

  const result = await db.runTransaction(async (tx) => {
    const reserveRef = db.doc(
      `companies/${auth.companyId}/employeeNumbers/${input.employeeNumber}`,
    );
    const counterRef = db.doc(insuredCounterPath(auth.companyId, input.officeId));
    const [reserveDoc, counter] = await Promise.all([tx.get(reserveRef), autoNumber ? tx.get(counterRef) : Promise.resolve(null)]);
    if (reserveDoc.exists) {
      throw alreadyExists('この社員番号');
    }
    const insuredPersonNumber = autoNumber ? nextInsuredNumber(usedNumbers, Number(counter?.data()?.last ?? 0)) : null;

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
      birthDate: input.birthDate ? toTimestamp(input.birthDate) : null,
      gender: input.gender,
      officeId: input.officeId,
      departmentId: input.departmentId ?? null,
      hireDate: toTimestamp(input.hireDate),
      resignationDate: null,
      userId: null,
      isActive: true,
      ...pickProfile(input),
      ...(insuredPersonNumber ? { insuredPersonNumber } : {}),
      version: 1,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    if (insuredPersonNumber) tx.set(counterRef, { last: Number(insuredPersonNumber), updatedAt: now }, { merge: true });

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
