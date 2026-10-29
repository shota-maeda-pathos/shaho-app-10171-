import { z } from 'zod';

export const CollectionCreateSchema = z.object({
  companyId: z.string().min(1),
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  officeId: z.string().min(1).optional(),
  collectionType: z.enum(['monthly', 'bonus']).default('monthly'),
  dueDate: z.string().date().optional(),
  notes: z.string().max(500).optional(),
});

export type CollectionCreateInput = z.infer<typeof CollectionCreateSchema>;
