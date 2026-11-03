import React, { useState, useEffect } from 'react';
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
  getFileTypeBadge,
} from '../utils/format';

interface ConvertViewProps {
  initialFile?: string;
}

interface QueueItem {
  id: string;
  path: string;
  name: string;
  size: number;
  extension: string;
  targetFormat: 'docx' | 'pdf' | 'auto';
  outputPath?: string;
  pageRange?: string;
}

export const ConvertView: React.FC<ConvertViewProps> = ({ initialFile }) => {
  // Mode selection: 'auto' | 'pdf2word' | 'word2pdf'
  const [mode, setMode] = useState<'auto' | 'pdf2word' | 'word2pdf'>('auto');

  // File queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [manualPathInput, setManualPathInput] = useState('');
  const [defaultOutputDir, setDefaultOutputDir] = useState<string>('');

  // Engine status
  const [engineStatus, setEngineStatus] = useState<ConvertEngineStatus | null>(null);
  const [showEngineInfo, setShowEngineInfo] = useState(false);

  // Conversion process state
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch engine status on mount
  useEffect(() => {
    api.getConvertEngineStatus().then(setEngineStatus).catch(console.error);
  }, []);

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
      let targetFormat: 'docx' | 'pdf' | 'auto' = 'auto';

      if (mode === 'pdf2word' || ext === 'pdf') {
        targetFormat = 'docx';
      } else if (mode === 'word2pdf' || ext === 'docx' || ext === 'doc') {
        targetFormat = 'pdf';
      }

      const defaultOut = targetFormat !== 'auto'
        ? generateDefaultConvertOutputPath(cleanPath, targetFormat)
        : '';

      const newItem: QueueItem = {
        id: `${Date.now()}_${Math.random()}`,
        path: meta.path,
        name: meta.name,
        size: meta.size,
        extension: ext,
        targetFormat,
        outputPath: defaultOut,
        pageRange: 'all',
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
  const handleUpdateItemFormat = (id: string, targetFormat: 'docx' | 'pdf' | 'auto') => {
    setQueue((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const defaultOut = targetFormat !== 'auto'
            ? generateDefaultConvertOutputPath(item.path, targetFormat)
            : '';
          return { ...item, targetFormat, outputPath: defaultOut };
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

  // Switch overall mode
  const handleModeChange = (newMode: 'auto' | 'pdf2word' | 'word2pdf') => {
    setMode(newMode);
    setQueue((prev) =>
      prev.map((item) => {
        let targetFormat: 'docx' | 'pdf' = 'docx';
        if (newMode === 'pdf2word') targetFormat = 'docx';
        else if (newMode === 'word2pdf') targetFormat = 'pdf';
        else {
          targetFormat = item.extension === 'pdf' ? 'docx' : 'pdf';
        }
        const defaultOut = generateDefaultConvertOutputPath(item.path, targetFormat);
        return { ...item, targetFormat, outputPath: defaultOut };
      })
    );
  };

  // Execute batch conversion
  const handleConvert = async () => {
    if (queue.length === 0) {
      setErrorMessage('请先添加需要转换的文件');
      return;
    }

    setIsConverting(true);
    setErrorMessage(null);
    setResult(null);

    try {
      const items: ConvertItem[] = queue.map((q) => ({
        input_path: q.path,
        output_path: q.outputPath && q.outputPath.trim().length > 0 ? q.outputPath.trim() : undefined,
        target_format: q.targetFormat,
        page_range: q.pageRange && q.pageRange !== 'all' ? q.pageRange : undefined,
      }));

      const res = await api.convertDocuments({
        items,
        default_output_dir: defaultOutputDir.trim() || undefined,
      });

      setResult(res);
    } catch (err: any) {
      setErrorMessage(typeof err === 'string' ? err : err?.message || '转换过程中发生异常');
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
              <span>PDF 与 Word 相互转换</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              支持 PDF 转 Word (.docx) 及 Word (.docx/.doc) 转 PDF，高保真还原段落排版、表格与字体
            </p>
          </div>

          <button
            onClick={() => setShowEngineInfo(!showEngineInfo)}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 text-xs transition-colors shadow-2xs"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>转换引擎信息</span>
          </button>
        </div>

        {/* Engine Status Drawer */}
        {showEngineInfo && engineStatus && (
          <div className="bg-white dark:bg-slate-900 border border-blue-200/80 dark:border-blue-900/60 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-blue-500" />
                <span>系统就绪转换引擎环境</span>
              </span>
              <span className="text-[11px] text-slate-400">自动多级级联回退</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">pdf2docx (AI排版)</span>
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
                <span className="text-slate-600 dark:text-slate-400">Chrome/Edge (矢量打印)</span>
                {engineStatus.chrome_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">未检测到</span>
                )}
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Pandoc 格式转换器</span>
                {engineStatus.pandoc_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">未检测到</span>
                )}
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">LibreOffice (soffice)</span>
                {engineStatus.soffice_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">已就绪</span>
                ) : (
                  <span className="text-slate-400 text-[11px]">未检测到</span>
                )}
              </div>
              <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">DocTools 原生保底</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">内置可用</span>
              </div>
            </div>
          </div>
        )}

        {/* Direction Tabs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-1.5 shadow-xs flex space-x-1">
          <button
            onClick={() => handleModeChange('auto')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-2 ${
              mode === 'auto'
                ? 'bg-blue-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>智能自动识别</span>
          </button>

          <button
            onClick={() => handleModeChange('pdf2word')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-2 ${
              mode === 'pdf2word'
                ? 'bg-blue-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>PDF 转 Word (.docx)</span>
          </button>

          <button
            onClick={() => handleModeChange('word2pdf')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center space-x-2 ${
              mode === 'word2pdf'
                ? 'bg-blue-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <FileType className="w-3.5 h-3.5" />
            <span>Word 转 PDF (.pdf)</span>
          </button>
        </div>

        {/* File Picker & Input Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              添加待转换文件
            </label>
            <span className="text-[11px] text-slate-400">
              支持 PDF / DOCX / DOC 格式，支持批量添加
            </span>
          </div>

          <div
            onClick={handlePickFile}
            className="border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 rounded-xl p-6 text-center text-xs text-slate-400 space-y-2 cursor-pointer transition-colors bg-slate-50/50 dark:bg-slate-900/50"
          >
            <Upload className="w-8 h-8 text-blue-400 dark:text-blue-500 mx-auto stroke-1" />
            <div>
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                点击调用系统弹窗选择文件
              </span>
              <span className="block text-[11px] text-slate-400 mt-0.5">
                也可在下方输入框粘贴绝对路径，或通过访达右键快速添加
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
              placeholder="输入或粘贴文件绝对路径，例如 /Users/jzefan/sample.pdf 并回车"
              className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500 font-mono"
            />
            <button
              onClick={() => addFilePathToQueue(manualPathInput)}
              disabled={!manualPathInput.trim()}
              className="px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 text-white disabled:text-slate-400 text-xs font-semibold transition-colors flex items-center space-x-1"
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
                {defaultOutputDir || '与源文件同目录 (默认)'}
              </span>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              {defaultOutputDir && (
                <button
                  onClick={() => setDefaultOutputDir('')}
                  className="text-[11px] text-slate-400 hover:text-red-500"
                >
                  重置
                </button>
              )}
              <button
                onClick={handlePickOutputDir}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-600 dark:text-slate-400 text-[11px] transition-colors"
              >
                <FolderOpen className="w-3 h-3" />
                <span>自定义目录</span>
              </button>
            </div>
          </div>
        </div>

        {/* Queue List Card */}
        {queue.length > 0 && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  转换队列 ({queue.length} 个文件)
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 font-medium">
                  批量处理就绪
                </span>
              </div>
              <button
                onClick={handleClearQueue}
                className="text-[11px] text-red-500 hover:text-red-600 flex items-center space-x-1"
              >
                <Trash2 className="w-3 h-3" />
                <span>清空队列</span>
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

                      <div className="flex items-center space-x-3 shrink-0">
                        <span className="text-[11px] text-slate-500 font-mono">
                          {formatFileSize(item.size)}
                        </span>
                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          className="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
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
                              e.target.value as 'docx' | 'pdf' | 'auto'
                            )
                          }
                          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 focus:outline-hidden"
                        >
                          <option value="docx">Word 文档 (.docx)</option>
                          <option value="pdf">PDF 文档 (.pdf)</option>
                          <option value="auto">自动识别</option>
                        </select>
                      </div>

                      {isPdf && item.targetFormat === 'docx' && (
                        <div className="flex items-center space-x-1.5">
                          <span className="text-slate-400">转换页码:</span>
                          <input
                            type="text"
                            value={item.pageRange || 'all'}
                            onChange={(e) =>
                              handleUpdatePageRange(item.id, e.target.value)
                            }
                            placeholder="all 或 1-3"
                            className="w-20 px-1.5 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-mono text-[10px]"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action Button */}
            <div className="pt-3">
              <button
                onClick={handleConvert}
                disabled={isConverting}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-semibold text-xs transition-all shadow-md shadow-blue-500/20 flex items-center justify-center space-x-2"
              >
                {isConverting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>正在高保真转换中，请稍候...</span>
                  </>
                ) : (
                  <>
                    <ArrowLeftRight className="w-4 h-4" />
                    <span>立即开始批量转换 ({queue.length} 个文件)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 text-red-600 dark:text-red-400 text-xs flex items-center space-x-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Success Results Card */}
        {result && (
          <div className="bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-emerald-900/60 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center space-x-2.5">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {result.message}
                </h3>
                <p className="text-[11px] text-slate-400">转换完成的文件已成功输出至磁盘</p>
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
                        {res.output_path.split('/').pop() || res.input_path.split('/').pop()}
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
                        {res.engine_used}
                      </span>
                    </div>
                  </div>

                  {res.success && (
                    <div className="pt-2 border-t border-slate-200/40 dark:border-slate-800/40 flex items-center justify-between text-[11px]">
                      <div className="text-slate-500 font-mono">
                        {formatFileSize(res.original_size)} → {formatFileSize(res.converted_size)}
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => api.openFilePath(res.output_path)}
                          className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-medium transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          <span>打开文件</span>
                        </button>
                        <button
                          onClick={() => api.revealInFinder(res.output_path)}
                          className="flex items-center space-x-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>在访达中显示</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {!res.success && (
                    <div className="text-[11px] text-red-500">{res.message}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
