import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { portalOverviewSchema, portalPayslipGetSchema } from './schema';
import { getPortalOverview, getPortalPayslip } from './service';
export const portalOverview = onCall(async request => {
 const input = validate(portalOverviewSchema, request.data);
 return getPortalOverview(input, await getAuthContext(request, input.companyId));
});
export const portalPayslipGet = onCall(async request => {
 const input = validate(portalPayslipGetSchema, request.data);
 return getPortalPayslip(input, await getAuthContext(request, input.companyId));
});
