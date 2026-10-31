import { Timestamp } from 'firebase-admin/firestore';
import { makeAuth, makeEmployeeDoc } from '../../__tests__/helpers';

const emp1 = makeEmployeeDoc({ employeeNumber: 'EMP-001', lastNameKana: 'アオキ' });
const emp2 = makeEmployeeDoc({ employeeNumber: 'EMP-002', lastNameKana: 'イトウ' });
const emp3 = makeEmployeeDoc({ employeeNumber: 'EMP-003', lastNameKana: 'ウエダ', isActive: false, resignationDate: Timestamp.now() });

const mockQueryDocs = jest.fn<any, any[]>();
const mockCountGet = jest.fn<any, any[]>();
let capturedQueries: string[] = [];
/** 検索（getAll）で全項目を返す従業員 */
let fullDocs: Record<string, any> = {};

jest.mock('../../config', () => {
  const buildQuery = () => {
    const q: any = {
      where: jest.fn((...args: any[]) => {
        capturedQueries.push(`where:${args[0]}:${args[1]}:${args[2]}`);
        return buildQuery();
      }),
      orderBy: jest.fn((...args: any[]) => {
        capturedQueries.push(`orderBy:${args[0]}`);
        return buildQuery();
      }),
      select: jest.fn(() => buildQuery()),
      startAfter: jest.fn(() => buildQuery()),
      limit: jest.fn(() => buildQuery()),
      count: jest.fn(() => ({
        get: mockCountGet,
      })),
      get: mockQueryDocs,
    };
    return q;
  };

  return {
    db: {
      collection: jest.fn(() => buildQuery()),
      doc: jest.fn((path: string) => ({
        path,
        id: path.split('/').pop(),
        get: jest.fn(async () => ({ exists: false })),
      })),
      getAll: jest.fn(async (...refs: any[]) => refs.map((r) => ({
        id: r.id,
        exists: !!fullDocs[r.id],
        data: () => fullDocs[r.id],
      }))),
    },
  };
});

import { listEmployees, matchesKeyword, normalizeSearchText } from './service';

beforeEach(() => {
  capturedQueries = [];
  mockCountGet.mockResolvedValue({ data: () => ({ count: 2 }) });
  mockQueryDocs.mockResolvedValue({
    docs: [
      { id: 'emp-1', data: () => emp1 },
      { id: 'emp-2', data: () => emp2 },
    ],
  });
});

