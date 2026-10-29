import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { db } from '../../config';
import { Timestamp } from 'firebase-admin/firestore';

export const seedMasterData = onCall(async (request) => {
  const companyId = request.data?.companyId ?? 'company-001';
  const auth = await getAuthContext(request, companyId);
  requireRole(auth, 'admin', 'operator');

  const base = `companies/${companyId}`;
  const now = Timestamp.now();

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

  // 事業所: 本社
  await db.doc(`${base}/offices/office-hq`).set({
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
    roundingRule: 'statutory',
    isActive: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  // 事業所: 大阪支社
  await db.doc(`${base}/offices/office-osaka`).set({
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
    roundingRule: 'statutory',
    isActive: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  // 保険料率マスタ
  const ratesRef = db.collection(`${base}/insuranceRates`);

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

  // ユーザーのロール更新
  const userRef = db.doc(`${base}/users/${auth.uid}`);
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    const data = userSnap.data()!;
    const currentRoles: string[] = data.roles ?? [];
    const newRoles = [...new Set([...currentRoles, 'admin', 'operator', 'approver'])];
    await userRef.update({
      roles: newRoles,
      officeIds: ['office-hq', 'office-osaka'],
      updatedAt: now,
    });
  }

  return {
    success: true,
    message: '会社情報・事業所2拠点・保険料率4種・ユーザーロールを設定しました',
  };
});
