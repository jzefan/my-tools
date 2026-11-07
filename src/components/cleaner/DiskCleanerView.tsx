import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Sparkles,
  RefreshCw,
  Trash2,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Info,
  CheckCircle2,
  HardDrive,
  MessageCircle,
  MessageSquare,
  Code2,
  Globe,
  FileText,
  Lock,
} from 'lucide-react';
import {
  CleanItem,
  DiskCleanScanResult,
  RiskLevel,
  CleanCategory,
} from '../../types/cleaner';
import { cleanerApi } from '../../services/cleanerApi';
import { DiskUsageView } from './DiskUsageView';
import { api } from '../../services/api';
import { formatDiskSize, formatFileSize } from '../../utils/format';
import { confirmDialog, alertDialog } from '../../utils/dialog';

interface DiskCleanerViewProps {
  activeSubTab?: string;
}

export const DiskCleanerView: React.FC<DiskCleanerViewProps> = ({ activeSubTab }) => {
  const [scanResult, setScanResult] = useState<DiskCleanScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Cleaning execution state
  const [isCleaning, setIsCleaning] = useState(false);
  const [isCleaningItem, setIsCleaningItem] = useState<string | null>(null);
  const [cleanSummary, setCleanSummary] = useState<{
    freedBytes: number;
    deletedFiles: number;
    errors: string[];
  } | null>(null);

  // Filter category
  const [filterCategory, setFilterCategory] = useState<'all' | 'safe_only' | CleanCategory>('all');

  // Trigger scan
  const handleScan = useCallback(async () => {
    setIsScanning(true);
    try {
      const res = await cleanerApi.scanDiskCleanItems();
      setScanResult(res);

      // Default select safe and recommended items
      const initialSelected = new Set<string>();
      for (const item of res.items) {
        if (item.default_selected && item.size_bytes > 0) {
          initialSelected.add(item.id);
        }
      }
      setSelectedIds(initialSelected);
    } catch (err) {
      await alertDialog(`扫描失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const [usageVisited, setUsageVisited] = useState(activeSubTab === 'cleaner_usage');
  const didScanRef = useRef(false);
  useEffect(() => {
    if (activeSubTab === 'cleaner_usage') setUsageVisited(true);
  }, [activeSubTab]);

  useEffect(() => {
    if (activeSubTab === 'cleaner_usage') return;
    if (didScanRef.current) return;
    didScanRef.current = true;
    void handleScan();
  }, [activeSubTab, handleScan]);

  const accessWatchRef = useRef(0);
  const watchFullDiskAccess = useCallback(() => {
    const watchId = accessWatchRef.current + 1;
    accessWatchRef.current = watchId;
    const tick = async () => {
      if (accessWatchRef.current !== watchId) return;
      try {
        if (await cleanerApi.hasFullDiskAccess()) {
          accessWatchRef.current = watchId + 1;
          await handleScan();
          return;
        }
      } catch {
        // Keep waiting until the user enables access.
      }
      if (accessWatchRef.current !== watchId) return;
      window.setTimeout(tick, 1000);
    };
    window.setTimeout(tick, 1000);
  }, [handleScan]);

  useEffect(
    () => () => {
      accessWatchRef.current += 1;
    },
    [],
  );

  // Sync with external sub-tab from sidebar
  useEffect(() => {
    if (!activeSubTab) return;
    if (activeSubTab === 'cleaner_wechat') {
      setFilterCategory('wechat');
    } else if (activeSubTab === 'cleaner_qq') {
      setFilterCategory('qq');
    } else if (activeSubTab === 'cleaner_developer') {
      setFilterCategory('developer');
    } else if (activeSubTab === 'cleaner_system') {
      setFilterCategory('system_logs');
    } else {
      setFilterCategory('all');
    }
  }, [activeSubTab]);

  // Toggle selection for an item
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all or deselect all
  const handleSelectAll = (select: boolean) => {
    if (select && scanResult) {
      const all = new Set(scanResult.items.filter((i) => i.size_bytes > 0).map((i) => i.id));
      setSelectedIds(all);
    } else {
      setSelectedIds(new Set());
    }
  };

  // Smart select (safe items only)
  const handleSelectSafeOnly = () => {
    if (!scanResult) return;
    const safeOnly = new Set(
      scanResult.items
        .filter((i) => i.risk_level === 'safe' && i.size_bytes > 0)
        .map((i) => i.id)
    );
    setSelectedIds(safeOnly);
  };

  // Toggle expand
  const handleToggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Reveal path in Finder
  const handleRevealInFinder = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.revealInFinder(path);
    } catch (err) {
      console.error('在访达中定位失败:', err);
    }
  };

  // Execute clean for selected items (Batch / Select all)
  const handleExecuteClean = async () => {
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    const confirmMsg = `确定清理选中的 ${count} 个项目吗？清理后将无法撤销。`;
    const confirmed = await confirmDialog(confirmMsg);
    if (!confirmed) return;

    setIsCleaning(true);
    try {
      const res = await cleanerApi.executeClean({
        item_ids: Array.from(selectedIds),
        delete_permanently: true,
      });

      setCleanSummary({
        freedBytes: res.freed_bytes,
        deletedFiles: res.deleted_files_count,
        errors: res.errors,
      });

      // Refresh scan after cleaning
      await handleScan();
    } catch (err: any) {
      await alertDialog(`清理出错: ${err?.message || err}`);
    } finally {
      setIsCleaning(false);
    }
  };

  // Clean single item
  const handleCleanSingleItem = async (item: CleanItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.size_bytes === 0) return;

    const confirmMsg = `确定单独清理「${item.name}」(${formatFileSize(item.size_bytes)}) 吗？清理后将无法撤销。`;
    const confirmed = await confirmDialog(confirmMsg);
    if (!confirmed) return;

    setIsCleaningItem(item.id);
    try {
      const res = await cleanerApi.executeClean({
        item_ids: [item.id],
        delete_permanently: true,
      });

      setCleanSummary({
        freedBytes: res.freed_bytes,
        deletedFiles: res.deleted_files_count,
        errors: res.errors,
      });

      await handleScan();
    } catch (err: any) {
      await alertDialog(`清理出错: ${err?.message || err}`);
    } finally {
      setIsCleaningItem(null);
    }
  };

  // Clean single sub-path
  const handleCleanSinglePath = async (path: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmMsg = `确定删除「${name}」吗？清理后将无法撤销。`;
    const confirmed = await confirmDialog(confirmMsg);
    if (!confirmed) return;

    setIsCleaningItem(path);
    try {
      const res = await cleanerApi.cleanSpecificPath(path);
      setCleanSummary({
        freedBytes: res.freed_bytes,
        deletedFiles: res.deleted_files_count,
        errors: res.errors,
      });

      await handleScan();
    } catch (err: any) {
      await alertDialog(`删除出错: ${err?.message || err}`);
    } finally {
      setIsCleaningItem(null);
    }
  };

  // Filtered items
  const filteredItems = useMemo(() => {
    if (!scanResult) return [];
    return scanResult.items.filter((item) => {
      if (filterCategory === 'all') return true;
      if (filterCategory === 'safe_only') return item.risk_level === 'safe';
      return item.category === filterCategory;
    });
  }, [scanResult, filterCategory]);

  // Selected size sum
  const selectedBytes = useMemo(() => {
    if (!scanResult) return 0;
    return scanResult.items
      .filter((i) => selectedIds.has(i.id))
      .reduce((acc, curr) => acc + curr.size_bytes, 0);
  }, [scanResult, selectedIds]);

  // Category Icon helper
  const renderCategoryIcon = (cat: CleanCategory) => {
    switch (cat) {
      case 'wechat':
        return <MessageCircle className="w-4 h-4 text-emerald-500" />;
      case 'qq':
        return <MessageSquare className="w-4 h-4 text-sky-500" />;
      case 'browser':
        return <Globe className="w-4 h-4 text-blue-500" />;
      case 'developer':
        return <Code2 className="w-4 h-4 text-amber-500" />;
      case 'system_logs':
        return <FileText className="w-4 h-4 text-indigo-500" />;
      case 'app_cache':
        return <HardDrive className="w-4 h-4 text-slate-500" />;
      case 'trash':
        return <Trash2 className="w-4 h-4 text-rose-500" />;
      default:
        return <Sparkles className="w-4 h-4 text-indigo-500" />;
    }
  };

  // Risk Badge Helper
  const renderRiskBadge = (level: RiskLevel) => {
    switch (level) {
      case 'safe':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
            <ShieldCheck className="w-3 h-3 mr-1" />
            安全可删
          </span>
        );
      case 'recommended':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
            <Info className="w-3 h-3 mr-1" />
            建议清理
          </span>
        );
      case 'caution':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-3 h-3 mr-1" />
            谨慎确认
          </span>
        );
    }
  };

  const diskUsedBytes =
    scanResult && scanResult.disk_total_bytes > scanResult.disk_free_bytes
      ? scanResult.disk_total_bytes - scanResult.disk_free_bytes
      : 0;

  const diskUsedPercent =
    scanResult && scanResult.disk_total_bytes > 0
      ? Math.min(100, Math.round((diskUsedBytes / scanResult.disk_total_bytes) * 100))
      : 0;

  const usageActive = activeSubTab === 'cleaner_usage';

  return (
    <>
      {usageVisited && (
        <div className={usageActive ? 'flex h-full min-h-0 flex-1 flex-col' : 'hidden'}>
          <DiskUsageView />
        </div>
      )}
      {!usageActive && scanResult?.supported === false && (
        <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">磁盘清理暂仅支持macOS</div>
      )}
      {!usageActive && scanResult?.supported !== false && (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 select-none">
      {/* Top Header & Storage Dashboard */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs shrink-0">
        <div className="flex items-center justify-between gap-4">
          {/* Storage Capacity Bar */}
          <div className="flex-1 min-w-[280px] max-w-xl bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200/80 dark:border-slate-700/60">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <div className="flex items-center space-x-1.5 font-medium text-slate-700 dark:text-slate-200">
                <HardDrive className="w-4 h-4 text-indigo-500" />
                <span>系统主磁盘</span>
              </div>
              <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                {scanResult
                  ? `已用 ${formatDiskSize(diskUsedBytes)} / 共 ${formatDiskSize(
                      scanResult.disk_total_bytes
                    )} (${diskUsedPercent}%)`
                  : '读取中...'}
              </span>
            </div>

            {/* Mini Progress Bar */}
            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex">
              <div
                style={{ width: `${diskUsedPercent}%` }}
                className={`h-full transition-all duration-300 ${
                  diskUsedPercent > 90
                    ? 'bg-rose-500'
                    : diskUsedPercent > 75
                    ? 'bg-amber-500'
                    : 'bg-indigo-600'
                }`}
              />
            </div>

            <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px]">
              <div className="flex items-center space-x-3">
                <span className="text-slate-500">
                  可清理垃圾：
                  <strong className="text-slate-800 dark:text-slate-200 font-mono">
                    {scanResult ? formatFileSize(scanResult.total_scanned_bytes) : '-'}
                  </strong>
                </span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  安全可删：
                  <strong className="font-mono">
                    {scanResult ? formatFileSize(scanResult.total_safe_bytes) : '-'}
                  </strong>
                </span>
              </div>
              <span className="text-slate-400 text-[10px]">
                共 {scanResult?.total_files.toLocaleString() || 0} 个文件
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={isScanning || isCleaning || isCleaningItem !== null}
              onClick={handleScan}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-indigo-500' : ''}`} />
              <span>{isScanning ? '正在扫描...' : '重新扫描'}</span>
            </button>

            <button
              type="button"
              disabled={isCleaning || isCleaningItem !== null || selectedIds.size === 0}
              onClick={handleExecuteClean}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>
                {isCleaning
                  ? '正在清理...'
                  : selectedBytes > 0
                  ? `开始清理 (${formatFileSize(selectedBytes)})`
                  : '开始清理'}
              </span>
            </button>
          </div>
        </div>

        {/* Permission Issue Notice Banner */}
        {scanResult?.has_permission_issues && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
            <div className="flex items-center space-x-2">
              <Lock className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                {scanResult.full_disk_client_name
                  ? `部分路径未能完整扫描。打开「${scanResult.full_disk_client_name}」`
                  : '部分路径未能完整扫描，统计可能不完整。'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                void cleanerApi.openFullDiskAccessSettings().then((opened) => {
                  if (opened) watchFullDiskAccess();
                });
              }}
              className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-medium shrink-0 cursor-pointer shadow-2xs"
            >
              去系统设置开启
            </button>
          </div>
        )}

        {/* Cleaning Result Toast Banner */}
        {cleanSummary && (
          <div className={`mt-3 px-3 py-2 rounded-xl border flex items-center justify-between text-xs animate-in fade-in ${cleanSummary.errors.length > 0
            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
            : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'}`}>
            <div className="flex items-center space-x-2">
              {cleanSummary.errors.length > 0
                ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                : <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
              <div>
                {cleanSummary.errors.length ? '部分项目未清理，已删除文件体积' : '已删除文件体积'} <strong>{formatFileSize(cleanSummary.freedBytes)}</strong>
                （{cleanSummary.deletedFiles} 个文件）
                {cleanSummary.errors.length > 0 && (
                  <details className="mt-1 text-amber-700 dark:text-amber-300">
                    <summary className="cursor-pointer">{cleanSummary.errors.length} 项错误</summary>
                    <ul className="mt-1 max-h-40 overflow-auto break-all">
                      {cleanSummary.errors.map((error, index) => <li key={index}>{error}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCleanSummary(null)}
              className="text-current hover:underline text-[11px] cursor-pointer"
            >
              关闭
            </button>
          </div>
        )}

        {/* Quick Filter Categories Bar */}
        <div className="mt-3 flex items-center justify-between gap-2 overflow-x-auto pt-1">
          <div className="flex items-center space-x-1.5 text-xs">
            <button
              type="button"
              onClick={() => setFilterCategory('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                filterCategory === 'all'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              全部项目
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory('safe_only')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                filterCategory === 'safe_only'
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              仅安全可删
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory('wechat')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                filterCategory === 'wechat'
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              微信专清
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory('qq')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                filterCategory === 'qq'
                  ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              QQ 专清
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory('browser')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                filterCategory === 'browser'
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              浏览器缓存
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory('developer')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                filterCategory === 'developer'
                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              开发者缓存
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory('trash')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                filterCategory === 'trash'
                  ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              废纸篓与安装包
            </button>
          </div>

          {/* Selection shortcuts */}
          <div className="flex items-center space-x-2 text-xs text-slate-500 shrink-0">
            <button
              type="button"
              onClick={handleSelectSafeOnly}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
            >
              推荐安全项
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => handleSelectAll(true)}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
            >
              全选
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => handleSelectAll(false)}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
            >
              全不选
            </button>
          </div>
        </div>
      </div>

      {/* Main Items List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {isScanning && !scanResult && (
          <div className="h-64 flex flex-col items-center justify-center text-xs text-slate-400 space-y-2">
            <RefreshCw className="w-5 h-5 text-indigo-500 animate-spin" />
            <span>正在快速扫描系统垃圾与微信/QQ缓存...</span>
          </div>
        )}

        {filteredItems.length === 0 && !isScanning && (
          <div className="h-64 flex flex-col items-center justify-center text-xs text-slate-400 space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 stroke-1" />
            <span className="font-medium text-slate-600 dark:text-slate-300">
              当前分类未发现可清理的垃圾文件
            </span>
            <span className="text-[11px] text-slate-400">系统保持在优良状态</span>
          </div>
        )}

        {filteredItems.map((item) => {
          const isSelected = selectedIds.has(item.id);
          const isExpanded = expandedIds.has(item.id);
          const hasDetails = item.details && item.details.length > 0;
          const isItemBeingCleaned = isCleaningItem === item.id;

          return (
            <div
              key={item.id}
              className={`rounded-2xl border transition-all ${
                isSelected
                  ? 'border-indigo-200 dark:border-indigo-800/80 bg-white dark:bg-slate-900 shadow-xs'
                  : 'border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/60'
              }`}
            >
              {/* Item Summary Bar */}
              <div
                onClick={() => handleToggleSelect(item.id)}
                className="p-3.5 flex items-center justify-between gap-3 cursor-pointer select-none"
              >
                {/* Left: Checkbox & Icon */}
                <div className="flex items-center space-x-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleSelect(item.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-400 cursor-pointer"
                  />
                  <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 shrink-0">
                    {renderCategoryIcon(item.category)}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-xs text-slate-800 dark:text-slate-100 truncate">
                        {item.name}
                      </span>
                      {renderRiskBadge(item.risk_level)}
                      {item.is_permission_denied && (
                        <span className="text-[10px] text-amber-500 font-medium">需要授权</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </div>

                {/* Right: Size, Files, Actions */}
                <div className="flex items-center space-x-3 shrink-0">
                  <div className="text-right">
                    <div className="font-mono font-semibold text-xs text-slate-800 dark:text-slate-100">
                      {formatFileSize(item.size_bytes)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {item.file_count > 0 ? `${item.file_count} 个文件` : '0 文件'}
                    </div>
                  </div>

                  {/* Reveal path in finder button */}
                  {item.paths.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => handleRevealInFinder(item.paths[0], e)}
                      title="在访达中显示"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Clean single item button */}
                  <button
                    type="button"
                    disabled={item.size_bytes === 0 || isItemBeingCleaned}
                    onClick={(e) => handleCleanSingleItem(item, e)}
                    title={item.size_bytes === 0 ? '暂无可清理内容' : `单独清理「${item.name}」`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    {isItemBeingCleaned ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-500" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {/* Expand details toggle */}
                  {hasDetails && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleExpand(item.id);
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

              {/* Collapsible Sub-item Details */}
              {isExpanded && hasDetails && (
                <div className="px-4 pb-3 pt-1 border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/40 rounded-b-2xl">
                  <div className="text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                    细分目录占用
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {item.details.map((detail, idx) => {
                      const isDetailBeingCleaned = isCleaningItem === detail.path;

                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg hover:bg-slate-100/70 dark:hover:bg-slate-800/70 group"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate">
                              {detail.name}
                            </span>
                          </div>
                          <div className="flex items-center space-x-3 shrink-0">
                            <span className="font-mono text-[11px] text-slate-500">
                              {formatFileSize(detail.size_bytes)}
                            </span>

                            {/* In Finder button */}
                            <button
                              type="button"
                              onClick={(e) => handleRevealInFinder(detail.path, e)}
                              title="在访达中显示"
                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-indigo-600 rounded transition-all cursor-pointer"
                            >
                              <FolderOpen className="w-3 h-3" />
                            </button>

                            {/* Delete single sub-item button */}
                            <button
                              type="button"
                              disabled={isDetailBeingCleaned}
                              onClick={(e) => handleCleanSinglePath(detail.path, detail.name, e)}
                              title={`删除「${detail.name}」`}
                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 rounded transition-all cursor-pointer disabled:opacity-40"
                            >
                              {isDetailBeingCleaned ? (
                                <RefreshCw className="w-3 h-3 animate-spin text-rose-500" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
      )}
    </>
  );
};
