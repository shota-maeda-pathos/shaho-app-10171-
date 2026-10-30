import { filingContentHash } from '../../utils/hash';

// 届出の保存原本（カタログ 9章「保存原本のアーカイブ」）。承認した時点の記入内容と、PDFに使う様式の版を残し、
// あとで同じPDFを作り直せるようにする。原本は追記するだけで、消さない（承認を取り消しても残る）。

/**
 * 届出の種類 → 同梱した公式様式のファイル。画面の official-filing-pdf.ts の OFFICIAL_FORMS と同じ対応
 */
export const FORM_FILE: Record<string, string> = {
  acquisitionNotification: 'acquisition', lossNotification: 'loss', remunerationMonthlyAlgorithm: 'santei', remunerationMonthlyChange: 'change',
  bonusPayment: 'bonus', bonusNonPayment: 'bonus-non-payment', dependentChange: 'dependent', maternityLeaveStart: 'maternity',
  childcareLeaveStart: 'childcare', maternityLeaveChange: 'maternity', childcareLeaveEnd: 'childcare-end',
  maternityLeaveEndChange: 'maternity-end-change', childcareLeaveEndChange: 'childcare-end-change', pensionLoss70: 'pension-loss-70',
};

/**
 * 同梱した様式の版（取得日と SHA-256）。src/public/filing-forms/sources.json と同じ値にする（テストで突き合わせる）。
 * 様式を差し替えたら両方を直す
 */
export const FORM_VERSIONS: Record<string, { checkedOn: string; sha256: string }> = {
  acquisition: { checkedOn: '2026-10-28', sha256: '07ca65ddff861611dc27d0800f68e5983228e0941e7ac6b675ca5a1afc9502ac' },
  loss: { checkedOn: '2026-10-28', sha256: '004ad7fa30b53a24a5bf3ff52b8a26ffcc53584ebd7dfd1fa19f287f90aeeb4d' },
  santei: { checkedOn: '2026-10-28', sha256: '82874d6d1ddcb48caf94964f616fef33ad0ec5a19cd1d50627597f3911ee80bd' },
  change: { checkedOn: '2026-10-28', sha256: '610461c8d24b0d19e22b7d115caee5f44b562c323bf1e9596471e3a83f164c7f' },
  bonus: { checkedOn: '2026-10-28', sha256: '24902c8aedbe6837eb6c7ca53ad44fcd3624a96f0fba14259ac4d6b3a0e81921' },
  dependent: { checkedOn: '2026-10-28', sha256: '93da8bc4656ee44ad778d06cbc2aa3584e364101f762bbea2654cc30d79bdfe7' },
  maternity: { checkedOn: '2026-10-28', sha256: '77eced44d60eb34b0a27a6db6d6c4060f7b132b2959444352e42dd157e906648' },
  childcare: { checkedOn: '2026-10-28', sha256: '8e30d157b2fdfacd00623950637a44201d4af3109e8c630adb839170d65def1f' },
  'childcare-end': { checkedOn: '2026-10-28', sha256: '8e30d157b2fdfacd00623950637a44201d4af3109e8c630adb839170d65def1f' },
  'maternity-end-change': { checkedOn: '2026-10-30', sha256: '05b75168a8d66637420e2536048c12b0687557b43ed6d3d22af7db67ca80e19a' },
  'childcare-end-change': { checkedOn: '2026-10-30', sha256: 'fed40a5b0be16a5f6abe7f7dcb46765696834b67f02f62d20d31e11216a1e690' },
  'pension-loss-70': { checkedOn: '2026-10-30', sha256: 'ecbddd474865d81b7fb22cc61d157491648eef3076fcbc98f83e3642c2c17883' },
  'bonus-non-payment': { checkedOn: '2026-10-30', sha256: '3558d592ea5d33444388994e00cc657190cd5da215d1b56a1a8132d7d6dc0f32' },
};

/** PDFの事業所欄などに使う情報（承認時点の値） */
export interface ArchiveMeta {
  companyName: string;
  officeName: string;
  officeNumber: string;
  officeAddress: string;
  officePhone: string;
  representativeName: string;
  effectiveDate: string;
  employeeNumber: string;
}

export interface ArchiveDoc {
  source: 'employee' | 'santei' | 'bonus';
  filingType: string;
  /** 訂正届・取消届は元の届出の種類（様式はこれを使う） */
  formType: string;
  /** 従業員の届出は formData、算定基礎届・賞与の届出は header と persons */
  formData: Record<string, unknown> | null;
  header: Record<string, unknown> | null;
  persons: unknown[] | null;
  corrections: unknown[] | null;
  reason: string | null;
  meta: ArchiveMeta;
  contentHash: string;
  form: { file: string; checkedOn: string; sha256: string } | null;
  filingVersion: number;
  approvedBy: string;
  approvalRequestId: string | null;
}

const text = (v: unknown) => (v == null ? '' : String(v));

/** 承認した届出から保存原本を作る */
export function buildArchive(input: {
  source: ArchiveDoc['source']; data: Record<string, any>; approvedBy: string; approvalRequestId?: string | null;
  company?: Record<string, any> | null; office?: Record<string, any> | null; employee?: Record<string, any> | null;
}): ArchiveDoc {
  const d = input.data;
  const filingType = text(d.filingType);
  const formType = d.originalFilingType ? text(d.originalFilingType) : filingType;
  const file = FORM_FILE[formType];
  const header = (d.header ?? null) as Record<string, unknown> | null;
  const effective = d.effectiveDate?.toDate ? d.effectiveDate.toDate().toISOString().slice(0, 10) : text(d.effectiveDate);
  const meta: ArchiveMeta = header ? {
    companyName: text(header['会社名']), officeName: text(header['事業所名称']), officeNumber: text(header['事業所整理記号']),
    officeAddress: text(header['事業所所在地']), officePhone: text(header['電話番号']), representativeName: text(header['事業主氏名']),
    effectiveDate: text(header['届出年月日'] ?? effective), employeeNumber: '',
  } : {
    companyName: text(input.company?.name), officeName: text(input.office?.name), officeNumber: text(input.office?.officeNumber),
    officeAddress: text(input.office?.address), officePhone: text(input.office?.phone), representativeName: text(input.company?.representativeName),
    effectiveDate: effective, employeeNumber: text(input.employee?.employeeNumber),
  };
  return {
    source: input.source, filingType, formType,
    formData: (d.formData ?? null) as Record<string, unknown> | null, header, persons: (d.persons ?? null) as unknown[] | null,
    corrections: (d.corrections ?? null) as unknown[] | null, reason: d.reason ?? null,
    meta, contentHash: filingContentHash(d),
    form: file && FORM_VERSIONS[file] ? { file, ...FORM_VERSIONS[file] } : null,
    filingVersion: typeof d.version === 'number' ? d.version : 0,
    approvedBy: input.approvedBy, approvalRequestId: input.approvalRequestId ?? null,
  };
}
