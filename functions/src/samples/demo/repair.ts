// 評価用のテストデータ（demo-v1）の直し（2026-11-02 の本番の一周で見つけたもの）。既定は dry（数えるだけ）
// 1. 2026年の定時決定：等級だけがあり定時決定の承認の記録がないため、算定基礎届の画面で全員が「依頼前」になり届出を作れない。
//    9月の等級が計算どおりの人に、承認済みの承認依頼を足し、等級に approvalRequestId を付ける（画面で承認したときと同じ形）
// 2. 雇用条件：2026年4月の昇給が入っていない。入社時の基本給を昇給前に直し、4月1日の昇給を足す
// 3. 同姓同名：大阪支社・新宿事業所の人の名を、作り方（data.ts）の今の名前に合わせる
// 4. 料率の備考：料率マスタの修正で足した協会けんぽの料率の備考を、ほかの都道府県と同じ「協会けんぽ 〇〇」にそろえる
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireRole } from '../../middleware/auth';
import { santeiApprovalMetadata } from '../../santei/santei-calc';
import { santeiGradePath, santeiOverview } from '../../santei/service';
import { KYOKAI_HEALTH_RATES } from '../../insurance-rates/kyokai-rates';
import { buildDemoEmployees, DEMO_OFFICES, DEMO_SET_ID } from './data';
import { demoEmployments } from './history';

const RATE_REPAIR_NOTE = '協会けんぽの公表料率（料率マスタの修正で追加）';
const SANTEI_YEAR = 2026;

export interface DemoRepairResult {
  dryRun: boolean;
  santei: { approvals: number; mismatched: string[]; skipped: number };
  employments: { updated: number; added: number };
  names: { renamed: { id: string; from: string; to: string }[] };
  rateNotes: number;
}

