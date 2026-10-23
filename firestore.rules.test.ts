/**
 * Firestore セキュリティルール テスト仕様
 *
 * 実行には Firebase Emulator Suite が必要:
 *   firebase emulators:exec --only firestore "npx jest firestore.rules.test.ts"
 *
 * @firebase/rules-unit-testing をインストール後に実行:
 *   npm install -D @firebase/rules-unit-testing
 */

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, collection, addDoc } from 'firebase/firestore';

const PROJECT_ID = 'shaho-test';
const COMPANY_ID = 'company-001';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

async function setupUser(
  uid: string,
  data: Record<string, unknown>,
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(
      doc(db, `companies/${COMPANY_ID}/users/${uid}`),
      {
        email: `${uid}@example.com`,
        displayName: 'Test User',
        roles: ['employee'],
        officeIds: [],
        isSuspended: false,
        isLoginDisabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      },
    );
  });
}

async function setupEmployee(
  employeeId: string,
  data: Record<string, unknown>,
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(
      doc(db, `companies/${COMPANY_ID}/employees/${employeeId}`),
      {
        lastName: '山田',
        firstName: '太郎',
        lastNameKana: 'ヤマダ',
        firstNameKana: 'タロウ',
        officeId: 'office-001',
        isActive: true,
        deletedAt: null,
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      },
    );
  });
}

async function setupCompany() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `companies/${COMPANY_ID}`), {
      name: 'テスト株式会社',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
}

// ── 認証なしのアクセス拒否 ──────────────────────────

describe('未認証アクセス', () => {
  it('認証なしでは companies を読めない', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `companies/${COMPANY_ID}`)));
  });
});

// ── companies ルート ─────────────────────────────────

describe('companies', () => {
  beforeEach(async () => {
    await setupCompany();
  });

  it('admin は company を読み書きできる', async () => {
    await setupUser('admin-user', { roles: ['admin'] });
    const db = testEnv.authenticatedContext('admin-user').firestore();
    await assertSucceeds(getDoc(doc(db, `companies/${COMPANY_ID}`)));
  });

  it('operator は company を読めるが書けない', async () => {
    await setupUser('op-user', { roles: ['operator'], officeIds: ['office-001'] });
    const db = testEnv.authenticatedContext('op-user').firestore();
    await assertSucceeds(getDoc(doc(db, `companies/${COMPANY_ID}`)));
    await assertFails(
      updateDoc(doc(db, `companies/${COMPANY_ID}`), { name: '変更' }),
    );
  });

  it('isLoginDisabled のユーザーはアクセスできない', async () => {
    await setupUser('disabled-user', { roles: ['admin'], isLoginDisabled: true });
    const db = testEnv.authenticatedContext('disabled-user').firestore();
    await assertFails(getDoc(doc(db, `companies/${COMPANY_ID}`)));
  });
});

// ── employees ────────────────────────────────────────

describe('employees', () => {
  beforeEach(async () => {
    await setupCompany();
    await setupEmployee('emp-001', { officeId: 'office-001', userId: 'self-user' });
  });

  it('admin は全従業員を読める', async () => {
    await setupUser('admin-user', { roles: ['admin'] });
    const db = testEnv.authenticatedContext('admin-user').firestore();
    await assertSucceeds(
      getDoc(doc(db, `companies/${COMPANY_ID}/employees/emp-001`)),
    );
  });

  it('operator は担当事業所の従業員を読める', async () => {
    await setupUser('op-user', { roles: ['operator'], officeIds: ['office-001'] });
    const db = testEnv.authenticatedContext('op-user').firestore();
    await assertSucceeds(
      getDoc(doc(db, `companies/${COMPANY_ID}/employees/emp-001`)),
    );
  });

  it('operator は担当外の事業所の従業員を読めない', async () => {
    await setupUser('op-user2', { roles: ['operator'], officeIds: ['office-002'] });
    const db = testEnv.authenticatedContext('op-user2').firestore();
    await assertFails(
      getDoc(doc(db, `companies/${COMPANY_ID}/employees/emp-001`)),
    );
  });

  it('本人は自分の情報を読める', async () => {
    await setupUser('self-user', { roles: ['employee'] });
    const db = testEnv.authenticatedContext('self-user').firestore();
    await assertSucceeds(
      getDoc(doc(db, `companies/${COMPANY_ID}/employees/emp-001`)),
    );
  });

  it('停止中の本人でも自分の情報を読める', async () => {
    await setupUser('self-user', { roles: ['employee'], isSuspended: true });
    const db = testEnv.authenticatedContext('self-user').firestore();
    await assertSucceeds(
      getDoc(doc(db, `companies/${COMPANY_ID}/employees/emp-001`)),
    );
  });
});

// ── secrets ──────────────────────────────────────────

