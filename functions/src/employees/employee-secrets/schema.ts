import { z } from 'zod';

export const SecretsGetSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
});

export type SecretsGetInput = z.infer<typeof SecretsGetSchema>;

export const SecretsUpdateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  // null は登録の取り消し
  myNumber: z.string().regex(/^\d{12}$/, '個人番号は12桁の数字です').nullable(),
  expectedVersion: z.number(),
});

export type SecretsUpdateInput = z.infer<typeof SecretsUpdateSchema>;

/** 個人番号を表示する理由（選択式。カタログ14章） */
export const REVEAL_REASONS = {
  filing: '届出の作成のため',
  identity: '本人確認のため',
  inquiry: '本人からの問い合わせのため',
  other: 'その他',
} as const;

export const SecretsRevealSchema = z
  .object({
    companyId: z.string(),
    employeeId: z.string(),
    reason: z.enum(['filing', 'identity', 'inquiry', 'other']),
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.reason !== 'other' || !!v.note, {
    message: '「その他」のときは理由を書いてください',
    path: ['note'],
  });

export type SecretsRevealInput = z.infer<typeof SecretsRevealSchema>;
