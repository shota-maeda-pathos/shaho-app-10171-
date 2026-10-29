import { HttpsError, onCall } from 'firebase-functions/v2/https';

/**
 * 旧方式の入社登録。適用判定を通らず等級を承認なしで書き込んでいたため廃止した。
 * 入社は onboarding（入社手続きのウィザード）で行う。古い画面から呼ばれた場合に案内を返す。
 */
export const employeeOnboard = onCall(async () => {
  throw new HttpsError('failed-precondition', '入社の登録は「手続きを始める」→「人が入社する」から行ってください');
});
