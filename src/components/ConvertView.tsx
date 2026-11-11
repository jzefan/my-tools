import { getPathBasename } from '../utils/format';
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeftRight,
  FileText,
  Upload,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Plus,
  Trash2,
  FolderOpen,
  Sparkles,
  FileType,
  Eye,
  Cpu,
  Image as ImageIcon,
} from 'lucide-react';
import { api } from '../services/api';
import {
  ConvertEngineStatus,
  ConvertItem,
  ConvertResult,
} from '../types';
import {
  formatFileSize,
  generateDefaultConvertOutputPath,
  generateDefaultPdfToImageDir,
  getFileTypeBadge,
} from '../utils/format';
import { OperationStatusBanner } from './common/OperationStatusBanner';
import { DocumentPreviewModal } from './common/DocumentPreviewModal';

interface ConvertViewProps {
  initialFile?: string;
}

interface QueueItem {
  id: string;
  path: string;
  name: string;
  size: number;
  extension: string;
  targetFormat: 'docx' | 'pdf' | 'image' | 'png' | 'jpg' | 'auto';
  outputPath?: string;
  pageRange?: string;
  dpi?: number;
}

export const ConvertView: React.FC<ConvertViewProps> = ({ initialFile }) => {
  // Mode selection: 'auto' | 'pdf2word' | 'word2pdf' | 'pdf2image'
  const [mode, setMode] = useState<'auto' | 'pdf2word' | 'word2pdf' | 'pdf2image'>('auto');

  // File queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [manualPathInput, setManualPathInput] = useState('');
  const [defaultOutputDir, setDefaultOutputDir] = useState<string>('');

  // Engine status
  const [engineStatus, setEngineStatus] = useState<ConvertEngineStatus | null>(null);
  const [showEngineInfo, setShowEngineInfo] = useState(false);
  const [isLoadingEngine, setIsLoadingEngine] = useState(false);

  // Conversion process state
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [showOverwriteModal, setShowOverwriteModal] = useState(false);
  const outcomeRef = useRef<HTMLDivElement>(null);

  // Lazy toggle and fetch engine status only when requested by user
  const handleToggleEngineInfo = async () => {
    const next = !showEngineInfo;
    setShowEngineInfo(next);
    if (next && !engineStatus && !isLoadingEngine) {
      setIsLoadingEngine(true);
      try {
        const s = await api.getConvertEngineStatus();
        setEngineStatus(s);
      } catch (err) {
        console.error('获取转换引擎信息失败:', err);
      } finally {
        setIsLoadingEngine(false);
      }
    }
  };

  // Handle initialFile passed from props or launch context
  useEffect(() => {
    if (initialFile) {
      addFilePathToQueue(initialFile);
    }
  }, [initialFile]);

  // Add path to queue
  const addFilePathToQueue = async (filePath: string) => {
    const cleanPath = filePath.trim();
    if (!cleanPath) return;

    // Check if already in queue
    if (queue.some((q) => q.path === cleanPath)) {
      return;
    }

    try {
      const meta = await api.getFileInfo(cleanPath);
      const ext = meta.extension.toLowerCase();
      let targetFormat: 'docx' | 'pdf' | 'png' | 'jpg' | 'auto' = 'auto';

      if (mode === 'pdf2image' && ext === 'pdf') {
        targetFormat = 'png';
      } else if (mode === 'pdf2word' || ext === 'pdf') {
        targetFormat = 'docx';
      } else if (mode === 'word2pdf' || ext === 'docx' || ext === 'doc') {
        targetFormat = 'pdf';
      }

      let defaultOut = '';
      if ((targetFormat as string) === 'png' || (targetFormat as string) === 'jpg') {
        defaultOut = generateDefaultPdfToImageDir(cleanPath);
      } else if (targetFormat === 'docx' || targetFormat === 'pdf') {
        defaultOut = generateDefaultConvertOutputPath(cleanPath, targetFormat);
      }

      const newItem: QueueItem = {
        id: `${Date.now()}_${Math.random()}`,
        path: meta.path,
        name: meta.name,
        size: meta.size,
        extension: ext,
        targetFormat,
        outputPath: defaultOut,
        pageRange: 'all',
        dpi: 150,
      };

      setQueue((prev) => [...prev, newItem]);
      setManualPathInput('');
      setErrorMessage(null);
      setResult(null);
    } catch (err: any) {
      setErrorMessage(
        typeof err === 'string' ? err : err?.message || '获取文件信息失败，请检查路径是否正确'
      );
    }
  };

  // Open native file picker dialog
  const handlePickFile = async () => {
    try {
      const selected = await api.pickFileDialog('请选择需要转换的 PDF 或 Word 文档', false);
      if (selected) {
        addFilePathToQueue(selected);
      }
    } catch (err) {
      console.error('选择文件出错:', err);
    }
  };

  // Open native folder picker for output directory
  const handlePickOutputDir = async () => {
    try {
      const selected = await api.pickFileDialog('请选择输出保存目录', true);
      if (selected) {
        setDefaultOutputDir(selected);
      }
    } catch (err) {
      console.error('选择输出目录出错:', err);
    }
  };

  // Remove single item from queue
  const handleRemoveItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  // Clear entire queue
  const handleClearQueue = () => {
    setQueue([]);
    setResult(null);
    setErrorMessage(null);
  };

  // Update target format for item
  const handleUpdateItemFormat = (
    id: string,
    targetFormat: 'docx' | 'pdf' | 'image' | 'png' | 'jpg' | 'auto'
  ) => {
    setQueue((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          let outputPath = item.outputPath;
          if (targetFormat === 'png' || targetFormat === 'jpg' || targetFormat === 'image') {
            outputPath = generateDefaultPdfToImageDir(item.path);
          } else if (targetFormat === 'docx' || targetFormat === 'pdf') {
            outputPath = generateDefaultConvertOutputPath(item.path, targetFormat);
          }
          return { ...item, targetFormat, outputPath };
        }
        return item;
      })
    );
  };

  // Update page range for PDF item
  const handleUpdatePageRange = (id: string, pageRange: string) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, pageRange } : item))
    );
  };

  // Update DPI for image output
  const handleUpdateDpi = (id: string, dpi: number) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, dpi } : item))
    );
  };

  // Switch overall mode
  const handleModeChange = (newMode: 'auto' | 'pdf2word' | 'word2pdf' | 'pdf2image') => {
    setMode(newMode);
    setResult(null);
    setErrorMessage(null);
    setQueue((prev) =>
      prev.map((item) => {
        const ext = item.extension.toLowerCase();
        let targetFormat = item.targetFormat;
        let outputPath = item.outputPath;

        if (newMode === 'pdf2image') {
          if (ext === 'pdf') {
            targetFormat = 'png';
            outputPath = generateDefaultPdfToImageDir(item.path);
          }
        } else if (newMode === 'pdf2word' && ext === 'pdf') {
          targetFormat = 'docx';
          outputPath = generateDefaultConvertOutputPath(item.path, 'docx');
        } else if (newMode === 'word2pdf' && (ext === 'docx' || ext === 'doc')) {
          targetFormat = 'pdf';
          outputPath = generateDefaultConvertOutputPath(item.path, 'pdf');
        } else {
          targetFormat = ext === 'pdf' ? 'docx' : 'pdf';
          outputPath = generateDefaultConvertOutputPath(item.path, targetFormat);
        }
        return { ...item, targetFormat, outputPath };
      })
    );
  };

  // Execute batch conversion
  const handleConvert = async (forceOverwrite = false) => {
    if (queue.length === 0) {
      setErrorMessage('请先添加需要转换的文件');
      return;
    }

    const items: ConvertItem[] = queue.map((q) => ({
      input_path: q.path,
      output_path: q.outputPath && q.outputPath.trim().length > 0 ? q.outputPath.trim() : undefined,
      target_format: q.targetFormat,
      page_range: q.pageRange && q.pageRange !== 'all' ? q.pageRange : undefined,
      dpi: q.dpi || 150,
      overwrite: forceOverwrite,
    }));

    if (!forceOverwrite) {
      try {
        const conflicts = await api.checkConvertConflicts({
          items,
          default_output_dir: defaultOutputDir.trim() || undefined,
        });
        if (conflicts && conflicts.length > 0) {
          setConflictFiles(conflicts);
          setShowOverwriteModal(true);
          return;
        }
      } catch (e) {
        // Fallback to direct conversion if check fails
      }
    }

    setShowOverwriteModal(false);
    setIsConverting(true);
    setErrorMessage(null);
    setResult(null);

    const startTime = Date.now();
    try {
      const res = await api.convertDocuments({
        items,
        default_output_dir: defaultOutputDir.trim() || undefined,
        overwrite: forceOverwrite,
      });

      const elapsed = Date.now() - startTime;
      if (elapsed < 700) {
        await new Promise((resolve) => setTimeout(resolve, 700 - elapsed));
      }

      setResult(res);
      requestAnimationFrame(() => outcomeRef.current?.scrollIntoView({ block: 'nearest' }));
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }
      setErrorMessage(typeof err === 'string' ? err : err?.message || '转换过程中发生异常');
      requestAnimationFrame(() => outcomeRef.current?.scrollIntoView({ block: 'nearest' }));
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50/50 dark:bg-slate-950 overflow-y-auto">
      <div className="titlebar-nodrag max-w-3xl w-full mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center space-x-2">
              <ArrowLeftRight className="w-5 h-5 text-blue-500" />
              <span>文档转换</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              PDF 与 Word 互转，支持 PDF 导出图片。
            </p>
          </div>

          <button
            type="button"
            onClick={handleToggleEngineInfo}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 text-xs transition-colors shadow-2xs cursor-pointer"
          >
            {isLoadingEngine ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
            ) : (
              <Cpu className="w-3.5 h-3.5" />
            )}
            <span>{isLoadingEngine ? '检测中...' : '环境检测'}</span>
          </button>
        </div>

        {/* Engine Status Drawer */}
        {showEngineInfo && (
          <div className="bg-white dark:bg-slate-900 border border-blue-200/80 dark:border-blue-900/60 rounded-2xl p-4 shadow-xs space-y-3 animate-pop-in">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-blue-500" />
                <span>转换引擎</span>
              </span>
            </div>

            {isLoadingEngine ? (
              <div className="py-4 flex items-center justify-center space-x-2 text-xs text-slate-500">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                <span>正在检测转换环境...</span>
              </div>
            ) : engineStatus ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">pdftoppm (图片渲染)</span>
                {engineStatus.pdftoppm_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">未检测到</span>
                )}
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">PyMuPDF (fitz)</span>
                {engineStatus.fitz_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">未检测到</span>
                )}
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">PDF 转 Word（内置）</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">pdf2docx（可选）</span>
                {engineStatus.pdf2docx_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">未检测到</span>
                )}
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Apple Pages</span>
                {engineStatus.pages_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">未检测到</span>
                )}
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Microsoft Word</span>
                {engineStatus.word_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">未检测到</span>
                )}
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">LibreOffice（转 PDF）</span>
                {engineStatus.soffice_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">未检测到</span>
                )}
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">docx2pdf</span>
                {engineStatus.docx2pdf_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">未检测到</span>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

        {/* Direction Tabs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-1.5 shadow-xs grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <button
            onClick={() => handleModeChange('auto')}
            className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              mode === 'auto'
                ? 'bg-blue-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>自动识别</span>
          </button>

          <button
            onClick={() => handleModeChange('pdf2word')}
            className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              mode === 'pdf2word'
                ? 'bg-blue-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>PDF 转 Word</span>
          </button>

          <button
            onClick={() => handleModeChange('word2pdf')}
            className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              mode === 'word2pdf'
                ? 'bg-blue-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <FileType className="w-3.5 h-3.5" />
            <span>Word 转 PDF</span>
          </button>

          <button
            onClick={() => handleModeChange('pdf2image')}
            className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              mode === 'pdf2image'
                ? 'bg-blue-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>PDF 转图片</span>
          </button>
        </div>

        {/* File Picker & Input Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              添加待转换文件
            </label>
            <span className="text-[11px] text-slate-400">
              支持 PDF / DOCX / DOC
            </span>
          </div>

          <div
            onClick={handlePickFile}
            className="border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 rounded-xl p-6 text-center text-xs text-slate-400 space-y-2 cursor-pointer transition-colors bg-slate-50/50 dark:bg-slate-900/50"
          >
            <Upload className="w-8 h-8 text-blue-400 dark:text-blue-500 mx-auto stroke-1" />
            <div>
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                点击选择文件
              </span>
              <span className="block text-[11px] text-slate-400 mt-0.5">
                支持拖拽或粘贴路径
              </span>
            </div>
          </div>

          {/* Manual path input & output dir row */}
          <div className="flex space-x-2">
            <input
              type="text"
              value={manualPathInput}
              onChange={(e) => setManualPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addFilePathToQueue(manualPathInput);
                }
              }}
              placeholder="输入或粘贴文件路径，按 Enter 添加"
              className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500 font-mono"
            />
            <button
              onClick={() => addFilePathToQueue(manualPathInput)}
              disabled={!manualPathInput.trim()}
              className="px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 text-white disabled:text-slate-400 text-xs font-semibold transition-colors flex items-center space-x-1 cursor-pointer disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加</span>
            </button>
          </div>

          {/* Custom Default Output Directory */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2 min-w-0 flex-1 mr-3">
              <span className="text-slate-500 shrink-0">输出保存目录:</span>
              <span className="text-slate-700 dark:text-slate-300 font-mono truncate text-[11px]">
                {defaultOutputDir || '与原文件同目录（默认）'}
              </span>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              {defaultOutputDir && (
                <button
                  onClick={() => setDefaultOutputDir('')}
                  className="text-[11px] text-slate-400 hover:text-red-500 cursor-pointer"
                >
                  重置
                </button>
              )}
              <button
                onClick={handlePickOutputDir}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-600 dark:text-slate-400 text-[11px] transition-colors cursor-pointer"
              >
                <FolderOpen className="w-3 h-3" />
                <span>更改目录</span>
              </button>
            </div>
          </div>
        </div>

        {/* Queue List Card */}
        {queue.length > 0 && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                待转换文件（{queue.length}）
              </span>
              <button
                onClick={handleClearQueue}
                className="text-[11px] text-red-500 hover:text-red-600 flex items-center space-x-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>清空</span>
              </button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {queue.map((item, idx) => {
                const badge = getFileTypeBadge(item.extension);
                const isPdf = item.extension === 'pdf';
                return (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col space-y-2 hover:border-blue-300 dark:hover:border-blue-800 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-3">
                        <span className="text-xs font-bold text-slate-400 font-mono w-4">
                          {idx + 1}.
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${badge.color}`}
                        >
                          {badge.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                            {item.name}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">
                            {item.path}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        <span className="text-[11px] text-slate-500 font-mono">
                          {formatFileSize(item.size)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPreviewPath(item.path)}
                          className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                          title="预览"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          className="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                          title="移除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Options row per file */}
                    <div className="pt-2 border-t border-slate-200/50 dark:border-slate-700/50 flex flex-wrap items-center justify-between text-[11px] gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-slate-400">转换目标:</span>
                        <select
                          value={item.targetFormat}
                          onChange={(e) =>
                            handleUpdateItemFormat(
                              item.id,
                              e.target.value as any
                            )
                          }
                          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 focus:outline-hidden"
                        >
                          {isPdf ? (
                            <>
                              <option value="docx">Word (.docx)</option>
                              <option value="png">PNG 图片</option>
                              <option value="jpg">JPG 图片</option>
                              <option value="auto">自动识别</option>
                            </>
                          ) : (
                            <>
                              <option value="pdf">PDF (.pdf)</option>
                              <option value="docx">Word (.docx)</option>
                              <option value="auto">自动识别</option>
                            </>
                          )}
                        </select>
                      </div>

                      {/* PDF to Image specific options */}
                      {isPdf && (item.targetFormat === 'png' || item.targetFormat === 'jpg' || item.targetFormat === 'image') && (
                        <div className="flex items-center space-x-1.5">
                          <span className="text-slate-400">分辨率:</span>
                          <select
                            value={item.dpi || 150}
                            onChange={(e) => handleUpdateDpi(item.id, Number(e.target.value))}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 focus:outline-hidden"
                          >
                            <option value={72}>72 DPI (标准)</option>
                            <option value={150}>150 DPI (高清)</option>
                            <option value={300}>300 DPI (超清)</option>
                          </select>
                        </div>
                      )}

                      {isPdf && (
                        <div className="flex items-center space-x-1.5">
                          <span className="text-slate-400">页码范围:</span>
                          <input
                            type="text"
                            value={item.pageRange || 'all'}
                            onChange={(e) =>
                              handleUpdatePageRange(item.id, e.target.value)
                            }
                            placeholder="全部或 1-3"
                            className="w-20 px-1.5 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-mono text-[10px]"
                            title="例如 1-3 或 2,4-5，默认全部转换"
                          />
                        </div>
                      )}

                      {/* Target directory badge for PDF to Image */}
                      {isPdf && (item.targetFormat === 'png' || item.targetFormat === 'jpg' || item.targetFormat === 'image') && (
                        <div className="w-full flex items-center space-x-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-mono bg-blue-50/60 dark:bg-blue-950/20 px-2 py-1 rounded-md border border-blue-100 dark:border-blue-900/30">
                          <FolderOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span className="shrink-0 text-blue-600 dark:text-blue-400 font-medium">输出目录:</span>
                          <span className="truncate">{item.outputPath || generateDefaultPdfToImageDir(item.path)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Loading Status Feedback */}
            {isConverting && (
              <div className="pt-2">
                <OperationStatusBanner
                  status="loading"
                  loadingLabel={`正在转换文档（共 ${queue.length} 个）...`}
                  loadingSublabel="带图文档可能需要几分钟"
                  accentColor="blue"
                  pixelVariant="Drive"
                />
              </div>
            )}
            {!isConverting && errorMessage && (
              <p className="pt-2 text-xs text-red-600 dark:text-red-400 break-words">{errorMessage}</p>
            )}
            {!isConverting && result?.results.some((item) => !item.success) && (
              <p className="pt-2 text-xs text-red-600 dark:text-red-400 break-words">
                {result.results.find((item) => !item.success)?.message}
              </p>
            )}

            {/* Action Button */}
            <div className="pt-3">
              <button
                onClick={() => handleConvert()}
                disabled={isConverting}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-semibold text-xs transition-all shadow-md shadow-blue-500/20 flex items-center justify-center space-x-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {isConverting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>正在转换...</span>
                  </>
                ) : (
                  <>
                    <ArrowLeftRight className="w-4 h-4" />
                    <span>{`开始转换（${queue.length} 个文件）`}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        <div ref={outcomeRef} className="scroll-mt-4" />
        {/* Error notification */}
        {errorMessage && (
          <OperationStatusBanner
            status="error"
            errorTitle="转换失败"
            errorMessage={errorMessage}
            onRetry={() => handleConvert()}
            onDismiss={() => setErrorMessage(null)}
          />
        )}

        {/* Results Card */}
        {result && (
          <div className="space-y-4">
            <OperationStatusBanner
              status={result.results.some((r) => !r.success) ? 'error' : 'success'}
              successTitle="批量转换完成"
              successMessage={result.message}
              errorTitle={
                result.results.every((r) => !r.success)
                  ? '全部文档转换失败'
                  : '部分文档转换失败'
              }
              errorMessage={
                result.results.some((r) => !r.success)
                  ? `存在 ${result.results.filter((r) => !r.success).length} 个文档转换失败，具体原因见下方列表`
                  : null
              }
              onRetry={result.results.some((r) => !r.success) ? () => handleConvert() : undefined}
              onDismiss={() => setResult(null)}
            />

            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center space-x-2.5">
                <div
                  className={`p-1.5 rounded-lg ${
                    result.results.some((r) => !r.success)
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                    {result.message}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    共处理 {result.results.length} 个文件，成功 {result.results.filter((r) => r.success).length} 个，失败 {result.results.filter((r) => !r.success).length} 个
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {result.results.map((res, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border ${
                      res.success
                        ? 'border-emerald-200/70 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/10'
                        : 'border-red-200/70 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/10'
                    } flex flex-col space-y-2`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1 mr-3">
                        <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                          {getPathBasename(res.output_path) || getPathBasename(res.input_path)}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {res.output_path || res.input_path}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            res.success
                              ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                              : 'bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300'
                          }`}
                        >
                          {res.engine_used || (res.success ? 'Success' : 'Failed')}
                        </span>
                      </div>
                    </div>

                    {res.success && (
                      <div className="pt-2 border-t border-slate-200/40 dark:border-slate-800/40 flex items-center justify-between text-[11px]">
                        <div className="text-slate-500 font-mono">
                          {formatFileSize(res.original_size)} → {formatFileSize(res.converted_size)}
                        </div>
                        <div className="flex items-center space-x-2">
                          {(!res.output_path.toLowerCase().endsWith('.pdf') &&
                            !res.output_path.toLowerCase().endsWith('.docx') &&
                            !res.output_path.toLowerCase().endsWith('.doc')) ? (
                            <>
                              <button
                                type="button"
                                onClick={() => api.openFilePath(res.output_path)}
                                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-medium transition-colors cursor-pointer"
                              >
                                <FolderOpen className="w-3 h-3" />
                                <span>打开图片目录</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => api.revealInFinder(res.output_path)}
                                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                              >
                                <FolderOpen className="w-3 h-3" />
                                <span>在访达中显示</span>
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setPreviewPath(res.output_path)}
                                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-medium transition-colors cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                                <span>预览</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => api.openFilePath(res.output_path)}
                                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>系统打开</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => api.revealInFinder(res.output_path)}
                                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                              >
                                <FolderOpen className="w-3 h-3" />
                                <span>在访达中显示</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {!res.success && (
                      <div className="mt-1 p-2 rounded-lg bg-red-100/70 dark:bg-red-950/60 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs flex items-center justify-between gap-2">
                        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-500" />
                          <span className="font-medium truncate">失败原因：{res.message || '转换失败'}</span>
                        </div>
                        {res.message?.includes('已存在') && (
                          <button
                            type="button"
                            onClick={() => handleConvert(true)}
                            className="shrink-0 px-2 py-0.5 rounded bg-red-200/80 dark:bg-red-900/60 hover:bg-red-300 dark:hover:bg-red-800 text-red-800 dark:text-red-200 text-[11px] font-medium transition-colors cursor-pointer"
                          >
                            覆盖重试
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Document Preview Modal */}
      <DocumentPreviewModal
        path={previewPath}
        onClose={() => setPreviewPath(null)}
      />

      {/* Overwrite Confirmation Modal */}
      {showOverwriteModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-pop-in select-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowOverwriteModal(false);
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  目标文件已存在
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  以下文件已存在，是否覆盖？
                </p>
              </div>
            </div>

            <div className="max-h-36 overflow-y-auto rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800 p-2.5 space-y-1.5 text-xs font-mono text-slate-600 dark:text-slate-400">
              {conflictFiles.map((path, idx) => (
                <div key={idx} className="truncate" title={path}>
                  {getPathBasename(path)}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setShowOverwriteModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleConvert(true)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors cursor-pointer"
              >
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
