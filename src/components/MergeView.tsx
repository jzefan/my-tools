import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  ArrowUp,
  Plus,
  Trash2,
  MoveUp,
  MoveDown,
  Check,
  Search,
  ExternalLink,
  ChevronRight,
  FolderOpen,
  FileText,
  AlertTriangle,
  RefreshCw,
  HardDrive,
} from 'lucide-react';
import { api } from '../services/api';
import { DirContent, FileItem, MergeItem, OperationResult, QuickPath } from '../types';
import { formatDate, formatFileSize, generateDefaultMergeOutputPath, getFileTypeBadge } from '../utils/format';

interface MergeViewProps {
  initialDirectory: string;
  initialFiles: string[];
}

export const MergeView: React.FC<MergeViewProps> = ({
  initialDirectory,
  initialFiles,
}) => {
  // Directory Browser State
  const [currentPath, setCurrentPath] = useState<string>(initialDirectory || '');
  const [dirContent, setDirContent] = useState<DirContent | null>(null);
  const [quickPaths, setQuickPaths] = useState<QuickPath[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlySupported, setOnlySupported] = useState(true);
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(new Set());
  const [isLoadingDir, setIsLoadingDir] = useState(false);

  // Merge Queue State
  const [mergeQueue, setMergeQueue] = useState<MergeItem[]>([]);
  const [outputFileName, setOutputFileName] = useState('');
  const [isMerging, setIsMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<OperationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load quick paths on mount
  useEffect(() => {
    api.getQuickDirectories().then(setQuickPaths).catch(console.error);
  }, []);

  // Set default output filename when directory changes
  useEffect(() => {
    if (currentPath) {
      setOutputFileName(generateDefaultMergeOutputPath(currentPath));
    }
  }, [currentPath]);

  // Handle initialFiles passed from Finder right-click
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      const loadInitialItems = async () => {
        const items: MergeItem[] = [];
        for (const filePath of initialFiles) {
          try {
            const meta = await api.getFileInfo(filePath);
            if (!meta.is_dir && meta.is_supported) {
              items.push({
                path: meta.path,
                name: meta.name,
                extension: meta.extension,
                page_count: meta.page_count,
                page_range: 'all',
              });
            }
          } catch (err) {
            console.error('Failed to load initial file:', filePath, err);
          }
        }
        if (items.length > 0) {
          setMergeQueue((prev) => {
            const existingPaths = new Set(prev.map((i) => i.path));
            const newOnes = items.filter((i) => !existingPaths.has(i.path));
            return [...prev, ...newOnes];
          });
        }
      };
      loadInitialItems();
    }
  }, [initialFiles]);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    if (!path) return;
    setIsLoadingDir(true);
    setErrorMessage(null);
    try {
      const content = await api.getDirectoryContents(path);
      setDirContent(content);
      setCurrentPath(content.current_path);
      setSelectedFilePaths(new Set());
    } catch (err: any) {
      setErrorMessage(typeof err === 'string' ? err : err?.message || '读取目录失败');
    } finally {
      setIsLoadingDir(false);
    }
  }, []);

  useEffect(() => {
    if (currentPath) {
      loadDirectory(currentPath);
    }
  }, [currentPath, loadDirectory]);

  // Filtered files in directory
  const filteredEntries = (dirContent?.entries || []).filter((item) => {
    if (onlySupported && !item.is_dir && !item.is_supported) {
      return false;
    }
    if (searchQuery.trim()) {
      return item.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  // Breadcrumbs
  const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : [];

  const handleBreadcrumbClick = (index: number) => {
    const targetPath = '/' + breadcrumbs.slice(0, index + 1).join('/');
    loadDirectory(targetPath);
  };

  // Add single item to queue
  const addToQueue = (item: FileItem) => {
    if (item.is_dir) return;
    setMergeQueue((prev) => {
      if (prev.some((q) => q.path === item.path)) return prev;
      return [
        ...prev,
        {
          path: item.path,
          name: item.name,
          extension: item.extension,
          page_count: item.page_count,
          page_range: 'all',
        },
      ];
    });
  };

  // Add multiple selected items
  const addSelectedToQueue = () => {
    const newItems: MergeItem[] = [];
    filteredEntries.forEach((item) => {
      if (!item.is_dir && selectedFilePaths.has(item.path)) {
        if (!mergeQueue.some((q) => q.path === item.path)) {
          newItems.push({
            path: item.path,
            name: item.name,
            extension: item.extension,
            page_count: item.page_count,
            page_range: 'all',
          });
        }
      }
    });
    setMergeQueue((prev) => [...prev, ...newItems]);
    setSelectedFilePaths(new Set());
  };

  // Toggle selection
  const toggleSelect = (path: string) => {
    setSelectedFilePaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const selectAllSupported = () => {
    const next = new Set<string>();
    filteredEntries.forEach((item) => {
      if (!item.is_dir && item.is_supported) {
        next.add(item.path);
      }
    });
    setSelectedFilePaths(next);
  };

  // Queue reordering
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
    setMergeQueue((prev) => prev.filter((_, i) => i !== index));
  };

  const updatePageRange = (index: number, range: string) => {
    setMergeQueue((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], page_range: range };
      return copy;
    });
  };

  // Execute Merge
  const handleMerge = async () => {
    if (mergeQueue.length === 0) {
      setErrorMessage('请至少添加一个需要合并的文件');
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
      // Refresh current directory so merged file shows up
      loadDirectory(currentPath);
    } catch (err: any) {
      setErrorMessage(typeof err === 'string' ? err : err?.message || '合并失败');
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-slate-950">
      {/* Top Header & Breadcrumb Bar */}
      <div className="titlebar-nodrag border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3 mb-2">
          {/* Breadcrumb Navigation */}
          <div className="flex items-center space-x-1 overflow-x-auto py-0.5 text-xs text-slate-600 dark:text-slate-400 max-w-2xl">
            <button
              onClick={() => loadDirectory('/')}
              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              title="根目录"
            >
              <HardDrive className="w-3.5 h-3.5" />
            </button>
            {breadcrumbs.map((segment, idx) => (
              <React.Fragment key={idx}>
                <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                <button
                  onClick={() => handleBreadcrumbClick(idx)}
                  className={`px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors whitespace-nowrap font-medium ${
                    idx === breadcrumbs.length - 1
                      ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40'
                      : ''
                  }`}
                >
                  {segment}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Quick Actions & Up Button */}
          <div className="flex items-center space-x-1.5 shrink-0">
            {dirContent?.parent_path && (
              <button
                onClick={() => loadDirectory(dirContent.parent_path!)}
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center space-x-1 text-slate-700 dark:text-slate-200 transition-colors font-medium shadow-2xs"
                title="返回上一级目录"
              >
                <ArrowUp className="w-3.5 h-3.5" />
                <span>上一级</span>
              </button>
            )}
            <button
              onClick={() => loadDirectory(currentPath)}
              className="p-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
              title="刷新当前目录"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDir ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Quick Directory Bookmarks Bar */}
        <div className="flex items-center space-x-1.5 overflow-x-auto text-[11px] pb-0.5">
          <span className="text-slate-400 shrink-0 font-medium mr-1">快捷前往:</span>
          {quickPaths.map((qp) => (
            <button
              key={qp.path}
              onClick={() => loadDirectory(qp.path)}
              className={`px-2 py-0.5 rounded-md border text-slate-600 dark:text-slate-300 transition-colors shrink-0 flex items-center space-x-1 ${
                currentPath === qp.path
                  ? 'bg-indigo-100/70 dark:bg-indigo-900/60 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-medium'
                  : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <FolderOpen className="w-3 h-3 text-indigo-500" />
              <span>{qp.name.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Split Body: Left Directory Browser, Right Merge Staging */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane: Current Directory Structure & Selection */}
        <div className="w-1/2 border-r border-slate-200/80 dark:border-slate-800 flex flex-col h-full bg-white dark:bg-slate-950">
          {/* Search & Filter Toolbar */}
          <div className="p-3 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-2 bg-slate-50/30 dark:bg-slate-900/30">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜索当前目录文件..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={() => setOnlySupported(!onlySupported)}
              className={`px-2.5 py-1.5 text-xs rounded-lg border font-medium transition-colors shrink-0 ${
                onlySupported
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              {onlySupported ? '仅支持格式' : '全部文件'}
            </button>
          </div>

          {/* Directory Item List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isLoadingDir ? (
              <div className="h-40 flex flex-col items-center justify-center text-slate-400 text-xs">
                <RefreshCw className="w-5 h-5 animate-spin mb-2 text-indigo-500" />
                <span>正在加载目录结构...</span>
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center text-slate-400 text-xs">
                <Folder className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2 stroke-1" />
                <span>此目录暂无可合并的文件</span>
              </div>
            ) : (
              filteredEntries.map((item) => {
                const badge = getFileTypeBadge(item.extension);
                const isSelected = selectedFilePaths.has(item.path);
                const isAlreadyInQueue = mergeQueue.some((q) => q.path === item.path);

                if (item.is_dir) {
                  return (
                    <div
                      key={item.path}
                      onClick={() => loadDirectory(item.path)}
                      className="px-2.5 py-2 rounded-xl flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-900 cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className="p-1 rounded-md bg-amber-500/10 text-amber-500">
                          <Folder className="w-4 h-4 fill-amber-500/20" />
                        </div>
                        <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                          {item.name}
                        </span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  );
                }

                return (
                  <div
                    key={item.path}
                    className={`px-2.5 py-2 rounded-xl border flex items-center justify-between transition-all ${
                      isSelected
                        ? 'bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800'
                        : isAlreadyInQueue
                        ? 'bg-slate-50/80 dark:bg-slate-900/60 border-slate-200/60 dark:border-slate-800 opacity-60'
                        : 'bg-white dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(item.path)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                      />
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${badge.color}`}>
                        {badge.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                          {item.name}
                        </div>
                        <div className="text-[10px] text-slate-400 space-x-2">
                          <span>{formatFileSize(item.size)}</span>
                          {item.page_count && <span>• {item.page_count} 页</span>}
                          <span>• {formatDate(item.modified)}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => addToQueue(item)}
                      disabled={isAlreadyInQueue}
                      className={`p-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1 shrink-0 transition-colors ${
                        isAlreadyInQueue
                          ? 'border-transparent text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 cursor-default'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 text-slate-600 dark:text-slate-300'
                      }`}
                      title={isAlreadyInQueue ? '已在合并队列中' : '添加到合并队列'}
                    >
                      {isAlreadyInQueue ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Directory Bottom Bar: Batch Selection */}
          <div className="p-2.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <button
                onClick={selectAllSupported}
                className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium text-[11px]"
              >
                全选支持格式
              </button>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <span className="text-slate-500 text-[11px]">已选 {selectedFilePaths.size} 项</span>
            </div>
            {selectedFilePaths.size > 0 && (
              <button
                onClick={addSelectedToQueue}
                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs flex items-center space-x-1 shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>批量添加到合并</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Pane: Merge Staging Queue & Options */}
        <div className="w-1/2 flex flex-col h-full bg-slate-50/30 dark:bg-slate-900/30">
          <div className="p-3 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-950">
            <div>
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center space-x-1.5">
                <span>待合并文件清单</span>
                <span className="px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 text-[10px]">
                  {mergeQueue.length}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">将按以下从上往下的顺序合并为单个 PDF</p>
            </div>
            {mergeQueue.length > 0 && (
              <button
                onClick={() => setMergeQueue([])}
                className="text-xs text-rose-500 hover:text-rose-600 font-medium flex items-center space-x-1 hover:underline"
              >
                <Trash2 className="w-3 h-3" />
                <span>清空</span>
              </button>
            )}
          </div>

          {/* Merge Queue Items */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {mergeQueue.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-xs px-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl m-2">
                <FileText className="w-10 h-10 text-slate-300 dark:text-slate-700 stroke-1 mb-2" />
                <span className="font-medium text-slate-600 dark:text-slate-400 mb-1">合并清单为空</span>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  从左侧目录中点击「+」添加 PDF、图片或 Word 文档，或通过系统访达右键直接选择多个文件合并
                </p>
              </div>
            ) : (
              mergeQueue.map((item, idx) => {
                const badge = getFileTypeBadge(item.extension);
                return (
                  <div
                    key={item.path + idx}
                    className="p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                        <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] flex items-center justify-center font-bold">
                          {idx + 1}
                        </span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${badge.color}`}>
                          {badge.label}
                        </span>
                        <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate" title={item.name}>
                          {item.name}
                        </span>
                      </div>

                      {/* Move and Delete Actions */}
                      <div className="flex items-center space-x-1 shrink-0">
                        <button
                          onClick={() => moveItem(idx, 'up')}
                          disabled={idx === 0}
                          className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-400"
                          title="上移"
                        >
                          <MoveUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveItem(idx, 'down')}
                          disabled={idx === mergeQueue.length - 1}
                          className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-400"
                          title="下移"
                        >
                          <MoveDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeItem(idx)}
                          className="p-1 rounded text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          title="移除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Page Range Setting for PDF */}
                    {item.extension.toLowerCase() === 'pdf' && (
                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 dark:border-slate-800/80">
                        <span className="text-slate-400">页码范围 (例如 1-3, 5):</span>
                        <input
                          type="text"
                          value={item.page_range || 'all'}
                          onChange={(e) => updatePageRange(idx, e.target.value)}
                          placeholder="all"
                          className="w-24 px-2 py-0.5 text-xs text-right rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-hidden"
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Merge Output & Execution Card */}
          <div className="p-3 border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950 space-y-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                合并输出保存路径:
              </label>
              <input
                type="text"
                value={outputFileName}
                onChange={(e) => setOutputFileName(e.target.value)}
                placeholder="/path/to/merged.pdf"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-mono"
              />
            </div>

            {/* Error or Success notification */}
            {errorMessage && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="truncate">{errorMessage}</span>
              </div>
            )}

            {mergeResult && (
              <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center justify-between">
                <div className="flex items-center space-x-2 min-w-0">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="truncate">{mergeResult.message}</span>
                </div>
                {mergeResult.output_path && (
                  <button
                    onClick={() => api.revealInFinder(mergeResult.output_path!)}
                    className="ml-2 text-indigo-600 dark:text-indigo-400 hover:underline flex items-center space-x-1 shrink-0 font-medium"
                  >
                    <span>在访达定位</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {/* Merge Action Button */}
            <button
              onClick={handleMerge}
              disabled={isMerging || mergeQueue.length === 0}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-40 text-white font-medium text-xs shadow-md shadow-indigo-500/20 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              {isMerging ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>正在深度合并中...</span>
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  <span>立即执行合并 ({mergeQueue.length} 个文件)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
