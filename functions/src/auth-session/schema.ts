import { z } from 'zod';

const companyId = z.string().min(1);
const userAgent = z.string().max(400).optional();

export const LoginSchema = z.object({
  companyId,
  email: z.string().trim().email('メールアドレスの形式が違います'),
  password: z.string().min(1).max(200),
  userAgent,
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const GoogleLoginSchema = z.object({
  companyId,
  idToken: z.string().min(1),
  userAgent,
});
export type GoogleLoginInput = z.infer<typeof GoogleLoginSchema>;

export const CompanySchema = z.object({ companyId });

export const RevokeSessionSchema = z.object({ companyId, sessionId: z.string().min(1) });
export type RevokeSessionInput = z.infer<typeof RevokeSessionSchema>;

export const UnlockSchema = z.object({ companyId, email: z.string().trim().email() });
export type UnlockInput = z.infer<typeof UnlockSchema>;

export const ChangePasswordSchema = z.object({
  companyId,
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const InvitationGetSchema = z.object({ companyId, invitationId: z.string().min(1) });
export type InvitationGetInput = z.infer<typeof InvitationGetSchema>;

export const InvitationAcceptSchema = z
  .object({
    companyId,
    invitationId: z.string().min(1),
    displayName: z.string().trim().min(1).max(100),
    // パスワードで登録するときは password、Google で登録するときは idToken
    password: z.string().min(1).max(200).optional(),
    idToken: z.string().min(1).optional(),
    userAgent,
  })
  .refine((v) => !!v.password !== !!v.idToken, { message: 'パスワードか Google のどちらかで登録してください' });
export type InvitationAcceptInput = z.infer<typeof InvitationAcceptSchema>;
