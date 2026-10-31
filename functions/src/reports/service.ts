import { z } from 'zod';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { auditAccess } from '../utils/audit';
import { toDateString } from '../utils/employment';
import { invalidArg, notFound } from '../utils/errors';
import { mapConcurrent } from '../utils/parallel';
import { fiscalMonths, fiscalYearOf } from '../dashboard/cost-analysis/rules';

/**
 * 届出以外の帳票5種（カタログ9章）の中身。画面が同じ表を PDF（A4・出力日時・ページ番号）か CSV にする。
 * 出力したことは監査ログに残す
 */
export const ReportSchema = z.object({
  companyId: z.string().min(1),
  kind: z.enum(['employeePremium', 'officeMonthly', 'gradeList', 'filingStatus', 'dependents']),
  format: z.enum(['pdf', 'csv']),
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  officeId: z.string().regex(/^[^/]+$/).optional(),
  employeeId: z.string().regex(/^[^/]+$/).optional(),
});
export type ReportInput = z.infer<typeof ReportSchema>;

export interface ReportTable {
  title: string;
  subtitle: string;
  columns: { label: string; align?: 'right'; width: number }[];
  rows: string[][];
  totals: string[] | null;
  landscape: boolean;
}

const yen = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('ja-JP') : '');
const amt = (b: any, k: 'employeeAmount' | 'employerAmount') => (typeof b?.[k] === 'number' ? b[k] : 0);
const RELATIONSHIP: Record<string, string> = { spouse: '配偶者', child: '子', parent: '父母', grandparent: '祖父母', sibling: '兄弟姉妹', grandchild: '孫', other: 'その他' };
const FILING: Record<string, string> = {
  acquisitionNotification: '資格取得届', lossNotification: '資格喪失届', pensionLoss70: '資格喪失届（70歳）', remunerationMonthlyAlgorithm: '算定基礎届',
  remunerationMonthlyChange: '月額変更届', bonusPayment: '賞与支払届', bonusNonPayment: '賞与不支給報告書', dependentChange: '被扶養者（異動）届',
  maternityLeaveStart: '産前産後休業取得者申出書', maternityLeaveChange: '産前産後休業取得者変更（終了）届', childcareLeaveStart: '育児休業等取得者申出書',
  childcareLeaveEnd: '育児休業等取得者終了届', correction: '訂正届', cancellation: '取消届', maternityLeaveEndChange: '産休終了時月額変更届', childcareLeaveEndChange: '育休終了時月額変更届',
};
const STATUS: Record<string, string> = {
  draft: '下書き', rejected: '差戻し', pending: '承認待ち', approved: '承認済み', sent: '送信済み', received: '到達', processing: '審査中',
  completed: '完了', mockFailed: '送信エラー', returned: '返戻', cancelled: '取消',
};

async function employeesInScope(auth: AuthContext, officeId?: string) {
  if (officeId) requireOffice(auth, officeId);
  const [emps, offices] = await Promise.all([
    db.collection(`companies/${auth.companyId}/employees`).where('deletedAt', '==', null).get(),
    db.collection(`companies/${auth.companyId}/offices`).get(),
  ]);
  const officeName = new Map(offices.docs.map(o => [o.id, o.data().name as string]));
  const list = emps.docs.filter(e => (!officeId || e.data().officeId === officeId) && (auth.roles.includes('admin') || auth.officeIds.includes(e.data().officeId)))
    .sort((a, b) => String(a.data().employeeNumber).localeCompare(String(b.data().employeeNumber)));
  return { list, officeName };
}

