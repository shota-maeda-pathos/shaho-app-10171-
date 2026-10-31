import { DRAFT_MAX_CHARS, draftError } from './draft';

describe('draftError', () => {
  it('ふつうの入力は下書きにできる', () => {
    expect(draftError({ employeeNumber: '0001', profile: { lastName: '山田' } })).toBeNull();
  });

  it('大きすぎる入力は断る', () => {
    expect(draftError({ text: 'あ'.repeat(DRAFT_MAX_CHARS) })).toBe('下書きが大きすぎます');
  });

  it('JSON にできないものは断る', () => {
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    expect(draftError(loop)).toBe('下書きにできない内容です');
    expect(draftError(undefined)).toBe('下書きにできない内容です');
  });
});
