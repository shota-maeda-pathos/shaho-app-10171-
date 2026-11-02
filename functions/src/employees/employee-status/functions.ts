import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { AbsenceSaveSchema, EmployeeStatusGetSchema } from './schema';
import { getEmployeeStatus, saveAbsence } from './service';

/** 在籍ステータス（今の状態と日付つきの履歴） */
export const employeeStatusGet = onCall(async (request) => {
  const input = validate(EmployeeStatusGetSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return getEmployeeStatus(input, auth);
});

/** 休職の記録（傷病休職・私傷病）を足す・直す・消す */
export const employeeAbsenceSave = onCall(async (request) => {
  const input = validate(AbsenceSaveSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return saveAbsence(input, auth);
});
