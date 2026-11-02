import { onCall } from 'firebase-functions/v2/https';
import { auditAccess } from '../../utils/audit';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { FilingPdfDataSchema } from './schema';
import { getFilingPdfData } from './service';

export const filingPdfData = onCall(async (request) => {
  const input = validate(FilingPdfDataSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  // 届出の記入内容（氏名・生年月日・住所など）は閲覧者には出さない（閲覧者は集計・帳票だけ）
  requireRole(auth, 'admin', 'operator', 'approver');
  const data = await getFilingPdfData(input, auth);
  await auditAccess(auth, 'filing', input.filingId, 'pdfGenerate', { employeeId: input.employeeId });
  return data;
});
