import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { decryptMyNumber } from '../../utils/kms';
import { mapConcurrent } from '../../utils/parallel';
import { assertAssignable } from '../../offices/lifecycle';
import { getAllChunked } from '../../monthly/service';
import { createEmployee } from '../employee-create/service';
import { EmployeeCreateInput } from '../employee-create/schema';
import { updateEmployee } from '../employee-update/service';
import { EmployeeUpdateInput } from '../employee-update/schema';
import { getSecrets, updateSecrets } from '../employee-secrets/service';
import { CsvContext, CsvError, CsvExisting, CsvPlan, CsvRowPlan, csvHasMyNumber, planEmployeeCsv } from './rules';
import { EmployeeCsvImportInput } from './schema';

const dateOf = (v: unknown): string | null => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toISOString().slice(0, 10) : typeof v === 'string' && v ? v.slice(0, 10) : null;
};
const text = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** 台帳・事業所・部署を読み、取込の判定に使う形にする。個人番号は CSV に入っているときだけ復号して重複を確かめる */
async function loadContext(input: EmployeeCsvImportInput, auth: AuthContext): Promise<CsvContext> {
  const base = `companies/${auth.companyId}`;
  const [offices, departments, employees] = await Promise.all([
    db.collection(`${base}/offices`).get(),
    db.collection(`${base}/departments`).get(),
    db.collection(`${base}/employees`).where('deletedAt', '==', null).get(),
  ]);
  const existing: CsvExisting[] = employees.docs.map(d => {
    const e = d.data() as EmployeeDoc & Record<string, unknown>;
    return {
      id: d.id,
      employeeNumber: String(e.employeeNumber ?? ''),
      officeId: e.officeId,
      departmentId: (e.departmentId as string | null | undefined) ?? null,
      version: e.version ?? 1,
      isActive: e.isActive !== false && !e.resignationDate,
      hasMyNumber: false,
      values: {
        lastName: text(e.lastName), firstName: text(e.firstName), lastNameKana: text(e.lastNameKana), firstNameKana: text(e.firstNameKana),
        birthDate: dateOf(e.birthDate), gender: text(e.gender), hireDate: dateOf(e.hireDate), formerLastName: text(e.formerLastName),
        postalCode: text(e.postalCode), prefecture: text(e.prefecture), city: text(e.city), addressLine: text(e.addressLine), building: text(e.building),
        phone: text(e.phone), email: text(e.email), insuredPersonNumber: text(e.insuredPersonNumber), basicPensionNumber: text(e.basicPensionNumber),
      },
    };
  });

  // 個人番号の登録の有無（変更の一覧で「未登録／登録済み」を出す）と、CSV に番号があるときは重複の確認に使う番号
  const secrets = await getAllChunked(existing.map(e => db.doc(`${base}/employees/${e.id}/secrets/main`)));
  secrets.forEach((s, i) => { existing[i].hasMyNumber = !!s.data()?.myNumberCipher; });
  let myNumbers: Map<string, string> | undefined;
  if (csvHasMyNumber(input.csv)) {
    myNumbers = new Map();
    const withCipher = existing.map((e, i) => ({ e, cipher: secrets[i].data()?.myNumberCipher as string | undefined })).filter(x => x.cipher);
    const plain = await mapConcurrent(withCipher, 20, x => decryptMyNumber(auth.companyId, x.e.id, x.cipher!));
    withCipher.forEach((x, i) => myNumbers!.set(x.e.id, plain[i]));
  }

  return {
    offices: offices.docs.map(d => ({ id: d.id, name: String(d.data().name ?? ''), officeNumber: d.data().officeNumber ?? null, abolished: !!d.data().abolishedOn })),
    departments: departments.docs.map(d => ({ id: d.id, officeId: d.data().officeId, name: d.data().name, isActive: d.data().isActive !== false })),
    existing,
    myNumbers,
    allowedOfficeIds: auth.roles.includes('admin') ? null : auth.officeIds,
  };
}

/** 新規の行の事業所が、配属できる状態か（設定が終わっていない・廃止した事業所には登録できない） */
async function checkAssignable(plan: CsvPlan, companyId: string): Promise<void> {
  const officeIds = [...new Set(plan.creates.map(r => r.officeId))];
  const problems = new Map<string, string>();
  for (const id of officeIds) {
    try { await assertAssignable(companyId, id); } catch (e) { problems.set(id, (e as Error).message); }
  }
  if (!problems.size) return;
  plan.creates = plan.creates.filter(r => {
    const m = problems.get(r.officeId);
    if (m) plan.errors.push({ line: r.line, employeeNumber: r.employeeNumber, message: m });
    return !m;
  });
}

