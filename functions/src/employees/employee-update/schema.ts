import { z } from 'zod';
import { EmployeeProfileFields } from '../../types/catalog-schemas';

export const EmployeeUpdateSchema = z.object({
  companyId: z.string(),
  employeeId: z.string(),
  expectedVersion: z.number().int(),
  lastName: z.string().min(1).optional(),
  firstName: z.string().min(1).optional(),
  lastNameKana: z.string().min(1).optional(),
  firstNameKana: z.string().min(1).optional(),
  // 画面は YYYY-MM-DD で送る（時刻つきも受け付ける）
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, '日付は YYYY-MM-DD で入力してください').optional(),
  gender: z.enum(['male', 'female']).optional(),
  departmentId: z.string().nullable().optional(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, '日付は YYYY-MM-DD で入力してください').optional(),
  ...EmployeeProfileFields,
});

export type EmployeeUpdateInput = z.infer<typeof EmployeeUpdateSchema>;
