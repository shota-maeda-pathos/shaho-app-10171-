import { Timestamp } from 'firebase-admin/firestore';
import { ProcedureDoc } from '../types/firestore';
import { makeAuth, makeEmployeeDoc } from '../__tests__/helpers';

let mockRecords: Map<string, any>;
let mockWrites: string[];
let mockFilters: any[][];
jest.mock('../config', () => {
  const snapshot = (path: string) => ({ exists: mockRecords.has(path), id: path.split('/').pop(), data: () => mockRecords.get(path) });
  const doc = (path: string): any => ({ path, id: path.split('/').pop(), get: async () => snapshot(path), update: async (data: any) => { mockWrites.push(path); mockRecords.set(path, { ...mockRecords.get(path), ...data }); } });
  const query = (path: string): any => ({
    doc: () => doc(`${path}/audit-1`), where: (...args: any[]) => { mockFilters.push(args); return query(path); }, orderBy: () => query(path), limit: () => query(path), startAfter: () => query(path),
    get: async () => ({ docs: [] }),
  });
  return { db: { doc, collection: query, runTransaction: async (fn: any) => fn({
    get: async (ref: any) => snapshot(ref.path),
    update: (ref: any, data: any) => { mockWrites.push(ref.path); mockRecords.set(ref.path, { ...mockRecords.get(ref.path), ...data }); },
    set: (ref: any, data: any) => { mockWrites.push(ref.path); mockRecords.set(ref.path, data); },
  }) } };
});
import { buildSteps } from './templates';
import { refreshProcedure, resolveStepStatuses } from './refresh';
import { getProcedure } from './procedure-get/service';
import { listProcedures } from './procedure-list/service';
import { confirmProcedure } from './procedure-action/service';
import { filingMatchesProcedure } from './hooks';

const base = 'companies/company-001';
const path = `${base}/procedures/proc-1`;
const now = Timestamp.now();
function procedure(overrides: Partial<ProcedureDoc> = {}): ProcedureDoc {
  return { procedureType:'acquisition', title:'入社', status:'in_progress', statusReason:'', priority:'normal', employeeId:'emp-1', employeeName:'山田 太郎', officeId:'office-001', targetOfficeId:null, scope:'individual', batchMeta:null, invitationId:null, onboardToken:null,
    steps:buildSteps('acquisition'), references:[{type:'filing',documentId:'filing-1',employeeId:'emp-1',documentSubtype:'acquisitionNotification',stepId:'filing_create',createdAt:now}], deadline:null,effectiveDate:null,assignedTo:'user-001',createdBy:'user-001',notes:'',version:1,createdAt:now,updatedAt:now,completedAt:null,deletedAt:null,...overrides };
}
beforeEach(() => {
  mockWrites=[]; mockFilters=[];
  const proc=procedure();
  const employeeStep=proc.steps[0]; employeeStep.referenceType='employee'; employeeStep.referenceId='emp-1';
  mockRecords=new Map<string,any>([[path,proc],[`${base}/employees/emp-1`,makeEmployeeDoc()],
    [`${base}/employees/emp-1/filings/filing-1`,{workflowStatus:'approved',mockStatus:'completed',submissionStatus:'notSubmitted'}]]);
});

