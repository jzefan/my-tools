import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Container,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { DockerCleanAction, DockerRiskLevel, DockerScanResult } from '../../types/cleaner';
import { cleanerApi } from '../../services/cleanerApi';
import { formatFileSize } from '../../utils/format';
import { alertDialog, confirmDialog } from '../../utils/dialog';

const RISK_META: Record<
  DockerRiskLevel,
  { label: string; className: string; icon: React.ReactNode }
> = {
  safe: {
    label: '安全',
    className: 'text-emerald-600 dark:text-emerald-400',
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
  },
  recommended: {
    label: '建议',
    className: 'text-amber-600 dark:text-amber-400',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  caution: {
    label: '谨慎',
    className: 'text-rose-600 dark:text-rose-400',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
};

const DF_LABEL: Record<string, string> = {
  Images: '镜像',
  Containers: '容器',
  'Local Volumes': '数据卷',
  'Build Cache': '构建缓存',
};

export const DockerCleanerView: React.FC = () => {
  const [scan, setScan] = useState<DockerScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isCleaning, setIsCleaning] = useState(false);
  const [summary, setSummary] = useState<{
    freedBytes: number;
    errors: string[];
  } | null>(null);

  const loadScan = useCallback(async () => {
    setIsScanning(true);
    try {
      const res = await cleanerApi.scanDockerReclaim();
      setScan(res);
      const next = new Set<string>();
      for (const action of res.actions) {
        if (action.default_selected) next.add(action.id);
      }
      setSelectedIds(next);
    } catch (err) {
      await alertDialog(`Docker 扫描失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    void loadScan();
  }, [loadScan]);

  const selectedBytes = useMemo(() => {
    if (!scan) return 0;
    return scan.actions
      .filter((a) => selectedIds.has(a.id))
      .reduce((sum, a) => sum + a.reclaimable_bytes, 0);
  }, [scan, selectedIds]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectDefaults = () => {
    if (!scan) return;
    setSelectedIds(
      new Set(scan.actions.filter((a) => a.default_selected).map((a) => a.id))
    );
  };

  const handleClean = async () => {
    if (selectedIds.size === 0) return;
    const hasVolume = selectedIds.has('unused_volumes');
    const msg = hasVolume
      ? `将清理 ${selectedIds.size} 项（含数据卷）。确认？`
      : `将清理 ${selectedIds.size} 项。确认？`;
    if (!(await confirmDialog(msg))) return;

    setIsCleaning(true);
    try {
      const res = await cleanerApi.executeDockerCleanup({
        action_ids: Array.from(selectedIds),
      });
      setSummary({ freedBytes: res.freed_bytes, errors: res.errors });
      await loadScan();
    } catch (err) {
      await alertDialog(`清理失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsCleaning(false);
    }
  };

  const unavailable = scan && (!scan.cli_available || !scan.daemon_running);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 select-none">
      <div className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
              <Container className="w-4 h-4 text-cyan-500 shrink-0" />
              <span>Docker 磁盘</span>
              {scan?.version && (
                <span className="text-[11px] font-mono text-slate-400">v{scan.version}</span>
              )}
            </div>
            {scan?.daemon_running && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>
                  占用{' '}
                  <strong className="font-mono text-slate-700 dark:text-slate-200">
                    {formatFileSize(scan.total_size_bytes)}
                  </strong>
                </span>
                <span>
                  可回收{' '}
                  <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                    {formatFileSize(scan.total_reclaimable_bytes)}
                  </strong>
                </span>
              </div>
            )}
            {scan?.daemon_running && scan.types.length > 0 && (
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {scan.types.map((t) => (
                  <div
                    key={t.type_name}
                    className="rounded-lg border border-slate-200/80 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5"
                  >
                    <div className="text-[10px] text-slate-500">
                      {DF_LABEL[t.type_name] || t.type_name}
                    </div>
                    <div className="font-mono text-xs text-slate-800 dark:text-slate-100">
                      {formatFileSize(t.size_bytes)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      可回收 {formatFileSize(t.reclaimable_bytes)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isScanning || isCleaning}
              onClick={() => void loadScan()}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-cyan-500' : ''}`} />
              <span>{isScanning ? '扫描中…' : '重新扫描'}</span>
            </button>
            <button
              type="button"
              disabled={
                isScanning ||
                isCleaning ||
                !scan?.daemon_running ||
                selectedIds.size === 0
              }
              onClick={() => void handleClean()}
              className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>
                {isCleaning
                  ? '清理中…'
                  : selectedBytes > 0
                    ? `清理 (${formatFileSize(selectedBytes)})`
                    : '清理'}
              </span>
            </button>
          </div>
        </div>

        {summary && (
          <div
            className={`mt-3 px-3 py-2 rounded-xl border flex items-center justify-between text-xs ${
              summary.errors.length > 0
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {summary.errors.length > 0 ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
              )}
              <span>
                已回收 <strong>{formatFileSize(summary.freedBytes)}</strong>
                {summary.errors.length > 0 && ` · ${summary.errors.length} 项失败`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSummary(null)}
              className="text-current hover:underline text-[11px] cursor-pointer"
            >
              关闭
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {!scan && isScanning && (
          <div className="flex h-40 items-center justify-center text-sm text-slate-500">
            正在扫描 Docker…
          </div>
        )}

        {unavailable && (
          <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm text-slate-500 dark:text-slate-400">
            <Container className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-1" />
            <span>
              {!scan?.cli_available ? '未安装 Docker' : 'Docker 未运行'}
            </span>
          </div>
        )}

        {scan?.daemon_running && (
          <>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
              <span>选择清理项</span>
              <button
                type="button"
                onClick={selectDefaults}
                className="text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
              >
                恢复默认
              </button>
            </div>
            <div className="space-y-2">
              {scan.actions.map((action) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  selected={selectedIds.has(action.id)}
                  disabled={isCleaning}
                  onToggle={() => toggle(action.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

function ActionRow({
  action,
  selected,
  disabled,
  onToggle,
}: {
  action: DockerCleanAction;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const risk = RISK_META[action.risk_level];
  const empty = action.reclaimable_bytes === 0 && action.item_count === 0;

  return (
    <label
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
        selected
          ? 'border-cyan-300 dark:border-cyan-700 bg-cyan-50/60 dark:bg-cyan-950/30'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-900/80'
      } ${empty ? 'opacity-60' : ''} ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={disabled}
        className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
          <span>{action.name}</span>
          <span className={`inline-flex items-center gap-0.5 text-[10px] ${risk.className}`}>
            {risk.icon}
            {risk.label}
          </span>
        </div>
        <div className="text-[11px] text-slate-500 truncate">{action.description}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono text-xs text-slate-800 dark:text-slate-100">
          {action.reclaimable_bytes > 0 ? formatFileSize(action.reclaimable_bytes) : '—'}
        </div>
        {action.item_count > 0 && (
          <div className="text-[10px] text-slate-400">{action.item_count} 项</div>
        )}
      </div>
    </label>
  );
}
