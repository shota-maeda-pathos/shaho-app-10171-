import { HomeTodo, payDateOf, sortTodos } from './rules';

const todo = (title: string, deadline: string | null, tone: HomeTodo['tone']): HomeTodo => ({
  id: title, kind: 'procedure', title, next: '', detail: null, officeName: '', deadline, tone, route: '/', queryParams: {}, updatedAt: null,
});

describe('ホーム：給与の支給日', () => {
  it('支給日がその月にあればその日、月末を超えれば月末', () => {
    expect(payDateOf('2026-11', 25)).toBe('2026-11-25');
    expect(payDateOf('2026-02', 31)).toBe('2026-02-28');
    expect(payDateOf('2026-11', 30)).toBe('2026-11-30');
  });
  it('支給日が未登録なら月末', () => {
    expect(payDateOf('2026-12', undefined)).toBe('2026-12-31');
  });
});

describe('ホーム：やることの並び順', () => {
  it('期限の近い順で、期限のないものは後ろ。同じ期限なら要対応が先', () => {
    const sorted = sortTodos([todo('期限なし', null, 'action'), todo('待ち', '2026-11-05', 'waiting'), todo('要対応', '2026-11-05', 'action'), todo('早い', '2026-11-01', 'yours')]);
    expect(sorted.map(t => t.title)).toEqual(['早い', '要対応', '待ち', '期限なし']);
  });
});
