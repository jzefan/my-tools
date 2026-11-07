import type { NetdiskItem, NetdiskSource, SourceKind } from '../types/netdisk.ts';

type Row = Record<string, unknown>;
const record = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string => typeof v === 'string' ? v : '';
function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const value = entity.slice(1, -1).toLowerCase();
    if (value.startsWith('#')) {
      const n = value[1] === 'x' ? parseInt(value.slice(2), 16) : parseInt(value.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[value] || '';
  });
}
export function cleanNetdiskText(value: unknown): string {
  return decodeEntities(str(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<(?:br\s*\/?|\/p)>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+/g, ' ').trim().slice(0, 2400);
}

/** Identify shares by exact host and share ID, never by an upstream type hint. */
export function normalizeShare(raw: string): { id: string; drive: string; url: string; password: string } | null {
  let u: URL;
  try { u = new URL(decodeEntities(raw.trim())); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname;
  let drive = '', shareId = '';
  const share = (pattern: RegExp) => path.match(pattern)?.[1] || '';
  if (host === 'pan.baidu.com') {
    drive = 'baidu'; shareId = share(/^\/s\/(1[\w-]+)\/?$/) || (path === '/share/init' && u.searchParams.get('surl') ? `1${u.searchParams.get('surl')}` : '');
  } else if (['alipan.com', 'aliyundrive.com'].includes(host)) { drive = 'aliyun'; shareId = share(/^\/s\/([\w-]+)\/?$/); }
  else if (host === 'pan.quark.cn') { drive = 'quark'; shareId = share(/^\/s\/([\w-]+)\/?$/); }
  else if (['123pan.com', '123pan.cn', '123865.com', '123684.com', '123912.com', '123pan.net', 'pan.123.com'].includes(host)) { drive = '123'; shareId = share(/^\/s\/([\w-]+)\/?$/); }
  else if (['115.com', '115cdn.com', 'anxia.com'].includes(host)) { drive = '115'; shareId = share(/^\/s\/([\w-]+)\/?$/); }
  else if (host === 'pan.xunlei.com') { drive = 'xunlei'; shareId = share(/^\/s\/([\w-]+)\/?$/); }
  else if (host === 'cloud.189.cn') { drive = 'tianyi'; shareId = share(/^\/t\/([\w-]+)\/?$/) || (path === '/web/share' ? u.searchParams.get('code') || '' : ''); }
  else if (host === 'drive.uc.cn') { drive = 'uc'; shareId = share(/^\/s\/([\w-]+)\/?$/); }
  else if (['caiyun.139.com', 'yun.139.com'].includes(host)) { drive = 'mobile'; shareId = share(/^\/(?:m\/i|w\/i)\/([\w-]+)\/?$/) || (/^\/(?:m\/i|w\/i)$/.test(path) ? u.search.slice(1).match(/^([\w-]+)(?:&|$)/)?.[1] || '' : ''); }
  else if ((/^[a-z\d-]+\.lanzou[a-z]\.com$/.test(host) || /^lanzou[a-z]\.com$/.test(host)) && /^\/[\w-]+\/?$/.test(path)) { drive = 'lanzou'; shareId = `${host}${path.replace(/\/$/, '')}`; }
  else if (['mypikpak.com', 'mypikpak.net'].includes(host)) { drive = 'pikpak'; shareId = share(/^\/s\/([\w-]+)\/?$/); }
  else if (host === 'guangyapan.com') { drive = 'guangya'; shareId = share(/^\/s\/([\w-]+)\/?$/); }
  if (!drive || !shareId || /[\s<>]/.test(shareId)) return null;
  let password = u.searchParams.get('pwd') || u.searchParams.get('password') || u.searchParams.get('passcode') || '';
  if (!password && drive === '115') password = new URLSearchParams(u.hash.slice(1)).get('password') || '';
  u.protocol = 'https:';
  // Retain functional query/fragment parameters; remove only common tracking.
  [...u.searchParams.keys()].filter(k => /^utm_|^(?:from|source|spm|ref)$/i.test(k)).forEach(k => u.searchParams.delete(k));
  return { id: `${drive}:${shareId}`, drive, url: u.toString(), password: password.slice(0, 32) };
}

function description(value: unknown, title: string): string {
  let text = cleanNetdiskText(value);
  const explicit = text.match(/(?:描述|简介|介绍)[：:]\s*([\s\S]+)/);
  if (explicit) text = explicit[1];
  else {
    text = text.replace(/^(?:📚)?\s*名称[：:]\s*/, '');
    if (text.startsWith(title)) text = text.slice(title.length);
  }
  return text.split(/(?:链接|下载地址|分享地址|标签)[：:]|[📁🏷🎉⚠📢👥🤖]/u)[0]
    .replace(/https?:\/\/\S+/g, '').replace(/(?:🔗\s*)?(?:夸克|百度|阿里|网盘)?\s*[：:]\s*$/u, '').trim().slice(0, 420);
}

function itemFrom(row: Row, parent: Row, source: string): NetdiskItem | null {
  const normalized = normalizeShare(str(row.url));
  if (!normalized) return null;
  const rawDate = str(row.datetime || row.updatetime || row.time || parent.datetime);
  const time = Date.parse(rawDate);
  const title = cleanNetdiskText(row.work_title || row.note || row.title || parent.title || parent.content).split('\n')[0].slice(0, 240) || '未命名资源';
  return {
    ...normalized,
    title,
    description: description(parent.content || row.description || row.category, title),
    password: str(row.password || row.extcode || row.extract_code).trim().slice(0, 32) || normalized.password,
    datetime: Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : '',
    sources: [source],
  };
}

/** Accept direct PanSou API and {code,message,data} proxy envelopes. */
export function parseNetdiskPayload(payload: unknown, kind: SourceKind, source: string): NetdiskItem[] {
  const root = record(payload);
  if (root.error || (root.code !== undefined && ![0, 200, '0', '200'].includes(root.code as number))) {
    throw new Error(cleanNetdiskText(root.message || root.error) || '搜索源返回错误');
  }
  const items: NetdiskItem[] = [];
  const push = (row: Row, parent: Row = {}) => { const item = itemFrom(row, parent, source); if (item) items.push(item); };
  if (kind === 'pansou') {
    const data = root.data && !Array.isArray(root.data) ? record(root.data) : root;
    if (!('merged_by_type' in data) && !Array.isArray(data.results)) throw new Error('搜索源数据格式已变化');
    for (const rows of Object.values(record(data.merged_by_type))) for (const row of array(rows)) push(record(row));
    for (const r of array(data.results)) {
      const parent = record(r);
      for (const link of array(parent.links)) push(record(link), parent);
    }
  } else if (kind === 'melost' || kind === 'qkpanso') {
    const data = record(root.data);
    if (root.code !== 200 || !Array.isArray(data.list)) throw new Error(cleanNetdiskText(root.msg || root.message) || '搜索源数据格式已变化');
    for (const value of data.list) {
      const row = record(value);
      if (row.enabled === false) continue;
      push({ url: row.link, title: row.disk_name, password: row.disk_pass, datetime: row.shared_time }, { content: row.files });
    }
  } else if (kind === 'qupansou') {
    if (root.status !== 200 || !Array.isArray(root.data)) throw new Error(cleanNetdiskText(root.message) || '搜索源数据格式已变化');
    for (const row of root.data) push(record(row));
  } else {
    const data = record(record(record(root.props).pageProps).data || record(root.pageProps).data);
    if (!Array.isArray(data.data)) throw new Error('搜索源页面结构已变化');
    for (const value of data.data) {
      const row = record(value);
      const content = str(row.content);
      const text = cleanNetdiskText(content);
      const title = text.match(/名称[：:]\s*([^\n]+)/)?.[1] || text.split('\n')[0];
      const password = text.match(/(?:提取码|访问码|密码)\s*[：:=]?\s*([a-z\d]{4,8})/i)?.[1] || '';
      const urls = decodeEntities(content).match(/https?:\/\/[^\s<>"']+/g) || [];
      for (const url of urls) push({ url, title, password, time: row.time }, { content: text });
    }
  }
  return mergeNetdiskItems(items);
}

export function mergeNetdiskItems(...groups: NetdiskItem[][]): NetdiskItem[] {
  const merged = new Map<string, NetdiskItem>();
  for (const item of groups.flat()) {
    const old = merged.get(item.id);
    if (!old) { merged.set(item.id, { ...item, sources: [...item.sources] }); continue; }
    const incomingNewer = item.datetime > old.datetime;
    merged.set(item.id, {
      ...old,
      title: old.title === '未命名资源' ? item.title : old.title,
      description: item.description.length > old.description.length ? item.description : old.description,
      password: incomingNewer ? item.password || old.password : old.password || item.password,
      url: item.password && (incomingNewer || !old.password) ? item.url : old.url,
      datetime: incomingNewer ? item.datetime : old.datetime,
      sources: [...new Set([...old.sources, ...item.sources])],
    });
  }
  return [...merged.values()];
}

export function rankNetdiskItems(items: NetdiskItem[], keyword: string, newest = false): NetdiskItem[] {
  const terms = keyword.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const score = (item: NetdiskItem) => terms.reduce((n, term) => n + (item.title.toLocaleLowerCase().includes(term) ? 10 : item.description.toLocaleLowerCase().includes(term) ? 1 : 0), 0);
  return [...items].sort((a, b) => (newest ? 0 : score(b) - score(a)) || b.datetime.localeCompare(a.datetime) || a.id.localeCompare(b.id));
}

export function validateSourceUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('请输入有效服务地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('服务地址需为 HTTP(S)，不含账号或查询参数');
  return url.toString().replace(/\/$/, '');
}

export function buildNetdiskRequest(source: NetdiskSource, keyword: string, refresh: boolean, cloudType = ''): { url: string; body?: string; headers?: Record<string, string> } {
  const base = validateSourceUrl(source.baseUrl);
  if (source.kind === 'pansou') return { url: `${base}/api/search?${new URLSearchParams({ kw: keyword, res: 'merge', src: 'all', refresh: String(refresh) })}` };
  if (source.kind === 'pansearch') return { url: `${base}/search?${new URLSearchParams({ keyword })}` };
  if (source.kind === 'melost' || source.kind === 'qkpanso') return {
    url: `${base}/v1/search/disk`, headers: { Origin: new URL(base).origin, Referer: `${base}/search` },
    body: JSON.stringify({ page: 1, q: keyword, user: '', exact: false, user_distinct: false, format: [], share_time: '', share_year: '', size: 50, order: '', type: ({ baidu: 'BDY', aliyun: 'ALY' } as Record<string, string>)[cloudType] || '', search_ticket: '', exclude_user: [], adv_params: { wechat_pwd: '', search_code: '', platform: 'pc', fp_data: '', automated: true } }),
  };
  return { url: `${base}/search`, headers: { Referer: 'https://pan.funletu.com/' }, body: JSON.stringify({ style: 'get', datasrc: 'search', query: { searchtext: keyword, courseid: 1, id: '', datetime: '', categoryid: '', filetypeid: '', filetype: '', reportid: '', validid: '' }, page: { pageSize: 500, pageIndex: 1 }, order: { prop: 'sort', order: 'desc' } }) };
}

export function shareText(item: NetdiskItem): string {
  return `${item.title}\n${item.url}${item.password ? `\n提取码：${item.password}` : ''}`;
}
