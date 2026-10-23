import { HttpsError } from 'firebase-functions/v2/https';

export function notFound(entity: string): HttpsError {
  return new HttpsError('not-found', `${entity}が見つかりません`);
}

export function alreadyExists(entity: string): HttpsError {
  return new HttpsError('already-exists', `${entity}は既に存在します`);
}

export function invalidArg(message: string): HttpsError {
  return new HttpsError('invalid-argument', message);
}
