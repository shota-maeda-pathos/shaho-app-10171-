import { Timestamp } from 'firebase-admin/firestore';
import { makeAuth, makeEmployeeDoc } from '../__tests__/helpers';
let mockDocs:Map<string,any>;let mockWrites:string[];
const mockCalculate=jest.fn();const mockApprove=jest.fn();const mockPublish=jest.fn();const mockCollection=jest.fn();
jest.mock('../insurance/monthly-insurance-calculate/service',()=>({calculateMonthlyInsurance:(...args:any[])=>mockCalculate(...args)}));
jest.mock('../approvals/approval-request-create/service',()=>({createApprovalRequest:(...args:any[])=>mockApprove(...args)}));
jest.mock('../salaries/salary-publish/service',()=>({publishSalaries:(...args:any[])=>mockPublish(...args)}));
jest.mock('../collections/collection-create/service',()=>({createCollection:(...args:any[])=>mockCollection(...args)}));
jest.mock('../config',()=>{
  const snapshot=(path:string)=>({id:path.split('/').pop(),exists:mockDocs.has(path),data:()=>mockDocs.get(path)});
  const doc=(path:string):any=>({path,id:path.split('/').pop(),get:async()=>snapshot(path),update:async(data:any)=>{mockWrites.push(path);mockDocs.set(path,{...mockDocs.get(path),...data});}});
  const query=(path:string,filters:any[]=[],limit=999,cursor=''):any=>({doc:(id='audit-1')=>doc(`${path}/${id}`),
    where:(...filter:any[])=>query(path,[...filters,filter],limit,cursor),orderBy:()=>query(path,filters,limit,cursor),limit:(size:number)=>query(path,filters,size,cursor),startAfter:(snap:any)=>query(path,filters,limit,snap.id),
    get:async()=>{const rows=[...mockDocs.keys()].filter(key=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')).filter(key=>filters.every(([field,op,value])=>op==='=='?mockDocs.get(key)[field]===value:op==='<='?mockDocs.get(key)[field]<=value:true)).filter(key=>!cursor||key.split('/').pop()!>cursor).slice(0,limit).map(snapshot);return {docs:rows,empty:!rows.length};},
  });
  return {db:{doc,collection:query,runTransaction:async(fn:any)=>{let wrote=false;return fn({get:async(ref:any)=>{if(wrote)throw new Error('read after write');return snapshot(ref.path);},set:(ref:any,data:any)=>{wrote=true;mockWrites.push(ref.path);mockDocs.set(ref.path,data);},update:(ref:any,data:any)=>{wrote=true;mockWrites.push(ref.path);mockDocs.set(ref.path,{...mockDocs.get(ref.path),...data});}});}}};
});
import { monthlyStatus, setHold, executeMonthlyAction, periodTarget } from './service';
const base='companies/company-001',employee=`${base}/employees/emp-1`,operation=`${base}/monthlyOperations/office-001_2026-10`;
const scope={companyId:'company-001',officeId:'office-001',yearMonth:'2026-10'};
const action={...scope,action:'calculate' as const,employeeIds:['emp-1'],requestId:'00000000-0000-4000-8000-000000000001'};
beforeEach(()=>{jest.clearAllMocks();mockWrites=[];mockDocs=new Map<string,any>([
 [employee,makeEmployeeDoc()],[`${employee}/salaries/2026-10`,{isConfirmed:true,isPublished:false}],
 [`${employee}/grades/2026-04`,{effectiveMonth:'2026-04'}],
]);mockCalculate.mockResolvedValue({success:true});mockApprove.mockResolvedValue({success:true});mockPublish.mockResolvedValue({published:1,errors:[]});mockCollection.mockResolvedValue({success:true});});
test('事業所外の状況取得は読取り前に拒否する',async()=>{await expect(monthlyStatus({...scope,limit:50},makeAuth({roles:['operator'],officeIds:[]}))).rejects.toMatchObject({code:'permission-denied'});});
test('承認・公開・保留の実データを返す',async()=>{
 mockDocs.set(`${employee}/monthlyInsurance/2026-10`,{isConfirmed:true,totalEmployeeAmount:75325,totalEmployerAmount:77125,childSupportPayment:{employeeAmount:575}});
 mockDocs.set(`${operation}/holds/emp-1`,{reason:'確認中',version:3});
 const result=await monthlyStatus({...scope,limit:50},makeAuth());
 expect(result.items[0]).toMatchObject({employeeId:'emp-1',salaryConfirmed:true,insuranceConfirmed:true,published:false,held:true,holdReason:'確認中',holdVersion:3,totalEmployee:75325});
});
test('期間外の入社・退職済み対象者を区別する',()=>{
 expect(periodTarget({...makeEmployeeDoc(),hireDate:Timestamp.fromDate(new Date('2026-11-01'))},'2026-10')).toBe(false);
 expect(periodTarget({...makeEmployeeDoc(),isActive:false,resignationDate:Timestamp.fromDate(new Date('2026-09-30'))},'2026-10')).toBe(false);
 expect(periodTarget({...makeEmployeeDoc(),isActive:false,resignationDate:Timestamp.fromDate(new Date('2026-10-20'))},'2026-10')).toBe(true);
});
test('保留理由を版管理し、古い版で上書きしない',async()=>{
 await setHold({...scope,employeeId:'emp-1',reason:'給与確認',expectedVersion:0},makeAuth());
 expect(mockDocs.get(`${operation}/holds/emp-1`)).toMatchObject({reason:'給与確認',version:1});
 await expect(setHold({...scope,employeeId:'emp-1',reason:null,expectedVersion:0},makeAuth())).rejects.toThrow('更新されています');
 await setHold({...scope,employeeId:'emp-1',reason:null,expectedVersion:1},makeAuth());
 expect(mockDocs.get(`${operation}/holds/emp-1`).reason).toBeNull();
});
test('保留中の対象者は計算しない',async()=>{
 mockDocs.set(`${operation}/holds/emp-1`,{reason:'保留'});
 const result=await executeMonthlyAction(action,makeAuth());expect(result.results[0].success).toBe(false);expect(mockCalculate).not.toHaveBeenCalled();
});
test('同じ操作IDの再試行は処理結果を再利用する',async()=>{
 const first=await executeMonthlyAction(action,makeAuth());const second=await executeMonthlyAction(action,makeAuth());
 expect(second).toEqual(first);expect(mockCalculate).toHaveBeenCalledTimes(1);
 expect(mockDocs.get(`${operation}/runs/${action.requestId}`).status).toBe('completed');
});
test('同じ操作IDを別の操作や他者が使えない',async()=>{
 await executeMonthlyAction(action,makeAuth());
 await expect(executeMonthlyAction({...action,action:'publish'},makeAuth())).rejects.toThrow('操作ID');
 await expect(executeMonthlyAction(action,makeAuth({uid:'another'}))).rejects.toThrow('操作ID');
});
test('対象者別に失敗しても他の対象者は処理を継続する',async()=>{
 mockDocs.set(`${base}/employees/emp-2`,{...makeEmployeeDoc(),officeId:'other-office'});
 const result=await executeMonthlyAction({...action,employeeIds:['emp-1','emp-2']},makeAuth());
 expect(result.results.map((r:any)=>r.success)).toEqual([true,false]);expect(mockCalculate).toHaveBeenCalledTimes(1);
});
test('承認済みの保険料を再計算で上書きしない',async()=>{
 mockDocs.set(`${employee}/monthlyInsurance/2026-10`,{isConfirmed:true});
 const result=await executeMonthlyAction(action,makeAuth());expect(result.results[0].success).toBe(true);expect(mockCalculate).not.toHaveBeenCalled();
});
test('支援金未計算の旧結果は新たな承認申請へ進めない',async()=>{
 mockDocs.set(`${employee}/monthlyInsurance/2026-10`,{isConfirmed:false,version:1});
 const result=await executeMonthlyAction({...action,action:'requestApproval'},makeAuth());
 expect(result.results[0]).toMatchObject({success:false});expect(mockApprove).not.toHaveBeenCalled();
});
