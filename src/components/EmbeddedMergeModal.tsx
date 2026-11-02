import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  ArrowUp,
  ChevronRight,
  ChevronDown,
  Check,
  Search,
  ExternalLink,
  Layers,
  RefreshCw,
  Maximize2,
  X,
  FileText,
  AlertTriangle,
  MoveUp,
  MoveDown,
  Trash2,
} from 'lucide-react';
import { api } from '../services/api';
import { DirContent, FileItem, MergeItem, OperationResult } from '../types';
import { formatDate, formatFileSize, generateDefaultMergeOutputPath, getFileTypeBadge } from '../utils/format';

interface EmbeddedMergeModalProps {
  initialDirectory: string;
  initialFiles: string[];
  onExpandToFullStudio: () => void;
  onClose: () => void;
}

export const EmbeddedMergeModal: React.FC<EmbeddedMergeModalProps> = ({
  initialDirectory,
  initialFiles,
  onExpandToFullStudio,
  onClose,
}) => {
  const [currentPath, setCurrentPath] = useState<string>(initialDirectory || '');
  const [dirContent, setDirContent] = useState<DirContent | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingDir, setIsLoadingDir] = useState(false);

  // In-place inline folder expansion
  const [expandedFolders, setExpandedFolders] = useState<Record<string, FileItem[]>>({});
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());

  // Selected files queue for merging
  const [mergeQueue, setMergeQueue] = useState<MergeItem[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [outputFileName, setOutputFileName] = useState('');

  // UI state
  const [showOrderDrawer, setShowOrderDrawer] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<OperationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    if (!path) return;
    setIsLoadingDir(true);
    setErrorMessage(null);
    try {
      const content = await api.getDirectoryContents(path);
      setDirContent(content);
      setCurrentPath(content.current_path);
      setOutputFileName(generateDefaultMergeOutputPath(content.current_path));
    } catch (err: any) {
      setErrorMessage(typeof err === 'string' ? err : err?.message || '读取目录失败');
    } finally {
      setIsLoadingDir(false);
    }
  }, []);

  // Preload initial files on mount
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      const loadInitial = async () => {
        const items: MergeItem[] = [];
        const paths = new Set<string>();
        for (const f of initialFiles) {
          try {
            const meta = await api.getFileInfo(f);
            if (!meta.is_dir && meta.is_supported) {
              items.push({
                path: meta.path,
                name: meta.name,
                extension: meta.extension,
                page_count: meta.page_count,
                page_range: 'all',
              });
              paths.add(meta.path);
            }
          } catch {
            // ignore
          }
        }
        setMergeQueue(items);
        setSelectedPaths(paths);
      };
      loadInitial();
    }
  }, [initialFiles]);

  useEffect(() => {
    if (currentPath) {
      loadDirectory(currentPath);
    }
  }, [currentPath, loadDirectory]);

  // Inline folder expansion toggle
  const toggleFolderExpand = async (folderPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (expandedFolders[folderPath]) {
      // Collapse
      const next = { ...expandedFolders };
      delete next[folderPath];
      setExpandedFolders(next);
    } else {
      // Expand inline
      setLoadingFolders((prev) => new Set(prev).add(folderPath));
      try {
        const sub = await api.getDirectoryContents(folderPath);
        setExpandedFolders((prev) => ({
          ...prev,
          [folderPath]: sub.entries,
        }));
      } catch (err) {
        console.error('Failed to expand folder:', err);
      } finally {
        setLoadingFolders((prev) => {
          const next = new Set(prev);
          next.delete(folderPath);
          return next;
        });
      }
    }
  };

  // Toggle file selection
  const toggleFile = (item: FileItem) => {
    if (item.is_dir) return;
    const isSelected = selectedPaths.has(item.path);
    if (isSelected) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        next.delete(item.path);
        return next;
      });
      setMergeQueue((prev) => prev.filter((q) => q.path !== item.path));
    } else {
      setSelectedPaths((prev) => new Set(prev).add(item.path));
      setMergeQueue((prev) => [
        ...prev,
        {
          path: item.path,
          name: item.name,
          extension: item.extension,
          page_count: item.page_count,
          page_range: 'all',
        },
      ]);
    }
  };

  // Reordering
  const moveItem = (index: number, direction: 'up' | 'down') => {
    setMergeQueue((prev) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  const removeItem = (index: number) => {
    const item = mergeQueue[index];
    if (item) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        next.delete(item.path);
        return next;
      });
    }
    setMergeQueue((prev) => prev.filter((_, i) => i !== index));
  };

  // Execute Merge
  const handleMerge = async () => {
    if (mergeQueue.length === 0) {
      setErrorMessage('请至少选择一个需要合并的文件');
      return;
    }
    if (!outputFileName.trim()) {
      setErrorMessage('请指定输出文件名');
      return;
    }

    setIsMerging(true);
    setErrorMessage(null);
    setMergeResult(null);

    try {
      const res = await api.mergeFiles({
        items: mergeQueue,
        output_path: outputFileName.trim(),
      });
      setMergeResult(res);
      // Reload directory to show merged PDF
      loadDirectory(currentPath);
    } catch (err: any) {
      setErrorMessage(typeof err === 'string' ? err : err?.message || '合并失败');
    } finally {
      setIsMerging(false);
    }
  };

  // Breadcrumbs
  const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const currentFolderName = breadcrumbs[breadcrumbs.length - 1] || '根目录';

  // Filter root items
  const rootEntries = (dirContent?.entries || []).filter((item) => {
    if (searchQuery.trim()) {
      return item.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full w-full bg-slate-900/95 text-slate-100 select-none overflow-hidden backdrop-blur-2xl">
      {/* Sleek Titlebar & Navigation */}
      <div className="titlebar-drag pt-3 pb-2.5 px-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
        {/* Left Window Action / Branding */}
        <div className="titlebar-nodrag flex items-center space-x-2">
          <button
            onClick={onClose}
            className="w-3.5 h-3.5 rounded-full bg-rose-500/80 hover:bg-rose-500 flex items-center justify-center text-slate-900 transition-colors"
            title="关闭浮窗"
          >
            <X className="w-2.5 h-2.5 opacity-0 hover:opacity-100" />
          </button>
          <div className="w-3.5 h-3.5 rounded-full bg-amber-500/80" />
          <button
            onClick={onExpandToFullStudio}
            className="w-3.5 h-3.5 rounded-full bg-emerald-500/80 hover:bg-emerald-500 flex items-center justify-center text-slate-900 transition-colors"
            title="切换到完整工作台"
          >
            <Maximize2 className="w-2.5 h-2.5 opacity-0 hover:opacity-100" />
          </button>
        </div>

        {/* Center Current Folder & Up Button */}
        <div className="titlebar-nodrag flex items-center space-x-2 flex-1 min-w-0 justify-center">
          {dirContent?.parent_path && (
            <button
              onClick={() => loadDirectory(dirContent.parent_path!)}
              className="p-1 rounded-lg border border-slate-700/80 hover:bg-slate-800 text-slate-300 transition-colors shrink-0"
              title="返回上一级目录"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          )}
          <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-200 truncate">
            <FolderOpen className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="truncate">{currentFolderName}</span>
            <span className="text-[10px] text-slate-500 font-mono hidden sm:inline truncate max-w-xs">
              ({currentPath})
            </span>
          </div>
        </div>

        {/* Right Switch Button */}
        <div className="titlebar-nodrag flex items-center space-x-2">
          <button
            onClick={onExpandToFullStudio}
            className="px-2 py-1 text-[11px] rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors font-medium flex items-center space-x-1"
          >
            <Maximize2 className="w-3 h-3 text-indigo-400" />
            <span>专业套件</span>
          </button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="p-2.5 border-b border-slate-800/80 bg-slate-950/30 flex items-center justify-between gap-3 text-xs">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="在当前目录与展开文件夹中筛选..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-800 bg-slate-900/80 text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {mergeQueue.length > 0 && (
          <button
            onClick={() => setShowOrderDrawer(!showOrderDrawer)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center space-x-1.5 ${
              showOrderDrawer
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>已选清单 ({mergeQueue.length})</span>
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left/Center In-Place Directory & File Tree View */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingDir ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-400 text-xs">
              <RefreshCw className="w-5 h-5 animate-spin mb-2 text-indigo-400" />
              <span>正在展开目录结构...</span>
            </div>
          ) : rootEntries.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-xs">
              <Folder className="w-8 h-8 text-slate-700 mb-2 stroke-1" />
              <span>此目录暂无可合并的文件</span>
            </div>
          ) : (
            rootEntries.map((item) => (
              <React.Fragment key={item.path}>
                {/* Entry Row */}
                <TreeItemRow
                  item={item}
                  depth={0}
                  isSelected={selectedPaths.has(item.path)}
                  isExpanded={Boolean(expandedFolders[item.path])}
                  isLoadingSub={loadingFolders.has(item.path)}
                  onToggleSelect={() => toggleFile(item)}
                  onToggleExpand={(e) => toggleFolderExpand(item.path, e)}
                  onEnterFolder={() => loadDirectory(item.path)}
                />

                {/* Inline Expanded Child Directory Rows */}
                {expandedFolders[item.path] && (
                  <div className="pl-4 border-l border-slate-800 ml-3 space-y-1 py-0.5">
                    {expandedFolders[item.path].length === 0 ? (
                      <div className="text-[11px] text-slate-500 py-1 pl-4">（子文件夹为空）</div>
                    ) : (
                      expandedFolders[item.path].map((subItem) => (
                        <TreeItemRow
                          key={subItem.path}
                          item={subItem}
                          depth={1}
                          isSelected={selectedPaths.has(subItem.path)}
                          isExpanded={Boolean(expandedFolders[subItem.path])}
                          isLoadingSub={loadingFolders.has(subItem.path)}
                          onToggleSelect={() => toggleFile(subItem)}
                          onToggleExpand={(e) => toggleFolderExpand(subItem.path, e)}
                          onEnterFolder={() => loadDirectory(subItem.path)}
                        />
                      ))
                    )}
                  </div>
                )}
              </React.Fragment>
            ))
          )}
        </div>

        {/* Right Drawer: Reordering & Sequence Panel */}
        {showOrderDrawer && (
          <div className="w-64 border-l border-slate-800 bg-slate-950/80 flex flex-col h-full animate-in slide-in-from-right duration-200">
            <div className="p-2.5 border-b border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-200">
              <span>合并顺序调整</span>
              <button
                onClick={() => setMergeQueue([])}
                className="text-rose-400 hover:text-rose-300 text-[11px] flex items-center space-x-1"
              >
                <Trash2 className="w-3 h-3" />
                <span>清空</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {mergeQueue.map((item, idx) => (
                <div
                  key={item.path}
                  className="p-2 rounded-lg border border-slate-800 bg-slate-900/90 text-xs flex items-center justify-between"
                >
                  <div className="flex items-center space-x-2 min-w-0 flex-1 mr-1">
                    <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-400 text-[10px] flex items-center justify-center font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-[11px] font-medium text-slate-200 truncate" title={item.name}>
                      {item.name}
                    </span>
                  </div>

                  <div className="flex items-center space-x-0.5 shrink-0">
                    <button
                      onClick={() => moveItem(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-20"
                    >
                      <MoveUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => moveItem(idx, 'down')}
                      disabled={idx === mergeQueue.length - 1}
                      className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-20"
                    >
                      <MoveDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => removeItem(idx)}
                      className="p-1 text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Merge Control Footer */}
      <div className="p-3 border-t border-slate-800 bg-slate-950 space-y-2">
        {/* Output Path Display / Edit */}
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="shrink-0 font-medium mr-2">输出保存至:</span>
          <input
            type="text"
            value={outputFileName}
            onChange={(e) => setOutputFileName(e.target.value)}
            className="flex-1 px-2 py-0.5 text-xs rounded border border-slate-800 bg-slate-900 text-slate-300 font-mono truncate focus:outline-hidden"
          />
        </div>

        {/* Error or Success notification */}
        {errorMessage && (
          <div className="p-2 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-400 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="truncate">{errorMessage}</span>
          </div>
        )}

        {mergeResult && (
          <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="truncate">{mergeResult.message}</span>
            </div>
            {mergeResult.output_path && (
              <button
                onClick={() => api.revealInFinder(mergeResult.output_path!)}
                className="ml-2 text-indigo-400 hover:underline flex items-center space-x-1 shrink-0 font-medium"
              >
                <span>在访达定位</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleMerge}
          disabled={isMerging || mergeQueue.length === 0}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 text-white font-medium text-xs shadow-md shadow-indigo-600/30 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {isMerging ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>正在无缝合并中...</span>
            </>
          ) : (
            <>
              <FileText className="w-4 h-4" />
              <span>
                ⚡ 立即合并已选文件 ({mergeQueue.length} 个文件)
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

// Subcomponent: Tree Item Row supporting Folders & Files
interface TreeItemRowProps {
  item: FileItem;
  depth: number;
  isSelected: boolean;
  isExpanded: boolean;
  isLoadingSub: boolean;
  onToggleSelect: () => void;
  onToggleExpand: (e: React.MouseEvent) => void;
  onEnterFolder: () => void;
}

const TreeItemRow: React.FC<TreeItemRowProps> = ({
  item,
  isSelected,
  isExpanded,
  isLoadingSub,
  onToggleSelect,
  onToggleExpand,
  onEnterFolder,
}) => {
  const badge = getFileTypeBadge(item.extension);

  if (item.is_dir) {
    return (
      <div
        onClick={onEnterFolder}
        className="px-2 py-1.5 rounded-lg flex items-center justify-between hover:bg-slate-800/80 cursor-pointer transition-colors group"
      >
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          {/* Chevron to expand inline */}
          <button
            onClick={onToggleExpand}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors shrink-0"
            title={isExpanded ? '收起此目录' : '在此展开下级目录'}
          >
            {isLoadingSub ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            ) : isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>

          <Folder className="w-4 h-4 text-amber-400 shrink-0 fill-amber-400/20" />
          <span className="text-xs font-medium text-slate-200 truncate">
            {item.name}
          </span>
        </div>

        <span className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
          点击进入
        </span>
      </div>
    );
  }

  // File Row
  return (
    <div
      onClick={onToggleSelect}
      className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between transition-all cursor-pointer ${
        isSelected
          ? 'bg-indigo-950/60 border-indigo-700 text-white'
          : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700 text-slate-300'
      }`}
    >
      <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-2">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 shrink-0"
        />
        <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded border shrink-0 ${badge.color}`}>
          {badge.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{item.name}</div>
          <div className="text-[10px] text-slate-500 space-x-2">
            <span>{formatFileSize(item.size)}</span>
            {item.page_count && <span>• {item.page_count} 页</span>}
            <span>• {formatDate(item.modified)}</span>
          </div>
        </div>
      </div>

      <div className="shrink-0">
        {isSelected ? (
          <span className="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px]">
            <Check className="w-3 h-3" />
          </span>
        ) : (
          <span className="text-[11px] text-slate-500 hover:text-slate-300">
            勾选
          </span>
        )}
      </div>
    </div>
  );
};
