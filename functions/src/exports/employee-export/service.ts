import { db } from '../../config';
import { Timestamp } from 'firebase-admin/firestore';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeExportInput } from './schema';
import { EMPLOYEE_CSV_COLUMNS, EXPORT_ONLY_COLUMNS } from '../../employees/employee-csv-import/rules';

export interface EmployeeExportResponse {
  csv: string;
  count: number;
}

export async function exportEmployees(
  input: EmployeeExportInput,
  auth: AuthContext,
): Promise<EmployeeExportResponse> {
  if (input.officeId) requireOffice(auth, input.officeId);
  let query = db
    .collection(`companies/${auth.companyId}/employees`)
    .where('deletedAt', '==', null) as FirebaseFirestore.Query;

  if (input.officeId) {
    query = query.where('officeId', '==', input.officeId);
  }
  query = query.where('isActive', '==', input.isActive ?? true);
  query = query.orderBy('employeeNumber', 'asc');

  const snap = await query.get();

  // 列は従業員CSVの取込と同じ（出力して直したものを、そのまま取り込める）。個人番号は出さない（カタログ14章）
  const columns = EMPLOYEE_CSV_COLUMNS.filter(c => c.field !== 'myNumber');
  const headers = [...columns.map(c => c.label), ...EXPORT_ONLY_COLUMNS];

  const docs = snap.docs.filter((doc) =>
    auth.roles.includes('admin') || auth.officeIds.includes(doc.data().officeId),
  );
  const [offices, departments] = docs.length
    ? await Promise.all([db.collection(`companies/${auth.companyId}/offices`).get(), db.collection(`companies/${auth.companyId}/departments`).get()])
    : [null, null];
  const officeName = new Map((offices?.docs ?? []).map(d => [d.id, String(d.data().name ?? d.id)]));
  const departmentName = new Map((departments?.docs ?? []).map(d => [d.id, String(d.data().name ?? '')]));
  const rows = docs.map((doc) => {
    const d = doc.data();
    const value = (field: string): unknown => {
      switch (field) {
        case 'birthDate': case 'hireDate': return formatDate(d[field]);
        case 'gender': return d.gender === 'male' ? '男' : d.gender === 'female' ? '女' : '';
        case 'office': return officeName.get(d.officeId) ?? d.officeId ?? '';
        case 'department': return d.departmentId ? departmentName.get(d.departmentId) ?? '' : '';
        default: return d[field] ?? '';
      }
    };
    return [
      ...columns.map(c => value(c.field)),
      formatDate(d.resignationDate),
      d.isActive ? '在籍' : '退職',
    ].map(escapeCsv).join(',');
  });

  const csv = '﻿' + [headers.join(','), ...rows].join('\r\n');
  return { csv, count: docs.length };
}

function escapeCsv(value: unknown): string {
  const raw = String(value ?? '');
  // 表計算ソフトで入力値が数式として実行されないようにする。
  const s = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatDate(value: Timestamp | string | null | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value.slice(0, 10) : value.toDate().toISOString().slice(0, 10);
}
