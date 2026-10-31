import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// 前に使ったパスワードを見分けるための指紋（scrypt）。パスワードそのものは残さない

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString('base64')}:${hash.toString('base64')}`;
}

export function matchesHash(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** ロックの記録の鍵（メールアドレスをそのまま文書IDにしない） */
export function emailKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
