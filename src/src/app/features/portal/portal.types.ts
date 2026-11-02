export interface PortalInsurance {
  yearMonth: string;
  health: number | null;
  pension: number | null;
  longTermCare: number | null;
  childSupportPayment: number | null;
  totalEmployee: number | null;
  isExempted: boolean;
}
export interface PortalPayslip {
  yearMonth: string;
  employeeName?: string;
  baseSalary: number | null;
  totalSalary: number | null;
  fixedAllowances: Record<string, number>;
  variableAllowances: Record<string, number>;
  insurance: PortalInsurance | null;
}
export interface PortalProfile {
  employeeName: string;
  employeeNumber: string;
  hireDate: string | null;
  officeName: string | null;
  departmentName: string | null;
  isActive: boolean;
}
/** 'YYYY-MM' の並び（新しい月から）を、順番を保ったまま年ごとに分ける */
export function groupByYear<T extends { yearMonth: string }>(items: T[]): { year: string; items: T[] }[] {
  const groups: { year: string; items: T[] }[] = [];
  for (const item of items) {
    const year = item.yearMonth.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last?.year === year) last.items.push(item); else groups.push({ year, items: [item] });
  }
  return groups;
}
export interface PortalOverview {
  linked: boolean;
  profile: PortalProfile | null;
  payslips: PortalPayslip[];
  hasMore: boolean;
  lastDocId: string | null;
}
