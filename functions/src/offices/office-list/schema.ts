import { z } from 'zod';

export const OfficeListSchema = z.object({
  companyId: z.string(),
  includeInactive: z.boolean().optional(),
});

export type OfficeListInput = z.infer<typeof OfficeListSchema>;
