import { invalidArg } from '../utils/errors';
export function validateApprovalTarget(path:string,type:string,companyId:string,employeeId:string):void {
  const collections:Record<string,string>={salary:'salaries',bonus:'bonuses',monthlyInsurance:'monthlyInsurance',bonusInsurance:'bonusInsurance',filing:'filings',employment:'employments',grade:'grades'};
  const collection=collections[type];if(!collection)throw invalidArg('承認種別が不正です');
  const prefix=`companies/${companyId}/employees/${employeeId}/${collection}/`;
  const id=path.startsWith(prefix)?path.slice(prefix.length):'';
  if(!/^[^/]+$/.test(id)||(['salary','bonus','monthlyInsurance','bonusInsurance'].includes(type)&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(id)))throw invalidArg('承認対象パスが不正です');
}
