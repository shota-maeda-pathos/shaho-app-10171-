import { makeAuth, makeInsuranceRateDoc } from '../../__tests__/helpers';

const healthRate = makeInsuranceRateDoc({
  insuranceType: 'health',
  totalRate: 99.8,
  employeeRate: 49.9,
  employerRate: 49.9,
});

const pensionRate = makeInsuranceRateDoc({
  insuranceType: 'pension',
  totalRate: 183.0,
  employeeRate: 91.5,
  employerRate: 91.5,
  appliedFrom: '2026-04',
});

const mockQueryDocs = jest.fn<any, any[]>();

jest.mock('../../config', () => {
  const buildQuery = () => {
    const q: any = {
      where: jest.fn(() => buildQuery()),
      orderBy: jest.fn(() => buildQuery()),
      get: mockQueryDocs,
    };
    return q;
  };

  return {
    db: {
      collection: jest.fn(() => buildQuery()),
    },
  };
});

import { listInsuranceRates } from './service';

beforeEach(() => {
  mockQueryDocs.mockResolvedValue({
    docs: [
      { id: 'health-kyokai-13-2026-04', data: () => healthRate },
      { id: 'pension-kyokai-13-2026-04', data: () => pensionRate },
    ],
  });
});

describe('listInsuranceRates', () => {
  it('admin は全保険料率を取得できる', async () => {
    const auth = makeAuth({ roles: ['admin'] });
    const result = await listInsuranceRates(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].insuranceType).toBe('health');
    expect(result.items[0].totalRate).toBe(99.8);
    expect(result.items[1].insuranceType).toBe('pension');
  });

  it('レスポンスに料率フィールドが正しく含まれる', async () => {
    mockQueryDocs.mockResolvedValue({
      docs: [{ id: 'health-kyokai-13-2026-04', data: () => healthRate }],
    });

    const auth = makeAuth();
    const result = await listInsuranceRates(
      { companyId: 'company-001' },
      auth,
    );

    const item = result.items[0];
    expect(item.employeeRate).toBe(49.9);
    expect(item.employerRate).toBe(49.9);
    expect(item.appliedFrom).toBe('2026-04');
    expect(item.appliedUntil).toBeNull();
    expect(item.prefectureCode).toBe('13');
  });

  it('等級テーブルが含まれる場合、正しく返される', async () => {
    const withGrades = makeInsuranceRateDoc({
      gradeTable: [
        { gradeNumber: 1, standardRemuneration: 58000, lowerBound: 0, upperBound: 63000 },
        { gradeNumber: 2, standardRemuneration: 68000, lowerBound: 63000, upperBound: 73000 },
      ],
    });
    mockQueryDocs.mockResolvedValue({
      docs: [{ id: 'health-kyokai-13-2026-04', data: () => withGrades }],
    });

    const auth = makeAuth();
    const result = await listInsuranceRates(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items[0].gradeTable).toHaveLength(2);
    expect(result.items[0].gradeTable![0].standardRemuneration).toBe(58000);
  });
});
