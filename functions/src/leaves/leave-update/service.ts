import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../config';
import { AuthContext, requireRole, requireOffice } from '../../middleware/auth';
import { invalidArg, notFound } from '../../utils/errors';
import { LeaveUpdateInput } from './schema';
export async function updateLeave(input: LeaveUpdateInput, auth: AuthContext) {
  requireRole(auth, 'admin', 'operator');
  const base = `companies/${auth.companyId}/employees/${input.employeeId}`;
  const target = db.doc(`${base}/leaves/${input.leaveId}`);
  const receipt = db.doc(`companies/${auth.companyId}/employeeRequests/${input.requestId}`);
  const fingerprint = JSON.stringify({ kind: 'leaveUpdate', employeeId: input.employeeId, id: input.leaveId, action: input.action, date: input.actualDate, version: input.expectedVersion });
  return db.runTransaction(async tx => {
    const employee = await tx.get(db.doc(base));
    if (!employee.exists || employee.data()!.deletedAt !== null) throw notFound('従業員');
    requireOffice(auth, employee.data()!.officeId);
    const previous = await tx.get(receipt);
    if (previous.exists) {
      if (previous.data()!.fingerprint !== fingerprint) throw invalidArg('同じrequestIdで異なる更新はできません');
      return previous.data()!.result;
    }
    const snapshot = await tx.get(target);
    if (!snapshot.exists) throw notFound('休業');
    const data = snapshot.data()!;
    const version = data.version ?? 1;
    if (version !== input.expectedVersion) throw new HttpsError('aborted', '他の操作で休業が更新されました。再読み込みしてください');
    if (input.action === 'start' && !['planned', 'scheduled'].includes(data.status)) throw invalidArg('予定の休業だけ開始できます');
    if (input.action === 'end' && data.status !== 'active') throw invalidArg('休業中の記録だけ終了できます');
    if (input.action === 'end' && (!data.actualStartDate || input.actualDate < data.actualStartDate)) throw invalidArg('終了日は実際の開始日以降にしてください');
    const now = Timestamp.now();
    const result = {
      id: target.id, status: input.action === 'start' ? 'active' : 'ended', version: version + 1,
      actualStartDate: input.action === 'start' ? input.actualDate : data.actualStartDate,
      actualEndDate: input.action === 'end' ? input.actualDate : null,
    };
    const { id: _id, ...changes } = result;
    tx.update(target, { ...changes, updatedAt: now });
    tx.set(receipt, { fingerprint, result, employeeId: input.employeeId, createdAt: now });
    tx.set(db.collection(`companies/${auth.companyId}/auditLogs`).doc(), {
      entity: 'leave', entityId: input.leaveId, action: input.action,
      changes: { status: { from: data.status, to: result.status }, actualStartDate: { from: data.actualStartDate ?? null, to: result.actualStartDate }, actualEndDate: { from: data.actualEndDate ?? null, to: result.actualEndDate } },
      performedBy: auth.uid, performedAt: now, version: result.version,
    });

    if (input.action === 'end' && data.leaveType === 'childcare') {
      const emp = employee.data()!;
      const officeSnap = await tx.get(db.doc(`companies/${auth.companyId}/offices/${emp.officeId}`));
      const office = officeSnap.exists ? officeSnap.data()! : null;
      const filingRef = db.collection(`${base}/filings`).doc();
      tx.set(filingRef, {
        filingType: 'childcareLeaveEnd',
        workflowStatus: 'draft',
        mockStatus: 'notStarted',
        submissionStatus: 'notSubmitted',
        effectiveDate: input.actualDate,
        formData: {
          '事業所整理記号': office?.officeNumber ?? '',
          '事業所名称': office?.name ?? '',
          '被保険者整理番号': emp.employeeNumber ?? '',
          '被保険者氏名': `${emp.lastName} ${emp.firstName}`,
          '届出区分': '育児休業等終了届',
          '休業開始日': data.actualStartDate ?? data.expectedStartDate,
          '休業終了日': input.actualDate,
          '備考': '',
        },
        submittedAt: null, resultReceivedAt: null, resultNote: null,
        version: 1, createdAt: now, updatedAt: now,
      });
    }

    return result;
  });
}
