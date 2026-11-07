import { DEFAULT_NETDISK_SOURCES } from '../types/netdisk';
import type { NetdiskItem, NetdiskSource } from '../types/netdisk';
import { normalizeShare, validateSourceUrl } from './netdisk';

const prefix = 'doc-tools.netdisk.v1.';
function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(prefix + key) || 'null'); } catch { return null; }
}
export function saveNetdiskState(key: 'sources' | 'saved' | 'history', value: unknown): void {
  try { localStorage.setItem(prefix + key, JSON.stringify(key === 'sources' ? { version: 2, items: value } : value)); }
  catch { throw new Error('本地保存失败，存储空间可能已满'); }
}
export function loadNetdiskSources(): NetdiskSource[] {
  const stored = read('sources');
  const legacy = Array.isArray(stored);
  const value = legacy ? stored : stored && typeof stored === 'object' && 'version' in stored && stored.version === 2 && 'items' in stored ? stored.items : null;
  if (!Array.isArray(value)) return DEFAULT_NETDISK_SOURCES.map(s => ({ ...s }));
  const ids = new Set<string>();
  const validated = value.filter((v): v is NetdiskSource => {
    if (!v || typeof v.id !== 'string' || !v.id || ids.has(v.id) || typeof v.name !== 'string' || !v.name.trim() || !['pansou', 'pansearch', 'qupansou', 'melost', 'qkpanso'].includes(v.kind) || typeof v.enabled !== 'boolean') return false;
    try { validateSourceUrl(v.baseUrl); } catch { return false; }
    ids.add(v.id); return true;
  }).slice(0, 12);
  if (!legacy) return validated;
  const upgraded = validated.map(s => s.id === 'pansou' && validateSourceUrl(s.baseUrl) === 'https://so.252035.xyz' ? { ...s, enabled: false } : s);
  const fresh = DEFAULT_NETDISK_SOURCES.filter(s => ['melost', 'qkpanso'].includes(s.kind) && !upgraded.some(old => old.id === s.id || validateSourceUrl(old.baseUrl) === s.baseUrl));
  // Leave room for existing custom services and preserve explicit v2 removals.
  return [...fresh.slice(0, Math.max(0, 12 - upgraded.length)), ...upgraded];
}
export function loadNetdiskSaved(): NetdiskItem[] {
  const value = read('saved');
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is NetdiskItem => v && typeof v.url === 'string' && normalizeShare(v.url)?.id === v.id && typeof v.title === 'string' && typeof v.description === 'string' && typeof v.password === 'string' && typeof v.datetime === 'string' && Array.isArray(v.sources) && v.sources.every((s: unknown) => typeof s === 'string')).slice(0, 200);
}
export function loadNetdiskHistory(): string[] {
  const value = read('history');
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && !!v.trim() && v.length <= 120))].slice(0, 20) : [];
}
