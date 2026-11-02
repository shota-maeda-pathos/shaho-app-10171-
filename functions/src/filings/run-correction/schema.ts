import { z } from 'zod';

const id = z.string().regex(/^[^/]+$/).max(200);

/** run の届出（算定基礎届は santeiRuns、賞与支払届は bonusRuns の下） */
const target = { companyId: z.string().min(1), source: z.enum(['santei', 'bonus']), parentId: id, filingId: id };

export const RunCorrectionCreateSchema = z.object({
  ...target,
  kind: z.enum(['correction', 'cancellation']),
  /** 訂正届・取消届に載せる人（元の届出に載っている人） */
  employeeIds: z.array(id).min(1).max(3000),
  reason: z.string().max(500),
}).strict();
export type RunCorrectionCreateInput = z.infer<typeof RunCorrectionCreateSchema>;

export const RunCorrectionUpdateSchema = z.object({
  ...target,
  expectedVersion: z.number().int(),
  action: z.literal('save'),
  /** 人ごとの直す項目（従業員ID → 項目名と値） */
  persons: z.record(id, z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.null()]))).optional(),
  reason: z.string().max(500).optional(),
}).strict();
export type RunCorrectionUpdateInput = z.infer<typeof RunCorrectionUpdateSchema>;
