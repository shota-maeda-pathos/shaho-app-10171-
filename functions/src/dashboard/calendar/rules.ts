// 手続きカレンダーと「今月やること」（カタログ12章）

export interface CalendarEvent {
  /** 'YYYY-MM-DD'。期間なら start〜end */
  start: string;
  end: string | null;
  title: string;
  kind: 'annual' | 'bonus' | 'deadline';
  officeName?: string;
}

export interface ChecklistItem {
  key: string;
  label: string;
  link: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 毎年の予定（算定基礎届・定時決定の準備・料率改定） */
export function annualEvents(year: number): CalendarEvent[] {
  return [
    { start: `${year}-03-01`, end: `${year}-03-31`, title: '健康保険・介護保険の料率改定（3月分から）。新しい料率を取り込む', kind: 'annual' },
    { start: `${year}-04-01`, end: `${year}-06-30`, title: '定時決定の準備（4〜6月の報酬を確かめる）', kind: 'annual' },
    { start: `${year}-07-01`, end: `${year}-07-10`, title: '算定基礎届の届出期間', kind: 'annual' },
    { start: `${year}-09-01`, end: null, title: '定時決定の等級を9月分から使う', kind: 'annual' },
  ];
}

/** 事業所の賞与の予定月（支払から5日以内に賞与支払届） */
export function bonusEvents(year: number, offices: { name: string; bonusMonths?: number[] }[]): CalendarEvent[] {
  return offices.flatMap(o => (o.bonusMonths ?? []).map(m => ({
    start: `${year}-${pad(m)}-01`, end: null, title: `賞与の支給予定（支払から5日以内に賞与支払届）`, kind: 'bonus' as const, officeName: o.name,
  })));
}

/** その月の「やること」のチェックリスト */
export function monthlyChecklist(ym: string, bonusMonth: boolean): ChecklistItem[] {
  const month = Number(ym.slice(5, 7));
  const items: ChecklistItem[] = [
    { key: 'salary', label: '今月の給与を登録する', link: '/monthly' },
    { key: 'premium', label: '保険料を計算して確定する', link: '/monthly' },
    { key: 'publish', label: '明細を公開する', link: '/monthly' },
    { key: 'filings', label: '期限が近い届出を出す', link: '/filings?view=dueSoon' },
    { key: 'requests', label: '本人からの申請を確かめる', link: '/portal-requests' },
  ];
  if (month === 3) items.push({ key: 'rates', label: '新しい料率を取り込んで切り替える', link: '/settings' });
  if (month >= 4 && month <= 6) items.push({ key: 'santeiPrep', label: '算定基礎届の準備（4〜6月の報酬を確かめる）', link: '/santei' });
  if (month === 7) items.push({ key: 'santei', label: '算定基礎届を7月10日までに出す', link: '/santei' });
  if (bonusMonth) items.push({ key: 'bonus', label: '賞与を登録し、支払から5日以内に賞与支払届を出す', link: '/bonus' });
  return items;
}

/** 期限の何日前に知らせるか（既定7日） */
export const DEFAULT_REMINDER_DAYS = 7;
