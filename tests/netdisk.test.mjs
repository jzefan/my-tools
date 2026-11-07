import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function moduleUrl(path, dependencies = {}) {
  let source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [name, url] of Object.entries(dependencies)) source = source.replaceAll(`from '${name}'`, `from '${url}'`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const coreUrl = moduleUrl('../src/utils/netdisk.ts');
const { normalizeShare, parseNetdiskPayload, mergeNetdiskItems, rankNetdiskItems, buildNetdiskRequest, validateSourceUrl, shareText } = await import(coreUrl);
const { searchNetdisk } = await import(moduleUrl('../src/utils/netdiskSearch.ts', { './netdisk': coreUrl }));
const source = { id: 'one', kind: 'pansou', baseUrl: 'https://search.example/prefix', name: '源一', enabled: true };
const link = { url: 'https://pan.baidu.com/s/1ABC?utm_source=x', note: '<em>Linux</em> 教程', datetime: '2026-10-01' };
const parse = payload => parseNetdiskPayload(payload, 'pansou', source.name);

test('share identity ignores aliases and tracking but preserves functional passwords', () => {
  assert.equal(normalizeShare('https://www.aliyundrive.com/s/AbCd?from=ads').id, normalizeShare('https://www.alipan.com/s/AbCd').id);
  assert.equal(normalizeShare('https://123865.com/s/one').id, normalizeShare('https://www.123pan.com/s/one?utm_source=ad').id);
  assert.equal(normalizeShare('https://pan.baidu.com/share/init?surl=ABC').id, normalizeShare('https://pan.baidu.com/s/1ABC').id);
  const share = normalizeShare('http://pan.baidu.com/s/1ABC?pwd=1234&utm_source=ad');
  assert.equal(share.password, '1234'); assert.equal(share.url, 'https://pan.baidu.com/s/1ABC?pwd=1234');
  assert.equal(normalizeShare('https://115.com/s/ABC#password=abcd').password, 'abcd');
  assert.equal(normalizeShare('https://cloud.189.cn/web/share?code=ABC').id, normalizeShare('https://cloud.189.cn/t/ABC').id);
});

test('rejects executable URLs, spoofed hosts, credentials and non-share pages', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://pan.baidu.com.evil.test/s/1ABC', 'https://pan.baidu.com@evil.test/s/1ABC', 'https://user@pan.baidu.com/s/1ABC', 'https://pan.baidu.com/', 'https://pan.baidu.com:1234/s/1ABC', 'https://unknown.test/s/ABC']) assert.equal(normalizeShare(url), null, url);
});

test('parses both PanSou envelopes, merges groups and raw results, and enriches missing passwords', () => {
  const body = { merged_by_type: { baidu: [link] }, results: [{ title: 'Linux 课程', content: 'Linux 教程详情', links: [{ url: link.url, password: 'abcd' }] }] };
  for (const data of [body, { code: 0, data: body }]) {
    const rows = parse(data); assert.equal(rows.length, 1); assert.equal(rows[0].title, 'Linux 教程'); assert.equal(rows[0].password, 'abcd'); assert.equal(rows[0].description, 'Linux 教程详情');
    assert.match(shareText(rows[0]), /提取码：abcd/);
  }
  assert.equal(parse({ results: [], merged_by_type: null }).length, 0);
  assert.throws(() => parse({ code: 401, message: '需要登录' }), /需要登录/);
  assert.throws(() => parse({ html: 'login' }), /格式/);
  assert.equal(parse({ results: [{ links: [{ type: 'baidu', url: 'https://evil.test' }] }] }).length, 0);
});

test('parses direct sources, HTML titles, extraction codes and zero timestamps', () => {
  const qupan = parseNetdiskPayload({ status: 200, data: [{ ...link, title: '<b>Linux</b>', extcode: 'qwer', updatetime: '2026-10-01 10:00:00' }] }, 'qupansou', '趣盘搜');
  assert.equal(qupan[0].password, 'qwer');
  for (const wrapper of [data => ({ props: { pageProps: { data } } }), data => ({ pageProps: { data } })]) {
    const rows = parseNetdiskPayload(wrapper({ data: [{ content: '名称：Linux 入门<br>链接：<a href="https://pan.baidu.com/s/1ABC?pwd=abcd&amp;utm_source=ad">资源</a><br>提取码：abcd', time: '0001-01-01T00:00:00Z' }] }), 'pansearch', '盘搜');
    assert.equal(rows.length, 1); assert.equal(rows[0].password, 'abcd'); assert.equal(rows[0].title, 'Linux 入门'); assert.equal(rows[0].datetime, ''); assert.doesNotMatch(rows[0].url, /utm_source/);
  }
});

test('merges sources without mutating inputs and sorts relevant titles first', () => {
  const [item] = parse({ merged_by_type: { baidu: [link] } });
  const other = { ...item, datetime: '2026-11-01T00:00:00.000Z', password: 'new1', sources: ['源二'] };
  const [merged] = mergeNetdiskItems([item], [other]); assert.deepEqual(merged.sources, ['源一', '源二']); assert.equal(merged.password, 'new1'); assert.deepEqual(item.sources, ['源一']);
  const [updated] = mergeNetdiskItems([{ ...item, password: 'old1', url: `${item.url}?pwd=old1` }], [{ ...other, url: `${item.url}?pwd=new1` }]);
  assert.match(updated.url, /pwd=new1$/);
  const unrelated = { ...other, id: 'other', title: '无关资源', description: 'Linux', datetime: '2026-12-01T00:00:00.000Z' };
  assert.equal(rankNetdiskItems([unrelated, item], 'Linux')[0].id, item.id);
  assert.equal(rankNetdiskItems([unrelated, item], 'Linux', true)[0].id, 'other');
});

