import { z } from 'zod';
import { corporateNumberField, insurerIdField } from '../../types/catalog-schemas';

export const CompanyUpdateSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  corporateNumber: corporateNumberField.optional(),
  representativeName: z.string().max(100).optional(),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  healthInsurerId: insurerIdField.optional(),
  pensionCode: z.string().max(20).optional(),
  postalCode: z.string().regex(/^\d{3}-?\d{4}$/).optional(),
  /** 特定適用事業所（厚生年金の被保険者数が基準以上の法人）か。未設定の間は短時間労働者の適用を担当者判断とする */
  specificApplicableOffice: z.boolean().nullable().optional(),
  laborConsultant: z.object({ name: z.string().min(1).max(100), registrationNumber: z.string().min(1).max(20) }).nullable().optional(),
  /** Google ログインを許可するドメイン（例：example.com）。空なら招待された人はどの Google アカウントでも可 */
  allowedGoogleDomains: z.array(z.string().trim().toLowerCase().regex(/^@?[a-z0-9.-]+\.[a-z]{2,}$/, 'ドメインの形式が違います')).max(20).optional(),
  expectedVersion: z.number().int().min(1),
});

export type CompanyUpdateInput = z.infer<typeof CompanyUpdateSchema>;
