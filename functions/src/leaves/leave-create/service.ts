import { db } from '../../config';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc, OfficeDoc } from '../../types/firestore';
import { LeaveCreateInput } from './schema';

export interface LeaveCreateResponse {
  id: string;
  exemptionId: string | null;
  filingId: string | null;
}

function dateToMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function filingTypeForLeave(leaveType: string, action: 'start'): string {
  if (leaveType === 'maternity') return 'maternityLeaveStart';
  return 'childcareLeaveStart';
}

export async function createLeave(
  input: LeaveCreateInput,
  auth: AuthContext,
): Promise<LeaveCreateResponse> {
  const base = `companies/${auth.companyId}`;
  const empRef = db.doc(`${base}/employees/${input.employeeId}`);
  const empSnap = await empRef.get();
  if (!empSnap.exists || empSnap.data()?.deletedAt !== null) {
    const { HttpsError } = await import('firebase-functions/v2/https');
    throw new HttpsError('not-found', '従業員が見つかりません');
  }
  const employee = empSnap.data()! as EmployeeDoc;

  if (!auth.roles.includes('admin')) {
    requireOffice(auth, employee.officeId);
  }

  const leaveRef = db.collection(`${base}/employees/${input.employeeId}/leaves`).doc();

  await leaveRef.set({
    leaveType: input.leaveType,
    expectedStartDate: input.expectedStartDate,
    expectedEndDate: input.expectedEndDate,
    actualStartDate: input.actualStartDate ?? null,
    actualEndDate: null,
    status: 'planned',
    notes: input.notes ?? '',
    createdBy: auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    version: 1,
  });

  let exemptionId: string | null = null;
  let filingId: string | null = null;

  if (input.leaveType === 'maternity' || input.leaveType === 'childcare') {
    const startMonth = dateToMonth(input.expectedStartDate);
    const endMonth = dateToMonth(input.expectedEndDate);
    const now = Timestamp.now();

    const exemptionRef = db.collection(`${base}/employees/${input.employeeId}/premiumExemptions`).doc();
    await exemptionRef.set({
      exemptionType: input.leaveType,
      startMonth,
      endMonth,
      approvedAt: null,
      status: 'pending',
      isMonthlyExempted: true,
      isBonusExempted: input.leaveType === 'childcare',
      leaveId: leaveRef.id,
      notes: `${input.leaveType === 'maternity' ? '産前産後' : '育児'}休業に伴う自動生成`,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    exemptionId = exemptionRef.id;

    const officeSnap = await db.doc(`${base}/offices/${employee.officeId}`).get();
    const office = officeSnap.exists ? officeSnap.data()! as OfficeDoc : null;

    const filingRef = db.collection(`${base}/employees/${input.employeeId}/filings`).doc();
    await filingRef.set({
      filingType: filingTypeForLeave(input.leaveType, 'start'),
      workflowStatus: 'draft',
      mockStatus: 'notStarted',
      submissionStatus: 'notSubmitted',
      effectiveDate: input.expectedStartDate,
      formData: {
        '事業所整理記号': office?.officeNumber ?? '',
        '事業所名称': office?.name ?? '',
        '被保険者整理番号': employee.employeeNumber,
        '被保険者氏名': `${employee.lastName} ${employee.firstName}`,
        '生年月日': '',
        '性別': employee.gender === 'male' ? '男' : '女',
        '届出区分': input.leaveType === 'maternity' ? '産前産後休業取得者申出書' : '育児休業等取得者申出書',
        '休業開始日': input.expectedStartDate,
        '休業終了予定日': input.expectedEndDate,
        '備考': '',
      },
      submittedAt: null,
      resultReceivedAt: null,
      resultNote: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    filingId = filingRef.id;

    const auditRef = db.collection(`${base}/auditLogs`).doc();
    await auditRef.set({
      entity: 'leave',
      entityId: leaveRef.id,
      action: 'create',
      changes: {
        exemption: { from: null, to: exemptionId },
        filing: { from: null, to: filingId },
        source: { from: null, to: 'autoGenerate' },
      },
      performedBy: auth.uid,
      performedAt: now,
      version: 1,
    });
  }

  const { notify } = await import('../../utils/notify');
  await notify({
    companyId: auth.companyId,
    title: '休業登録',
    body: `${input.leaveType === 'maternity' ? '産前産後休業' : '育児休業'}が登録されました`,
    category: 'leave',
    targetType: 'leave',
    targetId: leaveRef.id,
    createdBy: auth.uid,
  });

  return { id: leaveRef.id, exemptionId, filingId };
}
