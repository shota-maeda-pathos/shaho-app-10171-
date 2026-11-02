// 評価用のテストデータを作る（docs/test-data-plan.md）。古いテストデータを消したあとに一度だけ実行する
import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireRole } from '../../middleware/auth';
import { insuredCounterPath } from '../../offices/insured-number';
import { encryptMyNumber } from '../../utils/kms';
import { mapConcurrent } from '../../utils/parallel';
import { AllRates, findAllRates } from '../../utils/insurance-rate';
import { buildDemoEmployees, DEMO_ACCOUNTS, DEMO_COMPANY, DEMO_DEPARTMENTS, DEMO_OFFICES, DEMO_SET_ID } from './data';
import { addMonths, bonusMonthsFor, CURRENT_PAY_MONTH, demoBonus, demoBonusPremium, demoGrades, demoPremium, demoSchedule, gradeFor, HISTORY_FROM, monthsBetween, salaryIn } from './history';

const conflict = (message: string) => new HttpsError('failed-precondition', message);

/**
 * 事業所3か所・従業員300人（台帳・個人番号・雇用条件・扶養）と、2025年12月から先月までの履歴（等級・給与・保険料・明細の公開・徴収・賞与）を作り、
 * test1〜9 のアカウントを新しい従業員につなぎ直す。既存のデータは上書きしない（同じ事業所・社員番号があれば中断する）
 */
