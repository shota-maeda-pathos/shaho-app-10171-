import { onCall } from 'firebase-functions/v2/https';
import { employeeExportSchema } from './schema';
import { exportEmployees } from './service';
import { getAuthContext, requireRole } from '../../middleware/auth';

export const employeeExport = onCall(
  { region: 'us-central1' },
  async (request) => {
    const input = employeeExportSchema.parse(request.data);
    const auth = await getAuthContext(request, input.companyId);
    requireRole(auth, 'admin', 'operator');
    return exportEmployees(input, auth);
  },
);
