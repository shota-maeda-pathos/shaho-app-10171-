import { AuthContext } from '../middleware/auth';
import { MutationResponse } from '../types/response';
import { invalidArg } from '../utils/errors';
import { findGradeByNumber, resolveGradeTable } from '../insurance/calculator';
import { createApprovalRequest } from '../approvals/approval-request-create/service';

/**
 * 等級の手入力（作成・訂正）を承認申請にする。承認されると等級が確定する。
 * 標準報酬月額は画面の値を使わず、等級番号から公式の等級表で決める。
 */
export async function requestManualGrade(params: {
  companyId: string;
  employeeId: string;
  effectiveMonth: string;
  healthGradeNumber: number;
  pensionGradeNumber: number;
  determinationType: string;
  reason?: string;
}, auth: AuthContext): Promise<MutationResponse & { pendingApproval: true }> {
  if (!params.reason?.trim()) throw invalidArg('等級を手入力する理由を入力してください');
  const health = findGradeByNumber(resolveGradeTable('health'), params.healthGradeNumber);
  const pension = findGradeByNumber(resolveGradeTable('pension'), params.pensionGradeNumber);
  if (!health || !pension) throw invalidArg('等級の番号が等級表にありません');
  const { id } = await createApprovalRequest({
    companyId: params.companyId,
    employeeId: params.employeeId,
    targetPath: `companies/${auth.companyId}/employees/${params.employeeId}/grades/${params.effectiveMonth}`,
    targetVersion: 0,
    requestType: 'grade',
    comment: params.reason,
    metadata: {
      effectiveMonth: params.effectiveMonth,
      determinationType: params.determinationType,
      healthGradeNumber: health.gradeNumber,
      healthStandardRemuneration: health.standardRemuneration,
      pensionGradeNumber: pension.gradeNumber,
      pensionStandardRemuneration: pension.standardRemuneration,
      reason: `手入力：${params.reason.trim()}`,
      source: 'manual',
    },
  }, auth);
  return { success: true, id, pendingApproval: true };
}
