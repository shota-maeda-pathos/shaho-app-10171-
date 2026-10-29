import { makeAuth } from '../../__tests__/helpers';

const mockCollections = jest.fn();
const mockDocuments=jest.fn();
jest.mock('../../config', () => ({ db: { collection: (...args: unknown[]) => mockCollections(...args), doc:(path:string)=>({get:()=>mockDocuments(path)}) } }));
import { getDashboardStats } from './service';

beforeEach(() => {
  mockDocuments.mockReset();mockDocuments.mockResolvedValue({exists:false,data:()=>undefined});
  mockCollections.mockReset();
  mockCollections.mockImplementation((path: string) => {
    const query: any = {
      where: jest.fn(() => query), select: jest.fn(() => query), count: jest.fn(() => query),orderBy:jest.fn(()=>query),limit:jest.fn(()=>query),
      get: jest.fn(async () => path.endsWith('/employees') ? {
        docs: [
          { id: 'a', data: () => ({ officeId: 'office-001', isActive: true }) },
          { id: 'b', data: () => ({ officeId: 'office-002', isActive: true }) },
          { id: 'retired', data: () => ({ officeId: 'office-001', isActive: false }) },
        ],
      } : { docs:[],empty:true,data: () => ({ count: path.includes('/b/') ? 10 : 1 }) }),
    };
    return query;
  });
});

test('admin counts all offices, including pending work for retired employees', async () => {
  expect(await getDashboardStats(makeAuth())).toMatchObject({
    employeeCount: 2, pendingApprovals: 12, pendingFilings: 12, activeLeaves: 12, activeExemptions: 12,
  });
});

test('operator counts only assigned offices', async () => {
  expect(await getDashboardStats(makeAuth({ roles: ['operator'] }))).toMatchObject({
    employeeCount: 1, pendingApprovals: 2, pendingFilings: 2, activeLeaves: 2, activeExemptions: 2,
  });
  expect(mockCollections.mock.calls.some(([path]) => path.includes('/b/'))).toBe(false);
});

test('operator with no assigned office receives zero counts', async () => {
  expect(await getDashboardStats(makeAuth({ roles: ['operator'], officeIds: [] }))).toMatchObject({
    employeeCount: 0, pendingApprovals: 0, pendingFilings: 0, activeLeaves: 0, activeExemptions: 0,
  });
});

test('database errors are returned as errors instead of zero counts', async () => {
  mockCollections.mockImplementation(() => { throw new Error('unavailable'); });
  await expect(getDashboardStats(makeAuth())).rejects.toThrow('unavailable');
});

test('selected office is applied even for an administrator',async()=>{
  expect(await getDashboardStats(makeAuth(),'office-001')).toMatchObject({employeeCount:1,pendingApprovals:2});
  expect(mockCollections.mock.calls.some(([path])=>path.includes('/b/'))).toBe(false);
});

test('an unassigned office is rejected before reading records',async()=>{
  await expect(getDashboardStats(makeAuth({roles:['operator']}),'office-002')).rejects.toThrow('担当事業所外');
  expect(mockCollections).not.toHaveBeenCalled();
});

test('collection alert uses actual receipts and excludes the employer share',async()=>{
  mockDocuments.mockImplementation(async(path:string)=>({exists:true,data:()=>path.includes('/monthlyInsurance/')?
    {isConfirmed:true,totalEmployeeAmount:100,totalEmployerAmount:500}:{collectedAmount:40}}));
  const result=await getDashboardStats(makeAuth(),'office-001');
  expect(result.alerts.uncollectedPremiums).toHaveLength(4);
  expect(result.alerts.uncollectedPremiums.every(row=>row.totalAmount===60)).toBe(true);
});
