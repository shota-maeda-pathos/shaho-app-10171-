import * as fs from 'fs';
import * as path from 'path';

// 関数の一覧（index.ts）は読み込みを遅らせているため、名前の誤りが型で見つからない。ここで全部読み込んで確かめる。
const functions = require('./index') as Record<string, { __endpoint?: { region?: string[] } }>;

test('一覧の名前はすべて関数を指し、東京で動く', () => {
  const names = Object.keys(functions);
  expect(names.length).toBeGreaterThan(150);
  for (const name of names) {
    const endpoint = functions[name]?.__endpoint;
    expect([name, endpoint === undefined]).toEqual([name, false]);
    expect([name, endpoint?.region]).toEqual([name, ['asia-northeast1']]);
  }
});

test('関数のモジュールの公開している関数はすべて一覧にある', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  const modules = [...source.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]);
  for (const module of new Set(modules)) {
    for (const [name, value] of Object.entries(require(module) as Record<string, unknown>)) {
      if ((value as { __endpoint?: unknown })?.__endpoint) expect([module, name, name in functions]).toEqual([module, name, true]);
    }
  }
});
