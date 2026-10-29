import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { monthlyStatus, setHold, executeMonthlyAction } from './service';

const id = z.string().min(1).max(200).regex(/^[^/]+$/);
const base = z.object({companyId:id,officeId:id,yearMonth:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)});
const statusSchema=base.extend({cursor:id.optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
const holdSchema=base.extend({employeeId:id,reason:z.string().trim().min(1).max(500).nullable(),expectedVersion:z.number().int().min(0)}).strict();
const actionSchema=base.extend({action:z.enum(['calculate','requestApproval','publish','createCollection']),employeeIds:z.array(id).min(1).max(100),requestId:z.string().uuid()}).strict();
export const operationsMonthlyStatus=onCall(async request=>{
  const input=validate(statusSchema,request.data); const auth=await getAuthContext(request,input.companyId);
  requireRole(auth,'admin','operator'); return monthlyStatus(input,auth);
});
export const operationsMonthlyHold=onCall(async request=>{
  const input=validate(holdSchema,request.data); const auth=await getAuthContext(request,input.companyId);
  requireRole(auth,'admin','operator'); return setHold(input,auth);
});
export const operationsMonthlyAction=onCall({timeoutSeconds:300},async request=>{
  const input=validate(actionSchema,request.data); const auth=await getAuthContext(request,input.companyId);
  requireRole(auth,'admin','operator'); return executeMonthlyAction(input,auth);
});
