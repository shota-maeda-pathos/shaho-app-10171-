import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { getCalendar, getChecklist, getReminderDays, setChecklistItem, setReminderDays } from './service';

const companyId = z.string().min(1);
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const calendarGet = onCall(async request => {
  const input = validate(z.object({ companyId, year: z.number().int().min(2000).max(2100) }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver', 'viewer');
  return getCalendar(auth, input.year);
});

export const checklistGet = onCall(async request => {
  const input = validate(z.object({ companyId, yearMonth: ym }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return { ...await getChecklist(auth, input.yearMonth), reminderDays: await getReminderDays(input.companyId) };
});

export const checklistSet = onCall(async request => {
  const input = validate(z.object({ companyId, yearMonth: ym, key: z.string().min(1).max(40), done: z.boolean() }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator');
  return setChecklistItem(auth, input.yearMonth, input.key, input.done);
});

export const reminderSettingsUpdate = onCall(async request => {
  const input = validate(z.object({ companyId, daysBefore: z.number().int().min(1).max(60) }), request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin');
  return setReminderDays(auth, input.daysBefore);
});
