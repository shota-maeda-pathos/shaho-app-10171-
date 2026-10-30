import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();

// 関数は Firestore と同じ東京で動かす（関数ごとに region を書かない）
setGlobalOptions({ region: 'asia-northeast1' });

export const db = getFirestore();