export async function seedDemoData(auth: AuthContext) {
  requireRole(auth, 'admin');
  const base = `companies/${auth.companyId}`;
  const marker = db.doc(`${base}/sampleSets/${DEMO_SET_ID}`);
  if ((await marker.get()).exists) return { created: 0, alreadyExists: true };

  const employees = buildDemoEmployees();
  const officeRefs = DEMO_OFFICES.map(o => db.doc(`${base}/offices/${o.id}`));
  const departmentRefs = DEMO_DEPARTMENTS.map(d => db.doc(`${base}/departments/${d.id}`));
  const numberRefs = employees.map(e => db.doc(`${base}/employeeNumbers/${e.employeeNumber}`));
  const employeeRefs = employees.map(e => db.doc(`${base}/employees/${e.id}`));
  const existing = await db.getAll(...officeRefs, ...departmentRefs, ...numberRefs, ...employeeRefs);
  if (existing.some(d => d.exists)) {
    throw conflict('同じ事業所・部署・社員番号・従業員がすでにあります。古いテストデータを消してから作ってください（上書きはしません）');
  }

  // test1〜9 のアカウント。Authentication は課題管理アプリと共通なので、アカウント自体は作らず変えない
  const accountNumbers = Object.keys(DEMO_ACCOUNTS).map(Number);
  const lookup = await getAuth().getUsers(accountNumbers.map(n => ({ email: `test${n}@example.com` })));
  const uidOf = new Map(lookup.users.map(u => [u.email!.toLowerCase(), u.uid]));
  const accounts = accountNumbers.map(n => {
    const uid = uidOf.get(`test${n}@example.com`);
    if (!uid) throw conflict(`test${n}@example.com のアカウントが見つかりません`);
    return { n, uid, employee: employees.find(e => e.n === n)!, ...DEMO_ACCOUNTS[n] };
  });
  const profiles = await db.getAll(...accounts.map(a => db.doc(`${base}/users/${a.uid}`)));
  for (const [i, a] of accounts.entries()) {
    if (!profiles[i].exists) throw conflict(`test${a.n} が社会保険アプリのユーザーにいません`);
    const linked = await db.collection(`${base}/employees`).where('userId', '==', a.uid).get();
    if (linked.docs.some(d => d.data().deletedAt == null)) {
      throw conflict(`test${a.n} がまだ古い従業員につながっています。古いテストデータを消してから作ってください`);
    }
  }

  // 料率（事業所×月）。履歴の保険料を先に全部計算し、料率がない月があれば何も書かずに止める
  const ts = (date: string) => Timestamp.fromDate(new Date(`${date}T00:00:00Z`));
  const rates = new Map<string, AllRates>();
  const rateMonths = monthsBetween(HISTORY_FROM, addMonths(CURRENT_PAY_MONTH, -1));
  await mapConcurrent(DEMO_OFFICES.flatMap(o => rateMonths.map(m => ({ o, m }))), 8, async ({ o, m }) => {
    rates.set(`${o.id}|${m}`, await findAllRates(auth.companyId, m, o.prefectureCode, o.insurerId, o.healthInsuranceType));
  });
  const history = employees.map(e => {
    const office = DEMO_OFFICES.find(o => o.id === e.officeId)!;
    const birth = ts(e.birthDate);
    const grades = demoGrades(e);
    const schedule = demoSchedule(e, office);
    try {
      const premiums = schedule.premiumMonths.map(m => {
        const grade = gradeFor(grades, m);
        if (!grade) throw new Error(`${e.employeeNumber} の ${m} の等級がありません`);
        return demoPremium(birth, grade, rates.get(`${office.id}|${m}`)!, 'statutory', m);
      });
      let prior = 0;
      let fiscalYear = '';
      const bonuses = bonusMonthsFor(office).flatMap(m => {
        const bonus = demoBonus(e, m);
        if (!bonus) return [];
        const fy = String(Number(m.slice(0, 4)) - (Number(m.slice(5)) < 4 ? 1 : 0));
        if (fy !== fiscalYear) { fiscalYear = fy; prior = 0; }
        const premium = demoBonusPremium(birth, e.hireDate, bonus, rates.get(`${office.id}|${m}`)!, 'statutory', m, prior);
        const entry = { yearMonth: m, bonus, premium, prior };
        prior += bonus.standard;
        return [entry];
      });
      return { grades, schedule, premiums, bonuses };
    } catch (error) {
      throw conflict(`履歴の保険料を計算できません：${(error as Error).message}（料率の画面で登録してから作ってください）`);
    }
  });

  // 暗号化はまとめて先に（KMS の呼び出しを書き込みの途中で失敗させない）
  const ciphers = await mapConcurrent(employees, 10, e => encryptMyNumber(auth.companyId, e.id, e.myNumber));

  const now = Timestamp.now();
  const shared = { isSample: true, sampleSetId: DEMO_SET_ID, createdAt: now, updatedAt: now };
  const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown>; merge?: boolean }[] = [];
  const userOf = new Map(accounts.map(a => [a.employee.id, a.uid]));

  for (const [i, o] of DEMO_OFFICES.entries()) {
    writes.push({ ref: officeRefs[i], data: {
      ...shared, name: o.name, officeNumber: o.officeNumber, officeCode: o.officeCode, prefectureCode: o.prefectureCode, insurerId: o.insurerId,
      healthInsuranceType: o.healthInsuranceType, pensionOfficeName: o.pensionOfficeName, postalCode: o.postalCode, address: o.address, phone: o.phone,
      closingDay: 0, paymentDay: 25, paymentMonth: o.paymentMonth, deductionMethod: o.deductionMethod, roundingRule: 'statutory',
      appliedDate: o.appliedDate, bonusMonths: o.bonusMonths, insuredNumberMode: 'auto', fullTimeWeeklyHours: 40, fullTimeMonthlyDays: 21,
      abolishedOn: null, isActive: true, version: 1,
    } });
    writes.push({ ref: db.doc(insuredCounterPath(auth.companyId, o.id)), data: { last: employees.filter(e => e.officeId === o.id).length, updatedAt: now } });
  }
  for (const [i, d] of DEMO_DEPARTMENTS.entries()) {
    writes.push({ ref: departmentRefs[i], data: { ...shared, name: d.name, officeId: d.officeId, parentId: null, sortOrder: (i + 1) * 10, isActive: true } });
  }
  for (const [i, e] of employees.entries()) {
    const ref = employeeRefs[i];
    const office = DEMO_OFFICES.find(o => o.id === e.officeId)!;
    writes.push({ ref: numberRefs[i], data: { ...shared, employeeId: e.id } });
    writes.push({ ref, data: {
      ...shared, employeeNumber: e.employeeNumber, lastName: e.lastName, firstName: e.firstName, lastNameKana: e.lastNameKana, firstNameKana: e.firstNameKana,
      birthDate: ts(e.birthDate), gender: e.gender, officeId: e.officeId, departmentId: e.departmentId, hireDate: ts(e.hireDate), resignationDate: null,
      userId: userOf.get(e.id) ?? null, isActive: true, version: 1, deletedAt: null,
      formerLastName: null, basicPensionNumber: e.basicPensionNumber, postalCode: e.postalCode, prefecture: e.prefecture, city: e.city,
      addressLine: e.addressLine, building: null, phone: e.phone, email: e.email, insuredPersonNumber: e.insuredPersonNumber,
      qualificationAcquiredDate: e.hireDate, qualificationLostDate: null, foreignInfo: null,
      contract: { type: e.contract.type, endDate: e.contract.endDate, renewalExpected: e.contract.type === 'fixed' },
      sampleNote: ['評価用の架空のデータ', e.note].filter(Boolean).join('：'),
    } });
    writes.push({ ref: db.doc(`${ref.path}/secrets/main`), data: {
      myNumberCipher: ciphers[i], myNumberUpdatedAt: now, version: 1, createdAt: now, updatedAt: now, updatedBy: auth.uid,
    } });
    const general = e.insuredCategory === 'general';
    writes.push({ ref: db.doc(`${ref.path}/employments/demo-initial`), data: {
      ...shared, effectiveDate: e.hireDate, employmentType: general ? 'regular' : 'partTime', workStyle: general ? 'fullTime' : e.insuredCategory === 'partTimer' ? 'partTime' : 'shortTime',
      weeklyHours: e.weeklyHours, weeklyDays: general ? 5 : 4, monthlyDays: general ? 21 : 17, wageType: 'monthly', wageAmount: null, baseSalary: e.baseSalary,
      contractType: e.contract.type, contractStartDate: e.contract.type === 'fixed' ? '2026-04-01' : null, contractEndDate: e.contract.endDate, renewalExpected: e.contract.type === 'fixed',
      healthInsuranceEnrolled: true, pensionEnrolled: true, socialInsuranceEnrolled: true, insuredCategory: e.insuredCategory,
      applicabilityReason: e.insuredCategory === 'shortTime' ? 'specificShortTime' : 'standard', isStudent: false,
      longTermCareEnrolled: e.longTermCare, note: '評価用', version: 1,
    } });
    const h = history[i];
    for (const g of h.grades) {
      writes.push({ ref: db.doc(`${ref.path}/grades/${g.effectiveMonth}`), data: {
        ...shared, ...g, reason: `${g.reason}（評価用）`, filingId: null, isConfirmed: true, confirmedAt: now, confirmedBy: auth.uid, version: 1,
      } });
    }
    // 給与：先月までは承認・公開済み（控除した保険料の月つき）、今月は取り込んだだけ
    for (const p of h.schedule.payMonths) {
      const s = salaryIn(e, p.payMonth);
      writes.push({ ref: db.doc(`${ref.path}/salaries/${p.payMonth}`), data: {
        ...shared, yearMonth: p.payMonth, officeId: office.id, paymentBasisDays: s.days,
        baseSalary: s.base, fixedAllowances: {}, variableAllowances: s.overtime ? { '残業手当': s.overtime } : {},
        totalFixedWage: s.base, totalVariableWage: s.overtime, totalSalary: s.total, inKindAmount: 0, retroactivePay: null,
        noPay: false, noPayReason: null, source: 'sample', approvalPending: false, version: p.done ? 2 : 1,
        ...(p.done
          ? { isConfirmed: true, confirmedAt: now, confirmedBy: auth.uid, isPublished: true, publishedAt: now, publishedBy: auth.uid, deductedPremiumMonth: p.deductedPremiumMonth }
          : { isConfirmed: false, confirmedAt: null, confirmedBy: null, isPublished: false }),
      } });
    }
    const premiumOf = new Map(h.premiums.map(p => [p.yearMonth, p]));
    for (const p of h.premiums) {
      writes.push({ ref: db.doc(`${ref.path}/monthlyInsurance/${p.yearMonth}`), data: {
        ...p, officeId: office.id, isConfirmed: true, approvalPending: false, confirmedAt: now, confirmedBy: auth.uid, version: 2, createdAt: now, updatedAt: now,
      } });
    }
    // 徴収：公開した給与から控除した
    for (const p of h.schedule.payMonths) {
      const premium = p.done && p.deductedPremiumMonth ? premiumOf.get(p.deductedPremiumMonth) : null;
      if (!premium) continue;
      const note = `${p.payMonth}支給の給与から控除`;
      writes.push({ ref: db.doc(`${ref.path}/collectionReceipts/${premium.yearMonth}`), data: {
        yearMonth: premium.yearMonth, officeId: office.id, dueAmount: premium.totalEmployeeAmount, collectedAmount: premium.totalEmployeeAmount,
        entries: [{ method: 'payroll', amount: premium.totalEmployeeAmount, date: '', note, recordedBy: auth.uid }],
        note, updatedBy: auth.uid, updatedAt: now, version: 1,
      } });
    }
    for (const b of h.bonuses) {
      writes.push({ ref: db.doc(`${ref.path}/bonuses/${b.yearMonth}`), data: {
        ...shared, yearMonth: b.yearMonth, officeId: office.id, payments: b.bonus.payments, paymentDate: b.bonus.firstPaymentDate,
        cashAmount: b.bonus.cash, inKindAmount: 0, totalAmount: b.bonus.total, standardBonusAmount: b.bonus.standard, cumulativeBonusAmount: b.prior, source: 'sample',
        isConfirmed: true, approvalPending: false, confirmedAt: now, confirmedBy: auth.uid, version: 1,
      } });
      writes.push({ ref: db.doc(`${ref.path}/bonusInsurance/${b.yearMonth}`), data: {
        ...b.premium, bonusVersion: 1, officeId: office.id, isConfirmed: true, approvalPending: false, confirmedAt: now, confirmedBy: auth.uid, version: 2, createdAt: now, updatedAt: now,
      } });
    }
    for (const d of e.dependents) {
      writes.push({ ref: db.doc(`${ref.path}/dependents/demo-${d.key}`), data: {
        ...shared, lastName: d.lastName, firstName: d.firstName, lastNameKana: d.lastNameKana, firstNameKana: d.firstNameKana,
        birthDate: ts(d.birthDate), gender: d.gender, relationship: d.relationship, isDisabled: false, income: d.income, coResident: true,
        qualificationDate: ts(d.relationship === 'child' && d.birthDate > e.hireDate ? d.birthDate : e.hireDate), disqualificationDate: null,
        disqualificationReason: null, occupation: null, certification: 'certified', deletedAt: null,
      } });
    }
  }
  // 会社の番号（法人番号の検査用数字を合わせる）
  const company = await db.doc(base).get();
  writes.push({ ref: db.doc(base), data: { ...DEMO_COMPANY, version: (company.data()?.version ?? 1) + 1, updatedAt: now, updatedBy: auth.uid }, merge: true });
  // アカウントのつなぎ直し（ロールと担当の事業所は docs/test-data-plan.md の表）
  for (const a of accounts) {
    writes.push({ ref: db.doc(`${base}/users/${a.uid}`), data: { employeeId: a.employee.id, roles: a.roles, officeIds: a.officeIds, updatedAt: now }, merge: true });
  }
  writes.push({ ref: marker, data: { ...shared, employeeCount: employees.length, officeIds: DEMO_OFFICES.map(o => o.id), createdBy: auth.uid } });
  writes.push({ ref: db.collection(`${base}/auditLogs`).doc(), data: {
    entity: 'sampleSet', entityId: DEMO_SET_ID, action: 'create',
    changes: { employeeCount: employees.length, accounts: accounts.map(a => ({ email: `test${a.n}@example.com`, employeeId: a.employee.id, roles: a.roles })) },
    performedBy: auth.uid, performedAt: now, version: 1,
  } });

  // 1回の書き込みは500件まで。目印（marker）は最後の組に入るので、途中で失敗しても目印がなければ消して作り直せる
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 450)) {
      if (w.merge) batch.set(w.ref, w.data, { merge: true });
      else batch.set(w.ref, w.data);
    }
    await batch.commit();
  }
  return { created: employees.length, alreadyExists: false, offices: DEMO_OFFICES.map(o => o.id), writes: writes.length };
}
