import { z } from 'zod';

const id = z.string().regex(/^[^/]+$/);

export const CorrectionCreateSchema = z.object({
  companyId: z.string().min(1),
  employeeId: id,
  /** 元の（提出済みの）届出 */
  filingId: id,
  kind: z.enum(['correction', 'cancellation']),
  reason: z.string().max(500),
}).strict();
export type CorrectionCreateInput = z.infer<typeof CorrectionCreateSchema>;

export const CorrectionUpdateSchema = z.object({
  companyId: z.string().min(1),
  employeeId: id,
  /** 訂正届・取消届 */
  filingId: id,
  expectedVersion: z.number().int(),
  action: z.enum(['save', 'discard']),
  /** 直す項目（元の届出の項目名と値） */
  formData: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.null()])).optional(),
  reason: z.string().max(500).optional(),
}).strict();
export type CorrectionUpdateInput = z.infer<typeof CorrectionUpdateSchema>;
