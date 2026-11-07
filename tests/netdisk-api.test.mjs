import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const core = asModule(transpile('../src/utils/netdisk.ts'));
const tauri = asModule('export const isTauri = () => false; export const invoke = () => { throw Error("unexpected native call") };');
const opener = asModule('export const openUrl = () => { throw Error("unexpected open") };');
const source = transpile('../src/services/netdiskApi.ts').replace("from '@tauri-apps/api/core'", `from '${tauri}'`).replace("from '@tauri-apps/plugin-opener'", `from '${opener}'`).replace("from '../utils/netdisk'", `from '${core}'`);
const { fetchNetdiskSource } = await import(asModule(source));
const config = { id: 'progressive', name: 'PanSou', kind: 'pansou', baseUrl: 'https://search.example', enabled: true };
const payload = id => ({ results: [{ title: 'Linux', links: [{ url: `https://pan.baidu.com/s/1${id}`, password: 'abcd' }] }] });
const reply = data => ({ ok: true, status: 200, json: async () => data });

test('progressive reads never refresh the upstream twice and cache the full union', async () => {
  const originalFetch = globalThis.fetch, originalTimeout = globalThis.setTimeout;
  const requests = []; const partials = [];
  try {
    globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 3000 || ms === 6000 ? 0 : ms, ...args);
    globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(init.body)); return reply(payload(requests.length)); };
    const result = await fetchNetdiskSource(config, 'Linux', new AbortController().signal, true, '', rows => partials.push(rows.length));
    assert.deepEqual(partials, [1, 2, 3]); assert.equal(result.items.length, 3);
    assert.deepEqual(requests.map(r => r.refresh), [true, false, false]);
    const cached = await fetchNetdiskSource(config, 'Linux', new AbortController().signal);
    assert.equal(cached.cached, true); assert.equal(cached.items.length, 3); assert.equal(requests.length, 3);
  } finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; }
});

test('cancel during first partial prevents later fetches and leaves no cache entry', async () => {
  const original = globalThis.fetch; let requests = 0;
  try {
    globalThis.fetch = async () => { requests++; return reply(payload('cancel')); };
    const controller = new AbortController();
    await assert.rejects(fetchNetdiskSource({ ...config, id: 'cancel' }, 'cancel', controller.signal, false, '', () => controller.abort()), { name: 'AbortError' });
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});

test('follow-up outage retains initial real results', async () => {
  const original = globalThis.fetch, originalTimeout = globalThis.setTimeout; let requests = 0;
  try {
    globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 3000 || ms === 6000 ? 0 : ms, ...args);
    globalThis.fetch = async () => { if (requests++) throw Error('offline'); return reply(payload('partial')); };
    const result = await fetchNetdiskSource({ ...config, id: 'outage' }, 'outage', new AbortController().signal);
    assert.equal(result.items.length, 1); assert.equal(requests, 2);
  } finally { globalThis.fetch = original; globalThis.setTimeout = originalTimeout; }
});

test('already aborted requests and preview failures are surfaced', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () => { throw Error('unexpected request'); };
    const controller = new AbortController(); controller.abort();
    await assert.rejects(fetchNetdiskSource(config, 'a', controller.signal), { name: 'AbortError' });
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(fetchNetdiskSource(config, 'b', new AbortController().signal), /pnpm dev/);
    globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: '服务需要认证' }) });
    await assert.rejects(fetchNetdiskSource(config, 'c', new AbortController().signal), /认证/);
  } finally { globalThis.fetch = original; }
});

test('Melost progressively includes priority drives, without depending on PanSou', async () => {
  const original = globalThis.fetch; const requests = []; const partials = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const req = JSON.parse(init.body); requests.push(req);
      const url = req.cloudType === 'baidu' ? 'https://pan.baidu.com/s/1history' : req.cloudType === 'aliyun' ? 'https://www.alipan.com/s/history' : 'https://pan.quark.cn/s/history';
      return reply({ code: 200, data: { list: [{ disk_name: '史记', link: url }] } });
    };
    const result = await fetchNetdiskSource({ ...config, id: 'direct', kind: 'melost' }, '史记', new AbortController().signal, false, '', rows => partials.push(rows.length));
    assert.deepEqual(partials, [1, 2, 3]); assert.deepEqual(requests.map(r => r.cloudType), ['', 'baidu', 'aliyun']);
    assert.ok(requests.every(r => r.kind === 'melost')); assert.equal(result.items.length, 3);
  } finally { globalThis.fetch = original; }
});
