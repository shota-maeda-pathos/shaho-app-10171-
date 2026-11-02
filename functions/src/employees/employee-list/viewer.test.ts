import { viewerItem } from './functions';

test('閲覧者には氏名・社員番号・事業所・在籍だけを返す', () => {
  const full = {
    id: 'e1', employeeNumber: 'T-1', lastName: '山田', firstName: '太郎', officeId: 'o1', isActive: true,
    birthDate: '1990-01-01', postalCode: '100-0001', addressLine: '千代田1-1', phone: '03', email: 'a@example.com', basicPensionNumber: '1234', foreignInfo: { nationality: 'VN' },
  };
  expect(viewerItem(full)).toEqual({ id: 'e1', employeeNumber: 'T-1', lastName: '山田', firstName: '太郎', officeId: 'o1', isActive: true });
});