test('resource summaries keep descriptions and omit duplicate titles and channel promotion', () => {
  const [item] = parse({ results: [{ title: 'Linux 课程', content: '名称：Linux 课程描述：掌握系统运维。链接：https://pan.baidu.com/s/1ABC📢 频道：@ads🤖 投稿：@bot', links: [link] }] });
  assert.equal(item.description, '掌握系统运维。');
});

test('request URL preserves service prefixes and safely encodes keywords', () => {
  const request = buildNetdiskRequest(source, 'C++ & 资料', true);
  const url = new URL(request.url); assert.equal(url.pathname, '/prefix/api/search'); assert.equal(url.searchParams.get('kw'), 'C++ & 资料'); assert.equal(url.searchParams.get('refresh'), 'true');
  for (const bad of ['file:///tmp', 'https://u:p@example.com', 'https://example.com?token=secret']) assert.throws(() => validateSourceUrl(bad));
});

test('direct disk APIs preserve titles, passwords and real drive identities', () => {
  const payload = { code: 200, data: { list: [{ disk_name: '<em>史记</em> 集解', link: 'https://www.alipan.com/s/Shiji', disk_pass: 'abcd', files: 'PDF 全集', shared_time: '2026-10-01 12:00:00' }] } };
  const [item] = parseNetdiskPayload(payload, 'melost', 'Melost');
  assert.equal(item.title, '史记 集解'); assert.equal(item.drive, 'aliyun'); assert.equal(item.password, 'abcd');
  assert.throws(() => parseNetdiskPayload({ code: 0, msg: '需要登录', data: null }, 'qkpanso', 'QKPAN'), /登录/);
});

test('direct requests use provider protocol and targeted Baidu/Alipan searches', () => {
  const direct = { ...source, kind: 'melost', baseUrl: 'https://www.melost.cn' };
  const req = buildNetdiskRequest(direct, '史记', false, 'aliyun');
  assert.equal(req.url, 'https://www.melost.cn/v1/search/disk');
  const body = JSON.parse(req.body); assert.equal(body.q, '史记'); assert.equal(body.type, 'ALY'); assert.equal(body.size, 50);
});

test('old single-provider settings upgrade without losing bookmarks or custom services', async () => {
  const values = new Map(); globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const constants = moduleUrl('../src/types/netdisk.ts');
  const storage = await import(moduleUrl('../src/utils/netdiskStorage.ts', { '../types/netdisk': constants, './netdisk': coreUrl }));
  values.set('doc-tools.netdisk.v1.sources', JSON.stringify([{ id: 'pansou', name: 'PanSou', kind: 'pansou', baseUrl: 'https://so.252035.xyz', enabled: true }, source]));
  const migrated = storage.loadNetdiskSources();
  assert.ok(migrated.some(s => s.kind === 'melost' && s.enabled)); assert.ok(migrated.some(s => s.kind === 'qkpanso' && s.enabled));
  assert.equal(migrated.find(s => s.id === 'pansou').enabled, false); assert.equal(migrated.find(s => s.id === source.id).enabled, true);
  storage.saveNetdiskState('sources', migrated.filter(s => s.kind !== 'qkpanso'));
  assert.ok(!storage.loadNetdiskSources().some(s => s.kind === 'qkpanso'));
  delete globalThis.localStorage;
});

test('concurrent search yields fast partial results and isolates failed providers', async () => {
  const [item] = parse({ results: [{ links: [link] }] });
  const updates = [];
  await searchNetdisk([source, { ...source, id: 'broken' }], 'Linux', new AbortController().signal, false,
    async s => { if (s.id === 'broken') { await new Promise(resolve => setTimeout(resolve, 10)); throw new Error('offline'); } return { items: [item], cached: false }; },
    (items, progress) => updates.push({ items, progress }));
  assert.equal(updates[1].items.length, 1); assert.equal(updates[1].progress[1].state, 'pending');
  assert.equal(updates.at(-1).items.length, 1); assert.equal(updates.at(-1).progress[1].error, 'offline');
});

test('cancellation suppresses stale responses and limits concurrency to four', async () => {
  const controller = new AbortController(); let inFlight = 0, peak = 0, started = 0, emissions = 0;
  await searchNetdisk(Array.from({ length: 10 }, (_, i) => ({ ...source, id: String(i) })), 'Linux', controller.signal, false,
    async () => { started++; inFlight++; peak = Math.max(peak, inFlight); await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(); inFlight--; return { items: [], cached: false }; },
    () => { emissions++; });
  assert.equal(peak, 4); assert.equal(started, 4); assert.equal(emissions, 1);
});

test('storage validates corrupted state and surfaces failed writes', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const constants = moduleUrl('../src/types/netdisk.ts');
  const storage = await import(moduleUrl('../src/utils/netdiskStorage.ts', { '../types/netdisk': constants, './netdisk': coreUrl }));
  assert.equal(storage.loadNetdiskSources().length, 5);
  storage.saveNetdiskState('sources', [{ ...source, kind: 'evil' }, source, source]); assert.equal(storage.loadNetdiskSources().length, 1);
  storage.saveNetdiskState('saved', [{ url: 'javascript:alert(1)', id: 'bad' }]); assert.deepEqual(storage.loadNetdiskSaved(), []);
  storage.saveNetdiskState('history', ['Linux', 'Linux', {}, '']); assert.deepEqual(storage.loadNetdiskHistory(), ['Linux']);
  localStorage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => storage.saveNetdiskState('history', []), /保存失败/);
  delete globalThis.localStorage;
});
