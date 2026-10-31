// メールとパスワードが正しいかを Firebase Authentication の REST で確かめる（Admin SDK にはこの機能がない）
// 鍵は画面に埋め込んでいるウェブ用の API キー（公開してよいもの）
const WEB_API_KEY = 'AIzaSyCno1gHFdQ0R10PpVfysXgGvU5-KhsYtd4';

export type PasswordCheck =
  | { ok: true; uid: string }
  | { ok: false; reason: 'invalid' | 'disabled' | 'throttled' };

export async function checkPassword(email: string, password: string): Promise<PasswordCheck> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    },
  );
  const body = (await res.json()) as { localId?: string; error?: { message?: string } };
  if (res.ok && body.localId) return { ok: true, uid: body.localId };
  const message = body.error?.message ?? '';
  if (message.startsWith('USER_DISABLED')) return { ok: false, reason: 'disabled' };
  if (message.startsWith('TOO_MANY_ATTEMPTS')) return { ok: false, reason: 'throttled' };
  return { ok: false, reason: 'invalid' };
}
