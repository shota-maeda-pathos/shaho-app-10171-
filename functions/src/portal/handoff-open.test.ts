import { MockFirestore, makeAuth, makeEmployeeDoc } from '../__tests__/helpers';
import { buildDependentWizardSteps, buildLeaveWizardSteps } from '../procedures/templates';
import { setStep } from '../procedures/wizard';

let mockDb: MockFirestore;

jest.mock('../config', () => ({
  get db() {
    return mockDb;
  },
}));

import { startDependentChange } from '../dependent-change/service';
import { startLeave } from '../leave-procedure/service';

const base = 'companies/company-001';
const auth = makeAuth();

beforeEach(() => {
  mockDb = new MockFirestore();
  mockDb.setDoc(`${base}/employees/emp-001`, { ...makeEmployeeDoc() });
});

/** 進行中の手続きがあるときも、本人からの申請の中身をその手続きに入れる（2026-11-02 本番で、10/31 に始めた手続きに入らなかったのを直した） */
describe('進行中の手続きへの申請の取り込み', () => {
  const dependentRequest = {
    employeeId: 'emp-001', type: 'dependentAdd', status: 'submitted',
    detail: { lastName: '山田', firstName: '次郎', birthDate: '2026-10-15', gender: 'male', relationship: 'child', annualIncome: 0, coResident: true, since: '2026-11-01' },
  };
  const openDependent = (overrides: Record<string, unknown> = {}) => ({
    employeeId: 'emp-001', status: 'in_progress', deletedAt: null, version: 3, steps: buildDependentWizardSteps(),
    dependentChange: { items: [], sourceProcedureId: null, filingId: null, appliedAt: null }, ...overrides,
  });

  it('扶養：変わった内容を保存していなければ、申請の家族を足す', async () => {
    mockDb.setDoc(`${base}/portalRequests/req-1`, dependentRequest);
    mockDb.setDoc(`${base}/procedures/proc-1`, openDependent());

    const result = await startDependentChange({ employeeId: 'emp-001', sourceProcedureId: null, sourceRequestId: 'req-1' }, auth);

    expect(result).toEqual({ procedureId: 'proc-1', existing: true, prefilled: true });
    const op = mockDb.lastTransaction!.ops[0];
    expect(op.ref).toBe(`${base}/procedures/proc-1`);
    expect(op.data['dependentChange.items']).toEqual([expect.objectContaining({
      kind: 'add', lastName: '山田', firstName: '次郎', birthDate: '2026-10-15', gender: 'male', relationship: 'child', eventDate: '2026-11-01',
    })]);
    expect(op.data.version).toBe(4);
  });

  it('扶養：変わった内容を保存済みなら足さず、prefilled: false を返す', async () => {
    mockDb.setDoc(`${base}/portalRequests/req-1`, dependentRequest);
    mockDb.setDoc(`${base}/procedures/proc-1`, openDependent({ steps: setStep(buildDependentWizardSteps(), 'change', { status: 'completed' }) }));

    const result = await startDependentChange({ employeeId: 'emp-001', sourceProcedureId: null, sourceRequestId: 'req-1' }, auth);

    expect(result.prefilled).toBe(false);
    expect(mockDb.lastTransaction!.ops).toHaveLength(0);
  });

  it('扶養：同じ人がもう入っていれば足さない', async () => {
    mockDb.setDoc(`${base}/portalRequests/req-1`, dependentRequest);
    mockDb.setDoc(`${base}/procedures/proc-1`, openDependent({
      dependentChange: { items: [{ kind: 'add', lastName: '山田', firstName: '次郎' }], sourceProcedureId: null, filingId: null, appliedAt: null },
    }));

    const result = await startDependentChange({ employeeId: 'emp-001', sourceProcedureId: null, sourceRequestId: 'req-1' }, auth);

    expect(result.prefilled).toBe(true);
    expect(mockDb.lastTransaction!.ops).toHaveLength(0);
  });

  const leaveRequest = {
    employeeId: 'emp-001', type: 'leave', status: 'submitted',
    detail: { kind: 'childcare', startDate: '2027-01-15', endDate: '2027-06-30', childLastName: '山田', childFirstName: '三郎', childBirthDate: '2026-11-20' },
  };
  const openLeave = (lp: Record<string, unknown> = {}) => ({
    employeeId: 'emp-001', status: 'in_progress', deletedAt: null, version: 2, steps: buildLeaveWizardSteps(),
    leaveProcedure: { kind: 'childcare', expectedBirthDate: null, child: null, period: null, filingId: null, ...lp },
  });

  it('育休：期間をまだ保存していなければ、申請の子と期間を入れる', async () => {
    mockDb.setDoc(`${base}/portalRequests/req-2`, leaveRequest);
    mockDb.setDoc(`${base}/procedures/proc-2`, openLeave());

    const result = await startLeave({ employeeId: 'emp-001', kind: 'childcare', sourceProcedureId: null, sourceRequestId: 'req-2' }, auth);

    expect(result).toEqual({ procedureId: 'proc-2', existing: true, prefilled: true });
    const op = mockDb.lastTransaction!.ops[0];
    expect(op.data['leaveProcedure.child']).toEqual({ lastName: '山田', firstName: '三郎', birthDate: '2026-11-20', bornByEmployee: false });
    expect(op.data['leaveProcedure.period']).toEqual({ startDate: '2027-01-15', plannedEnd: '2027-06-30', actualBirthDate: null, actualEndDate: null });
    expect(op.data.version).toBe(3);
  });

  it('育休：期間を保存済みなら入れず、prefilled: false を返す', async () => {
    mockDb.setDoc(`${base}/portalRequests/req-2`, leaveRequest);
    mockDb.setDoc(`${base}/procedures/proc-2`, openLeave({ period: { startDate: '2026-12-01', plannedEnd: '2027-05-31', actualBirthDate: null, actualEndDate: null } }));

    const result = await startLeave({ employeeId: 'emp-001', kind: 'childcare', sourceProcedureId: null, sourceRequestId: 'req-2' }, auth);

    expect(result.prefilled).toBe(false);
    expect(mockDb.lastTransaction!.ops).toHaveLength(0);
  });
});
