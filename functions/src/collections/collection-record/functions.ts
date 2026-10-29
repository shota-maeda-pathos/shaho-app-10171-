import { Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../../config';
import { AuthContext, getAuthContext, requireRole, requireOffice } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { invalidArg, notFound } from '../../utils/errors';
const id=z.string().min(1).max(200).regex(/^[^/]+$/);
const schema=z.object({companyId:id,employeeId:id,yearMonth:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),collectedAmount:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),expectedVersion:z.number().int().min(0),note:z.string().trim().min(1).max(500)}).strict();
export async function recordCollection(input:z.infer<typeof schema>,auth:AuthContext) {
  const base=`companies/${auth.companyId}/employees/${input.employeeId}`;
  const ref=db.doc(`${base}/collectionReceipts/${input.yearMonth}`);
  await db.runTransaction(async tx=>{
    const employee=await tx.get(db.doc(base));
    if(!employee.exists||employee.data()!.deletedAt!=null) throw notFound('従業員');
    requireOffice(auth,employee.data()!.officeId);
    const [insurance,old]=await Promise.all([tx.get(db.doc(`${base}/monthlyInsurance/${input.yearMonth}`)),tx.get(ref)]);
    if(!insurance.exists||insurance.data()!.isConfirmed!==true) throw invalidArg('承認済みの保険料を確認してください');
    if((old.data()?.version??0)!==input.expectedVersion) throw invalidArg('徴収記録が更新されています。再読み込みしてください');
    const now=Timestamp.now();
    tx.set(ref,{yearMonth:input.yearMonth,officeId:employee.data()!.officeId,collectedAmount:input.collectedAmount,note:input.note,updatedBy:auth.uid,updatedAt:now,version:input.expectedVersion+1});
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(),{entity:'collectionReceipt',employeeId:input.employeeId,entityId:input.yearMonth,action:'update',changes:{collectedAmount:{from:old.data()?.collectedAmount??null,to:input.collectedAmount}},note:input.note,performedBy:auth.uid,performedAt:now,version:input.expectedVersion+1});
  });
  return {success:true};
}
export const collectionRecord=onCall(async request=>{const input=validate(schema,request.data);const auth=await getAuthContext(request,input.companyId);requireRole(auth,'admin','operator');return recordCollection(input,auth);});
