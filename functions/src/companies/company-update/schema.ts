import { z } from 'zod';

export const CompanyUpdateSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  corporateNumber: z.string().max(13).optional(),
  representativeName: z.string().max(100).optional(),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  healthInsurerId: z.string().max(20).optional(),
  pensionCode: z.string().max(20).optional(),
  expectedVersion: z.number().int().min(1),
});

export type CompanyUpdateInput = z.infer<typeof CompanyUpdateSchema>;
