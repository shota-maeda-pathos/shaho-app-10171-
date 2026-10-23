import { Timestamp } from 'firebase-admin/firestore';
import { AuthContext, Role } from '../middleware/auth';
import {
  EmployeeDoc,
  DependentDoc,
  OfficeDoc,
  DepartmentDoc,
  InsuranceRateDoc,
  EmploymentDoc,
  GradeDoc,
} from '../types/firestore';

export function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    uid: 'user-001',
    companyId: 'company-001',
    roles: ['admin'] as Role[],
    officeIds: ['office-001'],
    isSuspended: false,
    isLoginDisabled: false,
    ...overrides,
  };
}

export function makeEmployeeDoc(
  overrides: Partial<EmployeeDoc> = {},
): EmployeeDoc {
  const now = Timestamp.now();
  return {
    employeeNumber: 'EMP-001',
    lastName: '山田',
    firstName: '太郎',
    lastNameKana: 'ヤマダ',
    firstNameKana: 'タロウ',
    birthDate: Timestamp.fromDate(new Date('1990-01-15')),
    gender: 'male',
    officeId: 'office-001',
    departmentId: null,
    hireDate: Timestamp.fromDate(new Date('2020-04-01')),
    resignationDate: null,
    userId: null,
    isActive: true,
    version: 1,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeDependentDoc(
  overrides: Partial<DependentDoc> = {},
): DependentDoc {
  const now = Timestamp.now();
  return {
    lastName: '山田',
    firstName: '花子',
    lastNameKana: 'ヤマダ',
    firstNameKana: 'ハナコ',
    birthDate: Timestamp.fromDate(new Date('1992-05-20')),
    gender: 'female',
    relationship: 'spouse',
    isDisabled: false,
    income: 0,
    coResident: true,
    qualificationDate: Timestamp.fromDate(new Date('2020-04-01')),
    disqualificationDate: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeOfficeDoc(
  overrides: Partial<OfficeDoc> = {},
): OfficeDoc {
  const now = Timestamp.now();
  return {
    name: '本社',
    officeNumber: '0001',
    prefectureCode: '13',
    insurerId: 'kyokai',
    address: '東京都千代田区1-1',
    phone: '03-1234-5678',
    closingDay: 0,
    paymentDay: 25,
    paymentMonth: 'current',
    deductionMethod: 'current',
    roundingRule: 'truncate',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeDepartmentDoc(
  overrides: Partial<DepartmentDoc> = {},
): DepartmentDoc {
  const now = Timestamp.now();
  return {
    name: '総務部',
    parentId: null,
    officeId: 'office-001',
    sortOrder: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeInsuranceRateDoc(
  overrides: Partial<InsuranceRateDoc> = {},
): InsuranceRateDoc {
  const now = Timestamp.now();
  return {
    insuranceType: 'health',
    insurerId: 'kyokai',
    prefectureCode: '13',
    appliedFrom: '2026-04',
    appliedUntil: null,
    totalRate: 99.8,
    employeeRate: 49.9,
    employerRate: 49.9,
    gradeTable: null,
    note: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeEmploymentDoc(
  overrides: Partial<EmploymentDoc> = {},
): EmploymentDoc {
  const now = Timestamp.now();
  return {
    effectiveDate: '2020-04-01',
    employmentType: 'regular',
    weeklyHours: 40,
    monthlyDays: 20,
    baseSalary: 300000,
    socialInsuranceEnrolled: true,
    longTermCareEnrolled: false,
    note: '',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeGradeDoc(
  overrides: Partial<GradeDoc> = {},
): GradeDoc {
  const now = Timestamp.now();
  return {
    effectiveMonth: '2026-09',
    healthGradeNumber: 22,
    healthStandardRemuneration: 300000,
    pensionGradeNumber: 20,
    pensionStandardRemuneration: 300000,
    determinationType: 'regular',
    reason: '',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

type TxOp = { type: 'set' | 'update'; ref: string; data: Record<string, unknown> };

export class MockTransaction {
  ops: TxOp[] = [];
  private docs: Map<string, { exists: boolean; data: Record<string, unknown> | undefined }>;

  constructor(
    docs: Map<string, { exists: boolean; data: Record<string, unknown> | undefined }>,
  ) {
    this.docs = docs;
  }

  async get(ref: { path: string }) {
    const entry = this.docs.get(ref.path);
    return {
      exists: entry?.exists ?? false,
      data: () => entry?.data,
      id: ref.path.split('/').pop()!,
    };
  }

  set(ref: { path: string }, data: Record<string, unknown>) {
    this.ops.push({ type: 'set', ref: ref.path, data });
  }

  update(ref: { path: string }, data: Record<string, unknown>) {
    this.ops.push({ type: 'update', ref: ref.path, data });
  }
}

export class MockFirestore {
  private docs: Map<string, { exists: boolean; data: Record<string, unknown> | undefined }> =
    new Map();
  private autoIdCounter = 0;

  setDoc(path: string, data: Record<string, unknown>) {
    this.docs.set(path, { exists: true, data });
  }

  setDocNotExists(path: string) {
    this.docs.set(path, { exists: false, data: undefined });
  }

  doc(path: string) {
    return {
      path,
      id: path.split('/').pop()!,
      get: async () => {
        const entry = this.docs.get(path);
        return {
          exists: entry?.exists ?? false,
          data: () => entry?.data,
          id: path.split('/').pop()!,
        };
      },
    };
  }

  collection(path: string) {
    return {
      path,
      doc: (id?: string) => {
        const docId = id ?? `auto-${++this.autoIdCounter}`;
        const fullPath = `${path}/${docId}`;
        return this.doc(fullPath);
      },
    };
  }

  async runTransaction<T>(fn: (tx: MockTransaction) => Promise<T>): Promise<T> {
    const tx = new MockTransaction(this.docs);
    const result = await fn(tx);
    return result;
  }
}
