import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  ArrowUp,
  ChevronRight,
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
  Columns,
  List,
  Sparkles,
} from 'lucide-react';
import { api } from '../services/api';
import { DirContent, FileItem, MergeItem, OperationResult } from '../types';
import { formatFileSize, generateDefaultMergeOutputPath, getFileTypeBadge } from '../utils/format';

interface FinderColumnMergeViewProps {
  initialDirectory: string;
  initialFiles: string[];
  onExpandToFullStudio: () => void;
  onClose: () => void;
}

export const FinderColumnMergeView: React.FC<FinderColumnMergeViewProps> = ({
  initialDirectory,
  initialFiles,
  onExpandToFullStudio,
  onClose,
}) => {
  // Navigation State
  const [currentPath, setCurrentPath] = useState<string>(initialDirectory || '');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [selectedSubfolder, setSelectedSubfolder] = useState<string | null>(null);

  // Column Contents
  const [parentDirContent, setParentDirContent] = useState<DirContent | null>(null);
  const [currentDirContent, setCurrentDirContent] = useState<DirContent | null>(null);
  const [subfolderDirContent, setSubfolderDirContent] = useState<DirContent | null>(null);

  // Loading States
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [loadingParent, setLoadingParent] = useState(false);
  const [loadingSubfolder, setLoadingSubfolder] = useState(false);

  // Search & View Mode: 'column' (仿访达分栏) vs 'list' (仿访达列表)
  const [viewMode, setViewMode] = useState<'column' | 'list'>('column');
  const [searchQuery, setSearchQuery] = useState('');

  // Merge Staging
  const [mergeQueue, setMergeQueue] = useState<MergeItem[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const [outputFileName, setOutputFileName] = useState('');

  // Merge execution
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<OperationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load Parent Directory Content
  const loadParentDir = useCallback(async (pPath: string) => {
    setLoadingParent(true);
    try {
      const content = await api.getDirectoryContents(pPath);
      setParentDirContent(content);
    } catch {
      setParentDirContent(null);
    } finally {
      setLoadingParent(false);
    }
  }, []);

  // Load Subfolder Content for Column 3
  const loadSubfolderDir = useCallback(async (subPath: string) => {
    setSelectedSubfolder(subPath);
    setLoadingSubfolder(true);
    try {
      const content = await api.getDirectoryContents(subPath);
      setSubfolderDirContent(content);
    } catch {
      setSubfolderDirContent(null);
    } finally {
      setLoadingSubfolder(false);
    }
  }, []);

  // Load Current Directory Content
  const loadCurrentDir = useCallback(
    async (path: string) => {
      if (!path) return;
      setLoadingCurrent(true);
      setErrorMessage(null);
      try {
        const content = await api.getDirectoryContents(path);
        setCurrentDirContent(content);
        setCurrentPath(content.current_path);
        setOutputFileName(generateDefaultMergeOutputPath(content.current_path));

        // If parent exists, load parent column
        if (content.parent_path) {
          setParentPath(content.parent_path);
          loadParentDir(content.parent_path);
        } else {
          setParentPath(null);
          setParentDirContent(null);
        }

        // Auto select first subfolder for column 3 if available
        const firstFolder = content.entries.find((e) => e.is_dir);
        if (firstFolder) {
          loadSubfolderDir(firstFolder.path);
        } else {
          setSelectedSubfolder(null);
          setSubfolderDirContent(null);
        }
      } catch (err: any) {
        setErrorMessage(typeof err === 'string' ? err : err?.message || '读取目录失败');
      } finally {
        setLoadingCurrent(false);
      }
    },
    [loadParentDir, loadSubfolderDir]
  );

  // Initialize with right-clicked initial file(s)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      const initAnchor = async () => {
        const items: MergeItem[] = [];
        const paths = new Set<string>();

        // First file is the clicked anchor file
        setAnchorPath(initialFiles[0]);

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
      initAnchor();
    }
  }, [initialFiles]);

  useEffect(() => {
    if (currentPath) {
      loadCurrentDir(currentPath);
    }
  }, [currentPath, loadCurrentDir]);

  // Navigate to a folder as the new Current Directory
  const navigateToFolder = (targetPath: string) => {
    loadCurrentDir(targetPath);
  };

  // Toggle file selection into Merge Queue
  const toggleSelectFile = (item: FileItem) => {
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

  // Reorder queue
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
      // Reload current directory
      loadCurrentDir(currentPath);
    } catch (err: any) {
      setErrorMessage(typeof err === 'string' ? err : err?.message || '合并失败');
    } finally {
      setIsMerging(false);
    }
  };

  // Breadcrumbs
  const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const currentFolderName = breadcrumbs[breadcrumbs.length - 1] || '当前目录';
  const parentFolderName = parentPath ? parentPath.split('/').filter(Boolean).pop() : null;

  return (
    <div className="flex flex-col h-full w-full bg-slate-900/95 text-slate-100 select-none overflow-hidden backdrop-blur-3xl">
      {/* 1. macOS Finder Style Navigation Bar */}
      <div className="titlebar-drag pt-3 pb-2.5 px-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-3">
        {/* Window controls */}
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
            title="展开为完整专业版套件"
          >
            <Maximize2 className="w-2.5 h-2.5 opacity-0 hover:opacity-100" />
          </button>
        </div>

        {/* Center: Current Folder & Up navigation */}
        <div className="titlebar-nodrag flex items-center space-x-2 flex-1 min-w-0 justify-center">
          {parentPath && (
            <button
              onClick={() => navigateToFolder(parentPath)}
              className="px-2 py-1 text-xs rounded-lg border border-slate-700/80 hover:bg-slate-800 text-slate-300 transition-colors flex items-center space-x-1 shrink-0"
              title="前往上级目录"
            >
              <ArrowUp className="w-3 h-3 text-indigo-400" />
              <span className="text-[11px] font-medium">上一级</span>
            </button>
          )}

          <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-200 truncate bg-slate-800/60 px-3 py-1 rounded-xl border border-slate-750">
            <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-indigo-400 font-bold">当前目录:</span>
            <span className="truncate">{currentFolderName}</span>
          </div>
        </div>

        {/* Right Controls: View Switcher (Column vs List) */}
        <div className="titlebar-nodrag flex items-center space-x-1.5 shrink-0">
          <div className="flex items-center bg-slate-800/80 rounded-lg p-0.5 border border-slate-700">
            <button
              onClick={() => setViewMode('column')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'column'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="访达分栏视图 (浏览上级与下级)"
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="列表展开视图"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={onExpandToFullStudio}
            className="px-2 py-1 text-[11px] rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors font-medium flex items-center space-x-1"
          >
            <Maximize2 className="w-3 h-3 text-indigo-400" />
            <span>专业套件</span>
          </button>
        </div>
      </div>

      {/* 2. Search & Selection Status Bar */}
      <div className="px-4 py-2 border-b border-slate-800/80 bg-slate-950/40 flex items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索文件与文件夹..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1 text-xs rounded-lg border border-slate-800 bg-slate-900/90 text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Anchor File Indicator */}
        {anchorPath && (
          <div className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/80 border border-indigo-800/80 text-[11px] text-indigo-300 truncate max-w-xs">
            <Sparkles className="w-3 h-3 text-indigo-400 shrink-0" />
            <span className="text-slate-400 shrink-0">点选文件:</span>
            <span className="font-semibold truncate">{anchorPath.split('/').pop()}</span>
          </div>
        )}

        {/* Selected Counter & Drawer Trigger */}
        <button
          onClick={() => setShowQueueDrawer(!showQueueDrawer)}
          className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors flex items-center space-x-1.5 shrink-0 ${
            showQueueDrawer
              ? 'bg-indigo-600 border-indigo-500 text-white'
              : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span>待合并清单 ({mergeQueue.length})</span>
        </button>
      </div>

      {/* 3. Main Multi-Column Finder Experience */}
      <div className="flex-1 flex overflow-hidden">
        {viewMode === 'column' ? (
          /* Multi-Column View (访达分栏视图) */
          <div className="flex-1 flex overflow-x-auto divide-x divide-slate-800">
            {/* Column 1: Parent Directory (上级目录) */}
            <div className="w-64 min-w-[240px] flex flex-col h-full bg-slate-950/40">
              <div className="px-3 py-2 border-b border-slate-800/80 bg-slate-950/60 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-400 flex items-center space-x-1">
                  <ArrowUp className="w-3.5 h-3.5 text-slate-500" />
                  <span>上级目录: {parentFolderName || '根目录'}</span>
                </span>
                {parentPath && (
                  <button
                    onClick={() => navigateToFolder(parentPath)}
                    className="text-[10px] text-indigo-400 hover:underline"
                  >
                    跳转到此
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                {loadingParent ? (
                  <div className="p-4 text-center text-slate-500 text-xs">加载上级中...</div>
                ) : !parentDirContent || parentDirContent.entries.length === 0 ? (
                  <div className="p-4 text-center text-slate-600 text-xs">无上级目录文件</div>
                ) : (
                  parentDirContent.entries
                    .filter((e) => !searchQuery || e.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((item) => (
                      <FinderColumnItem
                        key={item.path}
                        item={item}
                        isSelected={selectedPaths.has(item.path)}
                        isCurrentFocus={item.path === currentPath}
                        isAnchor={item.path === anchorPath}
                        onToggleSelect={() => toggleSelectFile(item)}
                        onClickFolder={() => navigateToFolder(item.path)}
                      />
                    ))
                )}
              </div>
            </div>

            {/* Column 2: Current Directory (当前文件所在目录 - 核心高亮) */}
            <div className="w-80 min-w-[280px] flex flex-col h-full bg-slate-900/40 ring-1 ring-inset ring-indigo-500/20">
              <div className="px-3 py-2 border-b border-slate-800/80 bg-indigo-950/40 flex items-center justify-between text-xs">
                <span className="font-bold text-indigo-300 flex items-center space-x-1.5">
                  <FolderOpen className="w-4 h-4 text-amber-400" />
                  <span>当前目录: {currentFolderName}</span>
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-semibold">
                  {currentDirContent?.entries.length || 0} 项
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                {loadingCurrent ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                    <span>加载当前目录文件...</span>
                  </div>
                ) : !currentDirContent || currentDirContent.entries.length === 0 ? (
                  <div className="p-8 text-center text-slate-600 text-xs">目录为空</div>
                ) : (
                  currentDirContent.entries
                    .filter((e) => !searchQuery || e.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((item) => (
                      <FinderColumnItem
                        key={item.path}
                        item={item}
                        isSelected={selectedPaths.has(item.path)}
                        isCurrentFocus={item.path === selectedSubfolder}
                        isAnchor={item.path === anchorPath}
                        onToggleSelect={() => toggleSelectFile(item)}
                        onClickFolder={() => {
                          if (item.is_dir) {
                            loadSubfolderDir(item.path);
                          }
                        }}
                      />
                    ))
                )}
              </div>
            </div>

            {/* Column 3: Subdirectory (下级子文件夹) */}
            <div className="flex-1 min-w-[260px] flex flex-col h-full bg-slate-950/40">
              <div className="px-3 py-2 border-b border-slate-800/80 bg-slate-950/60 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-400 flex items-center space-x-1">
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    下级目录: {selectedSubfolder ? selectedSubfolder.split('/').pop() : '未选择子文件夹'}
                  </span>
                </span>
                {selectedSubfolder && (
                  <button
                    onClick={() => navigateToFolder(selectedSubfolder)}
                    className="text-[10px] text-indigo-400 hover:underline"
                  >
                    深入此目录
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                {loadingSubfolder ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-indigo-400" />
                    <span>加载子目录文件...</span>
                  </div>
                ) : !selectedSubfolder ? (
                  <div className="p-8 text-center text-slate-600 text-xs">
                    点击中间列的文件夹可在此查看下级文件并勾选
                  </div>
                ) : !subfolderDirContent || subfolderDirContent.entries.length === 0 ? (
                  <div className="p-8 text-center text-slate-600 text-xs">此子文件夹为空</div>
                ) : (
                  subfolderDirContent.entries
                    .filter((e) => !searchQuery || e.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((item) => (
                      <FinderColumnItem
                        key={item.path}
                        item={item}
                        isSelected={selectedPaths.has(item.path)}
                        isCurrentFocus={false}
                        isAnchor={item.path === anchorPath}
                        onToggleSelect={() => toggleSelectFile(item)}
                        onClickFolder={() => navigateToFolder(item.path)}
                      />
                    ))
                )}
              </div>
            </div>
          </div>
        ) : (
          /* List Mode (访达列表展开视图) */
          <div className="flex-1 overflow-y-auto p-3 space-y-1 bg-slate-950/40">
            {currentDirContent?.entries.map((item) => (
              <FinderColumnItem
                key={item.path}
                item={item}
                isSelected={selectedPaths.has(item.path)}
                isCurrentFocus={false}
                isAnchor={item.path === anchorPath}
                onToggleSelect={() => toggleSelectFile(item)}
                onClickFolder={() => navigateToFolder(item.path)}
              />
            ))}
          </div>
        )}

        {/* Right Drawer: Merge Sequence & Ordering */}
        {showQueueDrawer && (
          <div className="w-72 border-l border-slate-800 bg-slate-950 flex flex-col h-full animate-in slide-in-from-right duration-200">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-200">
              <div className="flex items-center space-x-1.5">
                <Layers className="w-4 h-4 text-indigo-400" />
                <span>合并顺序调整</span>
              </div>
              <button
                onClick={() => {
                  setMergeQueue([]);
                  setSelectedPaths(new Set());
                }}
                className="text-rose-400 hover:text-rose-300 text-[11px] flex items-center space-x-1"
              >
                <Trash2 className="w-3 h-3" />
                <span>清空</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {mergeQueue.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs">
                  暂未选择任何文件，从左侧分栏中勾选文件
                </div>
              ) : (
                mergeQueue.map((item, idx) => (
                  <div
                    key={item.path}
                    className={`p-2 rounded-lg border text-xs flex items-center justify-between ${
                      item.path === anchorPath
                        ? 'border-indigo-700 bg-indigo-950/60 ring-1 ring-indigo-500/30'
                        : 'border-slate-800 bg-slate-900/90'
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0 flex-1 mr-1">
                      <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-400 text-[10px] flex items-center justify-center font-bold shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-slate-200 truncate" title={item.name}>
                          {item.name}
                        </div>
                        {item.path === anchorPath && (
                          <div className="text-[9px] text-indigo-400 font-semibold">首选 (点选的文件)</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-0.5 shrink-0">
                      <button
                        onClick={() => moveItem(idx, 'up')}
                        disabled={idx === 0}
                        className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-20"
                        title="上移"
                      >
                        <MoveUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => moveItem(idx, 'down')}
                        disabled={idx === mergeQueue.length - 1}
                        className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-20"
                        title="下移"
                      >
                        <MoveDown className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => removeItem(idx)}
                        className="p-1 text-rose-400 hover:text-rose-300"
                        title="移除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* 4. Bottom Action Dock */}
      <div className="p-3 border-t border-slate-800 bg-slate-950 space-y-2">
        {/* Output Path */}
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="shrink-0 font-medium mr-2">合并保存至:</span>
          <input
            type="text"
            value={outputFileName}
            onChange={(e) => setOutputFileName(e.target.value)}
            className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-slate-800 bg-slate-900 text-slate-300 font-mono truncate focus:outline-hidden"
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
          <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="truncate font-medium">{mergeResult.message}</span>
            </div>
            {mergeResult.output_path && (
              <button
                onClick={() => api.revealInFinder(mergeResult.output_path!)}
                className="ml-2 text-indigo-400 hover:underline flex items-center space-x-1 shrink-0 font-medium"
              >
                <span>在访达定位</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Big Action Button */}
        <button
          onClick={handleMerge}
          disabled={isMerging || mergeQueue.length === 0}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 text-white font-medium text-xs shadow-md shadow-indigo-600/30 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {isMerging ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>正在快速合并所选文件...</span>
            </>
          ) : (
            <>
              <FileText className="w-4 h-4" />
              <span>
                ⚡ 开始合并点选的文件与所选文件 (共 {mergeQueue.length} 个)
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

// Subcomponent: Column Item
interface FinderColumnItemProps {
  item: FileItem;
  isSelected: boolean;
  isCurrentFocus: boolean;
  isAnchor: boolean;
  onToggleSelect: () => void;
  onClickFolder: () => void;
}

const FinderColumnItem: React.FC<FinderColumnItemProps> = ({
  item,
  isSelected,
  isCurrentFocus,
  isAnchor,
  onToggleSelect,
  onClickFolder,
}) => {
  const badge = getFileTypeBadge(item.extension);

  if (item.is_dir) {
    return (
      <div
        onClick={onClickFolder}
        className={`px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer transition-colors ${
          isCurrentFocus
            ? 'bg-indigo-900/60 text-white border border-indigo-700/80'
            : 'hover:bg-slate-800/80 text-slate-300'
        }`}
      >
        <div className="flex items-center space-x-2 min-w-0 flex-1 mr-1">
          <Folder className="w-4 h-4 text-amber-400 shrink-0 fill-amber-400/20" />
          <span className="text-xs font-medium truncate">{item.name}</span>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      </div>
    );
  }

  // File Item with Checkbox
  return (
    <div
      onClick={onToggleSelect}
      className={`px-2 py-1.5 rounded-lg border flex items-center justify-between transition-all cursor-pointer ${
        isSelected
          ? 'bg-indigo-950/70 border-indigo-700 text-white shadow-2xs'
          : 'bg-slate-900/40 border-slate-800/60 hover:border-slate-700 text-slate-300'
      }`}
    >
      <div className="flex items-center space-x-2 min-w-0 flex-1 mr-1.5">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 shrink-0"
        />
        <span className={`text-[9px] font-semibold px-1.5 py-0.2 rounded border shrink-0 ${badge.color}`}>
          {badge.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate flex items-center space-x-1">
            <span className="truncate">{item.name}</span>
            {isAnchor && (
              <span className="text-[9px] px-1 rounded bg-indigo-500/20 text-indigo-300 font-bold shrink-0">
                点选
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 space-x-1.5">
            <span>{formatFileSize(item.size)}</span>
            {item.page_count && <span>• {item.page_count}页</span>}
          </div>
        </div>
      </div>

      <div className="shrink-0">
        {isSelected ? (
          <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">
            <Check className="w-2.5 h-2.5" />
          </span>
        ) : (
          <span className="text-[10px] text-slate-500 hover:text-slate-300">
            选入
          </span>
        )}
      </div>
    </div>
  );
};
