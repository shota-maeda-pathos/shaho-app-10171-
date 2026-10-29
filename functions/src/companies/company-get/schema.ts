import { z } from 'zod';

export const CompanyGetSchema = z.object({
  companyId: z.string().min(1),
});

export type CompanyGetInput = z.infer<typeof CompanyGetSchema>;
