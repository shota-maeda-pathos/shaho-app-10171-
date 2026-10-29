import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { invalidArg, notFound } from '../../utils/errors';
import { SalaryPublishInput } from './schema';

export async function publishSalaries(input:SalaryPublishInput,auth:AuthContext):Promise<{success:boolean;published:number;errors:string[]}> {
  let published=0;const errors:string[]=[];
  for(const employeeId of [...new Set(input.employeeIds)]) {
    try {
      const changed=await db.runTransaction(async tx=>{
        const employeeBase=`companies/${auth.companyId}/employees/${employeeId}`;
        const employee=await tx.get(db.doc(employeeBase));
        if(!employee.exists||employee.data()!.deletedAt!=null) throw notFound('従業員');
        requireOffice(auth,employee.data()!.officeId);
        const ref=db.doc(`${employeeBase}/salaries/${input.yearMonth}`);
        const [salary,insurance]=await Promise.all([tx.get(ref),tx.get(db.doc(`${employeeBase}/monthlyInsurance/${input.yearMonth}`))]);
        if(!salary.exists||salary.data()!.isConfirmed!==true) throw invalidArg('給与が未登録または未承認です');
        if(salary.data()!.isPublished===true) return false;
        if(!insurance.exists||insurance.data()!.isConfirmed!==true) throw invalidArg('社会保険料の承認を完了してください');
        if(input.yearMonth>='2026-04'&&!insurance.data()!.childSupportPayment) throw invalidArg('支援金を含む保険料計算・承認を確認してください');
        const now=Timestamp.now();
        tx.update(ref,{isPublished:true,publishedAt:now,publishedBy:auth.uid,updatedAt:now,version:(salary.data()!.version??0)+1});
        tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(),{entity:'salary',entityId:input.yearMonth,action:'publish',employeeId,performedBy:auth.uid,performedAt:now});
        return true;
      });
      if(changed) published++;
    } catch(e:any) {errors.push(`${employeeId}: ${e.message??'公開できませんでした'}`);}
  }
  return {success:errors.length===0,published,errors};
}
