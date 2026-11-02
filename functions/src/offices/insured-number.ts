// 被保険者整理番号の自動の付け方（事業所の設定 insuredNumberMode: 'auto'）。
// 事業所の中で使われている数字の番号の最大と、採番の記録（counters）の大きい方の次を付ける。

/** 次の番号。数字でない番号（英字入りなど）は数えない */
export function nextInsuredNumber(used: (string | null | undefined)[], lastIssued: number): string {
  const max = used.reduce<number>((m, v) => (v && /^\d{1,9}$/.test(v.trim()) ? Math.max(m, Number(v.trim())) : m), 0);
  return String(Math.max(max, lastIssued) + 1);
}

export const insuredCounterPath = (companyId: string, officeId: string) => `companies/${companyId}/counters/insured-${officeId}`;
