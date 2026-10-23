import { z } from 'zod';

export const FilingSubmitSchema = z.object({
  companyId: z.string().min(1),
  employeeId: z.string().min(1),
  filingId: z.string().min(1),
  expectedVersion: z.number().int().min(1),
});

export type FilingSubmitInput = z.infer<typeof FilingSubmitSchema>;
