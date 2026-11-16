import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Package,
  PackageX,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  AppResidualKind,
  InstalledAppItem,
  UninstallAppsResult,
  UninstallAppTarget,
} from '../../types/cleaner';
import { cleanerApi } from '../../services/cleanerApi';
import { api } from '../../services/api';
import { formatFileSize } from '../../utils/format';
import { alertDialog } from '../../utils/dialog';
import {
  AppFilterMode,
  AppSortMode,
  filterAndSortApps,
  findLargeResidualApps,
  getAppResidualBytes,
  getAppTotalBytes,
  isLargeResidualApp,
} from '../../utils/appUninstaller';
import { UninstallConfirmModal } from './UninstallConfirmModal';

const RESIDUAL_KIND_LABEL: Record<AppResidualKind, string> = {
  cache: '缓存',
  support: '支持文件',
  logs: '日志',
  preferences: '偏好配置',
  container: '容器数据',
};

export const AppUninstallerView: React.FC = () => {
  const [apps, setApps] = useState<InstalledAppItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<AppFilterMode>('all');
  const [sortMode, setSortMode] = useState<AppSortMode>('total_desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [pendingTargets, setPendingTargets] = useState<InstalledAppItem[]>([]);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [uninstallSummary, setUninstallSummary] = useState<UninstallAppsResult | null>(null);

  const loadApps = useCallback(async () => {
    setIsScanning(true);
    try {
      const list = await cleanerApi.scanInstalledApps();
      setApps(list);
      setSelectedIds((prev) => {
        const available = new Set(list.map((a) => a.id));
        const next = new Set<string>();
        for (const id of prev) {
          if (available.has(id)) next.add(id);
        }
        return next;
      });
    } catch (err) {
      await alertDialog(`扫描已安装软件失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  const filteredApps = useMemo(
    () => filterAndSortApps(apps, searchQuery, filterMode, sortMode),
    [apps, searchQuery, filterMode, sortMode]
  );

  const largeResidualCount = useMemo(() => findLargeResidualApps(apps).length, [apps]);

  const totalAppBytes = useMemo(
    () => apps.reduce((sum, app) => sum + app.app_size_bytes, 0),
    [apps]
  );

  const totalResidualBytes = useMemo(
    () => apps.reduce((sum, app) => sum + getAppResidualBytes(app), 0),
    [apps]
  );

  const selectedApps = useMemo(
    () => apps.filter((app) => selectedIds.has(app.id)),
    [apps, selectedIds]
  );

  const toggleSelect = (appId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  };

  const toggleExpand = (appId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  };

  const handleSelectAllFiltered = (select: boolean) => {
    if (!select) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredApps.map((app) => app.id)));
  };

  const handleConfirmUninstall = async (targets: UninstallAppTarget[]) => {
    setIsUninstalling(true);
    try {
      const result = await cleanerApi.uninstallApps({ targets });
      setUninstallSummary(result);
      setPendingTargets([]);
      const removedIds = new Set(result.outcomes.map((o) => o.app_id));
      setApps((prev) => prev.filter((app) => !removedIds.has(app.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of removedIds) next.delete(id);
        return next;
      });
    } catch (err) {
      await alertDialog(`卸载失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsUninstalling(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 select-none">
      {/* Top Summary & Controls */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs shrink-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex-1 min-w-[280px] max-w-2xl bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200/80 dark:border-slate-700/60">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <div className="flex items-center space-x-2 font-semibold text-slate-700 dark:text-slate-200">
                <PackageX className="w-4 h-4 text-rose-500" />
                <span>软件卸载与残余文件清理</span>
              </div>
              <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                共 {apps.length} 个应用
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
              <span className="text-slate-500">
                主程序总计：
                <strong className="text-slate-800 dark:text-slate-200 font-mono">
                  {formatFileSize(totalAppBytes)}
                </strong>
              </span>
              <span className="text-slate-500">
                关联残余：
                <strong className="text-slate-800 dark:text-slate-200 font-mono">
                  {formatFileSize(totalResidualBytes)}
                </strong>
              </span>
              <span className="text-amber-600 dark:text-amber-400">
                残余 &gt; 100 MB：
                <strong className="font-mono">{largeResidualCount} 个</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={isScanning || isUninstalling}
              onClick={() => void loadApps()}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-indigo-500' : ''}`} />
              <span>{isScanning ? '扫描中...' : '重新扫描'}</span>
            </button>

            <button
              type="button"
              disabled={selectedApps.length === 0 || isUninstalling}
              onClick={() => setPendingTargets(selectedApps)}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>
                {selectedApps.length > 0 ? `批量卸载 (${selectedApps.length})` : '批量卸载'}
              </span>
            </button>
          </div>
        </div>

        {/* Uninstall Result Banner */}
        {uninstallSummary && (
          <div
            role="status"
            className="px-3.5 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-start space-x-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div>
                  已卸载{' '}
                  <strong>
                    {uninstallSummary.outcomes.map((o) => o.app_name).join('、')}
                  </strong>
                  ，共释放空间{' '}
                  <strong className="font-mono">
                    {formatFileSize(uninstallSummary.freed_bytes)}
                  </strong>
                </div>
                <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                  主程序 {formatFileSize(uninstallSummary.freed_app_bytes)}
                  {uninstallSummary.freed_residual_bytes > 0 &&
                    ` · 已同步删除残余 ${formatFileSize(uninstallSummary.freed_residual_bytes)}`}
                  {uninstallSummary.retained_residual_bytes > 0 &&
                    ` · 已保留残余文件 ${formatFileSize(uninstallSummary.retained_residual_bytes)}`}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUninstallSummary(null)}
              className="text-current hover:underline text-[11px] shrink-0 cursor-pointer"
            >
              关闭
            </button>
          </div>
        )}

        {/* Filter & Search Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                aria-label="搜索已安装软件"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索软件名称或 Bundle ID..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="flex items-center space-x-1 text-xs">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  filterMode === 'all'
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                全部软件 ({apps.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('large_residual')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  filterMode === 'large_residual'
                    ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                残余 &gt; 100 MB ({largeResidualCount})
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-500 shrink-0">
            <select
              aria-label="排序方式"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as AppSortMode)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 focus:outline-hidden cursor-pointer"
            >
              <option value="total_desc">按总占用排序</option>
              <option value="residual_desc">按残余大小排序</option>
              <option value="app_desc">按主程序大小排序</option>
              <option value="name_asc">按名称排序</option>
            </select>

            <button
              type="button"
              onClick={() => handleSelectAllFiltered(true)}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
            >
              全选
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => handleSelectAllFiltered(false)}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
            >
              全不选
            </button>
          </div>
        </div>
      </div>

      {/* App List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {isScanning && apps.length === 0 && (
          <div className="h-64 flex flex-col items-center justify-center text-xs text-slate-400 space-y-2">
            <RefreshCw className="w-5 h-5 text-indigo-500 animate-spin" />
            <span>正在扫描已安装软件与关联残余文件...</span>
          </div>
        )}

        {!isScanning && filteredApps.length === 0 && (
          <div className="h-64 flex flex-col items-center justify-center text-xs text-slate-400 space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 stroke-1" />
            <span className="font-medium text-slate-600 dark:text-slate-300">
              {apps.length === 0 ? '所有列表中的应用已卸载完成' : '未找到匹配的软件'}
            </span>
          </div>
        )}

        {filteredApps.map((app) => {
          const isSelected = selectedIds.has(app.id);
          const isExpanded = expandedIds.has(app.id);
          const residualBytes = getAppResidualBytes(app);
          const totalBytes = getAppTotalBytes(app);
          const isLargeResidual = isLargeResidualApp(app);

          return (
            <div
              key={app.id}
              className={`rounded-2xl border transition-all ${
                isSelected
                  ? 'border-rose-200 dark:border-rose-800/80 bg-white dark:bg-slate-900 shadow-xs'
                  : 'border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/60'
              }`}
            >
              <div
                onClick={() => toggleSelect(app.id)}
                className="p-3.5 flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${app.name}`}
                    checked={isSelected}
                    onChange={() => toggleSelect(app.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                  />

                  <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 shrink-0">
                    <Package className="w-4 h-4 text-indigo-500" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-xs text-slate-800 dark:text-slate-100 truncate">
                        {app.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono">
                        v{app.version}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                        {app.category}
                      </span>
                      {isLargeResidual && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          残余 &gt; 100 MB
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate mt-0.5">
                      {app.bundle_id} · {app.app_path}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2.5 shrink-0">
                  <div className="text-right">
                    <div className="font-mono font-semibold text-xs text-slate-800 dark:text-slate-100">
                      {formatFileSize(totalBytes)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      程序 {formatFileSize(app.app_size_bytes)} · 残余{' '}
                      <span className={isLargeResidual ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}>
                        {formatFileSize(residualBytes)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label={`在访达中定位 ${app.name}`}
                    title="在访达中显示"
                    onClick={(e) => {
                      e.stopPropagation();
                      void api.revealInFinder(app.app_path);
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    aria-label={`卸载 ${app.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingTargets([app]);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/80 text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    卸载
                  </button>

                  {app.residuals.length > 0 && (
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={`查看 ${app.name} 残余文件`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(app.id);
                      }}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && app.residuals.length > 0 && (
                <div className="px-4 pb-3 pt-2 border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/40 rounded-b-2xl space-y-1.5">
                  <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                    关联残余文件 ({app.residuals.length} 处)
                  </div>
                  {app.residuals.map((res) => (
                    <div
                      key={res.id}
                      className="flex items-center justify-between text-xs py-1 px-2 rounded-lg hover:bg-slate-100/70 dark:hover:bg-slate-800/70"
                    >
                      <div className="min-w-0 flex items-center space-x-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                          {RESIDUAL_KIND_LABEL[res.kind]}
                        </span>
                        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
                          {res.name}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 truncate hidden sm:inline">
                          {res.path}
                        </span>
                      </div>
                      <div className="flex items-center space-x-3 shrink-0 ml-2">
                        <span className="text-[10px] text-slate-400">
                          {res.file_count.toLocaleString()} 个文件
                        </span>
                        <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {formatFileSize(res.size_bytes)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Confirmation Dialog */}
      <UninstallConfirmModal
        apps={pendingTargets}
        isSubmitting={isUninstalling}
        onCancel={() => setPendingTargets([])}
        onConfirm={(targets) => void handleConfirmUninstall(targets)}
      />
    </div>
  );
};
