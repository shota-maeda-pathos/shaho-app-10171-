import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const app = initializeApp({
  credential: applicationDefault(),
  projectId: 'kensyu10171',
});
const db = getFirestore(app);

const COMPANY_ID = 'company-001';
const now = Timestamp.now();

async function seed() {
  const base = `companies/${COMPANY_ID}`;

  // 会社情報
  await db.doc(base).set({
    name: '株式会社パトスロゴス',
    corporateNumber: '1234567890123',
    representativeName: '森下 翔太',
    address: '東京都渋谷区神宮前1-2-3 パトスビル5F',
    phone: '03-1234-5678',
    email: 'info@pathoslogos.co.jp',
    healthInsurerId: '01130012',
    pensionCode: '12345',
    version: 1,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  console.log('✓ 会社情報を登録しました');

  // 事業所: 本社
  const officeHqRef = db.doc(`${base}/offices/office-hq`);
  await officeHqRef.set({
    name: '本社',
    officeNumber: '01',
    prefectureCode: '13',
    insurerId: '01130012',
    address: '東京都渋谷区神宮前1-2-3 パトスビル5F',
    phone: '03-1234-5678',
    closingDay: 25,
    paymentDay: 25,
    paymentMonth: 'next',
    deductionMethod: 'current',
    roundingRule: 'truncate',
    isActive: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  console.log('✓ 事業所「本社」を登録しました');

  // 事業所: 大阪支社
  const officeOsakaRef = db.doc(`${base}/offices/office-osaka`);
  await officeOsakaRef.set({
    name: '大阪支社',
    officeNumber: '02',
    prefectureCode: '27',
    insurerId: '27130045',
    address: '大阪府大阪市北区梅田2-4-6 グランドタワー10F',
    phone: '06-9876-5432',
    closingDay: 25,
    paymentDay: 25,
    paymentMonth: 'next',
    deductionMethod: 'current',
    roundingRule: 'truncate',
    isActive: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  console.log('✓ 事業所「大阪支社」を登録しました');

  // 保険料率マスタ（健康保険・厚生年金・介護保険・子ども子育て拠出金）
  const ratesRef = db.collection(`${base}/insuranceRates`);

  // 健康保険料率（協会けんぽ 東京 R6年度）
  await ratesRef.doc('health-2024-04').set({
    insuranceType: 'health',
    appliedFrom: '2024-04',
    rate: 0.09980,
    employeeRate: 0.04990,
    employerRate: 0.04990,
    prefectureCode: '13',
    description: '協会けんぽ東京 令和6年度',
    version: 1,
    createdAt: now,
  }, { merge: true });

  // 介護保険料率
  await ratesRef.doc('longTermCare-2024-04').set({
    insuranceType: 'longTermCare',
    appliedFrom: '2024-04',
    rate: 0.01600,
    employeeRate: 0.00800,
    employerRate: 0.00800,
    description: '介護保険料率 令和6年度',
    version: 1,
    createdAt: now,
  }, { merge: true });

  // 厚生年金保険料率
  await ratesRef.doc('pension-2024-04').set({
    insuranceType: 'pension',
    appliedFrom: '2024-04',
    rate: 0.18300,
    employeeRate: 0.09150,
    employerRate: 0.09150,
    description: '厚生年金保険料率',
    version: 1,
    createdAt: now,
  }, { merge: true });

  // 子ども・子育て拠出金率
  await ratesRef.doc('childSupport-2024-04').set({
    insuranceType: 'childSupport',
    appliedFrom: '2024-04',
    rate: 0.00360,
    employeeRate: 0,
    employerRate: 0.00360,
    description: '子ども・子育て拠出金率 令和6年度',
    version: 1,
    createdAt: now,
  }, { merge: true });

  console.log('✓ 保険料率マスタを登録しました');

  // 現在のユーザーにadmin+operator+approverロールを付与
  // 既存のユーザードキュメントを検索
  const usersSnap = await db.collection(`${base}/users`).get();
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const currentRoles: string[] = data.roles ?? [];
    const neededRoles = ['admin', 'operator', 'approver'];
    const newRoles = [...new Set([...currentRoles, ...neededRoles])];
    if (newRoles.length !== currentRoles.length) {
      await userDoc.ref.update({
        roles: newRoles,
        officeIds: ['office-hq', 'office-osaka'],
        updatedAt: now,
      });
      console.log(`✓ ユーザー ${userDoc.id} のロールを更新: ${newRoles.join(', ')}`);
    } else {
      // officeIdsだけ更新
      await userDoc.ref.update({
        officeIds: ['office-hq', 'office-osaka'],
        updatedAt: now,
      });
      console.log(`✓ ユーザー ${userDoc.id} の事業所アクセスを更新`);
    }
  }

  console.log('\n=== セットアップ完了 ===');
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
