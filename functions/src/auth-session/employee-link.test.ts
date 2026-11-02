import { makeEmployeeDoc } from '../__tests__/helpers';

jest.mock('../config', () => ({ db: {} }));

import { employeeLinkProblem } from './service';

describe('employeeLinkProblem（従業員につなぐ招待を受けられるか）', () => {
  it('在籍中でだれにもつながっていなければ受けられる', () => {
    expect(employeeLinkProblem(makeEmployeeDoc(), null)).toBeNull();
    expect(employeeLinkProblem(makeEmployeeDoc({ userId: 'uid-1' }), 'uid-1')).toBeNull();
  });

  it('退職した・消された・見つからない従業員は断る', () => {
    expect(employeeLinkProblem(makeEmployeeDoc({ isActive: false }), null)).toMatch('退職');
    expect(employeeLinkProblem(makeEmployeeDoc({ resignationDate: makeEmployeeDoc().hireDate }), null)).toMatch('退職');
    expect(employeeLinkProblem(makeEmployeeDoc({ deletedAt: makeEmployeeDoc().hireDate }), null)).toMatch('見つかりません');
    expect(employeeLinkProblem(undefined, null)).toMatch('見つかりません');
  });

  it('ほかのアカウントにつながっている従業員は断る（上書きしない）', () => {
    expect(employeeLinkProblem(makeEmployeeDoc({ userId: 'uid-1' }), null)).toMatch('別のアカウント');
    expect(employeeLinkProblem(makeEmployeeDoc({ userId: 'uid-1' }), 'uid-2')).toMatch('別のアカウント');
  });
});
