import { z } from 'zod';

const id = z.string().min(1).regex(/^[^/]+$/);
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const GradeCorrectionStartSchema = z.object({ companyId: id, employeeId: id });
export const GradeCorrectionGetSchema = z.object({ companyId: id, procedureId: id });
export const GradeCorrectionPreviewSchema = z.object({
  companyId: id, procedureId: id, effectiveMonth: yearMonth, healthGradeNumber: z.number().int().min(1).max(60), pensionGradeNumber: z.number().int().min(1).max(40),
});

const Base = { companyId: id, procedureId: id, expectedVersion: z.number().int().min(1) };
export const GradeCorrectionEntrySchema = z.object({
  ...Base, effectiveMonth: yearMonth, healthGradeNumber: z.number().int().min(1).max(60), pensionGradeNumber: z.number().int().min(1).max(40),
  reasonType: z.enum(['pensionOffice', 'error']), reason: z.string().trim().min(1).max(300),
});
export const GradeCorrectionCorrectSchema = z.object({ ...Base });
export const GradeCorrectionSettleSchema = z.object({
  ...Base, method: z.enum(['nextPayroll', 'separate', 'none']), payMonth: yearMonth.nullable().default(null), note: z.string().trim().max(300).default(''),
});
