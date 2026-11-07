import { invoke, isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { NetdiskItem, NetdiskSource } from '../types/netdisk';
import { mergeNetdiskItems, normalizeShare, parseNetdiskPayload, validateSourceUrl } from '../utils/netdisk';

const cache = new Map<string, { time: number; items: NetdiskItem[] }>();
const CACHE_TTL = 5 * 60_000;

async function requestSource(source: NetdiskSource, keyword: string, signal: AbortSignal, refresh: boolean, token: string, cloudType = ''): Promise<NetdiskItem[]> {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const request = { requestId, kind: source.kind, baseUrl: validateSourceUrl(source.baseUrl), keyword, refresh, token, cloudType };
  let payload: unknown;
  if (isTauri()) {
    const abort = () => { void invoke('cancel_netdisk_search', { requestIds: [requestId] }).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try { payload = await invoke('search_netdisk_source', { request }); }
    finally { signal.removeEventListener('abort', abort); }
  } else {
    const response = await fetch('/__netdisk/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
    });
    if (response.status === 404) throw new Error('网页预览请使用 pnpm dev，或在桌面端搜索');
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `连接失败（HTTP ${response.status}）`);
    }
    payload = await response.json();
  }
  signal.throwIfAborted();
  return parseNetdiskPayload(payload, source.kind, source.name);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function fetchNetdiskSource(source: NetdiskSource, keyword: string, signal: AbortSignal, refresh = false, token = '', partial?: (items: NetdiskItem[]) => void): Promise<{ items: NetdiskItem[]; cached: boolean }> {
  signal.throwIfAborted();
  const key = JSON.stringify([source.id, source.kind, source.baseUrl, keyword, token]);
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.time < CACHE_TTL) return { items: hit.items, cached: true };
  const bounded = new AbortController();
  const abort = () => bounded.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => bounded.abort(new Error('搜索源响应超时')), 30_000);
  let items: NetdiskItem[];
  try {
    items = await requestSource(source, keyword, bounded.signal, refresh, token);
    partial?.(items);
    if (source.kind === 'melost') {
      // The mixed ranking is dominated by Quark. Fetch the two priority drives
      // explicitly so Baidu/Alipan resources do not disappear behind that page.
      for (const cloudType of ['baidu', 'aliyun']) {
        try {
          items = mergeNetdiskItems(items, await requestSource(source, keyword, bounded.signal, false, token, cloudType));
          partial?.(items);
        } catch (error) {
          signal.throwIfAborted();
          if (!items.length) throw error;
          if (bounded.signal.aborted) break;
        }
      }
    }
    if (source.kind === 'pansou') {
      // Re-read the provider cache to collect slow asynchronous plugins. Only
      // the first request may refresh; refreshing every poll restarts the work.
      for (const pause of [3000, 6000]) {
        try {
          await delay(pause, bounded.signal);
          items = mergeNetdiskItems(items, await requestSource(source, keyword, bounded.signal, false, token));
          partial?.(items);
        } catch (error) {
          signal.throwIfAborted();
          if (!items.length) throw error;
          break;
        }
      }
    }
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  signal.throwIfAborted();
  // Empty results are retried on the next query; PanSou may still be warming its asynchronous plugins.
  if (items.length) {
    if (cache.size >= 30) cache.delete(cache.keys().next().value!);
    cache.set(key, { time: Date.now(), items });
  }
  return { items, cached: false };
}

export async function openNetdiskItem(item: NetdiskItem): Promise<void> {
  const normalized = normalizeShare(item.url);
  if (!normalized) throw new Error('分享链接无效');
  const url = new URL(normalized.url);
  // Some providers return passwords separately. Carry them to drives that support a URL password.
  if (item.password && ['baidu', 'aliyun', 'quark', '123', 'xunlei'].includes(item.drive)) url.searchParams.set('pwd', item.password);
  if (isTauri()) await openUrl(url.toString());
  else window.open(url.toString(), '_blank', 'noopener,noreferrer');
}
