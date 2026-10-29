import { db } from '../../config';
import { Timestamp } from 'firebase-admin/firestore';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeExportInput } from './schema';

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

  const headers = [
    '社員番号', '姓', '名', '姓カナ', '名カナ',
    '生年月日', '性別', '事業所ID', '入社日', '退職日',
    '在籍状況',
  ];

  const docs = snap.docs.filter((doc) =>
    auth.roles.includes('admin') || auth.officeIds.includes(doc.data().officeId),
  );
  const rows = docs.map((doc) => {
    const d = doc.data();
    return [
      d.employeeNumber ?? '',
      d.lastName ?? '',
      d.firstName ?? '',
      d.lastNameKana ?? '',
      d.firstNameKana ?? '',
      formatDate(d.birthDate),
      d.gender ?? '',
      d.officeId ?? '',
      formatDate(d.hireDate),
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
