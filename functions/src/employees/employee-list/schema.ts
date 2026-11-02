import { z } from 'zod';
import { EmploymentTypeSchema } from '../../types/catalog-schemas';

export const EmployeeListSchema = z.object({
  companyId: z.string(),
  officeId: z.string().optional(),
  departmentId: z.string().optional(),
  includeResigned: z.boolean().optional(),
  keyword: z.string().max(50).optional(),
  /** 今の雇用条件の雇用形態で絞る */
  employmentType: EmploymentTypeSchema.optional(),
  /** 今日の在籍ステータスで絞る */
  status: z.enum(['active', 'sickLeave', 'maternityLeave', 'childcareLeave', 'careLeave', 'resigned']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  lastDocId: z.string().optional(),
});

export type EmployeeListInput = z.output<typeof EmployeeListSchema>;
