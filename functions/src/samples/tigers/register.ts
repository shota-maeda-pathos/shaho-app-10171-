import { randomBytes } from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireRole, Role } from '../../middleware/auth';
import { samplePlayers } from './data';
import { seedTigersSamples } from './service';

export const tigersRoles: Record<number, Role> = {
  1: 'admin', 2: 'operator', 3: 'operator', 4: 'employee', 5: 'viewer',
  6: 'approver', 7: 'employee', 8: 'employee', 9: 'employee',
};
const adminUid = 'MJNjXeCfoYaohOgT5G4EZQf8URE3';
const base = 'companies/company-001';
const conflict = () => new HttpsError('failed-precondition', '既存の従業員・アカウントの紐付けと競合するため中断しました');

/** Explicit, one-time company registration. Never modifies shared Auth credentials. */
export async function registerTigers(auth: AuthContext) {
  requireRole(auth, 'admin');
  if (auth.companyId !== 'company-001' || auth.uid !== adminUid) {
    throw new HttpsError('permission-denied', '指定の会社管理者専用の登録です');
  }
  const marker = db.doc(`${base}/registrations/tigers-v1`);
  const previous = await marker.get();
  if (previous.exists) return { alreadyRegistered: true, users: previous.data()!.users, credentials: [] };
  await seedTigersSamples(auth);
  const firebaseAuth = getAuth();
  const lookup = await firebaseAuth.getUsers(samplePlayers.map(p => ({ email: `test${p.n}@example.com` })));
  const accounts = new Map(lookup.users.map(u => [u.email!.toLowerCase(), u]));
  if (accounts.get('test1@example.com')?.uid !== adminUid) throw conflict();
  // Validate existing links before creating any missing Auth accounts.
  for (const p of samplePlayers) {
    const employeeId = `sample-tigers-${String(p.n).padStart(2, '0')}`;
    const employee = await db.doc(`${base}/employees/${employeeId}`).get();
    const user = accounts.get(`test${p.n}@example.com`);
    const profile = user ? await db.doc(`${base}/users/${user.uid}`).get() : null;
    if (!employee.exists || employee.data()!.sampleSetId !== 'tigers-v1' || employee.data()!.deletedAt !== null ||
        (employee.data()!.userId && employee.data()!.userId !== user?.uid) ||
        (profile?.data()?.employeeId && profile.data()!.employeeId !== employeeId)) throw conflict();
  }
  const credentials: { email: string; password: string }[] = [];
  for (const p of samplePlayers) {
    const email = `test${p.n}@example.com`;
    if (accounts.has(email)) continue;
    const password = randomBytes(24).toString('base64url');
    try {
      const user = await firebaseAuth.createUser({ email, displayName: `${p.last} ${p.first}`, password });
      accounts.set(email, user);
      credentials.push({ email, password });
    } catch (error: any) {
      if (error.code !== 'auth/email-already-exists') throw error;
      accounts.set(email, await firebaseAuth.getUserByEmail(email));
    }
  }
  const users = samplePlayers.map(p => ({
    uid: accounts.get(`test${p.n}@example.com`)!.uid,
    email: `test${p.n}@example.com`, displayName: `${p.last} ${p.first}`,
    employeeId: `sample-tigers-${String(p.n).padStart(2, '0')}`,
    roles: [tigersRoles[p.n]], officeIds: ['sample-tigers-office'],
  }));
  const result = await db.runTransaction(async tx => {
    const done = await tx.get(marker);
    if (done.exists) return { alreadyRegistered: true, users: done.data()!.users };
    const userRefs = users.map(u => db.doc(`${base}/users/${u.uid}`));
    const employeeRefs = users.map(u => db.doc(`${base}/employees/${u.employeeId}`));
    const profiles = await tx.getAll(...userRefs);
    const employees = await tx.getAll(...employeeRefs);
    for (let i = 0; i < users.length; i++) {
      const u = users[i], employee = employees[i].data(), profile = profiles[i].data();
      if (!employee || employee.deletedAt !== null || employee.sampleSetId !== 'tigers-v1' ||
          (employee.userId && employee.userId !== u.uid) || (profile?.employeeId && profile.employeeId !== u.employeeId)) throw conflict();
      const otherEmployees = await tx.get(db.collection(`${base}/employees`).where('userId', '==', u.uid));
      const otherProfiles = await tx.get(db.collection(`${base}/users`).where('employeeId', '==', u.employeeId));
      if (otherEmployees.docs.some(d => d.id !== u.employeeId) || otherProfiles.docs.some(d => d.id !== u.uid)) throw conflict();
    }
    const officeRef = db.doc(`${base}/offices/sample-tigers-office`);
    const departmentRef = db.doc(`${base}/departments/sample-tigers-team`);
    const companyRef = db.doc(base);
    const [office, department, company] = await tx.getAll(officeRef, departmentRef, companyRef);
    const now = Timestamp.now();
    users.forEach((u, i) => {
      tx.set(userRefs[i], { ...u, isSample: false, isSuspended: profiles[i].data()?.isSuspended ?? false,
        isLoginDisabled: profiles[i].data()?.isLoginDisabled ?? false,
        createdAt: profiles[i].data()?.createdAt ?? now, updatedAt: now }, { merge: true });
      tx.update(employeeRefs[i], { userId: u.uid, isSample: false, updatedAt: now, version: (employees[i].data()!.version ?? 1) + 1 });
    });
    if (office.data()?.sampleSetId === 'tigers-v1') tx.update(officeRef, { name: '甲子園事業所', isSample: false, updatedAt: now });
    if (department.data()?.sampleSetId === 'tigers-v1') tx.update(departmentRef, { name: '営業部', isSample: false, updatedAt: now });
    if (company.data()?.name === 'サンプル株式会社タイガース' && company.data()?.isSample === true) {
      tx.update(companyRef, { name: '株式会社タイガース（検証用）', isSample: false, updatedAt: now });
    }
    tx.create(marker, { users, registeredBy: auth.uid, registeredAt: now });
    tx.create(db.collection(`${base}/auditLogs`).doc(), { entity: 'registration', entityId: 'tigers-v1',
      action: 'register', changes: { users }, performedBy: auth.uid, performedAt: now, version: 1 });
    return { alreadyRegistered: false, users };
  });
  // Passwords of newly created accounts are returned once, never stored in Firestore or logs.
  return { ...result, credentials: result.alreadyRegistered ? [] : credentials };
}
