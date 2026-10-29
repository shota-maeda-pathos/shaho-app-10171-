import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { db } from '../config';
import { AuthContext, requireOffice } from '../middleware/auth';
import { invalidArg, notFound } from '../utils/errors';
import { mapConcurrent } from '../utils/parallel';
import { calculateMonthlyInsurance } from '../insurance/monthly-insurance-calculate/service';
import { createApprovalRequest } from '../approvals/approval-request-create/service';
import { publishSalaries } from '../salaries/salary-publish/service';
import { createCollection } from '../collections/collection-create/service';

interface Scope { officeId:string;yearMonth:string }
function paths(input:Scope,auth:AuthContext) {
  requireOffice(auth,input.officeId);
  return {base:`companies/${auth.companyId}`,operation:`companies/${auth.companyId}/monthlyOperations/${input.officeId}_${input.yearMonth}`};
}
function month(value:any):string|null { return value?.toDate ? value.toDate().toISOString().slice(0,7):typeof value==='string'?value.slice(0,7):null; }
export function periodTarget(employee:FirebaseFirestore.DocumentData,yearMonth:string):boolean {
  const hire=month(employee.hireDate), resign=month(employee.resignationDate);
  return employee.deletedAt==null && (!hire || hire<=yearMonth) && (!resign || resign>=yearMonth) && (employee.isActive!==false || !!resign);
}

export async function monthlyStatus(input:Scope&{cursor?:string;limit:number},auth:AuthContext) {
  const {base,operation}=paths(input,auth);
  let query=db.collection(`${base}/employees`).where('officeId','==',input.officeId).where('deletedAt','==',null).orderBy('employeeNumber','asc');
  if(input.cursor) { const cursor=await db.doc(`${base}/employees/${input.cursor}`).get(); if(!cursor.exists || cursor.data()!.officeId!==input.officeId) throw notFound('対象者の続き'); query=query.startAfter(cursor); }
  const page=await query.limit(input.limit+1).get(); const docs=page.docs.slice(0,input.limit);
  const items=await mapConcurrent(docs,6,async doc=>{
    const employee=doc.data(), employeeBase=`${base}/employees/${doc.id}`;
    const [salary,insurance,hold,grade]=await Promise.all([
      db.doc(`${employeeBase}/salaries/${input.yearMonth}`).get(),db.doc(`${employeeBase}/monthlyInsurance/${input.yearMonth}`).get(),
      db.doc(`${operation}/holds/${doc.id}`).get(),db.collection(`${employeeBase}/grades`).where('effectiveMonth','<=',input.yearMonth).orderBy('effectiveMonth','desc').limit(1).get(),
    ]);
    const s=salary.data(),i=insurance.data(),h=hold.data();
    const included=periodTarget(employee,input.yearMonth); const issues:string[]=[];
    if(included) {
      if(!employee.birthDate) issues.push('生年月日が未入力');
      if(grade.empty) issues.push('適用等級が未登録');
      if(!salary.exists) issues.push('給与が未登録'); else if(s?.isConfirmed!==true) issues.push('給与が未承認');
      if(input.yearMonth>='2026-04'&&i&& !i.childSupportPayment) issues.push('支援金を含む再計算が必要');
    }
    return {employeeId:doc.id,employeeNumber:employee.employeeNumber??'',employeeName:`${employee.lastName??''} ${employee.firstName??''}`,
      included,issues,held:!!h?.reason,holdReason:h?.reason??'',holdVersion:h?.version??0,
      salaryExists:salary.exists,salaryConfirmed:s?.isConfirmed===true,published:s?.isPublished===true,
      calculated:insurance.exists,insuranceConfirmed:i?.isConfirmed===true,approvalPending:i?.approvalPending===true,
      totalEmployee:i?.totalEmployeeAmount??null,totalEmployer:i?.totalEmployerAmount??null,
    };
  });
  const runs=await db.collection(`${operation}/runs`).orderBy('updatedAt','desc').limit(5).get();
  const recentRuns=runs.docs.map(doc=>{const run=doc.data();return {id:doc.id,action:run.action,status:run.status,updatedAt:run.updatedAt?.toDate().toISOString()??null,result:run.result??null};});
  return {items,hasMore:page.docs.length>input.limit,cursor:docs.at(-1)?.id??null,recentRuns};
}

