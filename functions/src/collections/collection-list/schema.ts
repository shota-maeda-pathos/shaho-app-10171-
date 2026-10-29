import { z } from 'zod';

export const CollectionListSchema = z.object({
  companyId: z.string().min(1),
  officeId: z.string().regex(/^[^/]+$/).optional(),
  collectionType: z.enum(['monthly', 'bonus']).optional(),
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
});

export type CollectionListInput = z.infer<typeof CollectionListSchema>;
