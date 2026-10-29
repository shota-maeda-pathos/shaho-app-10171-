import { z } from 'zod';

export const CollectionSummarySchema = z.object({
  companyId: z.string().min(1),
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  officeId: z.string().min(1).optional(),
});

export type CollectionSummaryInput = z.infer<typeof CollectionSummarySchema>;
