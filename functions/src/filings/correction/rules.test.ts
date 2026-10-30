import { applyPatch, correctionBlocker, correctionErrors, correctionsOf, editableFields, isSubmittedFiling } from './rules';

const submitted = { filingType: 'acquisitionNotification', workflowStatus: 'approved', mockStatus: 'completed', submissionStatus: 'notSubmitted' };

describe('訂正届・取消届を作れるか', () => {
  it('提出し終えた届出だけ', () => {
    expect(isSubmittedFiling(submitted)).toBe(true);
    expect(isSubmittedFiling({ ...submitted, mockStatus: 'notStarted', submissionStatus: 'accepted' })).toBe(true);
    expect(isSubmittedFiling({ ...submitted, mockStatus: 'notStarted' })).toBe(false);
    expect(correctionBlocker(submitted, 'correction')).toBeNull();
    expect(correctionBlocker({ ...submitted, mockStatus: 'notStarted' }, 'correction')).toContain('承認を取り消して');
  });

  it('取り消し済みの届出・訂正届そのものからは作れない', () => {
    expect(correctionBlocker({ ...submitted, cancelledAt: 1 }, 'cancellation')).toContain('取り消し済み');
    expect(correctionBlocker({ ...submitted, filingType: 'correction' }, 'correction')).toContain('さらに訂正');
  });
});

describe('訂正の記入', () => {
  const original = { 被保険者氏名: '山田 太郎', 報酬月額_合計: 280000, 備考: '', 被扶養者一覧: [{ 氏名: '花子' }] };

  it('一覧（配列）の項目は直せない', () => {
    expect(editableFields(original)).toEqual(['被保険者氏名', '報酬月額_合計', '備考']);
  });

  it('数値だった項目は数値に戻し、元にない項目は受け付けない', () => {
    const r = applyPatch(original, original, { 報酬月額_合計: '300,000円', 被保険者氏名: ' 山田 太朗 ', 存在しない: 'x', 被扶養者一覧: 'x' });
    expect(r.formData).toMatchObject({ 報酬月額_合計: 300000, 被保険者氏名: '山田 太朗' });
    expect(r.rejected).toEqual(['存在しない', '被扶養者一覧']);
    expect(applyPatch(original, original, { 報酬月額_合計: 'abc' }).rejected).toEqual(['報酬月額_合計']);
    expect(applyPatch(original, original, { 報酬月額_合計: '' }).formData['報酬月額_合計']).toBeNull();
  });

  it('訂正箇所は元の届出との差分', () => {
    const { formData } = applyPatch(original, original, { 報酬月額_合計: 300000 });
    expect(correctionsOf(original, formData)).toEqual([{ field: '報酬月額_合計', before: '280,000', after: '300,000' }]);
    expect(correctionsOf(original, original)).toEqual([]);
  });

  it('送信前の確かめ：理由と訂正箇所が要る', () => {
    expect(correctionErrors({ filingType: 'correction', reason: '', corrections: [], formData: { 被保険者氏名: 'a' } })).toEqual(['訂正の理由', '訂正箇所（元の届出から直した項目がありません）']);
    expect(correctionErrors({ filingType: 'cancellation', reason: '二重に届け出たため', formData: { 被保険者氏名: 'a' } })).toEqual([]);
  });
});
