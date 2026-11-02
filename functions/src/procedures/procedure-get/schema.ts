import { z } from 'zod';

export const ProcedureGetSchema = z.object({
  companyId: z.string().regex(/^[^/]+$/),
  procedureId: z.string().regex(/^[^/]+$/),
  /** false なら読むだけ（手続きの状態を計算し直して保存しない。version を変えない） */
  refresh: z.boolean().default(true),
});

export type ProcedureGetInput = z.input<typeof ProcedureGetSchema>;
