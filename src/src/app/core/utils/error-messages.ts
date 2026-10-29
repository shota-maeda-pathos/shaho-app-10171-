export function toJapaneseError(error: unknown): string {
  const msg = (error as any)?.message ?? String(error);

  if (msg.includes('permission-denied') || msg.includes('PERMISSION_DENIED'))
    return '権限がありません。管理者にお問い合わせください。';
  if (msg.includes('not-found'))
    return '対象のデータが見つかりませんでした。';
  if (msg.includes('already-exists'))
    return '同じデータが既に存在しています。';
  if (msg.includes('failed-precondition'))
    return 'データが他のユーザーによって更新されています。画面を再読み込みしてください。';
  if (msg.includes('unauthenticated'))
    return 'ログインが必要です。再度ログインしてください。';
  if (msg.includes('resource-exhausted'))
    return 'リクエスト制限に達しました。しばらくしてから再試行してください。';
  if (msg.includes('unavailable'))
    return 'サーバーに接続できません。ネットワーク接続を確認してください。';
  if (msg.includes('deadline-exceeded'))
    return '処理がタイムアウトしました。再試行してください。';

  const serverMsg = (error as any)?.details?.message ?? (error as any)?.customData?.serverResponse;
  if (serverMsg && typeof serverMsg === 'string') return serverMsg;

  if (msg.startsWith('承認') || msg.startsWith('従業員') || msg.includes('バージョン') || msg.includes('版番号'))
    return msg;

  return '予期しないエラーが発生しました。時間をおいて再試行してください。';
}