export async function repairDemoData(auth: AuthContext, dryRun: boolean): Promise<DemoRepairResult> {
  requireRole(auth, 'admin');
  const base = `companies/${auth.companyId}`;
  const now = Timestamp.now();
  const people = buildDemoEmployees();
  const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown>; merge?: boolean }[] = [];
  const result: DemoRepairResult = { dryRun, santei: { approvals: 0, mismatched: [], skipped: 0 }, employments: { updated: 0, added: 0 }, names: { renamed: [] }, rateNotes: 0 };

  // 依頼した人は事業所の担当者、承認した人は承認者（いなければ自分）
  const users = await db.collection(`${base}/users`).get();
  const uidOf = (email: string) => users.docs.find(u => u.data().email === email)?.id ?? auth.uid;
  const requester: Record<string, string> = { 'office-hq': uidOf('test2@example.com'), 'office-osaka': uidOf('test3@example.com'), 'office-union': uidOf('test3@example.com') };
  const approver = uidOf('test6@example.com');

  // 3. 名前（承認の索引に名前が写る前に直す）
  const employeeSnaps = await db.getAll(...people.map(p => db.doc(`${base}/employees/${p.id}`)));
  people.forEach((p, i) => {
    const d = employeeSnaps[i].data();
    if (!d || d.sampleSetId !== DEMO_SET_ID) return;
    if (d.firstName === p.firstName && d.firstNameKana === p.firstNameKana) return;
    result.names.renamed.push({ id: p.id, from: `${d.lastName} ${d.firstName}`, to: `${p.lastName} ${p.firstName}` });
    writes.push({ ref: employeeSnaps[i].ref, data: { firstName: p.firstName, firstNameKana: p.firstNameKana, updatedAt: now }, merge: true });
  });

  // 2. 雇用条件
  for (const p of people) {
    const list = demoEmployments(p);
    if (list.length < 2) continue;
    const empPath = `${base}/employees/${p.id}/employments`;
    const [initial, raise] = await db.getAll(db.doc(`${empPath}/demo-initial`), db.doc(`${empPath}/${list[1].id}`));
    if (!initial.exists || initial.data()!.sampleSetId !== DEMO_SET_ID) continue;
    if (initial.data()!.baseSalary !== list[0].baseSalary) {
      result.employments.updated++;
      writes.push({ ref: initial.ref, data: { baseSalary: list[0].baseSalary, updatedAt: now }, merge: true });
    }
    if (!raise.exists) {
      result.employments.added++;
      const { createdAt: _c, updatedAt: _u, ...rest } = initial.data()!;
      writes.push({ ref: raise.ref, data: { ...rest, effectiveDate: list[1].effectiveDate, baseSalary: list[1].baseSalary, note: '評価用（2026年4月の昇給）', version: 1, createdAt: now, updatedAt: now } });
    }
  }

  // 1. 2026年の定時決定の承認の記録（名前・雇用条件を直す前の内容で計算しても、等級・給与は変わらない）
  for (const office of DEMO_OFFICES) {
    const overview = await santeiOverview({ companyId: auth.companyId, officeId: office.id, year: SANTEI_YEAR } as never, auth);
    for (const row of overview.rows) {
      if (row.approval.status !== 'none' || !row.septemberTaken) { result.santei.skipped++; continue; }
      const gradeRef = db.doc(santeiGradePath(auth.companyId, row.employeeId, SANTEI_YEAR));
      const grade = (await gradeRef.get()).data();
      if (row.status !== 'ok' || !row.proposed || !grade || grade.sampleSetId !== DEMO_SET_ID
        || grade.healthGradeNumber !== row.proposed.healthGradeNumber || grade.pensionGradeNumber !== row.proposed.pensionGradeNumber) {
        result.santei.mismatched.push(`${row.employeeNumber} ${row.employeeName}`);
        continue;
      }
      const metadata = santeiApprovalMetadata(SANTEI_YEAR, row);
      const reqRef = db.collection(`${base}/employees/${row.employeeId}/approvalRequests`).doc(`demo-santei-${SANTEI_YEAR}`);
      const at = Timestamp.fromDate(new Date('2026-07-08T10:00:00+09:00'));
      const approvedAt = Timestamp.fromDate(new Date('2026-07-09T10:00:00+09:00'));
      result.santei.approvals++;
      writes.push({ ref: reqRef, data: {
        targetPath: gradeRef.path, targetVersion: 0, snapshotData: {}, requestType: 'grade', status: 'approved',
        requestedBy: requester[office.id] ?? auth.uid, requestedAt: at, reviewedBy: approver, reviewedAt: approvedAt,
        comment: null, metadata, isSample: true, sampleSetId: DEMO_SET_ID, createdAt: at, updatedAt: approvedAt,
      } });
      writes.push({ ref: gradeRef, data: { approvalRequestId: reqRef.id, basisRemuneration: metadata.basisRemuneration, basisMonths: metadata.basisMonths, updatedAt: now }, merge: true });
    }
  }

  // 4. 料率の備考
  const names = new Map(KYOKAI_HEALTH_RATES.map(([code, name]) => [code, name]));
  const rates = await db.collection(`${base}/insuranceRates`).where('note', '==', RATE_REPAIR_NOTE).get();
  for (const r of rates.docs) {
    const name = names.get(r.data().prefectureCode);
    if (r.data().insuranceType !== 'health' || !name) continue;
    result.rateNotes++;
    writes.push({ ref: r.ref, data: { note: `協会けんぽ ${name}`, updatedAt: now }, merge: true });
  }

  if (!dryRun) {
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      for (const w of writes.slice(i, i + 400)) w.merge ? batch.set(w.ref, w.data, { merge: true }) : batch.set(w.ref, w.data);
      await batch.commit();
    }
    await db.collection(`${base}/auditLogs`).add({
      entity: 'sample', entityId: DEMO_SET_ID, action: 'update', performedBy: auth.uid, performedAt: now, version: 1,
      changes: { repair: '2026-11-02 の一周の直し', santeiApprovals: result.santei.approvals, employmentsUpdated: result.employments.updated, employmentsAdded: result.employments.added, renamed: result.names.renamed.length, rateNotes: result.rateNotes },
    });
  }
  return result;
}
