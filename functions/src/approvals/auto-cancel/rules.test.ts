import { changeReason, changedFields, COMPANY_FILING_FIELDS, EMPLOYEE_FILING_FIELDS } from './rules';

describe('承認の自動取消のきっかけ', () => {
  it('届出に載る項目が変わったときだけ数える', () => {
    expect(changedFields({ name: 'A社', phone: '03', version: 1 }, { name: 'B社', phone: '03', version: 2 }, COMPANY_FILING_FIELDS)).toEqual(['name']);
    expect(changedFields({ name: 'A社', updatedAt: 1 }, { name: 'A社', updatedAt: 2 }, COMPANY_FILING_FIELDS)).toEqual([]);
  });

  it('空欄・未設定・null は同じとみなす', () => {
    expect(changedFields({ building: '' }, { building: null }, EMPLOYEE_FILING_FIELDS)).toEqual([]);
    expect(changedFields({}, { building: 'Aビル' }, EMPLOYEE_FILING_FIELDS)).toEqual(['building']);
  });

  it('日付（Timestamp）は値で比べる', () => {
    const ts = (s: string) => ({ toDate: () => new Date(s) });
    expect(changedFields({ birthDate: ts('1990-01-01') }, { birthDate: ts('1990-01-01') }, EMPLOYEE_FILING_FIELDS)).toEqual([]);
    expect(changedFields({ birthDate: ts('1990-01-01') }, { birthDate: ts('1990-01-02') }, EMPLOYEE_FILING_FIELDS)).toEqual(['birthDate']);
  });

  it('作られた・消されたときは数えない', () => {
    expect(changedFields(undefined, { name: 'A' }, COMPANY_FILING_FIELDS)).toEqual([]);
  });

  it('理由の文に変わった項目の名前を書く', () => {
    expect(changeReason('会社情報', ['name', 'representativeName'])).toContain('会社名・代表者が変わったため');
  });
});
