import { z } from 'zod';

export const AgeEventCheckSchema = z.object({
  companyId: z.string(),
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});

export type AgeEventCheckInput = z.infer<typeof AgeEventCheckSchema>;
