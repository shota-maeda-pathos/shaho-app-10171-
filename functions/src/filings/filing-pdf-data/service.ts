import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext } from '../../middleware/auth';
import { FilingPdfDataInput } from './schema';

const FILING_TYPE_TITLES: Record<string, string> = {
  acquisitionNotification: '健康保険・厚生年金保険 被保険者資格取得届',
  lossNotification: '健康保険・厚生年金保険 被保険者資格喪失届',
  remunerationMonthlyChange: '健康保険・厚生年金保険 被保険者報酬月額変更届',
  remunerationMonthlyAlgorithm: '健康保険・厚生年金保険 被保険者報酬月額算定基礎届',
  dependentChange: '健康保険 被扶養者（異動）届',
  bonusPayment: '健康保険・厚生年金保険 被保険者賞与支払届',
  maternityLeaveStart: '産前産後休業取得者申出書',
  childcareLeaveStart: '育児休業等取得者申出書',
  maternityLeaveChange: '産前産後休業取得者変更（終了）届',
  childcareLeaveEnd: '育児休業等取得者終了届',
  maternityLeaveEndChange: '健康保険・厚生年金保険 産前産後休業終了時報酬月額変更届',
  childcareLeaveEndChange: '健康保険・厚生年金保険 育児休業等終了時報酬月額変更届',
};

export interface FilingPdfDataResponse {
  title: string;
  filingType: string;
  companyName: string;
  officeName: string;
  officeNumber: string;
  employeeName: string;
  employeeNumber: string;
  effectiveDate: string;
  workflowStatus: string;
  submissionStatus: string;
  formData: Record<string, unknown>;
  createdAt: string;
  sections: { label: string; rows: { label: string; value: string }[] }[];
}

export async function getFilingPdfData(
  input: FilingPdfDataInput,
  auth: AuthContext,
): Promise<FilingPdfDataResponse> {
  const base = `companies/${auth.companyId}`;

  const empSnap = await db.doc(`${base}/employees/${input.employeeId}`).get();
  if (!empSnap.exists) throw new HttpsError('not-found', '従業員が見つかりません');
  const emp = empSnap.data()!;

  if (!auth.roles.includes('admin') && !auth.officeIds.includes(emp.officeId)) {
    throw new HttpsError('permission-denied', 'この事業所へのアクセス権がありません');
  }

  const filingSnap = await db.doc(`${base}/employees/${input.employeeId}/filings/${input.filingId}`).get();
  if (!filingSnap.exists) throw new HttpsError('not-found', '届出が見つかりません');
  const filing = filingSnap.data()!;

  const officeSnap = await db.doc(`${base}/offices/${emp.officeId}`).get();
  const office = officeSnap.exists ? officeSnap.data()! : {};

  const companySnap = await db.doc(base).get();
  const company = companySnap.exists ? companySnap.data()! : {};

  const fd = filing.formData ?? {};
  const sections = buildSections(filing.filingType, fd);

  return {
    title: FILING_TYPE_TITLES[filing.filingType] ?? filing.filingType,
    filingType: filing.filingType,
    companyName: company.name ?? '',
    officeName: office.name ?? '',
    officeNumber: office.officeNumber ?? '',
    employeeName: `${emp.lastName} ${emp.firstName}`,
    employeeNumber: emp.employeeNumber ?? '',
    effectiveDate: filing.effectiveDate,
    workflowStatus: filing.workflowStatus,
    submissionStatus: filing.submissionStatus,
    formData: fd,
    createdAt: filing.createdAt?.toDate?.()?.toISOString?.() ?? '',
    sections,
  };
}

function fmt(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString('ja-JP');
  return String(v);
}

function yen(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return `${v.toLocaleString('ja-JP')} 円`;
  return String(v);
}

