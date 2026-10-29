import { makeAuth, makeEmployeeDoc } from '../__tests__/helpers';
let mockDocs:Map<string,any>;let mockWrites:string[];
jest.mock('../config',()=>{
 const snapshot=(path:string)=>({exists:mockDocs.has(path),data:()=>mockDocs.get(path)});
 const doc=(path:string):any=>({path,id:path.split('/').pop()});
 return {db:{doc,collection:(path:string)=>({doc:()=>doc(path+'/audit')}),runTransaction:async(fn:any)=>{let wrote=false;return fn({get:async(ref:any)=>{if(wrote)throw new Error('read after write');return snapshot(ref.path);},update:(ref:any,data:any)=>{wrote=true;mockWrites.push(ref.path);mockDocs.set(ref.path,{...mockDocs.get(ref.path),...data});},set:(ref:any,data:any)=>{wrote=true;mockWrites.push(ref.path);mockDocs.set(ref.path,data);}});}}};
});
import { publishSalaries } from '../salaries/salary-publish/service';
import { recordCollection } from '../collections/collection-record/functions';
import { validateApprovalTarget } from '../approvals/target';
const base='companies/company-001/employees/emp-1';
const publish={companyId:'company-001',yearMonth:'2026-10',employeeIds:['emp-1']};
const receipt={companyId:'company-001',employeeId:'emp-1',yearMonth:'2026-10',collectedAmount:75000,expectedVersion:0,note:'給与控除を確認'};
beforeEach(()=>{mockWrites=[];mockDocs=new Map<string,any>([[base,makeEmployeeDoc()],[`${base}/salaries/2026-10`,{isConfirmed:true,isPublished:false,version:1}],[`${base}/monthlyInsurance/2026-10`,{isConfirmed:true,childSupportPayment:{employeeAmount:575}}]]);});
test('承認済み給与・保険料から公開し、再実行では公開件数を増やさない',async()=>{
 expect(await publishSalaries(publish,makeAuth())).toMatchObject({published:1,errors:[]});
 expect(mockDocs.get(`${base}/salaries/2026-10`)).toMatchObject({isPublished:true,version:2});
 expect(await publishSalaries(publish,makeAuth())).toMatchObject({published:0,errors:[]});
});
test('事業所外の明細は公開しない',async()=>{
 expect((await publishSalaries(publish,makeAuth({roles:['operator'],officeIds:[]}))).errors).toHaveLength(1);expect(mockWrites).toHaveLength(0);
});
test('保険料が未承認なら公開しない',async()=>{
 mockDocs.get(`${base}/monthlyInsurance/2026-10`).isConfirmed=false;
 expect((await publishSalaries(publish,makeAuth())).errors[0]).toContain('社会保険料');expect(mockWrites).toHaveLength(0);
});
test('旧結果の支援金不足を0円として公開しない',async()=>{
 delete mockDocs.get(`${base}/monthlyInsurance/2026-10`).childSupportPayment;
 expect((await publishSalaries(publish,makeAuth())).errors[0]).toContain('支援金');expect(mockWrites).toHaveLength(0);
});
test('複数人の明細公開でトランザクションの読取後書込順序を守る',async()=>{
 for(const [key,value] of [...mockDocs])mockDocs.set(key.replace('emp-1','emp-2'),{...value});
 expect(await publishSalaries({...publish,employeeIds:['emp-1','emp-2']},makeAuth())).toMatchObject({published:2,errors:[]});
});
test('実徴収額の記録と訂正に版管理・監査を残す',async()=>{
 await recordCollection(receipt,makeAuth());expect(mockDocs.get(`${base}/collectionReceipts/2026-10`)).toMatchObject({collectedAmount:75000,version:1});
 await expect(recordCollection(receipt,makeAuth())).rejects.toThrow('更新されています');
 await recordCollection({...receipt,collectedAmount:75325,expectedVersion:1,note:'銀行記録と照合し訂正'},makeAuth());
 expect(mockDocs.get(`${base}/collectionReceipts/2026-10`)).toMatchObject({collectedAmount:75325,version:2});
 expect(mockWrites).toContain('companies/company-001/auditLogs/audit');
});
test('事業所外の徴収額を記録できない',async()=>{
 await expect(recordCollection(receipt,makeAuth({roles:['operator'],officeIds:[]}))).rejects.toMatchObject({code:'permission-denied'});expect(mockWrites).toHaveLength(0);
});
test('承認対象の会社・従業員・種別を検証する',()=>{
 expect(()=>validateApprovalTarget(`${base}/salaries/2026-10`,'salary','company-001','emp-1')).not.toThrow();
 for(const path of [`${base}/filings/2026-10`,`${base}/salaries/2026-13`,`${base}/salaries/2026-10/sub/id`,`${base.replace('emp-1','other')}/salaries/2026-10`])expect(()=>validateApprovalTarget(path,'salary','company-001','emp-1')).toThrow('承認対象');
});
