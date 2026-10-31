import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export interface ReportTable {
  title: string;
  subtitle: string;
  columns: { label: string; align?: 'right'; width: number }[];
  rows: string[][];
  totals: string[] | null;
  landscape: boolean;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 36;
const ROW = 15;
const SIZE = 7.5;

/** 列の幅に収まるよう、文字を小さくし、それでも入らなければ末尾を省く */
function fit(font: PDFFont, text: string, width: number): { text: string; size: number } {
  let size = SIZE;
  while (size > 5 && font.widthOfTextAtSize(text, size) > width - 4) size -= 0.5;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > width - 4) t = t.slice(0, -2) + '…';
  return { text: t, size };
}

/**
 * 帳票の表を PDF にする（カタログ9章：A4・出力日時・ページ番号つき、印刷向け）。
 * 列の幅は合計がページの幅に合うよう伸び縮みさせる
 */
export async function createReportPdf(table: ReportTable, loadFont: () => Promise<Uint8Array> = async () => {
  const r = await fetch('/filing-forms/fonts/NotoSansJP-Regular.ttf');
  if (!r.ok) throw new Error('日本語フォントを読み込めませんでした。再読み込みしてください。');
  return new Uint8Array(await r.arrayBuffer());
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await loadFont(), { subset: false });
  const [w, h] = table.landscape ? [A4[1], A4[0]] : A4;
  const usable = w - MARGIN * 2;
  const scale = usable / table.columns.reduce((a, c) => a + c.width, 0);
  const widths = table.columns.map(c => c.width * scale);
  const printedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const perPage = Math.floor((h - MARGIN * 2 - 70) / ROW);
  const body = [...table.rows, ...(table.totals ? [table.totals] : [])];
  const pageCount = Math.max(1, Math.ceil(body.length / perPage));

  const drawRow = (page: PDFPage, y: number, cells: string[], bold: boolean) => {
    let x = MARGIN;
    cells.forEach((cell, i) => {
      const { text, size } = fit(font, cell ?? '', widths[i]);
      const tw = font.widthOfTextAtSize(text, size);
      const tx = table.columns[i]?.align === 'right' ? x + widths[i] - 2 - tw : x + 2;
      page.drawText(text, { x: tx, y: y + 4, size, font, color: rgb(0, 0, 0) });
      x += widths[i];
    });
    page.drawLine({ start: { x: MARGIN, y }, end: { x: w - MARGIN, y }, thickness: bold ? 0.8 : 0.3, color: rgb(0.6, 0.6, 0.6) });
  };

  for (let p = 0; p < pageCount; p++) {
    const page = pdf.addPage([w, h]);
    page.drawText(table.title, { x: MARGIN, y: h - MARGIN - 14, size: 14, font });
    page.drawText(table.subtitle, { x: MARGIN, y: h - MARGIN - 32, size: 8.5, font, color: rgb(0.25, 0.25, 0.25) });
    page.drawText(`出力日時 ${printedAt}`, { x: w - MARGIN - font.widthOfTextAtSize(`出力日時 ${printedAt}`, 8), y: h - MARGIN - 14, size: 8, font });
    let y = h - MARGIN - 56;
    page.drawRectangle({ x: MARGIN, y, width: usable, height: ROW, color: rgb(0.92, 0.94, 0.96) });
    drawRow(page, y, table.columns.map(c => c.label), true);
    for (const cells of body.slice(p * perPage, (p + 1) * perPage)) {
      y -= ROW;
      drawRow(page, y, cells, cells === table.totals);
    }
    const label = `${p + 1} / ${pageCount}`;
    page.drawText(label, { x: w / 2 - font.widthOfTextAtSize(label, 8) / 2, y: MARGIN / 2, size: 8, font });
  }
  return pdf.save();
}

/** 同じ表を CSV に（Excel で開けるよう BOM つき） */
export function reportCsv(table: ReportTable): string {
  const rows = [table.columns.map(c => c.label), ...table.rows, ...(table.totals ? [table.totals] : [])];
  return '﻿' + rows.map(r => r.map(v => /[",\n]/.test(v ?? '') ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')).join(',')).join('\r\n');
}
