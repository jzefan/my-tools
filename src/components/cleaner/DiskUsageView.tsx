import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, HardDrive, Lock, RefreshCw, Trash2 } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { DiskUsageEntry, DiskUsageProgress, DiskUsageScan } from '../../types/cleaner';
import { cleanerApi } from '../../services/cleanerApi';
import { api, isTauriEnvironment } from '../../services/api';
import { confirmDialog, alertDialog } from '../../utils/dialog';
import { formatDiskSize, formatFileSize, getPathBreadcrumbs } from '../../utils/format';

const SEGMENT_COLORS = [
  'bg-indigo-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-rose-400',
  'bg-teal-500',
  'bg-slate-400',
];

function baseName(path: string): string {
  if (!path || path === '/') return '本机磁盘';
  const trimmed = path.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  return trimmed.slice(index + 1) || trimmed;
}

function shareOf(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.min(100, (part / total) * 100);
}

function shareLabel(part: number, total: number): string {
  const pct = shareOf(part, total);
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct > 0) return '<1%';
  return '0%';
}

/** Prefer a completed child scan when it found more than the parent walk recorded. */
function visibleSize(
  path: string,
  fallback: number,
  cache: Record<string, DiskUsageScan>,
  seen = new Set<string>(),
): number {
  if (!path || seen.has(path)) return fallback;
  const scan = cache[path];
  if (!scan) return fallback;
  if (scan.entries.length === 0) return Math.max(fallback, scan.size_bytes);
  seen.add(path);
  const sum = scan.entries.reduce(
    (total, entry) => total + visibleSize(entry.path, entry.size_bytes, cache, seen),
    0,
  );
  return Math.max(fallback, sum);
}

function underHome(path: string, home: string): boolean {
  const base = home.replace(/\/+$/, '');
  return !!path && !!base && path.startsWith(`${base}/`);
}

function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  return index <= 0 ? '/' : trimmed.slice(0, index);
}

function dropUsagePath(cache: Record<string, DiskUsageScan>, path: string): Record<string, DiskUsageScan> {
  const next = { ...cache };
  let removedSize = 0;
  let removedFiles = 0;
  const parent = parentPath(path);
  const parentScan = next[parent];
  if (parentScan) {
    const entry = parentScan.entries.find((item) => item.path === path);
    removedSize = entry?.size_bytes ?? 0;
    removedFiles = entry?.file_count ?? 0;
    next[parent] = {
      ...parentScan,
      size_bytes: Math.max(0, parentScan.size_bytes - removedSize),
      file_count: Math.max(0, parentScan.file_count - removedFiles),
      entries: parentScan.entries.filter((item) => item.path !== path),
    };
  }
  let cursor = parent;
  while (cursor !== '/') {
    const up = parentPath(cursor);
    const scan = next[up];
    if (scan) {
      next[up] = {
        ...scan,
        size_bytes: Math.max(0, scan.size_bytes - removedSize),
        file_count: Math.max(0, scan.file_count - removedFiles),
        entries: scan.entries.map((item) =>
          item.path === cursor
            ? {
                ...item,
                size_bytes: Math.max(0, item.size_bytes - removedSize),
                file_count: Math.max(0, item.file_count - removedFiles),
              }
            : item,
        ),
      };
    }
    cursor = up;
  }
  for (const key of Object.keys(next)) {
    if (key === path || key.startsWith(`${path}/`)) delete next[key];
  }
  return next;
}

function isCancelled(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return text.toLowerCase().includes('cancelled');
}

interface UsageRowsProps {
  entries: DiskUsageEntry[];
  depth: number;
  rootTotal: number;
  colors?: Map<string, string>;
  cache: Record<string, DiskUsageScan>;
  expanded: Set<string>;
  loadingPath: string | null;
  homePath: string;
  deletingPath: string | null;
  onToggle: (entry: DiskUsageEntry) => void;
  onReveal: (path: string, event: React.MouseEvent) => void;
  onDelete: (entry: DiskUsageEntry, event: React.MouseEvent) => void;
}

