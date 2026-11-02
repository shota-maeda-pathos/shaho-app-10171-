import { onCall } from 'firebase-functions/v2/https';
import { auditAccess } from '../../utils/audit';
import {
  getAuthContext,
  requireLoginEnabled,
  requireNotSuspended,
  requireRole,
} from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { EmployeeListSchema } from './schema';
import { listEmployees } from './service';

export const employeeList = onCall(async (request) => {
  const input = validate(EmployeeListSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireLoginEnabled(auth);
  requireNotSuspended(auth);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  const data = await listEmployees(input, auth);
  if (input.keyword) await auditAccess(auth, 'employee', 'search', 'search', { keyword: input.keyword });
  // 閲覧者（集計・帳票だけを見る役割）には、個人情報（生年月日・住所・連絡先・年金番号など）を返さない
  if (!auth.roles.some((r) => r === 'admin' || r === 'operator' || r === 'approver')) {
    return { ...data, items: data.items.map(viewerItem) };
  }
  return data;
});

/** 閲覧者に返す1人分：氏名・社員番号・事業所・在籍だけ */
export function viewerItem(e: { id: string; employeeNumber?: string; lastName?: string; firstName?: string; officeId?: string; isActive?: boolean }) {
  return { id: e.id, employeeNumber: e.employeeNumber, lastName: e.lastName, firstName: e.firstName, officeId: e.officeId, isActive: e.isActive };
}