describe('secrets', () => {
  it('admin でも secrets は読めない（Cloud Functions 専用）', async () => {
    await setupCompany();
    await setupEmployee('emp-001', {});
    await setupUser('admin-user', { roles: ['admin'] });

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, `companies/${COMPANY_ID}/employees/emp-001/secrets/myNumber`),
        { encryptedValue: 'xxx', maskedValue: '****' },
      );
    });

    const db = testEnv.authenticatedContext('admin-user').firestore();
    await assertFails(
      getDoc(doc(db, `companies/${COMPANY_ID}/employees/emp-001/secrets/myNumber`)),
    );
  });
});

// ── dependents ───────────────────────────────────────

describe('dependents', () => {
  beforeEach(async () => {
    await setupCompany();
    await setupEmployee('emp-001', { officeId: 'office-001', userId: 'self-user' });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, `companies/${COMPANY_ID}/employees/emp-001/dependents/dep-001`),
        { lastName: '山田', firstName: '花子', deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
      );
    });
  });

  it('admin は扶養家族を読める', async () => {
    await setupUser('admin-user', { roles: ['admin'] });
    const db = testEnv.authenticatedContext('admin-user').firestore();
    await assertSucceeds(
      getDoc(doc(db, `companies/${COMPANY_ID}/employees/emp-001/dependents/dep-001`)),
    );
  });

  it('本人は自分の扶養家族を読める', async () => {
    await setupUser('self-user', { roles: ['employee'] });
    const db = testEnv.authenticatedContext('self-user').firestore();
    await assertSucceeds(
      getDoc(doc(db, `companies/${COMPANY_ID}/employees/emp-001/dependents/dep-001`)),
    );
  });

  it('他人の扶養家族は読めない', async () => {
    await setupUser('other-user', { roles: ['employee'] });
    const db = testEnv.authenticatedContext('other-user').firestore();
    await assertFails(
      getDoc(doc(db, `companies/${COMPANY_ID}/employees/emp-001/dependents/dep-001`)),
    );
  });
});

// ── auditLogs ────────────────────────────────────────

describe('auditLogs', () => {
  it('admin は監査ログを読めるがクライアントからは書けない', async () => {
    await setupCompany();
    await setupUser('admin-user', { roles: ['admin'] });

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, `companies/${COMPANY_ID}/auditLogs/log-001`),
        { entity: 'employee', action: 'create', performedBy: 'admin-user' },
      );
    });

    const db = testEnv.authenticatedContext('admin-user').firestore();
    await assertSucceeds(
      getDoc(doc(db, `companies/${COMPANY_ID}/auditLogs/log-001`)),
    );
    await assertFails(
      addDoc(collection(db, `companies/${COMPANY_ID}/auditLogs`), { entity: 'test' }),
    );
  });
});

// ── users ────────────────────────────────────────────

describe('users', () => {
  beforeEach(async () => {
    await setupCompany();
  });

  it('admin は他のユーザーを読める', async () => {
    await setupUser('admin-user', { roles: ['admin'] });
    await setupUser('target-user', { roles: ['operator'] });

    const db = testEnv.authenticatedContext('admin-user').firestore();
    await assertSucceeds(
      getDoc(doc(db, `companies/${COMPANY_ID}/users/target-user`)),
    );
  });

  it('一般ユーザーは自分のユーザー情報のみ読める', async () => {
    await setupUser('normal-user', { roles: ['employee'] });
    await setupUser('other-user', { roles: ['employee'] });

    const db = testEnv.authenticatedContext('normal-user').firestore();
    await assertSucceeds(
      getDoc(doc(db, `companies/${COMPANY_ID}/users/normal-user`)),
    );
    await assertFails(
      getDoc(doc(db, `companies/${COMPANY_ID}/users/other-user`)),
    );
  });

  it('admin でも roles フィールドは直接変更できない', async () => {
    await setupUser('admin-user', { roles: ['admin'] });
    await setupUser('target-user', { roles: ['operator'] });

    const db = testEnv.authenticatedContext('admin-user').firestore();
    await assertFails(
      updateDoc(doc(db, `companies/${COMPANY_ID}/users/target-user`), {
        roles: ['admin'],
      }),
    );
  });
});

// ── invitations ──────────────────────────────────────

describe('invitations', () => {
  it('admin のみ招待を操作できる', async () => {
    await setupCompany();
    await setupUser('admin-user', { roles: ['admin'] });
    await setupUser('op-user', { roles: ['operator'], officeIds: ['office-001'] });

    const adminDb = testEnv.authenticatedContext('admin-user').firestore();
    await assertSucceeds(
      addDoc(collection(adminDb, `companies/${COMPANY_ID}/invitations`), {
        email: 'new@example.com',
        roles: ['operator'],
        status: 'pending',
        invitedBy: 'admin-user',
      }),
    );

    const opDb = testEnv.authenticatedContext('op-user').firestore();
    await assertFails(
      addDoc(collection(opDb, `companies/${COMPANY_ID}/invitations`), {
        email: 'another@example.com',
      }),
    );
  });
});
