import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
const citations = compile(fs.readFileSync(new URL('../src/utils/citations.ts', import.meta.url), 'utf8'));
let source = fs.readFileSync(new URL('../src/services/paperApi.ts', import.meta.url), 'utf8')
  .replace("import { invoke } from '@tauri-apps/api/core';", 'const invoke = (...args: unknown[]) => (globalThis as any).paperInvoke(...args);')
  .replace("import { openUrl } from '@tauri-apps/plugin-opener';", 'const openUrl = async () => {};')
  .replace("from '../utils/citations'", `from '${citations}'`);
const { paperApi } = await import(compile(source));
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const state = updatedAt => ({ papers: [], annotations: {}, overviews: {}, drafts: {}, updatedAt, aiConfig: { provider: 'deepseek', apiKey: 'secret', endpoint: 'https://test.invalid', model: 'test', temperature: 0 } });

test('paper library serializes writes, redacts credentials, and recovers the latest backup', async () => {
  const writes = [], resolve = [];
  globalThis.paperInvoke = (command, args) => {
    if (command === 'save_paper_library') { writes.push(JSON.parse(args.data)); return new Promise(done => resolve.push(done)); }
    return Promise.resolve('');
  };
  const first = paperApi.saveLibrary(state(1)), second = paperApi.saveLibrary(state(2));
  await new Promise(done => setTimeout(done, 0));
  assert.equal(writes.length, 1); assert.equal(writes[0].aiConfig.apiKey, '');
  assert(!localStorage.getItem('doc_tools_paper_library_backup').includes('secret'));
  resolve.shift()(); await first; await new Promise(done => setTimeout(done, 0));
  assert.equal(writes.length, 2); assert.equal(writes[1].updatedAt, 2); resolve.shift()(); await second;
  globalThis.paperInvoke = async command => { if (command === 'load_paper_library') return JSON.stringify({ ...state(1), aiConfig: undefined }); return ''; };
  const loaded = await paperApi.loadLibrary(); assert.equal(loaded.updatedAt, 2);
  globalThis.paperInvoke = async command => { if (command === 'load_paper_library') throw new Error('disk unavailable'); return ''; };
  assert.equal((await paperApi.loadLibrary()).updatedAt, 2);
  values.clear(); await assert.rejects(paperApi.loadLibrary(), /读取失败/);
});

test('credential persistence falls back to session and never saves plaintext in local settings', async () => {
  globalThis.paperInvoke = async () => { throw new Error('keychain unavailable'); };
  const config = await paperApi.saveAiConfig(state(1).aiConfig);
  assert.equal(config.keyPersistence, 'session');
  assert.equal(paperApi.loadLocalAiConfig().apiKey, 'secret');
  assert(!values.get('doc_tools_ai_config').includes('secret'));
  assert(!values.get('doc_tools_ai_providers').includes('secret'));
});
