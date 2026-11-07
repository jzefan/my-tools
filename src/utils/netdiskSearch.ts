import type { NetdiskItem, NetdiskSource, SourceProgress } from '../types/netdisk';
import { mergeNetdiskItems, rankNetdiskItems } from './netdisk';

export type SourceFetcher = (source: NetdiskSource, keyword: string, signal: AbortSignal, refresh: boolean, partial: (items: NetdiskItem[]) => void) => Promise<{ items: NetdiskItem[]; cached: boolean }>;

/** Bounded fan-out, immediate partial results, and a single abort boundary. */
export async function searchNetdisk(
  sources: NetdiskSource[], keyword: string, signal: AbortSignal, refresh: boolean,
  fetchSource: SourceFetcher,
  update: (items: NetdiskItem[], progress: SourceProgress[]) => void,
): Promise<void> {
  const enabled = sources.filter(s => s.enabled);
  if (!enabled.length) throw new Error('请先启用搜索源');
  let items: NetdiskItem[] = [];
  const progress: SourceProgress[] = enabled.map(s => ({ id: s.id, name: s.name, state: 'pending', count: 0 }));
  let cursor = 0;
  const emit = () => { if (!signal.aborted) update(rankNetdiskItems(items, keyword), progress.map(p => ({ ...p }))); };
  emit();
  const worker = async () => {
    while (cursor < enabled.length && !signal.aborted) {
      const index = cursor++;
      try {
        const result = await fetchSource(enabled[index], keyword, signal, refresh, partial => {
          if (signal.aborted) return;
          items = mergeNetdiskItems(items, partial);
          progress[index] = { ...progress[index], count: partial.length };
          emit();
        });
        if (signal.aborted) return;
        items = mergeNetdiskItems(items, result.items);
        progress[index] = { ...progress[index], state: 'success', count: result.items.length, cached: result.cached };
      } catch (error) {
        if (signal.aborted) return;
        progress[index] = { ...progress[index], state: 'error', error: String(error instanceof Error ? error.message : error).slice(0, 240) };
      }
      emit();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, enabled.length) }, worker));
}
