import { z } from 'zod';

const safeId = z.string().min(1).regex(/^[^/]+$/);

export const SanteiPreviewSchema = z.object({
  companyId: safeId,
  year: z.number().int().min(2020).max(2100),
  officeId: safeId.optional(),
  /** 個別確認用。最大30名 */
  employeeIds: z.array(safeId).min(1).max(30).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  lastDocId: safeId.optional(),
});

export type SanteiPreviewInput = z.infer<typeof SanteiPreviewSchema>;

export const SanteiSubmitSchema = z.object({
  companyId: safeId,
  year: z.number().int().min(2020).max(2100),
  employeeIds: z.array(safeId).min(1).max(100),
  comment: z.string().max(500).optional(),
});

export type SanteiSubmitInput = z.infer<typeof SanteiSubmitSchema>;
