import { createHash } from 'crypto';

/** キーの順に並べた JSON（同じ内容なら同じ文字列になる）。Firestore の Timestamp は ISO 文字列にする */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const t = value as { toDate?: () => Date };
  if (typeof t.toDate === 'function') return JSON.stringify(t.toDate().toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().filter(k => obj[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** 内容の指紋（SHA-256）。承認したときの内容が後から変わっていないかを確かめる */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/**
 * 届出の「承認した内容」。状態や版などの管理用の項目は除き、提出する中身だけを指紋にする。
 * 従業員の届出は formData、算定基礎届・賞与支払届は header と persons
 */
export function filingContentHash(data: Record<string, unknown>): string {
  if (data.persons !== undefined || data.header !== undefined) return contentHash({ header: data.header ?? null, persons: data.persons ?? null });
  return contentHash({ filingType: data.filingType ?? null, formData: data.formData ?? null });
}
