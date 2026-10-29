import { makeAuth } from '../../__tests__/helpers';

const mockCollections = jest.fn();
jest.mock('../../config', () => ({ db: { collection: (...args: unknown[]) => mockCollections(...args) } }));
import { getDashboardStats } from './service';

beforeEach(() => {
  mockCollections.mockReset();
  mockCollections.mockImplementation((path: string) => {
    const query: any = {
      where: jest.fn(() => query), select: jest.fn(() => query), count: jest.fn(() => query),
      get: jest.fn(async () => path.endsWith('/employees') ? {
        docs: [
          { id: 'a', data: () => ({ officeId: 'office-001', isActive: true }) },
          { id: 'b', data: () => ({ officeId: 'office-002', isActive: true }) },
          { id: 'retired', data: () => ({ officeId: 'office-001', isActive: false }) },
        ],
      } : { data: () => ({ count: path.includes('/b/') ? 10 : 1 }) }),
    };
    return query;
  });
});

test('admin counts all offices, including pending work for retired employees', async () => {
  expect(await getDashboardStats(makeAuth())).toEqual({
    employeeCount: 2, pendingApprovals: 12, pendingFilings: 12, activeLeaves: 12, activeExemptions: 12,
  });
});

test('operator counts only assigned offices', async () => {
  expect(await getDashboardStats(makeAuth({ roles: ['operator'] }))).toEqual({
    employeeCount: 1, pendingApprovals: 2, pendingFilings: 2, activeLeaves: 2, activeExemptions: 2,
  });
  expect(mockCollections.mock.calls.some(([path]) => path.includes('/b/'))).toBe(false);
});

test('operator with no assigned office receives zero counts', async () => {
  expect(await getDashboardStats(makeAuth({ roles: ['operator'], officeIds: [] }))).toEqual({
    employeeCount: 0, pendingApprovals: 0, pendingFilings: 0, activeLeaves: 0, activeExemptions: 0,
  });
});

test('database errors are returned as errors instead of zero counts', async () => {
  mockCollections.mockImplementation(() => { throw new Error('unavailable'); });
  await expect(getDashboardStats(makeAuth())).rejects.toThrow('unavailable');
});
