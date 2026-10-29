export interface PortalInsurance {
  yearMonth: string;
  health: number | null;
  pension: number | null;
  longTermCare: number | null;
  childSupport: number | null;
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
export interface PortalOverview {
  linked: boolean;
  profile: PortalProfile | null;
  payslips: PortalPayslip[];
  hasMore: boolean;
  lastDocId: string | null;
}
