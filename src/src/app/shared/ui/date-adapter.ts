import { Injectable } from '@angular/core';
import { DateAdapter, MatDateFormats } from '@angular/material/core';

/**
 * 日付の入力（Material の日付ピッカー）を、画面の値は「YYYY-MM-DD」の文字列のまま扱う。
 * 画面ごとの ngModel・サーバーへ送る値は今までどおり文字列で、カレンダーから選ぶことも、
 * 「2000/8/14」「20000814」「2000-08-14」のように打つこともできる。
 */
const INVALID = 'invalid';
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${pad(m + 1)}-${pad(d)}`;

@Injectable()
export class IsoStringDateAdapter extends DateAdapter<string> {
  constructor() {
    super();
    this.setLocale('ja-JP');
  }

  private parts(date: string): [number, number, number] {
    const [y, m, d] = date.split('-').map(Number);
    return [y, m - 1, d];
  }

  getYear(date: string) { return this.parts(date)[0]; }
  getMonth(date: string) { return this.parts(date)[1]; }
  getDate(date: string) { return this.parts(date)[2]; }
  getDayOfWeek(date: string) { const [y, m, d] = this.parts(date); return new Date(Date.UTC(y, m, d)).getUTCDay(); }
  getMonthNames(style: 'long' | 'short' | 'narrow') { return Array.from({ length: 12 }, (_, i) => style === 'narrow' ? String(i + 1) : `${i + 1}月`); }
  getDateNames() { return Array.from({ length: 31 }, (_, i) => String(i + 1)); }
  getDayOfWeekNames() { return ['日', '月', '火', '水', '木', '金', '土']; }
  getYearName(date: string) { return `${this.getYear(date)}年`; }
  getFirstDayOfWeek() { return 0; }
  getNumDaysInMonth(date: string) { const [y, m] = this.parts(date); return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  clone(date: string) { return date; }

  createDate(year: number, month: number, date: number) {
    const d = new Date(Date.UTC(year, month, date));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== date) throw Error(`Invalid date ${year}-${month + 1}-${date}`);
    return iso(year, month, date);
  }

  today() { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); }

  /** 打った文字を日付にする。年4桁・月・日を「/」「-」「.」「年月日」で区切るか、8桁の数字 */
  parse(value: unknown): string | null {
    if (value == null || value === '') return null;
    const text = String(value).trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (!text) return null;
    const m = text.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/) ?? text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return INVALID;
    try { return this.createDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])); } catch { return INVALID; }
  }

  /** displayFormat は ISO_DATE_FORMATS の文字（入力欄・カレンダーの見出し・読み上げ） */
  format(date: string, displayFormat: string) {
    if (!this.isValid(date)) return '';
    const [y, m, d] = this.parts(date);
    if (displayFormat === 'YYYY年M月') return `${y}年${m + 1}月`;
    if (displayFormat === 'YYYY年M月D日') return `${y}年${m + 1}月${d}日`;
    return `${y}/${pad(m + 1)}/${pad(d)}`;
  }

  addCalendarYears(date: string, years: number) { return this.addCalendarMonths(date, years * 12); }
  addCalendarMonths(date: string, months: number) {
    const [y, m, d] = this.parts(date);
    const target = new Date(Date.UTC(y, m + months, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return iso(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last));
  }
  addCalendarDays(date: string, days: number) {
    const [y, m, d] = this.parts(date);
    const t = new Date(Date.UTC(y, m, d + days));
    return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  }

  toIso8601(date: string) { return date; }
  isDateInstance(obj: unknown) { return typeof obj === 'string' && (obj === INVALID || /^\d{4}-\d{2}-\d{2}$/.test(obj)); }
  isValid(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()); }
  invalid() { return INVALID; }

  /** 画面の初期値の空文字は「未入力」として扱う（エラーにしない） */
  override deserialize(value: unknown): string | null {
    if (value == null || value === '') return null;
    return this.isDateInstance(value) && this.isValid(value as string) ? value as string : this.invalid();
  }
}

export const ISO_DATE_FORMATS: MatDateFormats = {
  parse: { dateInput: 'YYYY/MM/DD' },
  display: { dateInput: 'YYYY/MM/DD', monthYearLabel: 'YYYY年M月', dateA11yLabel: 'YYYY年M月D日', monthYearA11yLabel: 'YYYY年M月' },
};
