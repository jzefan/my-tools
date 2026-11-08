import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function loadTs(path) {
  const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('workbench suites follow the requested order', () => {
  const source = fs.readFileSync(new URL('../src/suites/registry.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export const ALL_SUITES');
  const block = source.slice(start, source.indexOf('];', start));
  const ids = [...block.matchAll(/([A-Z]+_SUITE)(?!S)/g)].map((match) => match[1]);
  assert.deepEqual(ids, [
    'DOCS_SUITE',
    'CLEANER_SUITE',
    'NETDISK_SUITE',
    'TYPING_SUITE',
    'PAPER_SUITE',
    'MEDIA_SUITE',
  ]);
});

test('online modules expose a searchable mini program name and the math site', async () => {
  const { ONLINE_MODULES } = await loadTs('../src/suites/online.ts');
  assert.deepEqual(ONLINE_MODULES, [
    { id: 'page-scan', name: '纸页快扫', kind: 'wechat', searchName: '纸页快扫' },
    { id: 'math-variation', name: '小学数学举一反三', kind: 'link', url: 'https://www.math314159.com' },
  ]);

  const home = fs.readFileSync(new URL('../src/components/home/HomeView.tsx', import.meta.url), 'utf8');
  assert.match(home, /ONLINE_MODULES/);
  assert.match(home, /微信搜索/);
  assert.doesNotMatch(home, /weixin:\/\/|wxaurl\.cn/);
});
