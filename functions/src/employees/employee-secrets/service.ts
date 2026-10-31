import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { notFound } from '../../utils/errors';
import { decryptMyNumber, encryptMyNumber } from '../../utils/kms';
import {
  REVEAL_REASONS,
  SecretsGetInput,
  SecretsRevealInput,
  SecretsUpdateInput,
} from './schema';

/** 個人番号は返さない。登録の有無だけ（画面では全桁を伏せる） */
export interface SecretsResponse {
  myNumberRegistered: boolean;
  myNumberUpdatedAt: string | null;
  version: number;
}

async function loadEmployee(auth: AuthContext, employeeId: string): Promise<EmployeeDoc> {
  const snap = await db.doc(`companies/${auth.companyId}/employees/${employeeId}`).get();
  if (!snap.exists || (snap.data() as EmployeeDoc).deletedAt !== null) {
    throw notFound('従業員');
  }
  const emp = snap.data() as EmployeeDoc;
  requireOffice(auth, emp.officeId);
  return emp;
}

export async function getSecrets(
  input: SecretsGetInput,
  auth: AuthContext,
): Promise<SecretsResponse> {
  await loadEmployee(auth, input.employeeId);
  const snap = await db
    .doc(`companies/${auth.companyId}/employees/${input.employeeId}/secrets/main`)
    .get();
  const data = snap.data();
  return {
    myNumberRegistered: !!data?.myNumberCipher,
    myNumberUpdatedAt: data?.myNumberUpdatedAt
      ? (data.myNumberUpdatedAt as Timestamp).toDate().toISOString()
      : null,
    version: snap.exists ? (data!.version ?? 1) : 0,
  };
}

export async function updateSecrets(
  input: SecretsUpdateInput,
  auth: AuthContext,
): Promise<{ success: boolean }> {
  const base = `companies/${auth.companyId}`;
  const empRef = db.doc(`${base}/employees/${input.employeeId}`);
  const secretRef = db.doc(`${base}/employees/${input.employeeId}/secrets/main`);

  // 暗号化はトランザクションの外で（KMS の呼び出しを繰り返さない）
  const cipher =
    input.myNumber === null
      ? null
      : await encryptMyNumber(auth.companyId, input.employeeId, input.myNumber);

  await db.runTransaction(async (tx) => {
    const empSnap = await tx.get(empRef);
    if (!empSnap.exists || (empSnap.data() as EmployeeDoc).deletedAt !== null) {
      throw notFound('従業員');
    }
    requireOffice(auth, (empSnap.data() as EmployeeDoc).officeId);

    const secretSnap = await tx.get(secretRef);
    const currentVersion = secretSnap.exists ? (secretSnap.data()!.version ?? 1) : 0;
    if (currentVersion !== input.expectedVersion) {
      throw new HttpsError(
        'failed-precondition',
        `データが更新されています（現在のバージョン: ${currentVersion}）`,
      );
    }
    const hadNumber = !!secretSnap.data()?.myNumberCipher;

    const now = Timestamp.now();
    tx.set(
      secretRef,
      {
        myNumberCipher: cipher,
        myNumberUpdatedAt: now,
        version: currentVersion + 1,
        updatedAt: now,
        updatedBy: auth.uid,
        ...(secretSnap.exists ? {} : { createdAt: now }),
      },
      { merge: true },
    );

    // 個人番号は変更前後の値を残さない。登録・変更・削除した事実だけを残す
    tx.set(db.collection(`${base}/auditLogs`).doc(), {
      entity: 'employeeMyNumber',
      entityId: input.employeeId,
      action: cipher === null ? 'delete' : hadNumber ? 'update' : 'create',
      changes: { myNumber: { from: 'redacted', to: 'redacted' } },
      performedBy: auth.uid,
      performedAt: now,
      version: currentVersion + 1,
    });
  });

  return { success: true };
}

export async function revealSecrets(
  input: SecretsRevealInput,
  auth: AuthContext,
): Promise<{ myNumber: string }> {
  const base = `companies/${auth.companyId}`;
  await loadEmployee(auth, input.employeeId);
  const snap = await db.doc(`${base}/employees/${input.employeeId}/secrets/main`).get();
  const cipher = snap.data()?.myNumberCipher;
  if (!cipher) {
    throw new HttpsError('failed-precondition', '個人番号が登録されていません');
  }
  const myNumber = await decryptMyNumber(auth.companyId, input.employeeId, cipher);

  // 閲覧の記録は表示より先に書く（書けなければ表示しない）
  const now = Timestamp.now();
  const record = {
    employeeId: input.employeeId,
    reason: input.reason,
    reasonLabel: REVEAL_REASONS[input.reason],
    note: input.note ?? null,
    viewedBy: auth.uid,
    viewedAt: now,
  };
  const batch = db.batch();
  batch.set(db.collection(`${base}/myNumberAccessLogs`).doc(), record);
  batch.set(db.collection(`${base}/auditLogs`).doc(), {
    entity: 'employeeMyNumber',
    entityId: input.employeeId,
    action: 'view',
    changes: { reason: record.reasonLabel, note: record.note },
    performedBy: auth.uid,
    performedAt: now,
    version: 0,
  });
  await batch.commit();

  return { myNumber };
}