const publicRow = (r: CsvRowPlan, officeName: (id: string) => string) => ({
  line: r.line, employeeNumber: r.employeeNumber, name: r.name, officeName: officeName(r.officeId), changes: r.changes,
});

export interface EmployeeCsvImportResult {
  dryRun: boolean;
  creates: ReturnType<typeof publicRow>[];
  updates: ReturnType<typeof publicRow>[];
  unchanged: { line: number; employeeNumber: string; name: string }[];
  errors: CsvError[];
  created: number;
  updated: number;
}

/**
 * 従業員CSVの確認（dryRun）と取込（カタログ2章 CSV一括取込）。
 * 確認では、新規・更新（変わる項目）・変わらない行・誤りの行を返す。取込は確認と同じ判定をし直し、正常な行だけを書く。
 * 個人番号は暗号化して保存するだけで、画面には返さない。CSV そのものは保存しない（処理が終われば残らない）。
 */
export async function importEmployeeCsv(input: EmployeeCsvImportInput, auth: AuthContext): Promise<EmployeeCsvImportResult> {
  const ctx = await loadContext(input, auth);
  const plan = planEmployeeCsv(input.csv, ctx);
  await checkAssignable(plan, auth.companyId);
  const officeName = (id: string) => ctx.offices.find(o => o.id === id)?.name ?? id;
  const result: EmployeeCsvImportResult = {
    dryRun: input.dryRun,
    creates: plan.creates.map(r => publicRow(r, officeName)),
    updates: plan.updates.map(r => publicRow(r, officeName)),
    unchanged: plan.unchanged,
    errors: [...plan.errors].sort((a, b) => a.line - b.line),
    created: 0,
    updated: 0,
  };
  if (input.dryRun) return result;

  const failed: CsvError[] = [];
  const fail = (r: CsvRowPlan, e: unknown) => failed.push({ line: r.line, employeeNumber: r.employeeNumber, message: `取り込めませんでした：${(e as Error)?.message ?? e}` });
  const saveMyNumber = async (employeeId: string, myNumber: string) => {
    const { version } = await getSecrets({ companyId: auth.companyId, employeeId }, auth);
    await updateSecrets({ companyId: auth.companyId, employeeId, myNumber, expectedVersion: version }, auth);
  };

  // 新規は1件ずつ（整理番号の自動採番が同じ事業所の番号を数えるため）
  for (const r of plan.creates) {
    try {
      const { id } = await createEmployee({
        companyId: auth.companyId, employeeNumber: r.employeeNumber, officeId: r.officeId, departmentId: r.departmentId ?? null,
        ...r.fields,
      } as unknown as EmployeeCreateInput, auth);
      result.created++;
      if (r.myNumber && id) {
        try { await saveMyNumber(id, r.myNumber); } catch (e) { fail(r, new Error(`台帳には登録しましたが、個人番号を保存できませんでした（${(e as Error).message}）。従業員の画面で入れてください`)); }
      }
    } catch (e) { fail(r, e); }
  }
  await mapConcurrent(plan.updates, 8, async r => {
    try {
      const fields = { ...r.fields, ...(r.departmentId !== undefined ? { departmentId: r.departmentId } : {}) };
      if (Object.keys(fields).length) {
        await updateEmployee({ companyId: auth.companyId, employeeId: r.employeeId!, expectedVersion: r.expectedVersion!, ...fields } as unknown as EmployeeUpdateInput, auth);
      }
      if (r.myNumber) await saveMyNumber(r.employeeId!, r.myNumber);
      result.updated++;
    } catch (e) { fail(r, e); }
  });
  result.errors = [...result.errors, ...failed].sort((a, b) => a.line - b.line);

  // 取込の事実だけを残す（値は各従業員の登録・更新の記録に。個人番号は値を残さない）
  await db.collection(`companies/${auth.companyId}/auditLogs`).add({
    entity: 'employeeCsvImport',
    entityId: 'employees',
    action: 'import',
    changes: { created: result.created, updated: result.updated, unchanged: result.unchanged.length, errors: result.errors.length },
    performedBy: auth.uid,
    performedAt: Timestamp.now(),
    version: 1,
  });
  return result;
}
