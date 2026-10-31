import { type CallableRequest, onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireLoginEnabled, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  ChangePasswordSchema,
  CompanySchema,
  GoogleLoginSchema,
  InvitationAcceptSchema,
  InvitationGetSchema,
  LoginSchema,
  RevokeSessionSchema,
  UnlockSchema,
} from './schema';
import {
  type Client,
  changePassword,
  googleLogin,
  invitationAccept,
  invitationGet,
  invitationReissue,
  listSessions,
  login,
  logout,
  revokeSession,
  unlock,
} from './service';
import { z } from 'zod';

/** 監査ログに残す接続元（IPとブラウザー） */
function clientOf(request: CallableRequest, userAgent?: string): Client {
  const raw = request.rawRequest;
  const forwarded = raw?.headers?.['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || raw?.ip || '';
  return { ip, userAgent: userAgent ?? String(raw?.headers?.['user-agent'] ?? '') };
}

// ログイン前に呼ぶ関数（認証なし）
export const authLogin = onCall(async (request) => {
  const input = validate(LoginSchema, request.data);
  return login(input, clientOf(request, input.userAgent));
});

export const authGoogleLogin = onCall(async (request) => {
  const input = validate(GoogleLoginSchema, request.data);
  return googleLogin(input, clientOf(request, input.userAgent));
});

export const authInvitationGet = onCall(async (request) => {
  const input = validate(InvitationGetSchema, request.data);
  return invitationGet(input);
});

export const authInvitationAccept = onCall(async (request) => {
  const input = validate(InvitationAcceptSchema, request.data);
  return invitationAccept(input, clientOf(request, input.userAgent));
});

// ログイン後に呼ぶ関数
export const authLogout = onCall(async (request) => {
  const input = validate(CompanySchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  return logout(auth, auth.sessionId, clientOf(request));
});

export const authSessionList = onCall(async (request) => {
  const input = validate(CompanySchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  return listSessions(auth, auth.sessionId);
});

export const authSessionRevoke = onCall(async (request) => {
  const input = validate(RevokeSessionSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  return revokeSession(auth, input, clientOf(request));
});

export const authChangePassword = onCall(async (request) => {
  const input = validate(ChangePasswordSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  return changePassword(auth, input, clientOf(request));
});

export const authUnlock = onCall(async (request) => {
  const input = validate(UnlockSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return unlock(auth, input, clientOf(request));
});

export const authInvitationReissue = onCall(async (request) => {
  const input = validate(z.object({ companyId: z.string().min(1), invitationId: z.string().min(1) }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return invitationReissue(auth, input.invitationId, clientOf(request));
});

/** 画面を操作しているあいだ、最後の操作の時刻をサーバーに知らせる（数分に1回） */
export const authPing = onCall(async (request) => {
  const input = validate(CompanySchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  return { ok: true, sessionId: auth.sessionId };
});
