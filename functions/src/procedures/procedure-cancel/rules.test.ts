import { cancelPermissionProblem, filingCancelPlan, procedureFilingIds } from './rules';

describe('手続きをやめられる人', () => {
  const base = { creatorName: '梅野 隆太郎', reason: '' };
  it('自分が始めた手続きは、担当者でも理由なしでやめられる', () => {
    expect(cancelPermissionProblem({ ...base, roles: ['operator'], uid: 'u2', createdBy: 'u2' })).toBeNull();
  });
  it('ほかの人が始めた手続きは、担当者はやめられず、だれに頼むかを返す', () => {
    expect(cancelPermissionProblem({ ...base, roles: ['operator'], uid: 'u3', createdBy: 'u2' })).toContain('梅野 隆太郎さんか管理者に頼んでください');
  });
  it('管理者はほかの人の手続きもやめられるが、理由が要る', () => {
    expect(cancelPermissionProblem({ ...base, roles: ['admin'], uid: 'u1', createdBy: 'u2' })).toContain('理由');
    expect(cancelPermissionProblem({ ...base, roles: ['admin'], uid: 'u1', createdBy: 'u2', reason: '重複' })).toBeNull();
  });
  it('始めた人が記録されていない古い手続きは、管理者だけ（理由つき）', () => {
    expect(cancelPermissionProblem({ ...base, roles: ['operator'], uid: 'u2', createdBy: undefined })).not.toBeNull();
    expect(cancelPermissionProblem({ ...base, roles: ['admin'], uid: 'u1', createdBy: undefined, reason: '古い' })).toBeNull();
  });
});

describe('届出の状態', () => {
  it('下書き・差し戻しの届出は一緒に取り下げる。取り下げ済みは数えない', () => {
    expect(filingCancelPlan([
      { id: 'a', workflowStatus: 'draft' }, { id: 'b', workflowStatus: 'rejected' }, { id: 'c', workflowStatus: 'cancelled', cancelledAt: 1 },
    ])).toEqual({ problem: null, discard: ['a', 'b'] });
  });
  it('承認を頼んでいる最中の届出があれば、やめられない', () => {
    expect(filingCancelPlan([{ id: 'a', workflowStatus: 'pending' }]).problem).toContain('差し戻して');
  });
  it('承認済み・提出済み・模擬申請中の届出があれば、やめられない', () => {
    expect(filingCancelPlan([{ id: 'a', workflowStatus: 'approved' }]).problem).toContain('訂正届');
    expect(filingCancelPlan([{ id: 'a', workflowStatus: 'draft', submissionStatus: 'submitted' }]).problem).not.toBeNull();
    expect(filingCancelPlan([{ id: 'a', workflowStatus: 'draft', mockStatus: 'processing' }]).problem).not.toBeNull();
  });
});

describe('手続きにつながる届出', () => {
  it('ウィザードの状態と参照から、届出の ID を重ならずに集める', () => {
    const proc = {
      references: [{ type: 'filing', documentId: 'f1' }, { type: 'approval', documentId: 'a1' }],
      dependentChange: { filingId: 'f1', items: [] },
      transfer: { lossFilingId: 'f2', acquisitionFilingId: 'f3' },
      leaveProcedure: { history: [{ filingId: 'f4' }], filingIds: ['f5'] },
    } as never;
    expect(procedureFilingIds(proc).sort()).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
  });
});
