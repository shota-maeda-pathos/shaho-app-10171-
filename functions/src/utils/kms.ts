import { KeyManagementServiceClient } from '@google-cloud/kms';

// 個人番号の鍵は Cloud KMS（Firebase の外）に置く。鍵は関数の実行アカウントだけが使える
const KEY_NAME =
  'projects/kensyu10171/locations/asia-northeast1/keyRings/shaho/cryptoKeys/my-number';

let client: KeyManagementServiceClient | null = null;
function kms(): KeyManagementServiceClient {
  client ??= new KeyManagementServiceClient();
  return client;
}

/** 暗号文をどの記録のものかに結びつける（別の従業員の記録に写しても復号できない） */
function aad(companyId: string, employeeId: string): Buffer {
  return Buffer.from(`${companyId}/employees/${employeeId}/myNumber`);
}

export async function encryptMyNumber(
  companyId: string,
  employeeId: string,
  plain: string,
): Promise<string> {
  const [res] = await kms().encrypt({
    name: KEY_NAME,
    plaintext: Buffer.from(plain),
    additionalAuthenticatedData: aad(companyId, employeeId),
  });
  return Buffer.from(res.ciphertext as Uint8Array).toString('base64');
}

export async function decryptMyNumber(
  companyId: string,
  employeeId: string,
  cipher: string,
): Promise<string> {
  const [res] = await kms().decrypt({
    name: KEY_NAME,
    ciphertext: Buffer.from(cipher, 'base64'),
    additionalAuthenticatedData: aad(companyId, employeeId),
  });
  return Buffer.from(res.plaintext as Uint8Array).toString();
}
