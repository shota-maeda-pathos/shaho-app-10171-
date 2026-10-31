import { chainHash } from './seal';

describe('chainHash', () => {
  const log = { entity: 'employee', entityId: 'e1', action: 'update', changes: { name: { from: 'a', to: 'b' } }, performedBy: 'u1' };

  it('同じ中身・同じつながりなら同じ指紋、封の項目は指紋に入れない', () => {
    const h = chainHash('', 1, log);
    expect(chainHash('', 1, { ...log, seq: 1, prevHash: '', hash: 'x', sealedAt: 'y' })).toBe(h);
  });

  it('中身・通し番号・前の指紋のどれかが変わると指紋が変わる', () => {
    const h = chainHash('', 1, log);
    expect(chainHash('', 1, { ...log, changes: { name: { from: 'a', to: 'c' } } })).not.toBe(h);
    expect(chainHash('', 2, log)).not.toBe(h);
    expect(chainHash('abc', 1, log)).not.toBe(h);
  });
});
