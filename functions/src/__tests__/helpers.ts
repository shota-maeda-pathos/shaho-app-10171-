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
  SalaryDoc,
  BonusDoc,
  ApprovalRequestDoc,
  FilingDoc,
} from '../types/firestore';

export function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    uid: 'user-001',
    companyId: 'company-001',
    roles: ['admin'] as Role[],
    officeIds: ['office-001'],
    isSuspended: false,
    isLoginDisabled: false,
    sessionId: 'session-001',
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
    roundingRule: 'statutory',
    isActive: true,
    version: 1,
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

export function makeSalaryDoc(
  overrides: Partial<SalaryDoc> = {},
): SalaryDoc {
  const now = Timestamp.now();
  return {
    yearMonth: '2026-10',
    officeId: 'office-001',
    paymentBasisDays: 20,
    baseSalary: 300000,
    fixedAllowances: { housing: 20000, commute: 15000 },
    variableAllowances: {},
    totalFixedWage: 335000,
    totalVariableWage: 0,
    totalSalary: 335000,
    isConfirmed: false,
    confirmedAt: null,
    confirmedBy: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeBonusDoc(
  overrides: Partial<BonusDoc> = {},
): BonusDoc {
  const now = Timestamp.now();
  return {
    yearMonth: '2026-06',
    officeId: 'office-001',
    totalAmount: 500000,
    standardBonusAmount: 500000,
    cumulativeBonusAmount: 500000,
    isConfirmed: false,
    confirmedAt: null,
    confirmedBy: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeApprovalRequestDoc(
  overrides: Partial<ApprovalRequestDoc> = {},
): ApprovalRequestDoc {
  const now = Timestamp.now();
  return {
    targetPath: 'companies/company-001/employees/emp-001/salaries/2026-10',
    targetVersion: 1,
    snapshotData: { totalSalary: 335000 },
    requestType: 'salary',
    status: 'pending',
    requestedBy: 'user-001',
    requestedAt: now,
    reviewedBy: null,
    reviewedAt: null,
    comment: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeFilingDoc(
  overrides: Partial<FilingDoc> = {},
): FilingDoc {
  const now = Timestamp.now();
  return {
    filingType: 'acquisitionNotification',
    workflowStatus: 'draft',
    mockStatus: 'notStarted',
    submissionStatus: 'notSubmitted',
    effectiveDate: '2026-10-01',
    formData: { employeeName: '山田太郎' },
    submittedAt: null,
    resultReceivedAt: null,
    resultNote: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

type TxOp = { type: 'set' | 'update'; ref: string; data: Record<string, unknown> };
type DocEntry = { exists: boolean; data: Record<string, unknown> | undefined };
type Filter = { field: string; op: string; value: unknown };

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

function matches(data: Record<string, unknown>, f: Filter): boolean {
  const v = data[f.field] ?? null;
  switch (f.op) {
    case '==': return v === f.value;
    case '!=': return v !== f.value;
    case '<': return v !== null && compare(v, f.value) < 0;
    case '<=': return v !== null && compare(v, f.value) <= 0;
    case '>': return v !== null && compare(v, f.value) > 0;
    case '>=': return v !== null && compare(v, f.value) >= 0;
    case 'in': return (f.value as unknown[]).includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(f.value);
    default: throw new Error(`MockFirestore: unsupported operator ${f.op}`);
  }
}

/** コレクション直下の文書に対するクエリ（where / orderBy / limit）の簡易実装 */
export class MockQuery {
  constructor(
    readonly path: string,
    private store: Map<string, DocEntry>,
    private filters: Filter[] = [],
    private orders: { field: string; dir: 'asc' | 'desc' }[] = [],
    private max: number | null = null,
    private after: string | null = null,
  ) {}

  where(field: string, op: string, value: unknown) {
    return new MockQuery(this.path, this.store, [...this.filters, { field, op, value }], this.orders, this.max, this.after);
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
    return new MockQuery(this.path, this.store, this.filters, [...this.orders, { field, dir }], this.max, this.after);
  }

  limit(n: number) {
    return new MockQuery(this.path, this.store, this.filters, this.orders, n, this.after);
  }

  /** 文書スナップショット（id を持つもの）の次から */
  startAfter(doc: { id: string }) {
    return new MockQuery(this.path, this.store, this.filters, this.orders, this.max, doc.id);
  }

  async get() {
    const prefix = `${this.path}/`;
    let rows = [...this.store.entries()]
      .filter(([p, e]) => e.exists && p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map(([p, e]) => ({ path: p, data: e.data ?? {} }))
      .filter(r => this.filters.every(f => matches(r.data, f)));
    for (const o of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => compare(a.data[o.field], b.data[o.field]) * (o.dir === 'desc' ? -1 : 1));
    }
    if (this.after !== null) {
      const index = rows.findIndex(r => r.path.split('/').pop() === this.after);
      rows = rows.slice(index + 1);
    }
    if (this.max !== null) rows = rows.slice(0, this.max);
    const docs = rows.map(r => ({ id: r.path.split('/').pop()!, ref: { path: r.path }, exists: true, data: () => r.data }));
    return { empty: docs.length === 0, size: docs.length, docs };
  }

  count() {
    return { get: async () => { const snap = await this.get(); return { data: () => ({ count: snap.size }) }; } };
  }
}

export class MockTransaction {
  ops: TxOp[] = [];
  private docs: Map<string, DocEntry>;

  constructor(docs: Map<string, DocEntry>) {
    this.docs = docs;
  }

  async get(ref: { path: string } | MockQuery) {
    // Firestore のトランザクションは、書き込みの後に読み取ると失敗する
    if (this.ops.length > 0) {
      throw new Error('Firestore transactions require all reads to be executed before all writes.');
    }
    if (ref instanceof MockQuery) return ref.get();
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

  create(ref: { path: string }, data: Record<string, unknown>) {
    this.ops.push({ type: 'set', ref: ref.path, data });
  }

  delete(ref: { path: string }) {
    this.ops.push({ type: 'update', ref: ref.path, data: { __deleted: true } });
  }
}

export class MockFirestore {
  private docs: Map<string, DocEntry> = new Map();
  private autoIdCounter = 0;
  /** 最後に実行したトランザクション（書き込み内容の検証用） */
  lastTransaction: MockTransaction | null = null;

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
      set: async (data: Record<string, unknown>) => { this.docs.set(path, { exists: true, data }); },
      update: async (data: Record<string, unknown>) => {
        const entry = this.docs.get(path);
        this.docs.set(path, { exists: true, data: { ...(entry?.data ?? {}), ...data } });
      },
    };
  }

  collection(path: string) {
    const query = new MockQuery(path, this.docs);
    return Object.assign(query, {
      doc: (id?: string) => {
        const docId = id ?? `auto-${++this.autoIdCounter}`;
        const fullPath = `${path}/${docId}`;
        return this.doc(fullPath);
      },
    });
  }

  async runTransaction<T>(fn: (tx: MockTransaction) => Promise<T>): Promise<T> {
    const tx = new MockTransaction(this.docs);
    this.lastTransaction = tx;
    const result = await fn(tx);
    return result;
  }
}
