import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, FilingDoc } from '../../types/firestore';
import { notFound, invalidArg } from '../../utils/errors';
import { FilingMockSubmitInput } from './schema';

const REQUIRED_FIELDS: Record<string, string[]> = {
  acquisitionNotification: ['被保険者氏名', '生年月日', '性別', '資格取得年月日', '報酬月額_合計'],
  lossNotification: ['被保険者氏名', '生年月日', '資格喪失年月日', '喪失原因'],
  remunerationMonthlyChange: ['被保険者氏名', '改定年月', '1月目_通貨'],
  remunerationMonthlyAlgorithm: ['被保険者氏名', '対象年'],
  dependentChange: ['被保険者氏名', '被扶養者一覧'],
  bonusPayment: ['被保険者氏名', '賞与支払年月日', '賞与額_合計'],
  maternityLeaveStart: ['被保険者氏名'],
  childcareLeaveStart: ['被保険者氏名'],
  maternityLeaveChange: ['被保険者氏名', '出産予定年月日'],
  childcareLeaveEnd: ['被保険者氏名'],
  maternityLeaveEndChange: ['被保険者氏名', '改定年月', '休業終了年月日', '平均額'],
  childcareLeaveEndChange: ['被保険者氏名', '改定年月', '休業終了年月日', '平均額'],
  pensionLoss70: ['被保険者氏名', '生年月日', '資格喪失年月日', '報酬月額_合計'],
};

function validateFormData(filingType: string, formData: Record<string, unknown>): string[] {
  const required = REQUIRED_FIELDS[filingType] ?? [];
  const missing: string[] = [];
  for (const field of required) {
    if (formData[field] == null || formData[field] === '') {
      missing.push(field);
    }
  }
  return missing;
}

export interface FilingMockSubmitResponse {
  success: boolean;
  id: string;
  mockStatus: 'completed' | 'failed';
  validationErrors: string[];
  eGovResponse: {
    responseCode: string;
    responseMessage: string;
    acceptanceNumber: string | null;
    processedAt: string;
  };
}

export async function mockSubmitFiling(
  input: FilingMockSubmitInput,
  auth: AuthContext,
): Promise<FilingMockSubmitResponse> {
  const base = `companies/${auth.companyId}`;
  const empRef = db.doc(`${base}/employees/${input.employeeId}`);
  const filingRef = db.doc(`${base}/employees/${input.employeeId}/filings/${input.filingId}`);

  const result = await db.runTransaction(async (tx) => {
    const empSnap = await tx.get(empRef);
    if (!empSnap.exists || empSnap.data()!.deletedAt !== null) throw notFound('従業員');
    const employee = empSnap.data()! as EmployeeDoc;

    if (!auth.roles.includes('admin')) requireOffice(auth, employee.officeId);

    const filingSnap = await tx.get(filingRef);
    if (!filingSnap.exists) throw notFound('届出');
    const filing = filingSnap.data()! as FilingDoc;

    if (filing.version !== input.expectedVersion) {
      throw invalidArg(`版番号が一致しません（現行: ${filing.version}, 指定: ${input.expectedVersion}）`);
    }

    if (filing.workflowStatus !== 'approved') {
      throw invalidArg('社内承認が完了していない届出は模擬申請できません');
    }

    if (filing.mockStatus === 'completed') {
      throw invalidArg('模擬申請は既に完了しています');
    }

    const errors = validateFormData(filing.filingType, filing.formData);
    const mockStatus = errors.length === 0 ? 'completed' : 'failed';
    const now = Timestamp.now();
    const acceptanceNumber = mockStatus === 'completed'
      ? `MOCK-${now.toDate().getFullYear()}${String(now.toDate().getMonth() + 1).padStart(2, '0')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
      : null;

    tx.update(filingRef, {
      mockStatus,
      mockValidationErrors: errors,
      mockSubmittedAt: now,
      mockAcceptanceNumber: acceptanceNumber,
      version: filing.version + 1,
      updatedAt: now,
    });

    const auditRef = db.collection(`${base}/auditLogs`).doc();
    tx.set(auditRef, {
      entity: 'filing',
      entityId: input.filingId,
      action: 'update',
      changes: { mockStatus: { from: filing.mockStatus, to: mockStatus } },
      performedBy: auth.uid,
      performedAt: now,
      version: filing.version + 1,
    });

    return {
      mockStatus: mockStatus as 'completed' | 'failed',
      validationErrors: errors,
      acceptanceNumber,
      processedAt: now.toDate().toISOString(),
    };
  });

  const { refreshEmployeeProcedures } = await import('../../procedures/hooks');
  await refreshEmployeeProcedures(auth.companyId, input.employeeId);

  return {
    success: true,
    id: input.filingId,
    mockStatus: result.mockStatus,
    validationErrors: result.validationErrors,
    eGovResponse: {
      responseCode: result.mockStatus === 'completed' ? '0000' : '9001',
      responseMessage: result.mockStatus === 'completed' ? '正常に受け付けました（模擬）' : `必須項目が不足しています: ${result.validationErrors.join(', ')}`,
      acceptanceNumber: result.acceptanceNumber,
      processedAt: result.processedAt,
    },
  };
}
