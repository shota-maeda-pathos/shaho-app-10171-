import { attachmentChecklist, attachmentError, MAX_FILE_BYTES, missingRequired, safeFileName, sniffContentType } from './rules';

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

describe('受け付けるファイル', () => {
  it('先頭のバイトで種類を見分ける', () => {
    expect(sniffContentType(pdf)).toBe('application/pdf');
    expect(sniffContentType(png)).toBe('image/png');
    expect(sniffContentType(jpg)).toBe('image/jpeg');
    expect(sniffContentType(new TextEncoder().encode('<html>'))).toBeNull();
  });

  it('大きさ・件数・種類を確かめる', () => {
    expect(attachmentError({ name: 'a.pdf', bytes: pdf, existing: 0 })).toBeNull();
    expect(attachmentError({ name: 'a.pdf', bytes: new Uint8Array(MAX_FILE_BYTES + 1), existing: 0 })).toContain('5MBまで');
    expect(attachmentError({ name: 'a.pdf', bytes: pdf, existing: 20 })).toContain('20ファイル');
    expect(attachmentError({ name: 'a.exe', bytes: new Uint8Array([0x4d, 0x5a, 1]), existing: 0 })).toContain('PDF・JPEG・PNG');
    expect(attachmentError({ name: 'a.pdf', bytes: new Uint8Array(), existing: 0 })).toContain('空');
  });

  it('ファイル名からパスに使えない文字を除く', () => {
    expect(safeFileName('../課税証明書:2026.pdf')).toBe('.._課税証明書_2026.pdf');
    expect(safeFileName('   ')).toBe('file');
  });
});

describe('必要書類のチェックリスト', () => {
  it('扶養：別居の家族を入れるときは仕送りの書類が原則必要', () => {
    const items = attachmentChecklist('dependentChange', { 被扶養者一覧: [
      { 異動の種別: '該当', 続柄: '父母', 同居別居: '別居' },
      { 異動の種別: '非該当', 続柄: '子', 同居別居: '同居' },
    ] });
    expect(items.map(i => i.key)).toEqual(['relationship', 'income', 'remittance', 'dependentCard']);
    expect(missingRequired(items, []).map(i => i.key)).toEqual(['remittance']);
    expect(missingRequired(items, ['remittance'])).toEqual([]);
  });

  it('扶養：同居が要件の続柄は住民票', () => {
    expect(attachmentChecklist('dependentChange', { 被扶養者一覧: [{ 異動の種別: '該当', 続柄: 'その他の親族', 同居別居: '同居' }] }).map(i => i.key)).toContain('residence');
  });

  it('喪失届は保険証、取得届の再雇用は書類が原則必要', () => {
    expect(attachmentChecklist('lossNotification', {})[0].key).toBe('insuranceCard');
    expect(attachmentChecklist('acquisitionNotification', { 備考: '退職後の継続再雇用者の取得' })[0].need).toBe('required');
    expect(attachmentChecklist('acquisitionNotification', {})).toEqual([]);
  });

  it('訂正届は元の届出の種類で案内を変える', () => {
    expect(attachmentChecklist('correction', {}, { filingType: 'acquisitionNotification' })[0].note).toContain('取得日・喪失日');
  });
});
