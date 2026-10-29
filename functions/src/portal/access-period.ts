// Company-local portal access. Never disables the shared Firebase Auth account.
export function portalAccessDeadline(employee:FirebaseFirestore.DocumentData):Date|null {
  if(employee.portalAccessUntil?.toDate) return employee.portalAccessUntil.toDate();
  const resignation=employee.resignationDate?.toDate?.();
  if(!resignation) return null;
  const year=resignation.getUTCFullYear(),month=resignation.getUTCMonth()+3;
  const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return new Date(Date.UTC(year,month,Math.min(resignation.getUTCDate(),lastDay),resignation.getUTCHours(),resignation.getUTCMinutes(),resignation.getUTCSeconds()));
}
