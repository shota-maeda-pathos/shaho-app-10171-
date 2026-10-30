import { readFileSync } from 'fs';
import { join } from 'path';
import { buildArchive, FORM_FILE, FORM_VERSIONS } from './rules';

describe('同梱した様式の版', () => {
  it('sources.json と同じ値（様式を差し替えたら両方を直す）', () => {
    const sources = JSON.parse(readFileSync(join(__dirname, '../../../../src/public/filing-forms/sources.json'), 'utf-8')) as Record<string, { checkedOn: string; sha256: string }>;
    for (const [file, v] of Object.entries(FORM_VERSIONS)) {
      expect(sources[file]).toMatchObject({ checkedOn: v.checkedOn, sha256: v.sha256 });
    }
    for (const file of Object.values(FORM_FILE)) expect(FORM_VERSIONS[file]).toBeDefined();
  });
});

describe('保存原本', () => {
  it('従業員の届出：記入内容と事業所の情報、様式の版を残す', () => {
    const a = buildArchive({
      source: 'employee', approvedBy: 'u2', approvalRequestId: 'r1',
      data: { filingType: 'lossNotification', formData: { 被保険者氏名: '山田' }, effectiveDate: '2026-12-01', version: 3 },
      company: { name: 'A社', representativeName: '代表 一郎' }, office: { name: '本社', officeNumber: '00-ケイト', address: '東京', phone: '03-1-2' },
      employee: { employeeNumber: 'E-1' },
    });
    expect(a).toMatchObject({
      formType: 'lossNotification', formData: { 被保険者氏名: '山田' }, filingVersion: 3, approvalRequestId: 'r1',
      meta: { companyName: 'A社', officeName: '本社', officeNumber: '00-ケイト', effectiveDate: '2026-12-01', employeeNumber: 'E-1' },
      form: { file: 'loss', checkedOn: '2026-10-28' },
    });
    expect(a.contentHash).toHaveLength(64);
  });

  it('訂正届は元の届出の様式、算定基礎届は header から事業所の情報', () => {
    expect(buildArchive({ source: 'employee', approvedBy: 'u', data: { filingType: 'correction', originalFilingType: 'acquisitionNotification', formData: {} } }).form?.file).toBe('acquisition');
    const s = buildArchive({ source: 'santei', approvedBy: 'u', data: { filingType: 'remunerationMonthlyAlgorithm', header: { 事業所名称: '大阪', 会社名: 'A社' }, persons: [{ a: 1 }] } });
    expect(s.meta).toMatchObject({ officeName: '大阪', companyName: 'A社' });
    expect(s.persons).toHaveLength(1);
  });
});