function buildSections(
  filingType: string,
  fd: Record<string, unknown>,
): { label: string; rows: { label: string; value: string }[] }[] {
  const sections: { label: string; rows: { label: string; value: string }[] }[] = [];

  sections.push({
    label: '事業所・被保険者情報',
    rows: [
      { label: '事業所整理記号', value: fmt(fd['事業所整理記号']) },
      { label: '事業所名称', value: fmt(fd['事業所名称']) },
      { label: '被保険者整理番号', value: fmt(fd['被保険者整理番号']) },
      { label: '被保険者氏名', value: fmt(fd['被保険者氏名']) },
      { label: 'フリガナ', value: fmt(fd['被保険者氏名フリガナ']) },
      { label: '生年月日', value: fmt(fd['生年月日']) },
      { label: '性別', value: fmt(fd['性別']) },
      { label: '個人番号', value: fmt(fd['個人番号']) },
    ],
  });

  if (filingType === 'acquisitionNotification') {
    sections.push({
      label: '資格取得',
      rows: [
        { label: '資格取得年月日', value: fmt(fd['資格取得年月日']) },
        { label: '取得区分', value: fmt(fd['取得区分']) },
        { label: '被保険者種別', value: fmt(fd['被保険者種別']) },
        { label: '報酬月額（通貨）', value: yen(fd['報酬月額_通貨']) },
        { label: '報酬月額（現物）', value: yen(fd['報酬月額_現物']) },
        { label: '報酬月額（合計）', value: yen(fd['報酬月額_合計']) },
      ],
    });
    sections.push({
      label: '標準報酬月額',
      rows: [
        { label: '健康保険 等級', value: fmt(fd['健康保険_等級']) },
        { label: '健康保険 標準報酬月額', value: yen(fd['健康保険_標準報酬月額']) },
        { label: '厚生年金 等級', value: fmt(fd['厚生年金_等級']) },
        { label: '厚生年金 標準報酬月額', value: yen(fd['厚生年金_標準報酬月額']) },
      ],
    });
  }

  if (filingType === 'lossNotification') {
    sections.push({
      label: '資格喪失',
      rows: [
        { label: '資格喪失年月日', value: fmt(fd['資格喪失年月日']) },
        { label: '喪失原因', value: fmt(fd['喪失原因']) },
        { label: '退職年月日', value: fmt(fd['退職年月日']) },
        { label: '最終標準報酬月額（健康保険）', value: yen(fd['最終標準報酬月額_健康保険']) },
        { label: '最終標準報酬月額（厚生年金）', value: yen(fd['最終標準報酬月額_厚生年金']) },
      ],
    });
  }

  if (filingType === 'remunerationMonthlyChange' || filingType === 'maternityLeaveEndChange' || filingType === 'childcareLeaveEndChange') {
    if (filingType !== 'remunerationMonthlyChange') {
      sections.push({
        label: '休業と申出',
        rows: [
          { label: '休業終了年月日', value: fmt(fd['休業終了年月日']) },
          { label: '養育する子', value: `${fmt(fd['養育する子の氏名'])}（${fmt(fd['養育する子の生年月日'])}生まれ）` },
          { label: '本人の申出年月日', value: fmt(fd['申出年月日']) },
        ],
      });
    }
    sections.push({
      label: '従前の標準報酬',
      rows: [
        { label: '健康保険 等級', value: fmt(fd['従前の等級_健康保険']) },
        { label: '健康保険 標準報酬月額', value: yen(fd['従前の標準報酬月額_健康保険']) },
        { label: '厚生年金 等級', value: fmt(fd['従前の等級_厚生年金']) },
        { label: '厚生年金 標準報酬月額', value: yen(fd['従前の標準報酬月額_厚生年金']) },
      ],
    });
    const month = (i: number) => {
      const p = `${i}月目`;
      const used = fd[`${p}_算入`] === false ? '（平均に入れない）' : '';
      return { label: `${i}月目（${fmt(fd[`${p}_年月`])}）`, value: `通貨 ${yen(fd[`${p}_通貨`])}・現物 ${yen(fd[`${p}_現物`])} / ${fmt(fd[`${p}_支払基礎日数`])}日${used}` };
    };
    sections.push({
      label: '報酬月額（3か月）',
      rows: [
        { label: '改定年月', value: fmt(fd['改定年月']) },
        ...(fd['昇降給月'] ? [{ label: '昇（降）給月', value: `${fmt(fd['昇降給月'])}（${fmt(fd['昇降給区分'])}）` }] : []),
        month(1), month(2), month(3),
        { label: '総計', value: yen(fd['合計']) },
        { label: '平均額', value: yen(fd['平均額']) },
        ...(fd['修正平均額'] != null ? [{ label: '修正平均額', value: yen(fd['修正平均額']) }, { label: '遡及支払額', value: `${yen(fd['遡及支払額'])}（${fmt(fd['遡及支払月'])}）` }] : []),
      ],
    });
    if (fd['改定後の等級_健康保険'] != null) {
      sections.push({
        label: '改定後の標準報酬',
        rows: [
          { label: '健康保険', value: `${fmt(fd['改定後の等級_健康保険'])}等級 ${yen(fd['改定後の標準報酬月額_健康保険'])}` },
          { label: '厚生年金', value: `${fmt(fd['改定後の等級_厚生年金'])}等級 ${yen(fd['改定後の標準報酬月額_厚生年金'])}` },
          { label: '改定する保険', value: fmt(fd['改定する保険']) },
        ],
      });
    }
  }

  if (filingType === 'remunerationMonthlyAlgorithm') {
    sections.push({
      label: '従前の標準報酬',
      rows: [
        { label: '対象年', value: fmt(fd['対象年']) },
        { label: '健康保険 等級', value: fmt(fd['従前の等級_健康保険']) },
        { label: '健康保険 標準報酬月額', value: yen(fd['従前の標準報酬月額_健康保険']) },
        { label: '厚生年金 等級', value: fmt(fd['従前の等級_厚生年金']) },
        { label: '厚生年金 標準報酬月額', value: yen(fd['従前の標準報酬月額_厚生年金']) },
      ],
    });
    sections.push({
      label: '報酬月額（4〜6月）',
      rows: [
        { label: '4月', value: `${yen(fd['4月_通貨'])} / ${fmt(fd['4月_支払基礎日数'])}日` },
        { label: '5月', value: `${yen(fd['5月_通貨'])} / ${fmt(fd['5月_支払基礎日数'])}日` },
        { label: '6月', value: `${yen(fd['6月_通貨'])} / ${fmt(fd['6月_支払基礎日数'])}日` },
        { label: '合計', value: yen(fd['合計']) },
        { label: '平均額', value: yen(fd['平均額']) },
      ],
    });
  }

  if (filingType === 'bonusPayment') {
    sections.push({
      label: '賞与支払情報',
      rows: [
        { label: '賞与支払年月日', value: fmt(fd['賞与支払年月日']) },
        { label: '賞与額（通貨）', value: yen(fd['賞与額_通貨']) },
        { label: '賞与額（現物）', value: yen(fd['賞与額_現物']) },
        { label: '賞与額（合計）', value: yen(fd['賞与額_合計']) },
        { label: '標準賞与額', value: yen(fd['標準賞与額']) },
        { label: '年度累計標準賞与額', value: yen(fd['年度累計標準賞与額']) },
        { label: '健康保険料（被保険者）', value: yen(fd['健康保険料_被保険者']) },
        { label: '厚生年金保険料（被保険者）', value: yen(fd['厚生年金保険料_被保険者']) },
      ],
    });
  }

  if (filingType === 'dependentChange') {
    const deps = (fd['被扶養者一覧'] as any[]) ?? [];
    if (deps.length > 0) {
      sections.push({
        label: '被扶養者',
        rows: deps.map((d: any, i: number) => ({
          label: `${i + 1}. ${d['氏名'] ?? ''}`,
          value: `${d['続柄'] ?? ''} / ${d['生年月日'] ?? ''} / ${d['性別'] ?? ''} / ${d['同居別居'] ?? ''} / 年収 ${typeof d['年間収入'] === 'number' ? d['年間収入'].toLocaleString('ja-JP') : '—'} 円`,
        })),
      });
    }
  }

  return sections;
}
