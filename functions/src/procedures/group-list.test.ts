import { groupItemOf } from './group-list';
import { ProcedureDoc } from '../types/firestore';

const step = (id: string, status: string, statusDetail: string | null = null) => ({ id, label: id, status, statusDetail });

function proc(over: Partial<ProcedureDoc>): ProcedureDoc {
  return {
    procedureType: 'loss', status: 'in_progress', employeeId: 'e1', employeeName: '山田 太郎', officeId: 'o1', version: 3, steps: [],
    ...over,
  } as unknown as ProcedureDoc;
}

describe('groupItemOf', () => {
  it('旧方式の退職手続き（resignation がない）は一覧に出さない', () => {
    expect(groupItemOf('p1', proc({}), 'loss')).toBeNull();
  });

  it('退職日が未入力なら date は null、今のステップは退職日の入力', () => {
    const item = groupItemOf('p1', proc({
      resignation: { resignationDate: null } as ProcedureDoc['resignation'],
      steps: [step('entry', 'in_progress', '退職日の入力待ち'), step('settlement', 'not_started')] as ProcedureDoc['steps'],
    }), 'loss')!;
    expect(item).toMatchObject({ date: null, current: 'entry', currentDetail: '退職日の入力待ち', returned: false });
  });

  it('年齢到達は到達日と種類を返し、差し戻しを returned にする', () => {
    const item = groupItemOf('p2', proc({
      procedureType: 'age_event',
      ageEvent: { kind: 'pension70', reachDate: '2026-11-30' } as ProcedureDoc['ageEvent'],
      steps: [step('check', 'completed'), step('filing_create', 'returned', '差戻し：報酬月額を確認'), step('approval', 'not_started')] as ProcedureDoc['steps'],
    }), 'age_event')!;
    expect(item).toMatchObject({ date: '2026-11-30', kind: 'pension70', current: 'filing', returned: true, currentDetail: '差戻し：報酬月額を確認' });
  });
});
