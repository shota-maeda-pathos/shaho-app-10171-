import { db } from '../../config';
import { AuthContext, requireOffice } from '../../middleware/auth';
import { EmployeeDoc } from '../../types/firestore';
import { EmployeeResponse, ListResponse } from '../../types/response';
import { toEmployeeResponse } from '../../utils/firestore';
import { EmployeeListInput } from './schema';

export async function listEmployees(
  input: EmployeeListInput,
  auth: AuthContext,
): Promise<ListResponse<EmployeeResponse>> {
  if(input.officeId) requireOffice(auth,input.officeId);
  const { companyId } = auth;
  const collRef = db.collection(`companies/${companyId}/employees`);

  const targetOfficeIds = auth.roles.includes('admin')
    ? null
    : auth.officeIds;

  if (targetOfficeIds && targetOfficeIds.length === 0) {
    return { items: [], total: 0, hasMore: false };
  }

  if (input.keyword?.trim()) {
    return searchByKeyword(collRef, input, targetOfficeIds, companyId);
  }

  let query: FirebaseFirestore.Query = collRef
    .where('deletedAt', '==', null)
    .orderBy('employeeNumber', 'asc');

  if (targetOfficeIds) {
    query = query.where('officeId', 'in', targetOfficeIds);
  }
  if (input.officeId) {
    query = query.where('officeId', '==', input.officeId);
  }
  if (input.departmentId) {
    query = query.where('departmentId', '==', input.departmentId);
  }
  if (!input.includeResigned) {
    query = query.where('isActive', '==', true);
  }

  const countSnap = await query.count().get();
  const total = countSnap.data().count;

  if (input.lastDocId) {
    const lastDoc = await db
      .doc(`companies/${companyId}/employees/${input.lastDocId}`)
      .get();
    if (lastDoc.exists) {
      query = query.startAfter(lastDoc);
    }
  }
  const effectiveLimit = input.limit ?? 20;
  query = query.limit(effectiveLimit + 1);

  const snap = await query.get();
  const hasMore = snap.docs.length > effectiveLimit;
  const docs = hasMore ? snap.docs.slice(0, effectiveLimit) : snap.docs;

  return {
    items: docs.map((d) =>
      toEmployeeResponse(d.id, d.data() as EmployeeDoc),
    ),
    total,
    hasMore,
    lastDocId: docs.length > 0 ? docs[docs.length - 1].id : undefined,
  };
}

/** 検索で読む項目（絞り込みと並べ替えに使うものだけ。返す1ページ分は後で全項目を読む） */
const SEARCH_FIELDS = [
  'employeeNumber', 'lastName', 'firstName', 'lastNameKana', 'firstNameKana',
  'officeId', 'departmentId', 'isActive', 'deletedAt',
] as const;

type SearchRow = Pick<EmployeeDoc, (typeof SEARCH_FIELDS)[number]> & { id: string };
type NameFields = Pick<EmployeeDoc, 'employeeNumber' | 'lastName' | 'firstName' | 'lastNameKana' | 'firstNameKana'>;

/** 空白を除き、全角英数を半角・半角カナを全角・ひらがなをカタカナ・英字を小文字にそろえる */
export function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/\s/g, '')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .toLowerCase();
}

/** 氏名・カナ・社員番号のどれかに検索語が含まれるか（姓と名は続けても空白で区切っても探せる） */
export function matchesKeyword(row: NameFields, keyword: string): boolean {
  const term = normalizeSearchText(keyword);
  if (!term) return true;
  return [
    `${row.lastName ?? ''}${row.firstName ?? ''}`,
    `${row.lastNameKana ?? ''}${row.firstNameKana ?? ''}`,
    row.employeeNumber,
  ].some((text) => normalizeSearchText(text).includes(term));
}

/** カナ（姓→名）→社員番号の順 */
function compareByKana(a: SearchRow, b: SearchRow): number {
  return (a.lastNameKana ?? '').localeCompare(b.lastNameKana ?? '', 'ja')
    || (a.firstNameKana ?? '').localeCompare(b.firstNameKana ?? '', 'ja')
    || (a.employeeNumber ?? '').localeCompare(b.employeeNumber ?? '', 'ja')
    || a.id.localeCompare(b.id);
}

/**
 * 名前・カナ・社員番号で探す。複合索引に頼らないよう、Firestore には事業所の等価条件だけを渡し
 * （admin で事業所の指定がなければ会社の全員）、削除・部署・在籍と検索語はメモリで絞る。
 * 読むのは SEARCH_FIELDS だけで、返す1ページ分だけ全項目を読む。
 */
async function searchByKeyword(
  collRef: FirebaseFirestore.CollectionReference,
  input: EmployeeListInput,
  targetOfficeIds: string[] | null,
  companyId: string,
): Promise<ListResponse<EmployeeResponse>> {
  const officeIds = input.officeId ? [input.officeId] : targetOfficeIds;
  const queries: FirebaseFirestore.Query[] = officeIds
    ? officeIds.map((officeId) => collRef.where('officeId', '==', officeId))
    : [collRef];
  const snaps = await Promise.all(queries.map((q) => q.select(...SEARCH_FIELDS).get()));

  const rows: SearchRow[] = snaps
    .flatMap((snap) => snap.docs.map((d) => ({ ...(d.data() as Omit<SearchRow, 'id'>), id: d.id })))
    .filter((row) => row.deletedAt === null)
    .filter((row) => !input.departmentId || row.departmentId === input.departmentId)
    .filter((row) => input.includeResigned || row.isActive === true)
    .filter((row) => matchesKeyword(row, input.keyword!))
    .sort(compareByKana);

  const start = input.lastDocId ? rows.findIndex((row) => row.id === input.lastDocId) + 1 : 0;
  const effectiveLimit = input.limit ?? 20;
  const page = rows.slice(start, start + effectiveLimit);
  const hasMore = start + effectiveLimit < rows.length;

  const fullSnaps = page.length
    ? await db.getAll(...page.map((row) => db.doc(`companies/${companyId}/employees/${row.id}`)))
    : [];
  const items = fullSnaps
    .filter((d) => d.exists)
    .map((d) => toEmployeeResponse(d.id, d.data() as EmployeeDoc));

  return {
    items,
    total: rows.length,
    hasMore,
    lastDocId: page.length > 0 ? page[page.length - 1].id : undefined,
  };
}
