import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthContext, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { bulkTodo, listHomeTodos } from './service';

const id = z.string().min(1).max(200).regex(/^[^/]+$/);
const HomeTodosSchema = z.object({ companyId: id, officeId: id.optional(), deferBulk: z.boolean().default(false) }).strict();
const HomeBulkTodoSchema = z.object({
  companyId: id,
  kind: z.enum(['monthly', 'santei', 'bonus']),
  officeId: id,
  period: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/),
}).strict();

/** ホームのやることリスト（deferBulk なら、毎月の処理・算定・賞与は対象だけ返す） */
export const homeTodos = onCall(async (request) => {
  const input = validate(HomeTodosSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return listHomeTodos(auth, input.officeId, input.deferBulk);
});

/**
 * ホームの一括型の手続き1件（事業所×月）の次にやること。ホームが件数分を同時に呼ぶ。
 * 1件に数秒かかる計算のため、1つのインスタンスで1件ずつ処理して、同時に呼ばれた分は別のインスタンスで並べて計算させる
 */
export const homeBulkTodo = onCall({ concurrency: 1, maxInstances: 30 }, async (request) => {
  const input = validate(HomeBulkTodoSchema, request.data);
  const auth = await getAuthContext(request, input.companyId);
  requireRole(auth, 'admin', 'operator', 'approver');
  return { item: await bulkTodo(auth, { kind: input.kind, officeId: input.officeId, period: input.period }) };
});
