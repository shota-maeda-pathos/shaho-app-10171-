import { z } from 'zod';

export const PremiumSimulateSchema = z.object({
  companyId: z.string(),
  officeId: z.string(),
  monthlyRemuneration: z.number().min(0),
  age: z.number().int().min(15).max(80),
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});

export type PremiumSimulateInput = z.infer<typeof PremiumSimulateSchema>;
