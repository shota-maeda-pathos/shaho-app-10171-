import { onCall } from 'firebase-functions/v2/https';
import { auditAccess } from '../../utils/audit';
import { employeeExportSchema } from './schema';
import { exportEmployees } from './service';
import { getAuthContext, requireRole } from '../../middleware/auth';

export const employeeExport = onCall(
  async (request) => {
    const input = employeeExportSchema.parse(request.data);
    const auth = await getAuthContext(request, input.companyId);
    requireRole(auth, 'admin', 'operator');
    const data = await exportEmployees(input, auth);
    await auditAccess(auth, 'employee', 'export', 'csvExport', { ...input, companyId: undefined });
    return data;
  },
);