describe('listEmployees', () => {
  it('生年月日が未入力の従業員がいても一覧全体を取得できる', async () => {
    mockQueryDocs.mockResolvedValue({
      docs: [
        { id: 'emp-1', data: () => emp1 },
        { id: 'emp-2', data: () => ({ ...makeEmployeeDoc(), birthDate: null }) },
      ],
    });

    const result = await listEmployees({ companyId: 'company-001' }, makeAuth({ roles: ['admin'] }));

    expect(result.items).toHaveLength(2);
    expect(result.items[0].birthDate).toBe('1990-01-15');
    expect(result.items[1].birthDate).toBe('');
  });

  it('admin は全事業所の従業員を取得できる', async () => {
    const auth = makeAuth({ roles: ['admin'] });
    const result = await listEmployees(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it('担当事業所が空の operator は空の一覧を返す', async () => {
    const auth = makeAuth({ roles: ['operator'], officeIds: [] });
    const result = await listEmployees(
      { companyId: 'company-001' },
      auth,
    );

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('hasMore が正しく判定される', async () => {
    mockCountGet.mockResolvedValue({ data: () => ({ count: 25 }) });
    const threeDocs = [
      { id: 'emp-1', data: () => emp1 },
      { id: 'emp-2', data: () => emp2 },
      { id: 'emp-3', data: () => emp3 },
    ];
    mockQueryDocs.mockResolvedValue({ docs: threeDocs });

    const auth = makeAuth();
    const result = await listEmployees(
      { companyId: 'company-001', limit: 2 },
      auth,
    );

    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(2);
  });
});

describe('検索語の照合', () => {
  const row = { employeeNumber: 'TEST-014', lastName: '岩貞', firstName: '祐太', lastNameKana: 'イワサダ', firstNameKana: 'ユウタ' };

  it('ひらがな・全角英数・空白の違いをそろえる', () => {
    expect(normalizeSearchText(' いわ さだ ')).toBe('イワサダ');
    expect(normalizeSearchText('ＴＥＳＴ－０１４')).toBe('test-014');
    expect(normalizeSearchText('ｲﾜｻﾀﾞ')).toBe('イワサダ');
  });

  it('氏名・カナ・社員番号のどれかに含まれれば当たる', () => {
    expect(matchesKeyword(row, '岩貞 祐太')).toBe(true);
    expect(matchesKeyword(row, '貞祐')).toBe(true);
    expect(matchesKeyword(row, 'いわさだ')).toBe(true);
    expect(matchesKeyword(row, 'サダユウ')).toBe(true);
    expect(matchesKeyword(row, 'test-01')).toBe(true);
    expect(matchesKeyword(row, '014')).toBe(true);
    expect(matchesKeyword(row, '前田')).toBe(false);
  });
});

describe('listEmployees（検索語あり）', () => {
  const docsOf = (list: [string, any][]) => ({ docs: list.map(([id, d]) => ({ id, data: () => d })) });
  const people: [string, any][] = [
    ['e-ueda', makeEmployeeDoc({ employeeNumber: 'EMP-003', lastName: '上田', lastNameKana: 'ウエダ', firstNameKana: 'ハナコ' })],
    ['e-aoki', makeEmployeeDoc({ employeeNumber: 'EMP-001', lastName: '青木', lastNameKana: 'アオキ', firstNameKana: 'ハナコ' })],
    ['e-aoki2', makeEmployeeDoc({ employeeNumber: 'EMP-002', lastName: '青木', lastNameKana: 'アオキ', firstNameKana: 'イチロウ', departmentId: 'dept-1' })],
    ['e-resigned', makeEmployeeDoc({ employeeNumber: 'EMP-004', lastName: '青山', lastNameKana: 'アオヤマ', isActive: false })],
    ['e-deleted', makeEmployeeDoc({ employeeNumber: 'EMP-005', lastName: '青田', lastNameKana: 'アオタ', deletedAt: Timestamp.now() })],
  ];

  beforeEach(() => {
    fullDocs = Object.fromEntries(people);
    mockCountGet.mockClear();
    mockQueryDocs.mockResolvedValue(docsOf(people));
  });

  it('複合索引の要る条件を使わず、メモリで絞ってカナ順に返す', async () => {
    const result = await listEmployees({ companyId: 'company-001', keyword: 'あお' }, makeAuth({ roles: ['admin'] }));

    expect(capturedQueries).toEqual([]);
    expect(mockCountGet).not.toHaveBeenCalled();
    expect(result.items.map((e) => e.id)).toEqual(['e-aoki2', 'e-aoki']);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it('退職者を含める・部署で絞る', async () => {
    const withResigned = await listEmployees({ companyId: 'company-001', keyword: '青', includeResigned: true }, makeAuth({ roles: ['admin'] }));
    expect(withResigned.items.map((e) => e.id)).toEqual(['e-aoki2', 'e-aoki', 'e-resigned']);

    const inDept = await listEmployees({ companyId: 'company-001', keyword: '青', departmentId: 'dept-1' }, makeAuth({ roles: ['admin'] }));
    expect(inDept.items.map((e) => e.id)).toEqual(['e-aoki2']);
  });

  it('社員番号でも探せる', async () => {
    const result = await listEmployees({ companyId: 'company-001', keyword: 'emp-003' }, makeAuth({ roles: ['admin'] }));
    expect(result.items.map((e) => e.id)).toEqual(['e-ueda']);
  });

  it('lastDocId の続きから limit 件ずつ返す', async () => {
    const auth = makeAuth({ roles: ['admin'] });
    const first = await listEmployees({ companyId: 'company-001', keyword: 'emp', limit: 2 }, auth);
    expect(first.items.map((e) => e.id)).toEqual(['e-aoki2', 'e-aoki']);
    expect(first.total).toBe(3);
    expect(first.hasMore).toBe(true);
    expect(first.lastDocId).toBe('e-aoki');

    const second = await listEmployees({ companyId: 'company-001', keyword: 'emp', limit: 2, lastDocId: first.lastDocId }, auth);
    expect(second.items.map((e) => e.id)).toEqual(['e-ueda']);
    expect(second.hasMore).toBe(false);
  });

  it('admin 以外は担当事業所ごとに等価条件だけで読む', async () => {
    mockQueryDocs
      .mockResolvedValueOnce(docsOf([people[1]]))
      .mockResolvedValueOnce(docsOf([people[2]]));
    const result = await listEmployees(
      { companyId: 'company-001', keyword: 'アオキ' },
      makeAuth({ roles: ['operator'], officeIds: ['office-001', 'office-002'] }),
    );

    expect(capturedQueries).toEqual(['where:officeId:==:office-001', 'where:officeId:==:office-002']);
    expect(result.items.map((e) => e.id)).toEqual(['e-aoki2', 'e-aoki']);
  });

  it('事業所を指定したらその事業所だけを読む', async () => {
    await listEmployees({ companyId: 'company-001', officeId: 'office-001', keyword: 'アオキ' }, makeAuth({ roles: ['admin'] }));
    expect(capturedQueries).toEqual(['where:officeId:==:office-001']);
  });
});
