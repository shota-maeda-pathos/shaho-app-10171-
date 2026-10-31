// ダッシュボードのサマリーカード10種（カタログ12章）の決まり。集計は service.ts が1日1回（と「更新」ボタン）で行う

export const SUMMARY_CARDS = {
  overdueFilings: { label: '期限切れの届出', link: '/filings?view=overdue', urgent: true },
  dueThisWeek: { label: '今週が期限の届出', link: '/filings?view=dueSoon', urgent: false },
  pendingApprovals: { label: '承認待ち', link: '/approvals', urgent: false },
  rejectedOrReturned: { label: '差戻し・返戻', link: '/filings?view=open&status=rejected', urgent: false },
  missingSalaries: { label: '今月の給与が未登録の従業員', link: '/monthly', urgent: false },
  unconfirmedOffices: { label: '今月の保険料が未確定の事業所', link: '/monthly', urgent: false },
  revisionCandidates: { label: '随時改定の可能性がある従業員', link: '/procedures/new?type=monthly_change', urgent: false },
  ageEvents: { label: '来月に年齢到達する従業員（40・65・70・75歳）', link: '/procedures/new?type=age_event', urgent: false },
  contractsEnding: { label: '30日以内に契約が満了する従業員', link: '/employees', urgent: false },
  leavesSoon: { label: '30日以内に産休・育休が始まる・終わる従業員', link: '/procedures/new?type=leave', urgent: false },
  portalRequests: { label: '本人からの申請（受付待ち）', link: '/portal-requests', urgent: false },
} as const;

export type SummaryKey = keyof typeof SUMMARY_CARDS;
export type SummaryCounts = Record<SummaryKey, number>;

export function emptyCounts(): SummaryCounts {
  return Object.fromEntries(Object.keys(SUMMARY_CARDS).map(k => [k, 0])) as SummaryCounts;
}

/** 'YYYY-MM-DD' に日数を足す */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** 社会保険の年齢到達は誕生日の前日。その日が来月に入る年齢（40・65・70・75）。なければ null */
export function ageReachedIn(birthDate: string, month: string): number | null {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  for (const age of [40, 65, 70, 75]) {
    const birthday = new Date(Date.UTC(by + age, bm - 1, bd));
    birthday.setUTCDate(birthday.getUTCDate() - 1);
    if (birthday.toISOString().slice(0, 7) === month) return age;
  }
  return null;
}

/** today から days 日以内（今日を含む）か */
export function within(date: string | null | undefined, today: string, days: number): boolean {
  return !!date && date >= today && date <= addDays(today, days);
}