export async function setHold(input:Scope&{employeeId:string;reason:string|null;expectedVersion:number},auth:AuthContext) {
  const {base,operation}=paths(input,auth),ref=db.doc(`${operation}/holds/${input.employeeId}`);
  await db.runTransaction(async tx=>{
    const employee=await tx.get(db.doc(`${base}/employees/${input.employeeId}`));
    if(!employee.exists||employee.data()!.deletedAt!=null) throw notFound('従業員');
    if(employee.data()!.officeId!==input.officeId) throw invalidArg('対象事業所が一致しません');
    const current=await tx.get(ref); if((current.data()?.version??0)!==input.expectedVersion) throw invalidArg('保留情報が更新されています。再読み込みしてください');
    const now=Timestamp.now();
    tx.set(ref,{reason:input.reason,updatedBy:auth.uid,updatedAt:now,version:input.expectedVersion+1});
    tx.set(db.collection(`${base}/auditLogs`).doc(),{entity:'monthlyOperation',entityId:`${input.officeId}_${input.yearMonth}`,action:'update',changes:{hold:{from:current.data()?.reason??null,to:input.reason}},performedBy:auth.uid,performedAt:now,version:input.expectedVersion+1});
  });
  return {success:true};
}

type Action='calculate'|'requestApproval'|'publish'|'createCollection';
export async function executeMonthlyAction(input:Scope&{action:Action;employeeIds:string[];requestId:string},auth:AuthContext) {
  const {base,operation}=paths(input,auth);
  const employeeIds=[...new Set(input.employeeIds)].sort();
  const fingerprint=createHash('sha256').update(JSON.stringify({action:input.action,employeeIds})).digest('hex');
  const ref=db.doc(`${operation}/runs/${input.requestId}`); const now=Timestamp.now();
  const previous=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref); const data=snap.data();
    if(data) {
      if(data.createdBy!==auth.uid||data.fingerprint!==fingerprint) throw invalidArg('操作IDが別の処理で使われています');
      if(data.status==='completed') return data.result;
      if(data.startedAt.toMillis()>Date.now()-360_000) throw invalidArg('処理中です。完了を待って再読み込みしてください');
    }
    tx.set(ref,{action:input.action,employeeIds,fingerprint,createdBy:auth.uid,status:'running',startedAt:now,updatedAt:now});
    return null;
  });
  if(previous) return previous;
  const results=await mapConcurrent(employeeIds,3,async employeeId=>{
    try {
      const employeeBase=`${base}/employees/${employeeId}`;
      const [employee,hold]=await Promise.all([db.doc(employeeBase).get(),db.doc(`${operation}/holds/${employeeId}`).get()]);
      if(!employee.exists||!periodTarget(employee.data()!,input.yearMonth)) throw invalidArg('対象期間の従業員ではありません');
      if(employee.data()!.officeId!==input.officeId) throw invalidArg('対象事業所が一致しません');
      if(hold.data()?.reason) throw invalidArg('保留中です。理由を確認して保留を解除してください');
      const insRef=db.doc(`${employeeBase}/monthlyInsurance/${input.yearMonth}`);
      const insurance=await insRef.get(); const ins=insurance.data();
      if(input.action==='calculate') {
        if(!employee.data()!.birthDate) throw invalidArg('生年月日を登録してください');
        if(ins?.isConfirmed||ins?.approvalPending) return {employeeId,success:true,message:'既存の承認・承認申請を維持しました'};
        await calculateMonthlyInsurance({companyId:auth.companyId,employeeId,yearMonth:input.yearMonth},auth);
      } else if(input.action==='requestApproval') {
        if(!ins) throw invalidArg('保険料が未計算です');
        if(input.yearMonth>='2026-04'&&!ins.childSupportPayment) throw invalidArg('支援金を含めて再計算してください');
        if(!ins.isConfirmed&&!ins.approvalPending) await createApprovalRequest({companyId:auth.companyId,employeeId,requestType:'monthlyInsurance',targetPath:insRef.path,targetVersion:ins.version},auth);
      } else if(input.action==='publish') {
        const result=await publishSalaries({companyId:auth.companyId,yearMonth:input.yearMonth,employeeIds:[employeeId]},auth);
        if(result.errors.length) throw invalidArg(result.errors.join('、'));
      }
      return {employeeId,success:true,message:'完了'};
    } catch(e:any) { return {employeeId,success:false,message:e.message??'処理に失敗しました'}; }
  });
  if(input.action==='createCollection'&&results.every(r=>r.success)) {
    try { await createCollection({companyId:auth.companyId,yearMonth:input.yearMonth,officeId:input.officeId,collectionType:'monthly'},auth); }
    catch(e:any) { results.forEach(r=>{r.success=false;r.message=e.message??'徴収記録を作成できませんでした';}); }
  }
  const result={results};
  await ref.update({status:'completed',result,updatedAt:Timestamp.now()});
  return result;
}
