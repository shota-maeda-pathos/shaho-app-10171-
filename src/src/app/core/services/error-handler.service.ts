import { ErrorHandler, Injectable, inject, NgZone } from '@angular/core';
import { NotificationService } from './notification.service';

const ERROR_MESSAGES: Record<string, string> = {
  'not-found': 'データが見つかりません',
  'permission-denied': '権限がありません',
  'unauthenticated': 'ログインが必要です',
  'already-exists': 'データが既に存在します',
  'failed-precondition': '操作の前提条件を満たしていません',
  'invalid-argument': '入力内容に誤りがあります',
  'resource-exhausted': 'リクエスト制限に達しました。しばらくお待ちください',
  'internal': 'サーバーエラーが発生しました',
  'unavailable': 'サーバーに接続できません。ネットワークを確認してください',
  'deadline-exceeded': '処理がタイムアウトしました',
};

const CHUNK_RELOAD_KEY = 'chunk-reload-at';

function isChunkLoadError(error: any): boolean {
  const message = String(error?.rejection?.message ?? error?.message ?? '');
  // Chrome / Firefox / Safari でそれぞれ文言が違う
  return /dynamically imported module|Importing a module script failed/i.test(message);
}

/** 直近10秒以内に読み込み直していなければ読み込み直して true。ループを防ぐ */
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private notification = inject(NotificationService);
  private zone = inject(NgZone);

  handleError(error: any): void {
    // デプロイで古い chunk が消えたあと、開いたままのタブが画面を移ると読み込めない。1回だけ読み込み直す
    if (isChunkLoadError(error) && reloadOnce()) return;

    const message = this.extractMessage(error);
    this.zone.run(() => {
      this.notification.error(message);
    });
    console.error('Unhandled error:', error);
  }

  private extractMessage(error: any): string {
    if (error?.rejection) {
      error = error.rejection;
    }

    const code = error?.code ?? error?.details?.code;
    if (code && typeof code === 'string') {
      const cleanCode = code.replace('functions/', '');
      if (ERROR_MESSAGES[cleanCode]) {
        return ERROR_MESSAGES[cleanCode];
      }
    }

    if (error?.message && typeof error.message === 'string') {
      if (error.message.length < 100) return error.message;
    }

    return '予期しないエラーが発生しました';
  }
}
