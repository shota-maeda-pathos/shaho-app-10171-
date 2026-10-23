import { z } from 'zod';

export const FilingGetSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  filingId: z.string(),
});

export type FilingGetInput = z.infer<typeof FilingGetSchema>;
