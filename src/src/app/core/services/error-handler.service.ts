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

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private notification = inject(NotificationService);
  private zone = inject(NgZone);

  handleError(error: any): void {
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