const UsageRows: React.FC<UsageRowsProps> = ({
  entries,
  depth,
  rootTotal,
  colors,
  cache,
  expanded,
  loadingPath,
  homePath,
  deletingPath,
  onToggle,
  onReveal,
  onDelete,
}) => {
  const rows = [...entries].sort(
    (a, b) =>
      visibleSize(b.path, b.size_bytes, cache) - visibleSize(a.path, a.size_bytes, cache) ||
      a.name.localeCompare(b.name),
  );
  return (
  <>
    {rows.map((entry) => {
      const key = `${entry.kind}:${entry.path}:${entry.name}`;
      const expandable = entry.kind === 'dir' && !!entry.path;
      const open = expandable && expanded.has(entry.path);
      const child = entry.path ? cache[entry.path] : undefined;
      const loading = open && loadingPath === entry.path && !child;
      const color = colors?.get(entry.path || entry.name) || 'bg-indigo-500';
      const size = visibleSize(entry.path, entry.size_bytes, cache);
      const width = shareOf(size, rootTotal);
      return (
        <React.Fragment key={key}>
          <div
            data-usage-path={entry.path || undefined}
            onClick={() => expandable && onToggle(entry)}
            title={entry.path ? entry.path : entry.name}
            className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg ${
              expandable ? 'cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/70' : ''
            }`}
          >
            <div className="flex items-center w-52 shrink-0 min-w-0" style={{ paddingLeft: depth * 14 }}>
              <span className="w-4 h-4 shrink-0 flex items-center justify-center text-slate-400">
                {loading ? (
                  <RefreshCw className="w-3 h-3 animate-spin text-sky-500" />
                ) : expandable ? (
                  open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
                ) : null}
              </span>
              <span className={`truncate text-xs ${entry.kind === 'files' || entry.kind === 'dirs' ? 'text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
                {entry.name}
              </span>
              {entry.permission_denied && <Lock className="w-3 h-3 ml-1 shrink-0 text-amber-500" />}
            </div>
            <div className="flex-1 min-w-16 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className={`h-full ${color}`} style={{ width: `${width}%` }} />
            </div>
            <span className="w-[4.75rem] shrink-0 text-right font-mono text-[11px] text-slate-700 dark:text-slate-200">
              {formatFileSize(size)}
            </span>
            <span className="w-12 shrink-0 text-right font-mono text-[10px] text-slate-400">
              {shareLabel(size, rootTotal)}
            </span>
            <span className="w-12 shrink-0 flex justify-end">
              {entry.kind === 'dir' && underHome(entry.path, homePath) && (
                <button
                  type="button"
                  title="删除"
                  disabled={deletingPath === entry.path}
                  onClick={(event) => onDelete(entry, event)}
                  className="p-1 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer disabled:opacity-100"
                >
                  {deletingPath === entry.path ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
              {entry.path && (
                <button
                  type="button"
                  title="在访达中显示"
                  onClick={(event) => onReveal(entry.path, event)}
                  className="p-1 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          </div>
          {open && child && (
            <UsageRows
              entries={child.entries}
              depth={depth + 1}
              rootTotal={rootTotal}
              cache={cache}
              expanded={expanded}
              loadingPath={loadingPath}
              homePath={homePath}
              deletingPath={deletingPath}
              onToggle={onToggle}
              onReveal={onReveal}
              onDelete={onDelete}
            />
          )}
        </React.Fragment>
      );
    })}
  </>
  );
};

export const DiskUsageView: React.FC = () => {
  const [rootPath, setRootPath] = useState('/');
  const [cache, setCache] = useState<Record<string, DiskUsageScan>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [progress, setProgress] = useState<DiskUsageProgress | null>(null);
  const [homePath, setHomePath] = useState('');
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef(cache);
  const expandedRef = useRef(expanded);
  const rootPathRef = useRef(rootPath);
  const watchRef = useRef(0);
  const removedRef = useRef<string[]>([]);
  const runRef = useRef(0);
  const pendingRef = useRef<string[]>([]);
  cacheRef.current = cache;
  expandedRef.current = expanded;
  rootPathRef.current = rootPath;

  const loadRef = useRef<(path: string, force?: boolean, supersede?: boolean) => Promise<void>>(async () => {});

  const drain = useCallback(() => {
    while (pendingRef.current.length > 0) {
      const next = pendingRef.current.shift();
      if (!next || cacheRef.current[next]) continue;
      const wanted = next === rootPathRef.current || expandedRef.current.has(next);
      if (wanted) {
        void loadRef.current(next);
        return;
      }
    }
  }, []);

  const load = useCallback(async (path: string, force = false, supersede = false) => {
    if (!force && cacheRef.current[path]) return;
    if (runRef.current !== 0 && !supersede) {
      pendingRef.current = pendingRef.current.filter((item) => item !== path);
      pendingRef.current.push(path);
      return;
    }
    const token = ++runRef.current;
    pendingRef.current = pendingRef.current.filter((item) => item !== path);
    setLoadingPath(path);
    setError(null);
    try {
      const scan = await cleanerApi.scanDiskUsage(path);
      if (runRef.current !== token) return;
      if (removedRef.current.some((item) => path === item || path.startsWith(`${item}/`))) {
        setLoadingPath((current) => (current === path ? null : current));
        return;
      }
      if (scan.home_path) setHomePath(scan.home_path);
      const next = { ...cacheRef.current, [path]: scan };
      cacheRef.current = next;
      setCache(next);
      setLoadingPath((current) => (current === path ? null : current));
      setProgress((current) => (current?.root_path === path ? null : current));
    } catch (err) {
      if (runRef.current !== token) {
        const wanted = path === rootPathRef.current || expandedRef.current.has(path);
        if (wanted && !cacheRef.current[path] && !pendingRef.current.includes(path)) {
          pendingRef.current.push(path);
        }
        return;
      }
      setLoadingPath((current) => (current === path ? null : current));
      if (isCancelled(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (runRef.current === token) {
        runRef.current = 0;
        drain();
      }
    }
  }, [drain]);

  loadRef.current = load;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let stopped = false;
    if (isTauriEnvironment()) {
      void listen<DiskUsageProgress>('disk-usage-progress', (event) => {
        if (event.payload.home_path) setHomePath(event.payload.home_path);
        setProgress(event.payload);
      }).then((stop) => {
        if (stopped) stop();
        else unlisten = stop;
      });
    }
    void loadRef.current('/');
    return () => {
      stopped = true;
      unlisten?.();
      watchRef.current += 1;
    };
  }, []);

  const selectRoot = (path: string) => {
    if (!path || path === rootPath) return;
    removedRef.current = [];
    rootPathRef.current = path;
    expandedRef.current = new Set();
    setRootPath(path);
    setExpanded(new Set());
    void load(path, false, true);
  };

  const rescan = () => {
    removedRef.current = [];
    expandedRef.current = new Set();
    setExpanded(new Set());
    void load(rootPath, true, true);
  };

  const toggle = (entry: DiskUsageEntry) => {
    if (entry.kind !== 'dir' || !entry.path) return;
    const opening = !expanded.has(entry.path);
    const next = new Set(expanded);
    if (opening) next.add(entry.path);
    else {
      next.delete(entry.path);
      pendingRef.current = pendingRef.current.filter((item) => item !== entry.path);
    }
    expandedRef.current = next;
    setExpanded(next);
    if (opening) void load(entry.path);
  };

  const reveal = (path: string, event: React.MouseEvent) => {
    event.stopPropagation();
    void api.revealInFinder(path);
  };

  const removeEntry = async (entry: DiskUsageEntry, event: React.MouseEvent) => {
    event.stopPropagation();
    if (entry.kind !== 'dir' || !underHome(entry.path, homePath) || deletingPath) return;
    const confirmed = await confirmDialog(`确定删除「${entry.name}」吗？删除后无法撤销。`);
    if (!confirmed) return;
    setDeletingPath(entry.path);
    try {
      const result = await cleanerApi.deleteUsagePath(entry.path);
      if (!result.success) {
        await alertDialog(result.errors[0] || '删除失败');
        return;
      }
      removedRef.current.push(entry.path);
      const nextExpanded = new Set(
        [...expandedRef.current].filter((item) => item !== entry.path && !item.startsWith(`${entry.path}/`)),
      );
      expandedRef.current = nextExpanded;
      setExpanded(nextExpanded);
      pendingRef.current = pendingRef.current.filter((item) => item !== entry.path && !item.startsWith(`${entry.path}/`));
      const next = dropUsagePath(cacheRef.current, entry.path);
      cacheRef.current = next;
      setCache(next);
    } catch (err) {
      await alertDialog(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingPath((current) => (current === entry.path ? null : current));
    }
  };

  const focusEntry = (entry: DiskUsageEntry) => {
    if (entry.kind === 'dir' && entry.path) {
      const next = new Set(expanded);
      next.add(entry.path);
      expandedRef.current = next;
      setExpanded(next);
      void load(entry.path);
    }
    if (!entry.path) return;
    requestAnimationFrame(() => {
      document.querySelector(`[data-usage-path="${CSS.escape(entry.path)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  };

  const scan = cache[rootPath];

  // Automatically watch for Full Disk Access permission when permission issues exist
  useEffect(() => {
    if (!scan?.permission_denied) return;

    let isChecking = false;
    let timerId: number | null = null;
    let cancelled = false;

    const check = async () => {
      if (cancelled || isChecking) return;
      isChecking = true;
      try {
        const hasAccess = await cleanerApi.hasFullDiskAccess();
        if (hasAccess && !cancelled) {
          // Immediately hide banner and start auto reload
          setCache((prev) => {
            const current = prev[rootPathRef.current];
            if (!current) return prev;
            return {
              ...prev,
              [rootPathRef.current]: { ...current, permission_denied: false },
            };
          });
          void loadRef.current(rootPathRef.current, true, true);
          return;
        }
      } catch {
        // Keep checking
      } finally {
        isChecking = false;
      }
    };

    void check();
    timerId = window.setInterval(check, 1000);

    const onFocus = () => {
      void check();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void check();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearInterval(timerId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [scan?.permission_denied]);
  const loadingRoot = loadingPath === rootPath;
  const shownRoot = scan ? visibleSize(scan.root_path, scan.size_bytes, cache) : 0;
  const diskUsed =
    scan && scan.disk_total_bytes > scan.disk_free_bytes ? scan.disk_total_bytes - scan.disk_free_bytes : 0;
  const ranked = scan
    ? [...scan.entries].sort(
        (a, b) =>
          visibleSize(b.path, b.size_bytes, cache) - visibleSize(a.path, a.size_bytes, cache) ||
          a.name.localeCompare(b.name),
      )
    : [];
  const topEntries = ranked.slice(0, 8);
  const restBytes = ranked.slice(8).reduce((sum, entry) => sum + visibleSize(entry.path, entry.size_bytes, cache), 0);
  const colors = new Map(topEntries.map((entry, index) => [entry.path || entry.name, SEGMENT_COLORS[index]]));
  const crumbs = rootPath === '/' ? [] : getPathBreadcrumbs(rootPath);
  const progressText =
    loadingRoot && progress?.root_path === rootPath
      ? `正在统计 ${baseName(progress.current_path)} · ${progress.scanned_files.toLocaleString('zh-CN')} 个文件 · ${formatFileSize(progress.scanned_bytes)}`
      : loadingRoot
        ? '正在统计'
        : '';

  if (scan && !scan.supported) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        磁盘清理暂仅支持macOS
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => selectRoot('/')}
              className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer ${
                rootPath === '/'
                  ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              本机磁盘
            </button>
            <button
              type="button"
              disabled={!homePath}
              onClick={() => homePath && selectRoot(homePath)}
              className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer disabled:opacity-40 ${
                homePath && rootPath === homePath
                  ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              用户目录
            </button>
          </div>
          <button
            type="button"
            onClick={rescan}
            disabled={loadingRoot}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingRoot ? 'animate-spin text-sky-500' : ''}`} />
            重新统计
          </button>
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{scan?.root_name || baseName(rootPath)}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
              {scan ? `已统计 ${formatFileSize(shownRoot)} · ${scan.file_count.toLocaleString('zh-CN')} 个文件` : progressText || '正在统计'}
            </div>
          </div>
          {scan && scan.disk_total_bytes > 0 && (
            <div className="text-[11px] text-slate-400 font-mono shrink-0">
              已用 {formatDiskSize(diskUsed)} / 共 {formatDiskSize(scan.disk_total_bytes)}
            </div>
          )}
        </div>

        <div className="mt-2 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex">
          {scan &&
            topEntries.map((entry) => (
              <button
                key={entry.path || entry.name}
                type="button"
                title={`${entry.name} ${formatFileSize(visibleSize(entry.path, entry.size_bytes, cache))} ${shareLabel(visibleSize(entry.path, entry.size_bytes, cache), shownRoot)}`}
                onClick={() => focusEntry(entry)}
                className={`h-full ${colors.get(entry.path || entry.name)} cursor-pointer`}
                style={{ width: `${shareOf(visibleSize(entry.path, entry.size_bytes, cache), shownRoot)}%` }}
              />
            ))}
          {scan && restBytes > 0 && (
            <div className="h-full bg-slate-300 dark:bg-slate-600" style={{ width: `${shareOf(restBytes, shownRoot)}%` }} />
          )}
        </div>

        {progressText && scan && <div className="mt-1.5 text-[11px] text-slate-400 truncate">{progressText}</div>}

        {crumbs.length > 0 && (
          <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-500 min-w-0 overflow-x-auto">
            <button type="button" onClick={() => selectRoot('/')} className="shrink-0 hover:text-sky-600 cursor-pointer">
              本机磁盘
            </button>
            {crumbs.map((crumb) => (
              <React.Fragment key={crumb.path}>
                <ChevronRight className="w-3 h-3 shrink-0 text-slate-300" />
                <button
                  type="button"
                  onClick={() => selectRoot(crumb.path)}
                  className={`shrink-0 truncate max-w-40 cursor-pointer hover:text-sky-600 ${
                    crumb.path === rootPath ? 'text-slate-800 dark:text-slate-100 font-medium' : ''
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {scan && scan.volumes.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px]">
            <span className="text-slate-400">其他卷</span>
            {scan.volumes.map((volume) => (
              <button
                key={volume.path}
                type="button"
                onClick={() => selectRoot(volume.path)}
                className="px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {volume.name} {formatFileSize(volume.size_bytes)}
              </button>
            ))}
          </div>
        )}

        {scan?.permission_denied && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
            <div className="flex items-center gap-2 min-w-0">
              <Lock className="w-3.5 h-3.5 shrink-0 text-amber-500" />
              <span className="truncate">部分目录未能读取</span>
            </div>
            <button
              type="button"
              onClick={() => {
                void cleanerApi.openFullDiskAccessSettings();
              }}
              className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-medium shrink-0 cursor-pointer"
            >
              去系统设置开启
            </button>
          </div>
        )}

        {error && <div className="mt-2 text-xs text-rose-600 dark:text-rose-400 truncate">{error}</div>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {!scan && (
          <div className="h-64 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
            <RefreshCw className="w-5 h-5 text-sky-500 animate-spin" />
            <span>{progressText || '正在统计'}</span>
          </div>
        )}
        {scan && scan.entries.length === 0 && !loadingRoot && (
          <div className="h-64 flex items-center justify-center text-xs text-slate-400">空</div>
        )}
        {scan && scan.entries.length > 0 && (
          <UsageRows
            entries={scan.entries}
            depth={0}
            rootTotal={shownRoot}
            colors={colors}
            cache={cache}
            expanded={expanded}
            loadingPath={loadingPath}
            homePath={homePath}
            deletingPath={deletingPath}
            onToggle={toggle}
            onReveal={reveal}
            onDelete={removeEntry}
          />
        )}
        {scan && loadingRoot && scan.entries.length === 0 && (
          <div className="h-40 flex items-center justify-center text-xs text-slate-400">
            <HardDrive className="w-4 h-4 mr-2" />
            {progressText}
          </div>
        )}
      </div>
    </div>
  );
};
