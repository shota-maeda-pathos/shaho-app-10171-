import { afterFailure, domainAllowed, isLocked, passwordProblem, sessionProblem } from './rules';

const MIN = 60 * 1000;

describe('passwordProblem', () => {
  it('8文字以上で英字と数字があれば通る', () => {
    expect(passwordProblem('abcdefg1')).toBeNull();
  });
  it('短い・数字だけ・英字だけは通らない', () => {
    expect(passwordProblem('abc123')).toMatch('8文字');
    expect(passwordProblem('12345678')).toMatch('英字と数字');
    expect(passwordProblem('abcdefgh')).toMatch('英字と数字');
  });
});

describe('ログインのロック', () => {
  it('5回目の失敗で30分ロックする', () => {
    let g = null;
    for (let i = 0; i < 4; i++) g = afterFailure(g, 0);
    expect(g).toEqual({ failures: 4, lockedUntil: null });
    g = afterFailure(g, 0);
    expect(g.lockedUntil).toBe(30 * MIN);
    expect(isLocked(g, 29 * MIN)).toBe(true);
    expect(isLocked(g, 30 * MIN)).toBe(false);
  });
  it('ロックが明けた後の失敗は1回目から数える', () => {
    const g = afterFailure({ failures: 5, lockedUntil: 30 * MIN }, 31 * MIN);
    expect(g).toEqual({ failures: 1, lockedUntil: null });
  });
});

describe('sessionProblem', () => {
  const s = { createdAt: 0, lastActiveAt: 0, revokedAt: null };
  it('8時間・無操作30分・切断で使えなくなる', () => {
    expect(sessionProblem(s, 29 * MIN)).toBeNull();
    expect(sessionProblem(s, 31 * MIN)).toMatch('30分');
    expect(sessionProblem({ ...s, lastActiveAt: 8 * 60 * MIN }, 8 * 60 * MIN + 1)).toMatch('8時間');
    expect(sessionProblem({ ...s, revokedAt: 1 }, 1)).toMatch('切断');
    expect(sessionProblem(null, 0)).not.toBeNull();
  });
});

describe('domainAllowed', () => {
  it('未設定ならどのドメインも可、設定があればそのドメインだけ', () => {
    expect(domainAllowed('a@gmail.com', [])).toBe(true);
    expect(domainAllowed('a@example.com', ['example.com'])).toBe(true);
    expect(domainAllowed('a@Example.com', ['@example.com'])).toBe(true);
    expect(domainAllowed('a@gmail.com', ['example.com'])).toBe(false);
  });
});
