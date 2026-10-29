import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

async function verify() {
  const base = 'companies/company-001';

  // 会社情報
  const company = await db.doc(base).get();
  console.log('=== 会社情報 ===');
  if (company.exists) {
    const d = company.data()!;
    console.log(`  会社名: ${d.name}`);
    console.log(`  法人番号: ${d.corporateNumber}`);
    console.log(`  代表者: ${d.representativeName}`);
    console.log(`  住所: ${d.address}`);
  } else {
    console.log('  ❌ 未登録');
  }

  // 事業所
  const offices = await db.collection(`${base}/offices`).get();
  console.log(`\n=== 事業所 (${offices.size}件) ===`);
  for (const doc of offices.docs) {
    const d = doc.data();
    console.log(`  [${doc.id}] ${d.name} (${d.officeNumber}) - ${d.address}`);
  }

  // 保険料率
  const rates = await db.collection(`${base}/insuranceRates`).get();
  console.log(`\n=== 保険料率 (${rates.size}件) ===`);
  for (const doc of rates.docs) {
    const d = doc.data();
    console.log(`  [${d.insuranceType}] ${(d.rate * 100).toFixed(3)}% (${d.description})`);
  }

  // ユーザー
  const users = await db.collection(`${base}/users`).get();
  console.log(`\n=== ユーザー (${users.size}名) ===`);
  for (const doc of users.docs) {
    const d = doc.data();
    console.log(`  [${doc.id}] roles: ${(d.roles ?? []).join(', ')} | offices: ${(d.officeIds ?? []).join(', ')}`);
  }

  // 従業員
  const emps = await db.collection(`${base}/employees`).where('deletedAt', '==', null).get();
  console.log(`\n=== 従業員 (${emps.size}名) ===`);
  for (const doc of emps.docs) {
    const d = doc.data();
    console.log(`  [${d.employeeNumber}] ${d.lastName} ${d.firstName} - 事業所: ${d.officeId} - ${d.isActive ? '在籍' : '退職'}`);
  }

  console.log('\n=== 検証完了 ===');
}

verify().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
