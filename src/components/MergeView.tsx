import { getPathBreadcrumbs } from '../utils/format';
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
  ChevronRight,
  FolderOpen,
  FileText,
  RefreshCw,
  HardDrive,
  AlertCircle,
  Eye,
  Layers,
  FilePlus2,
  Image as ImageIcon,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { api } from '../services/api';
import { DirContent, FileItem, MergeItem, OperationResult, QuickPath } from '../types';
import {
  formatDate,
  formatFileSize,
  generateDefaultMergeOutputPath,
  generateDefaultInsertOutputPath,
  getFileTypeBadge,
} from '../utils/format';
import { OperationStatusBanner } from './common/OperationStatusBanner';
import { DocumentPreviewModal } from './common/DocumentPreviewModal';

interface MergeViewProps {
  initialDirectory: string;
  initialFiles: string[];
}

export const MergeView: React.FC<MergeViewProps> = ({
  initialDirectory,
  initialFiles,
}) => {
  // Mode selection: 'merge' = sequential batch merge; 'insert' = insert images/docs into PDF at specific page
  const [mode, setMode] = useState<'merge' | 'insert'>('merge');

  // Directory Browser State
  const [currentPath, setCurrentPath] = useState<string>(initialDirectory || '');
  const [dirContent, setDirContent] = useState<DirContent | null>(null);
  const [quickPaths, setQuickPaths] = useState<QuickPath[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlySupported, setOnlySupported] = useState(true);
  const [isLoadingDir, setIsLoadingDir] = useState(false);

  // Merge Mode State
  const [mergeQueue, setMergeQueue] = useState<MergeItem[]>([]);
  const [outputFileName, setOutputFileName] = useState('');
  const [isMerging, setIsMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<OperationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Insert Mode State
  const [targetPdf, setTargetPdf] = useState<FileItem | null>(null);
  const [insertItems, setInsertItems] = useState<MergeItem[]>([]);
  const [insertPositionType, setInsertPositionType] = useState<'start' | 'after_page' | 'end'>('after_page');
  const [insertAfterPage, setInsertAfterPage] = useState<number>(1);
  const [insertOutputPath, setInsertOutputPath] = useState<string>('');
  const [isInserting, setIsInserting] = useState<boolean>(false);
  const [insertResult, setInsertResult] = useState<OperationResult | null>(null);
  const [insertErrorMessage, setInsertErrorMessage] = useState<string | null>(null);

  // Preview Modal State
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  // Sync initialDirectory if updated
  useEffect(() => {
    if (initialDirectory && !currentPath) {
      setCurrentPath(initialDirectory);
    }
  }, [initialDirectory]);

  // Load quick paths on mount
  useEffect(() => {
    api
      .getQuickDirectories()
      .then((paths) => {
        setQuickPaths(paths);
        if (!currentPath && !initialDirectory && paths.length > 0) {
          setCurrentPath(paths[0].path);
        }
      })
      .catch(console.error);
  }, []);

  // Set default merge output filename when directory changes
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
        let firstPdf: FileItem | null = null;
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
              if (!firstPdf && meta.extension.toLowerCase() === 'pdf') {
                firstPdf = meta;
              }
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
          // Also prefill insert state if a PDF was passed
          if (firstPdf) {
            setTargetPdf(firstPdf);
            setInsertOutputPath(generateDefaultInsertOutputPath(firstPdf.path));
            const nonPdfItems = items.filter((i) => i.path !== firstPdf?.path);
            if (nonPdfItems.length > 0) {
              setInsertItems(nonPdfItems);
            }
          }
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
  const breadcrumbs = getPathBreadcrumbs(currentPath);

  const handleBreadcrumbClick = (index: number) => {
    const targetPath = breadcrumbs[index].path;
    loadDirectory(targetPath);
  };

  // Toggle single item in/out of mergeQueue (Sequential Merge mode)
  const toggleItemQueue = (item: FileItem) => {
    if (item.is_dir) return;
    setMergeQueue((prev) => {
      const exists = prev.some((q) => q.path === item.path);
      if (exists) {
        return prev.filter((q) => q.path !== item.path);
      }
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

  // Select all or deselect all supported files in current folder (Merge mode)
  const toggleSelectAllSupported = () => {
    const supported = filteredEntries.filter((e) => !e.is_dir && e.is_supported);
    if (supported.length === 0) return;

    const allInQueue = supported.every((item) => mergeQueue.some((q) => q.path === item.path));
    if (allInQueue) {
      const pathsToRemove = new Set(supported.map((s) => s.path));
      setMergeQueue((prev) => prev.filter((q) => !pathsToRemove.has(q.path)));
    } else {
      setMergeQueue((prev) => {
        const existingPaths = new Set(prev.map((q) => q.path));
        const newItems: MergeItem[] = [];
        for (const item of supported) {
          if (!existingPaths.has(item.path)) {
            newItems.push({
              path: item.path,
              name: item.name,
              extension: item.extension,
              page_count: item.page_count,
              page_range: 'all',
            });
          }
        }
        return [...prev, ...newItems];
      });
    }
  };

  // Queue reordering (Merge mode)
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
    if (mergeQueue.length < 2) {
      setErrorMessage(
        mergeQueue.length === 0
          ? '请选择要合并的文件'
          : '合并至少需要 2 个文件'
      );
      return;
    }
    if (!outputFileName.trim()) {
      setErrorMessage('请指定输出保存路径');
      return;
    }

    setIsMerging(true);
    setErrorMessage(null);
    setMergeResult(null);

    const startTime = Date.now();
    try {
      const res = await api.mergeFiles({
        items: mergeQueue,
        output_path: outputFileName.trim(),
      });

      const elapsed = Date.now() - startTime;
      if (elapsed < 700) {
        await new Promise((resolve) => setTimeout(resolve, 700 - elapsed));
      }

      if (res.success) {
        setMergeResult(res);
        loadDirectory(currentPath);
      } else {
        setErrorMessage(res.message || '合并失败');
      }
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }
      setErrorMessage(typeof err === 'string' ? err : err?.message || '合并失败');
    } finally {
      setIsMerging(false);
    }
  };

  // ==========================================
  // Insert Mode Specific Handlers
  // ==========================================

  // Select target PDF base document
  const handleSelectTargetPdf = async (file: FileItem) => {
    let fullItem = file;
    if (!file.page_count && file.extension.toLowerCase() === 'pdf') {
      try {
        fullItem = await api.getFileInfo(file.path);
      } catch (e) {
        console.error('获取底稿 PDF 页数失败:', e);
      }
    }
    setTargetPdf(fullItem);
    setInsertOutputPath(generateDefaultInsertOutputPath(fullItem.path));
    if (fullItem.page_count && fullItem.page_count > 0) {
      setInsertAfterPage((prev) => Math.min(Math.max(1, prev), fullItem.page_count || 1));
    }
    setInsertErrorMessage(null);
    setInsertResult(null);
  };

  // Toggle file in insert items queue
  const toggleInsertItem = (item: FileItem) => {
    if (item.is_dir) return;
    setInsertItems((prev) => {
      const exists = prev.some((q) => q.path === item.path);
      if (exists) {
        return prev.filter((q) => q.path !== item.path);
      }
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

  // Add / Remove all images in current folder into insert list
  const toggleAllImagesToInsert = () => {
    const images = filteredEntries.filter(
      (e) => !e.is_dir && ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'].includes(e.extension.toLowerCase())
    );
    if (images.length === 0) return;

    const allIn = images.every((img) => insertItems.some((q) => q.path === img.path));
    if (allIn) {
      const pathsToRemove = new Set(images.map((i) => i.path));
      setInsertItems((prev) => prev.filter((q) => !pathsToRemove.has(q.path)));
    } else {
      setInsertItems((prev) => {
        const existingPaths = new Set(prev.map((q) => q.path));
        const newOnes: MergeItem[] = [];
        for (const img of images) {
          if (!existingPaths.has(img.path)) {
            newOnes.push({
              path: img.path,
              name: img.name,
              extension: img.extension,
              page_count: img.page_count,
              page_range: 'all',
            });
          }
        }
        return [...prev, ...newOnes];
      });
    }
  };

  const moveInsertItem = (index: number, direction: 'up' | 'down') => {
    setInsertItems((prev) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  const removeInsertItem = (index: number) => {
    setInsertItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Execute Insert Pages
  const handleInsert = async () => {
    if (!targetPdf) {
      setInsertErrorMessage('请选择目标 PDF 底稿');
      return;
    }
    if (insertItems.length === 0) {
      setInsertErrorMessage('请添加需要插入的文件');
      return;
    }
    if (!insertOutputPath.trim()) {
      setInsertErrorMessage('请指定输出保存路径');
      return;
    }

    const totalPages = targetPdf.page_count || 1;
    let afterPage = 0;
    if (insertPositionType === 'start') {
      afterPage = 0;
    } else if (insertPositionType === 'end') {
      afterPage = totalPages;
    } else {
      afterPage = Math.min(Math.max(0, insertAfterPage), totalPages);
    }

    setIsInserting(true);
    setInsertErrorMessage(null);
    setInsertResult(null);

    const startTime = Date.now();
    try {
      const res = await api.insertPagesIntoPdf({
        target_pdf_path: targetPdf.path,
        insert_items: insertItems,
        insert_after_page: afterPage,
        output_path: insertOutputPath.trim(),
      });

      const elapsed = Date.now() - startTime;
      if (elapsed < 700) {
        await new Promise((resolve) => setTimeout(resolve, 700 - elapsed));
      }

      if (res.success) {
        setInsertResult(res);
        loadDirectory(currentPath);
      } else {
        setInsertErrorMessage(res.message || '插入页面失败');
      }
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }
      setInsertErrorMessage(typeof err === 'string' ? err : err?.message || '插入页面执行异常');
    } finally {
      setIsInserting(false);
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
              onClick={() => loadDirectory(breadcrumbs[0]?.path.includes('\\') ? breadcrumbs[0].path : '/')}
              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="根目录"
            >
              <HardDrive className="w-3.5 h-3.5" />
            </button>
            {breadcrumbs.map((segment, idx) => (
              <React.Fragment key={idx}>
                <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                <button
                  onClick={() => handleBreadcrumbClick(idx)}
                  className={`px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors whitespace-nowrap font-medium cursor-pointer ${
                    idx === breadcrumbs.length - 1
                      ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40'
                      : ''
                  }`}
                >
                  {segment.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Quick Actions & Up Button */}
          <div className="flex items-center space-x-1.5 shrink-0">
            {dirContent?.parent_path && (
              <button
                onClick={() => loadDirectory(dirContent.parent_path!)}
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center space-x-1 text-slate-700 dark:text-slate-200 transition-colors font-medium shadow-2xs cursor-pointer"
                title="返回上一级目录"
              >
                <ArrowUp className="w-3.5 h-3.5" />
                <span>上一级</span>
              </button>
            )}
            <button
              onClick={() => loadDirectory(currentPath)}
              className="p-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors cursor-pointer"
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
              className={`px-2 py-0.5 rounded-md border text-slate-600 dark:text-slate-300 transition-colors shrink-0 flex items-center space-x-1 cursor-pointer ${
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

      {/* Main Split Body: Left Directory Browser, Right Staging Work Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane: Current Directory Structure & Selection */}
        <div className="w-1/2 border-r border-slate-200/80 dark:border-slate-800 flex flex-col h-full bg-white dark:bg-slate-950">
          {/* Search & Filter Toolbar */}
          <div className="p-3 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-2 bg-slate-50/30 dark:bg-slate-900/30">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜索当前目录..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={() => setOnlySupported(!onlySupported)}
              className={`px-2.5 py-1.5 text-xs rounded-lg border font-medium transition-colors shrink-0 cursor-pointer ${
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
                <span>正在加载...</span>
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center text-slate-400 text-xs">
                <Folder className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2 stroke-1" />
                <span>此目录暂无可操作的文件</span>
              </div>
            ) : (
              filteredEntries.map((item) => {
                const badge = getFileTypeBadge(item.extension);
                const isPdf = item.extension.toLowerCase() === 'pdf';

                // State determination depending on active mode
                const isMergeQueued = mergeQueue.some((q) => q.path === item.path);
                const isTargetPdf = mode === 'insert' && targetPdf?.path === item.path;
                const isInsertQueued = mode === 'insert' && insertItems.some((q) => q.path === item.path);

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

                // Row click handler
                const handleRowClick = () => {
                  if (mode === 'merge') {
                    toggleItemQueue(item);
                  } else {
                    // Insert mode
                    if (isPdf) {
                      if (!targetPdf) {
                        handleSelectTargetPdf(item);
                      } else if (targetPdf.path === item.path) {
                        setTargetPdf(null);
                      } else {
                        toggleInsertItem(item);
                      }
                    } else {
                      toggleInsertItem(item);
                    }
                  }
                };

                const isHighlight =
                  mode === 'merge' ? isMergeQueued : isTargetPdf || isInsertQueued;

                return (
                  <div
                    key={item.path}
                    onClick={handleRowClick}
                    className={`px-2.5 py-2 rounded-xl border flex items-center justify-between transition-all cursor-pointer select-none ${
                      isTargetPdf
                        ? 'bg-purple-50/90 dark:bg-purple-950/60 border-purple-400 dark:border-purple-600 shadow-2xs ring-1 ring-purple-300 dark:ring-purple-700'
                        : isHighlight
                        ? 'bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-700 shadow-2xs'
                        : 'bg-white dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-slate-700 hover:bg-slate-50/70 dark:hover:bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-2">
                      <input
                        type="checkbox"
                        checked={Boolean(isHighlight)}
                        onChange={handleRowClick}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                      />
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${badge.color}`}>
                        {badge.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate flex items-center space-x-1.5">
                          <span className="truncate">{item.name}</span>
                          {mode === 'merge' && isMergeQueued && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-100 dark:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 font-medium shrink-0">
                              已选
                            </span>
                          )}
                          {mode === 'insert' && isTargetPdf && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-900/70 text-purple-700 dark:text-purple-300 font-bold shrink-0">
                              目标底稿
                            </span>
                          )}
                          {mode === 'insert' && isInsertQueued && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-100 dark:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 font-medium shrink-0">
                              待插入
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 space-x-2">
                          <span>{formatFileSize(item.size)}</span>
                          {item.page_count && <span>• {item.page_count} 页</span>}
                          <span>• {formatDate(item.modified)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewPath(item.path);
                        }}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-indigo-600 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors shrink-0 cursor-pointer"
                        title="预览"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      {mode === 'insert' && isPdf && !isTargetPdf && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectTargetPdf(item);
                          }}
                          className="px-2 py-1 rounded-lg border border-purple-200 dark:border-purple-800 text-[10px] font-semibold text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/60 transition-colors cursor-pointer"
                          title="设为底稿"
                        >
                          设为底稿
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick();
                        }}
                        className={`p-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1 shrink-0 transition-colors cursor-pointer ${
                          isHighlight
                            ? 'border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:hover:bg-rose-950/40 dark:hover:text-rose-400'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 text-slate-600 dark:text-slate-300'
                        }`}
                        title={isHighlight ? '点击移出' : '点击添加'}
                      >
                        {isHighlight ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Directory Bottom Bar: Batch Selection */}
          {mode === 'merge' ? (
            (() => {
              const currentSupported = filteredEntries.filter((e) => !e.is_dir && e.is_supported);
              const inQueueCount = currentSupported.filter((e) =>
                mergeQueue.some((q) => q.path === e.path)
              ).length;
              const allInQueue = currentSupported.length > 0 && inQueueCount === currentSupported.length;

              return (
                <div className="p-2.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={toggleSelectAllSupported}
                      disabled={currentSupported.length === 0}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium text-[11px] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {allInQueue ? '取消全选' : '全选支持文件'}
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <span className="text-slate-500 text-[11px]">
                      当前目录已选 {inQueueCount}/{currentSupported.length} 项（总计 {mergeQueue.length}）
                    </span>
                  </div>

                  {currentSupported.length > 0 && !allInQueue && (
                    <button
                      onClick={toggleSelectAllSupported}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs flex items-center space-x-1 shadow-2xs cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>添加全部支持文件</span>
                    </button>
                  )}
                </div>
              );
            })()
          ) : (
            (() => {
              const imagesInDir = filteredEntries.filter(
                (e) => !e.is_dir && ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'].includes(e.extension.toLowerCase())
              );
              const addedImagesCount = imagesInDir.filter((e) =>
                insertItems.some((q) => q.path === e.path)
              ).length;
              const allImagesAdded = imagesInDir.length > 0 && addedImagesCount === imagesInDir.length;

              return (
                <div className="p-2.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="text-slate-600 dark:text-slate-400 text-[11px]">
                      目录图片: <b className="text-indigo-600 dark:text-indigo-400">{imagesInDir.length}</b>
                      {addedImagesCount > 0 && `（已选 ${addedImagesCount}）`}
                    </span>
                  </div>

                  {imagesInDir.length > 0 && (
                    <button
                      onClick={toggleAllImagesToInsert}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs flex items-center space-x-1 shadow-2xs cursor-pointer transition-colors"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>{allImagesAdded ? '移除全部图片' : `添加全部图片（${imagesInDir.length}）`}</span>
                    </button>
                  )}
                </div>
              );
            })()
          )}
        </div>

        {/* Right Pane: Staging Work Area with Mode Switcher */}
        <div className="w-1/2 flex flex-col h-full bg-slate-50/30 dark:bg-slate-900/30">
          {/* Top Switcher: Sequential Merge vs Insert Into PDF */}
          <div className="p-2.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-950">
            <div className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200/70 dark:border-slate-700/60">
              <button
                type="button"
                onClick={() => setMode('merge')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 cursor-pointer ${
                  mode === 'merge'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>顺序合并</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('insert')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 cursor-pointer ${
                  mode === 'insert'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <FilePlus2 className="w-3.5 h-3.5 text-indigo-500" />
                <span>页面插入</span>
              </button>
            </div>

            {mode === 'merge' ? (
              mergeQueue.length > 0 && (
                <button
                  onClick={() => setMergeQueue([])}
                  className="text-xs text-rose-500 hover:text-rose-600 font-medium flex items-center space-x-1 hover:underline cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>清空</span>
                </button>
              )
            ) : (
              (targetPdf || insertItems.length > 0) && (
                <button
                  onClick={() => {
                    setTargetPdf(null);
                    setInsertItems([]);
                    setInsertResult(null);
                    setInsertErrorMessage(null);
                  }}
                  className="text-xs text-rose-500 hover:text-rose-600 font-medium flex items-center space-x-1 hover:underline cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>重置</span>
                </button>
              )
            )}
          </div>

          {/* ========================================================= */}
          {/* View 1: Sequential Merge Mode Staging */}
          {/* ========================================================= */}
          {mode === 'merge' && (
            <>
              {/* Merge Queue Items */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    待合并文件（{mergeQueue.length}）
                  </span>
                  <span className="text-[11px] text-slate-400">按列表顺序合并为单个 PDF</span>
                </div>

                {mergeQueue.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-xs px-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl m-2">
                    <FileText className="w-10 h-10 text-slate-300 dark:text-slate-700 stroke-1 mb-2" />
                    <span className="font-medium text-slate-600 dark:text-slate-400 mb-1">合并清单为空</span>
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      从左侧选择 PDF、图片或 Word 文件加入合并
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

                          {/* Preview, Move and Delete Actions */}
                          <div className="flex items-center space-x-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => setPreviewPath(item.path)}
                              className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer"
                              title="预览"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => moveItem(idx, 'up')}
                              disabled={idx === 0}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer"
                              title="上移"
                            >
                              <MoveUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => moveItem(idx, 'down')}
                              disabled={idx === mergeQueue.length - 1}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer"
                              title="下移"
                            >
                              <MoveDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => removeItem(idx)}
                              className="p-1 rounded text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              title="移除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Page Range Setting for PDF */}
                        {item.extension.toLowerCase() === 'pdf' && (
                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 dark:border-slate-800/80">
                            <span className="text-slate-400">页码范围:</span>
                            <input
                              type="text"
                              value={item.page_range || 'all'}
                              onChange={(e) => updatePageRange(idx, e.target.value)}
                              placeholder="全部或 1-3, 5"
                              className="w-28 px-2 py-0.5 text-xs text-right rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-hidden"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Merge Output & Execution Card */}
              <div className="shrink-0 p-3 border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950 space-y-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    输出保存路径:
                  </label>
                  <input
                    type="text"
                    value={outputFileName}
                    onChange={(e) => setOutputFileName(e.target.value)}
                    placeholder="/path/to/merged.pdf"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                {/* Requirement prompt when fewer than 2 files */}
                {mergeQueue.length < 2 && (
                  <div className="flex items-center space-x-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50/90 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 rounded-xl px-3 py-2 animate-pop-in">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="leading-snug">
                      {mergeQueue.length === 0
                        ? '请在左侧选择要合并的文件'
                        : '合并至少需要 2 个文件'}
                    </span>
                  </div>
                )}

                {/* Loading & Status feedback */}
                <OperationStatusBanner
                  status={
                    isMerging ? 'loading' : errorMessage ? 'error' : mergeResult ? 'success' : 'idle'
                  }
                  loadingLabel={`正在合并文档（共 ${mergeQueue.length} 个）...`}
                  loadingSublabel="正在生成合并文件"
                  accentColor="indigo"
                  pixelVariant="Drive"
                  successTitle="合并完成"
                  successMessage={mergeResult?.message}
                  outputPath={mergeResult?.output_path}
                  errorTitle="合并失败"
                  errorMessage={errorMessage}
                  onRetry={handleMerge}
                  onPreview={setPreviewPath}
                  onDismiss={() => {
                    setErrorMessage(null);
                    setMergeResult(null);
                  }}
                />

                {/* Merge Action Button */}
                <button
                  type="button"
                  onClick={handleMerge}
                  disabled={isMerging || mergeQueue.length < 2}
                  className={`w-full py-2.5 px-4 rounded-xl font-medium text-xs flex items-center justify-center space-x-2 transition-all ${
                    isMerging
                      ? 'bg-indigo-600 text-white cursor-wait opacity-90 shadow-md'
                      : mergeQueue.length < 2
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 shadow-none cursor-not-allowed'
                      : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/30 cursor-pointer active:scale-[0.99]'
                  }`}
                  title={
                    mergeQueue.length < 2
                      ? '至少选择 2 个文件以合并'
                      : undefined
                  }
                >
                  {isMerging ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>正在合并...</span>
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4" />
                      <span>
                        {mergeQueue.length === 0
                          ? '开始合并（请先添加文件）'
                          : mergeQueue.length === 1
                          ? '开始合并（需至少 2 个文件）'
                          : `开始合并（${mergeQueue.length} 个文件）`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {/* ========================================================= */}
          {/* View 2: Insert Pages Into PDF Mode Staging */}
          {/* ========================================================= */}
          {mode === 'insert' && (
            <div className="flex-1 flex flex-col h-full overflow-y-auto p-3 space-y-3.5">
              {/* Section 1: Target PDF Base Document */}
              <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    <span className="w-4 h-4 rounded-full bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-400 flex items-center justify-center text-[10px] font-bold">
                      1
                    </span>
                    <span>目标 PDF</span>
                  </div>
                  {targetPdf && (
                    <button
                      type="button"
                      onClick={() => setTargetPdf(null)}
                      className="text-[11px] text-rose-500 hover:text-rose-600 cursor-pointer"
                    >
                      更换
                    </button>
                  )}
                </div>

                {targetPdf ? (
                  <div className="p-2.5 rounded-lg border border-purple-200 dark:border-purple-900/60 bg-purple-50/40 dark:bg-purple-950/20 flex items-center justify-between">
                    <div className="flex items-center space-x-2.5 min-w-0 mr-2">
                      <div className="p-1.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {targetPdf.name}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 space-x-2 font-mono">
                          <span className="font-bold text-purple-600 dark:text-purple-400">
                            共 {targetPdf.page_count || 1} 页
                          </span>
                          <span>• {formatFileSize(targetPdf.size)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setPreviewPath(targetPdf.path)}
                        className="p-1 rounded text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 cursor-pointer"
                        title="预览"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-center text-xs text-slate-400 space-y-1">
                    <div className="text-slate-500 dark:text-slate-400 font-medium">未选择目标 PDF</div>
                    <div className="text-[11px]">从左侧列表中选择一个 PDF 作为目标</div>
                  </div>
                )}
              </div>

              {/* Section 2: Insert Items List */}
              <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    <span className="w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold">
                      2
                    </span>
                    <span>待插入文件 ({insertItems.length})</span>
                  </div>
                  {insertItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setInsertItems([])}
                      className="text-[11px] text-rose-500 hover:text-rose-600 cursor-pointer"
                    >
                      清空
                    </button>
                  )}
                </div>

                {insertItems.length === 0 ? (
                  <div className="p-3 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-center text-xs text-slate-400 space-y-1">
                    <div className="text-slate-500 dark:text-slate-400 font-medium">未添加插入文件</div>
                    <div className="text-[11px]">从左侧选择图片、Word 或 PDF 文件</div>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                    {insertItems.map((item, idx) => {
                      const badge = getFileTypeBadge(item.extension);
                      return (
                        <div
                          key={item.path + idx}
                          className="p-2 rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                            <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] flex items-center justify-center font-mono font-bold">
                              {idx + 1}
                            </span>
                            <span className={`text-[9px] font-semibold px-1 py-0.2 rounded border ${badge.color}`}>
                              {badge.label}
                            </span>
                            <span className="truncate text-slate-800 dark:text-slate-200 font-medium" title={item.name}>
                              {item.name}
                            </span>
                          </div>

                          <div className="flex items-center space-x-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => setPreviewPath(item.path)}
                              className="p-1 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                              title="预览"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveInsertItem(idx, 'up')}
                              disabled={idx === 0}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 cursor-pointer"
                              title="上移"
                            >
                              <MoveUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveInsertItem(idx, 'down')}
                              disabled={idx === insertItems.length - 1}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 cursor-pointer"
                              title="下移"
                            >
                              <MoveDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeInsertItem(idx)}
                              className="p-1 rounded text-rose-400 hover:text-rose-600 cursor-pointer"
                              title="移除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Section 3: Insertion Position Setting */}
              <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    <span className="w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold">
                      3
                    </span>
                    <span>插入位置</span>
                  </div>
                  {targetPdf && (
                    <span className="text-[11px] text-slate-400">
                      共 <b className="text-purple-600 dark:text-purple-400">{targetPdf.page_count || 1}</b> 页
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setInsertPositionType('start')}
                    className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                      insertPositionType === 'start'
                        ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold shadow-2xs'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <div className="text-xs">文档开头</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">第 1 页前</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInsertPositionType('after_page')}
                    className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                      insertPositionType === 'after_page'
                        ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold shadow-2xs'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <div className="text-xs">指定页码后</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">指定页后</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInsertPositionType('end')}
                    className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                      insertPositionType === 'end'
                        ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold shadow-2xs'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <div className="text-xs">文档末尾</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">最后一页后</div>
                  </button>
                </div>

                {/* Page Number Stepper when 'after_page' is active */}
                {insertPositionType === 'after_page' && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 animate-pop-in">
                    <div className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                      插入位置:
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setInsertAfterPage((p) => Math.max(1, p - 1))}
                        disabled={insertAfterPage <= 1}
                        className="w-7 h-7 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-sm disabled:opacity-30 cursor-pointer"
                      >
                        -
                      </button>
                      <div className="flex items-center space-x-1 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                        <span>第</span>
                        <input
                          type="number"
                          min={1}
                          max={targetPdf?.page_count || 9999}
                          value={insertAfterPage}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) {
                              setInsertAfterPage(Math.max(1, Math.min(val, targetPdf?.page_count || 9999)));
                            }
                          }}
                          className="w-12 text-center py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:outline-hidden"
                        />
                        <span>页后</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInsertAfterPage((p) => Math.min(targetPdf?.page_count || 9999, p + 1))}
                        disabled={insertAfterPage >= (targetPdf?.page_count || 9999)}
                        className="w-7 h-7 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-sm disabled:opacity-30 cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}

                {/* Visual Flowchart Diagram */}
                {targetPdf && insertItems.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-[11px] space-y-1.5 animate-pop-in">
                    <div className="text-[10px] font-semibold text-indigo-800 dark:text-indigo-300 flex items-center space-x-1">
                      <span>页面顺序预览</span>
                    </div>

                    {(() => {
                      const totalP = targetPdf.page_count || 1;
                      const insCount = insertItems.length;
                      const finalTotal = totalP + insCount;

                      if (insertPositionType === 'start') {
                        return (
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                            <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-300 dark:border-indigo-700">
                              插入 {insCount} 项 (第 1~{insCount} 页)
                            </span>
                            <ArrowRight className="w-3 h-3 text-indigo-400" />
                            <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              原文档 1~{totalP} 页 (变为第 {insCount + 1}~{finalTotal} 页)
                            </span>
                            <span className="text-slate-400 ml-auto font-sans font-medium text-[11px]">
                              = 共 <b className="text-indigo-600 dark:text-indigo-400">{finalTotal}</b> 页
                            </span>
                          </div>
                        );
                      } else if (insertPositionType === 'end') {
                        return (
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                            <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              原文档全部 1~{totalP} 页
                            </span>
                            <ArrowRight className="w-3 h-3 text-indigo-400" />
                            <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-300 dark:border-indigo-700">
                              插入 {insCount} 项 (变为第 {totalP + 1}~{finalTotal} 页)
                            </span>
                            <span className="text-slate-400 ml-auto font-sans font-medium text-[11px]">
                              = 共 <b className="text-indigo-600 dark:text-indigo-400">{finalTotal}</b> 页
                            </span>
                          </div>
                        );
                      } else {
                        const p = Math.min(insertAfterPage, totalP);
                        if (p >= totalP) {
                          return (
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                              <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                原文档全部 1~{totalP} 页
                              </span>
                              <ArrowRight className="w-3 h-3 text-indigo-400" />
                              <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-300 dark:border-indigo-700">
                                插入 {insCount} 项 (变为第 {totalP + 1}~{finalTotal} 页)
                              </span>
                              <span className="text-slate-400 ml-auto font-sans font-medium text-[11px]">
                                = 共 <b className="text-indigo-600 dark:text-indigo-400">{finalTotal}</b> 页
                              </span>
                            </div>
                          );
                        }
                        return (
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                            <span className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              原文档 1~{p} 页
                            </span>
                            <ArrowRight className="w-3 h-3 text-indigo-400" />
                            <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-300 dark:border-indigo-700">
                              插入 {insCount} 项 (第 {p + 1}~{p + insCount} 页)
                            </span>
                            <ArrowRight className="w-3 h-3 text-indigo-400" />
                            <span className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              原文档 {p + 1}~{totalP} 页 (第 {p + insCount + 1}~{finalTotal} 页)
                            </span>
                            <span className="text-slate-400 ml-auto font-sans font-medium text-[11px]">
                              = 共 <b className="text-indigo-600 dark:text-indigo-400">{finalTotal}</b> 页
                            </span>
                          </div>
                        );
                      }
                    })()}
                  </div>
                )}
              </div>

              {/* Section 4: Output File Path */}
              <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-2">
                <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                  输出路径:
                </label>
                <input
                  type="text"
                  value={insertOutputPath}
                  onChange={(e) => setInsertOutputPath(e.target.value)}
                  placeholder="自动生成，支持自定义"
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              {/* Section 5: BeautifulUI OperationStatusBanner */}
              <OperationStatusBanner
                status={
                  isInserting
                    ? 'loading'
                    : insertErrorMessage
                    ? 'error'
                    : insertResult
                    ? 'success'
                    : 'idle'
                }
                loadingLabel="正在插入页面..."
                loadingSublabel="正在处理页面与图片资源"
                accentColor="indigo"
                pixelVariant="Drive"
                successTitle="插入完成"
                successMessage={insertResult?.message}
                outputPath={insertResult?.output_path}
                errorTitle="插入失败"
                errorMessage={insertErrorMessage}
                onRetry={handleInsert}
                onPreview={setPreviewPath}
                onDismiss={() => {
                  setInsertErrorMessage(null);
                  setInsertResult(null);
                }}
              />

              {/* Section 6: Action Button */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleInsert}
                  disabled={isInserting || !targetPdf || insertItems.length === 0}
                  className={`w-full py-2.5 px-4 rounded-xl font-medium text-xs flex items-center justify-center space-x-2 transition-all ${
                    isInserting
                      ? 'bg-indigo-600 text-white cursor-wait opacity-90 shadow-md'
                      : !targetPdf || insertItems.length === 0
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 shadow-none cursor-not-allowed'
                      : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/30 cursor-pointer active:scale-[0.99]'
                  }`}
                >
                  {isInserting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>正在插入页面...</span>
                    </>
                  ) : !targetPdf ? (
                    <>
                      <FilePlus2 className="w-4 h-4" />
                      <span>开始插入（请选择目标 PDF）</span>
                    </>
                  ) : insertItems.length === 0 ? (
                    <>
                      <ImageIcon className="w-4 h-4" />
                      <span>开始插入（请添加文件）</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>
                        {insertPositionType === 'start'
                          ? `插入到开头（${insertItems.length} 个文件）`
                          : insertPositionType === 'end'
                          ? `追加到末尾（${insertItems.length} 个文件）`
                          : `插入到第 ${insertAfterPage} 页后（${insertItems.length} 个文件）`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Document Preview Modal */}
      <DocumentPreviewModal
        path={previewPath}
        onClose={() => setPreviewPath(null)}
      />
    </div>
  );
};
