import { z } from 'zod';

export const ProcedureTypeEnum = z.enum([
  'acquisition',
  'loss',
  'dependent_change',
  'maternity_leave',
  'childcare_leave',
  'monthly_change',
  'annual_review',
  'bonus_payment',
  'transfer',
  'age_event',
]);

export const ProcedureCreateSchema = z.object({
  companyId: z.string().min(1),
  procedureType: ProcedureTypeEnum,
  employeeId: z.string().optional(),
  employeeName: z.string().min(1),
  officeId: z.string().min(1),
  targetOfficeId: z.string().optional(),
  scope: z.enum(['individual', 'batch']).optional().default('individual'),
  batchMeta: z.object({
    targetYearMonth: z.string().regex(/^\d{4}-\d{2}$/),
    targetEmployeeIds: z.array(z.string()),
  }).optional(),
  invitationId: z.string().optional(),
  onboardToken: z.string().optional(),
  effectiveDate: z.string().optional(),
  deadline: z.string().optional(),
  assignedTo: z.string().optional(),
  priority: z.enum(['high', 'normal', 'low']).optional().default('normal'),
  notes: z.string().optional().default(''),
});

export type ProcedureCreateInput = z.output<typeof ProcedureCreateSchema>;