test('片方の提出完了から完了確認へ進め、確認操作を監査付きで保存できる', async () => {
  const result=await refreshProcedure('company-001','proc-1');
  expect(result.procedure.steps.find(s=>s.id==='confirm')?.status).toBe('available');
  expect(result.procedure.status).toBe('in_progress');
  await confirmProcedure({procedureId:'proc-1',stepId:'confirm',expectedVersion:result.procedure.version},makeAuth());
  expect(mockRecords.get(path)).toMatchObject({status:'completed',statusReason:'模擬申請として完了（実提出の記録は別管理）'});
  expect(mockWrites).toContain(`${base}/auditLogs/audit-1`);
  const count=mockWrites.length;
  await confirmProcedure({procedureId:'proc-1',stepId:'confirm',expectedVersion:result.procedure.version},makeAuth());
  expect(mockWrites).toHaveLength(count);
});
test('紙が受理済みなら模擬申請なしでも完了確認できる', async () => {
  Object.assign(mockRecords.get(`${base}/employees/emp-1/filings/filing-1`),{mockStatus:'notStarted',submissionStatus:'accepted'});
  expect((await refreshProcedure('company-001','proc-1')).procedure.steps.find(s=>s.id==='confirm')?.status).toBe('available');
});
test('承認前は模擬申請・紙提出をブロックする', async () => {
  Object.assign(mockRecords.get(`${base}/employees/emp-1/filings/filing-1`),{workflowStatus:'pending',mockStatus:'notStarted'});
  const {procedure:p}=await refreshProcedure('company-001','proc-1');
  expect(p.steps.find(s=>s.id==='mock_filing')).toMatchObject({status:'blocked',actionLabel:null});
  expect(p.steps.find(s=>s.id==='confirm')?.status).toBe('blocked');
  await expect(confirmProcedure({procedureId:'proc-1',stepId:'confirm',expectedVersion:p.version},makeAuth())).rejects.toThrow('完了確認できません');
});
test('再承認待ちへ変わったら提出済みでも未完了作業として扱う', async () => {
  Object.assign(mockRecords.get(`${base}/employees/emp-1/filings/filing-1`),{workflowStatus:'pending'});
  const {procedure:p}=await refreshProcedure('company-001','proc-1');
  expect(p.steps.find(s=>s.id==='approval')?.status).toBe('in_progress');
  expect(p.steps.find(s=>s.id==='confirm')?.status).toBe('blocked');
});
test.each(['cancelled','completed'] as const)('%s案件は閲覧時に変更しない', async status => {
  Object.assign(mockRecords.get(path),{status,statusReason:'保存した履歴'});
  expect((await refreshProcedure('company-001','proc-1')).changed).toBe(false);
  expect(mockRecords.get(path).statusReason).toBe('保存した履歴'); expect(mockWrites).toHaveLength(0);
});
test('担当外の単件取得は状態更新より先に拒否する', async () => {
  await expect(getProcedure({companyId:'company-001',procedureId:'proc-1'},makeAuth({roles:['operator'],officeIds:[]}))).rejects.toMatchObject({code:'permission-denied'});
  expect(mockWrites).toHaveLength(0);
});
test('担当事業所なしの一覧は全件取得しない', async () => {
  expect(await listProcedures({companyId:'company-001',limit:50},makeAuth({roles:['operator'],officeIds:[]}))).toEqual({items:[],hasMore:false});
  expect(mockFilters).toHaveLength(0);
});
test('指定した担当外事業所の一覧取得を拒否する', async () => {
  await expect(listProcedures({companyId:'company-001',officeId:'other',limit:50},makeAuth({roles:['operator'],officeIds:['office-001']}))).rejects.toMatchObject({code:'permission-denied'});
});
test('異動先の権限も単件取得前に検証する', async () => {
  mockRecords.get(path).targetOfficeId='office-002';
  await expect(getProcedure({companyId:'company-001',procedureId:'proc-1'},makeAuth({roles:['operator'],officeIds:['office-001']}))).rejects.toMatchObject({code:'permission-denied'});
  expect(mockWrites).toHaveLength(0);
});
test('退職精算が残っていれば届出済みでも全体を完了しない', async () => {
  const old=mockRecords.get(path) as ProcedureDoc;
  const steps=buildSteps('loss');
  steps.find(s=>s.id==='resign_entry')!.status='completed'; steps.find(s=>s.id==='portal_access')!.status='completed';
  const p={...old,procedureType:'loss' as const,steps};
  expect((await resolveStepStatuses('company-001',p)).find(s=>s.id==='confirm')?.status).toBe('blocked');
});
test('参照先の削除を完了済みとして残さない', async () => {
  mockRecords.delete(`${base}/employees/emp-1/filings/filing-1`);
  const {procedure:p}=await refreshProcedure('company-001','proc-1');
  expect(p.steps.find(s=>s.id==='filing_create')).toMatchObject({status:'blocked',completedAt:null});
});
test('並行する別種の案件へ届出を紐付けない', () => {
  expect(filingMatchesProcedure('acquisition','lossNotification')).toBe(false);
  expect(filingMatchesProcedure('loss','lossNotification')).toBe(true);
  expect(filingMatchesProcedure('maternity_leave','dependentChange')).toBe(false);
  expect(filingMatchesProcedure('dependent_change','dependentChange')).toBe(true);
});
