import type { BonusPrintPerson, FilingPrintMeta, OfficialPdfResult, SanteiPrintPerson } from '../templates/official-filing-pdf';
import { filingTypeLabel } from '../filing-labels';

// 保存原本（承認時点の記入内容）から、同梱の公式様式に記入した PDF を作り直す

export interface FilingArchive {
  id?: string;
  source: 'employee' | 'santei' | 'bonus';
  filingType: string;
  formType: string;
  formData: Record<string, unknown> | null;
  header: Record<string, unknown> | null;
  persons: unknown[] | null;
  corrections: { field: string; before: string; after: string }[] | null;
  reason: string | null;
  meta: FilingPrintMeta & { employeeNumber: string };
  contentHash: string;
  form: { file: string; checkedOn: string; sha256: string } | null;
  approvedAt: string | null;
  approvedByName?: string;
}

let sourcesCache: Promise<Record<string, { checkedOn: string; sha256: string }>> | null = null;
function bundledForms() {
  sourcesCache ??= fetch('/filing-forms/sources.json').then(r => r.json()).catch(() => ({}));
  return sourcesCache;
}

/** 原本を作ったときの様式と、いま同梱している様式が違えば知らせる（同じ PDF にならないことがある） */
export async function formVersionWarning(a: FilingArchive): Promise<string | null> {
  if (!a.form) return null;
  const now = (await bundledForms())[a.form.file];
  if (!now) return '承認時の様式が見つかりません。';
  return now.sha256 === a.form.sha256 ? null : `承認時（${a.form.checkedOn}取得）と今の様式（${now.checkedOn}取得）が違います。今の様式に記入しています。`;
}

export async function pdfFromArchive(a: FilingArchive): Promise<OfficialPdfResult> {
  const m = await import('../templates/official-filing-pdf');
  const meta: FilingPrintMeta = a.meta;
  let result: OfficialPdfResult;
  if (a.filingType === 'correction' || a.filingType === 'cancellation') {
    result = await m.createCorrectionPdf(a.filingType, a.formType, a.formData ?? {}, a.corrections ?? [], a.reason ?? '', meta);
  } else if (a.source === 'santei') {
    result = await m.createSanteiFilingPdf(a.header ?? {}, (a.persons ?? []) as SanteiPrintPerson[], meta);
  } else if (a.filingType === 'bonusNonPayment') {
    result = await m.createBonusNonPaymentPdf(a.header ?? {}, meta);
  } else if (a.source === 'bonus') {
    result = await m.createBonusFilingPdf(a.header ?? {}, (a.persons ?? []) as BonusPrintPerson[], meta);
  } else {
    result = await m.createOfficialFilingPdf(a.filingType, a.formData ?? {}, meta);
  }
  const warning = await formVersionWarning(a);
  return warning ? { ...result, warnings: [warning, ...result.warnings] } : result;
}

/** ZIP の中のファイル名：日付_届出の種類_対象.pdf（ファイル名に使えない文字は除く） */
export function archiveFileName(x: { date: string | null; filingType: string; employeeName: string; officeName: string; number: number | null; year: number | null; payMonth: string | null; current: boolean }): string {
  const target = x.employeeName || `${x.officeName}${x.year ? `_${x.year}年` : x.payMonth ? `_${x.payMonth}` : ''}${x.number ? `_${x.number}件目` : ''}`;
  const name = `${x.date ?? '日付なし'}_${filingTypeLabel(x.filingType)}_${target}${x.current ? '_今の内容' : ''}.pdf`;
  return name.replace(/[\\/:*?"<>|]/g, '_');
}