export async function buildReport(auth: AuthContext, input: ReportInput): Promise<ReportTable> {
  const scopeLabel = async () => input.officeId ? ((await db.doc(`companies/${auth.companyId}/offices/${input.officeId}`).get()).data()?.name ?? '') : '全事業所';
  let table: ReportTable;
  switch (input.kind) {
    case 'employeePremium': {
      if (!input.employeeId || !input.yearMonth) throw invalidArg('従業員と年度（月）を選んでください');
      const emp = await db.doc(`companies/${auth.companyId}/employees/${input.employeeId}`).get();
      if (!emp.exists) throw notFound('従業員');
      requireOffice(auth, emp.data()!.officeId);
      const fy = fiscalYearOf(input.yearMonth);
      const months = fiscalMonths(fy);
      const snap = await emp.ref.collection('monthlyInsurance').where('yearMonth', '>=', months[0]).get();
      const docs = snap.docs.map(d => d.data()).filter(d => d.isConfirmed === true && d.yearMonth <= months[11]).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
      const rows = docs.map(d => {
        const support = amt(d.childSupportPayment, 'employeeAmount');
        return [d.yearMonth, yen(d.healthStandardRemuneration), `${d.healthGradeNumber}／${d.pensionGradeNumber}`, yen(amt(d.healthInsurance, 'employeeAmount')), yen(amt(d.longTermCareInsurance, 'employeeAmount')), yen(support), yen(amt(d.pensionInsurance, 'employeeAmount')), yen(d.totalEmployeeAmount), yen(d.totalEmployerAmount), d.isExempted ? '免除' : ''];
      });
      const sum = (k: string) => docs.reduce((a, d) => a + (typeof d[k] === 'number' ? d[k] : 0), 0);
      const e = emp.data()!;
      table = {
        title: '従業員別保険料明細書', subtitle: `${e.lastName} ${e.firstName}（${e.employeeNumber}）・${fy}年度（${months[0]}〜${months[11]}）`, landscape: false,
        columns: [{ label: '月', width: 50 }, { label: '標準報酬月額', align: 'right', width: 62 }, { label: '等級 健保／厚年', width: 54 }, { label: '健康保険', align: 'right', width: 48 }, { label: '介護保険', align: 'right', width: 44 }, { label: '支援金', align: 'right', width: 40 }, { label: '厚生年金', align: 'right', width: 48 }, { label: '本人計', align: 'right', width: 50 }, { label: '会社計', align: 'right', width: 50 }, { label: '', width: 28 }],
        rows, totals: ['年度合計', '', '', '', '', '', '', yen(sum('totalEmployeeAmount')), yen(sum('totalEmployerAmount')), ''],
      };
      break;
    }
    case 'officeMonthly': {
      if (!input.yearMonth) throw invalidArg('月を選んでください');
      const { list, officeName } = await employeesInScope(auth, input.officeId);
      const docs = (await mapConcurrent(list, 10, async e => ({ e, d: (await e.ref.collection('monthlyInsurance').doc(input.yearMonth!).get()).data() }))).filter(x => x.d?.isConfirmed === true);
      const cols = ['healthInsurance', 'longTermCareInsurance', 'pensionInsurance'] as const;
      const t = { emp: 0, er: 0, h: [0, 0], c: [0, 0], p: [0, 0], s: [0, 0] };
      const rows = docs.map(({ e, d }) => {
        const x = e.data();
        const [h, c, p] = cols.map(k => [amt(d![k], 'employeeAmount'), amt(d![k], 'employerAmount')]);
        const s = [amt(d!.childSupportPayment, 'employeeAmount'), amt(d!.childSupportPayment, 'employerAmount') + amt(d!.childSupportContribution, 'employerAmount')];
        [['h', h], ['c', c], ['p', p], ['s', s]].forEach(([k, v]) => { (t as any)[k as string][0] += (v as number[])[0]; (t as any)[k as string][1] += (v as number[])[1]; });
        t.emp += d!.totalEmployeeAmount ?? 0; t.er += d!.totalEmployerAmount ?? 0;
        return [x.employeeNumber, `${x.lastName} ${x.firstName}`, officeName.get(x.officeId) ?? '', yen(d!.healthStandardRemuneration), `${d!.healthGradeNumber}／${d!.pensionGradeNumber}`,
          `${yen(h[0])}／${yen(h[1])}`, `${yen(c[0])}／${yen(c[1])}`, `${yen(s[0])}／${yen(s[1])}`, `${yen(p[0])}／${yen(p[1])}`, yen(d!.totalEmployeeAmount), yen(d!.totalEmployerAmount)];
      });
      table = {
        title: '事業所別月次保険料一覧表', subtitle: `${await scopeLabel()}・${input.yearMonth}分（確定済み ${rows.length}名。金額は 本人／会社）`, landscape: true,
        columns: [{ label: '社員番号', width: 56 }, { label: '氏名', width: 70 }, { label: '事業所', width: 80 }, { label: '標準報酬月額', align: 'right', width: 60 }, { label: '等級', width: 40 },
          { label: '健康保険', align: 'right', width: 80 }, { label: '介護保険', align: 'right', width: 70 }, { label: '支援金・拠出金', align: 'right', width: 70 }, { label: '厚生年金', align: 'right', width: 80 }, { label: '本人計', align: 'right', width: 55 }, { label: '会社計', align: 'right', width: 55 }],
        rows, totals: ['合計', '', '', '', '', `${yen(t.h[0])}／${yen(t.h[1])}`, `${yen(t.c[0])}／${yen(t.c[1])}`, `${yen(t.s[0])}／${yen(t.s[1])}`, `${yen(t.p[0])}／${yen(t.p[1])}`, yen(t.emp), yen(t.er)],
      };
      break;
    }
    case 'gradeList': {
      const ym = input.yearMonth ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
      const { list, officeName } = await employeesInScope(auth, input.officeId);
      const active = list.filter(e => e.data().isActive === true);
      const rows = (await mapConcurrent(active, 10, async e => {
        const g = (await e.ref.collection('grades').where('effectiveMonth', '<=', ym).orderBy('effectiveMonth', 'desc').limit(1).get()).docs[0]?.data();
        const x = e.data();
        return [x.employeeNumber, `${x.lastName} ${x.firstName}`, officeName.get(x.officeId) ?? '', g ? `${g.healthGradeNumber}` : '未決定', g ? yen(g.healthStandardRemuneration) : '', g ? `${g.pensionGradeNumber}` : '', g ? yen(g.pensionStandardRemuneration) : '', g?.effectiveMonth ?? ''];
      }));
      table = {
        title: '等級一覧表', subtitle: `${await scopeLabel()}・${ym}時点（在籍 ${rows.length}名）`, landscape: false,
        columns: [{ label: '社員番号', width: 60 }, { label: '氏名', width: 80 }, { label: '事業所', width: 90 }, { label: '健保等級', width: 40 }, { label: '健保 標準報酬', align: 'right', width: 62 }, { label: '厚年等級', width: 40 }, { label: '厚年 標準報酬', align: 'right', width: 62 }, { label: '適用開始', width: 50 }],
        rows, totals: null,
      };
      break;
    }
    case 'filingStatus': {
      const { officeName } = await employeesInScope(auth, input.officeId);
      const snap = await db.collection(`companies/${auth.companyId}/filingIndex`).get();
      const rows = snap.docs.map(d => d.data())
        .filter(f => (!input.officeId || f.officeId === input.officeId) && (auth.roles.includes('admin') || auth.officeIds.includes(f.officeId)))
        .filter(f => !input.yearMonth || String(f.createdDate ?? '').startsWith(input.yearMonth.slice(0, 4)))
        .sort((a, b) => String(b.createdDate ?? '').localeCompare(String(a.createdDate ?? '')))
        .map(f => [f.createdDate ?? '', FILING[f.filingType] ?? f.filingType, f.employeeName || `${f.personCount}名`, f.officeName || officeName.get(f.officeId) || '', STATUS[f.status] ?? f.status, f.deadline ?? '', f.submittedDate ?? '', f.acceptanceNumber ?? '']);
      table = {
        title: '届出提出状況一覧', subtitle: `${await scopeLabel()}${input.yearMonth ? `・${input.yearMonth.slice(0, 4)}年に作成` : ''}（${rows.length}件）`, landscape: true,
        columns: [{ label: '作成日', width: 60 }, { label: '届出', width: 140 }, { label: '対象', width: 90 }, { label: '事業所', width: 100 }, { label: '状態', width: 60 }, { label: '期限', width: 60 }, { label: '提出日', width: 60 }, { label: '受付番号', width: 90 }],
        rows, totals: null,
      };
      break;
    }
    case 'dependents': {
      const { list, officeName } = await employeesInScope(auth, input.officeId);
      const rows = (await mapConcurrent(list.filter(e => e.data().isActive === true), 10, async e => {
        const x = e.data();
        const deps = await e.ref.collection('dependents').where('deletedAt', '==', null).get();
        return deps.docs.map(d => d.data()).map(d => [x.employeeNumber, `${x.lastName} ${x.firstName}`, officeName.get(x.officeId) ?? '', `${d.lastName} ${d.firstName}`, RELATIONSHIP[d.relationship] ?? d.relationship, toDateString(d.birthDate) ?? '', toDateString(d.qualificationDate) ?? '', d.disqualificationDate ? `外れた（${toDateString(d.disqualificationDate)}）` : '扶養中']);
      })).flat();
      table = {
        title: '被扶養者一覧', subtitle: `${await scopeLabel()}（${rows.length}名）`, landscape: false,
        columns: [{ label: '社員番号', width: 56 }, { label: '被保険者', width: 76 }, { label: '事業所', width: 80 }, { label: '被扶養者', width: 76 }, { label: '続柄', width: 40 }, { label: '生年月日', width: 56 }, { label: '認定日', width: 56 }, { label: '状況', width: 70 }],
        rows, totals: null,
      };
      break;
    }
  }
  await auditAccess(auth, 'report', input.kind, input.format === 'pdf' ? 'pdfGenerate' : 'csvExport', { title: table.title, subtitle: table.subtitle, rows: table.rows.length });
  return table;
}
