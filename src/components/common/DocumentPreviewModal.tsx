import { getPathBasename } from '../../utils/format';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Eye,
  ExternalLink,
  FolderOpen,
  FileText,
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../../services/api';
import { DocumentPreviewData } from '../../types';
import { formatDate, formatFileSize, getFileTypeBadge } from '../../utils/format';
import { LoadingState } from './LoadingState';

interface DocumentPreviewModalProps {
  path: string | null;
  onClose: () => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  path,
  onClose,
}) => {
  const [data, setData] = useState<DocumentPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'view' | 'text' | 'meta'>('view');
  const [zoom, setZoom] = useState<number>(100);
  const [copied, setCopied] = useState<boolean>(false);

  const previewRequest = useRef(0);

  // Load preview data when path changes
  const loadPreview = useCallback(async (filePath: string) => {
    const requestId = ++previewRequest.current;
    setIsLoading(true);
    setErrorMessage(null);
    setData(null);
    setZoom(100);
    setActiveTab('view');

    try {
      const res = await api.getDocumentPreview(filePath);
      if (requestId !== previewRequest.current) return;
      setData(res);
      // If docx and has text but no thumbnail, default to text tab
      if (res.extension === 'docx' && !res.thumbnail_url && res.text_content) {
        setActiveTab('text');
      }
    } catch (err: any) {
      if (requestId !== previewRequest.current) return;
      setErrorMessage(
        typeof err === 'string' ? err : err?.message || '预览失败'
      );
    } finally {
      if (requestId === previewRequest.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (path) {
      loadPreview(path);
    } else {
      setData(null);
      setErrorMessage(null);
    }
    return () => { ++previewRequest.current; };
  }, [path, loadPreview]);

  // Handle keyboard shortcuts (Esc to close, Space to QuickLook)
  useEffect(() => {
    if (!path) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.code === 'Space' && (e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        api.quickLookFile(path).catch(console.error);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [path, onClose]);

  if (!path) return null;

  const handleCopyPath = () => {
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const badge = data ? getFileTypeBadge(data.extension) : { label: 'FILE', color: 'text-slate-600' };
  const isPdf = data?.extension === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'gif'].includes(
    data?.extension || ''
  );
  const isWord = ['docx', 'doc'].includes(data?.extension || '');

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/70 backdrop-blur-md animate-pop-in select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl h-[88vh] max-h-[820px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* 1. Modal Header Bar */}
        <div className="shrink-0 px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex items-center justify-between gap-3">
          {/* File icon & Title */}
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0">
              {isImage ? (
                <ImageIcon className="w-5 h-5" />
              ) : (
                <FileText className="w-5 h-5" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${badge.color}`}>
                  {badge.label}
                </span>
                <h3
                  className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate"
                  title={data?.name || path}
                >
                  {data?.name || getPathBasename(path)}
                </h3>
              </div>

              {/* Subtitle / Attributes badges */}
              <div className="flex items-center space-x-2.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {data?.size !== undefined && (
                  <span className="font-mono">{formatFileSize(data.size)}</span>
                )}
                {data?.page_count && (
                  <>
                    <span>•</span>
                    <span className="font-medium text-indigo-600 dark:text-indigo-400">
                      共 {data.page_count} 页
                    </span>
                  </>
                )}
                {data?.metadata?.width && data?.metadata?.height && (
                  <>
                    <span>•</span>
                    <span className="font-mono">
                      {data.metadata.width} × {data.metadata.height} px
                    </span>
                  </>
                )}
                {data?.modified && (
                  <>
                    <span>•</span>
                    <span>{formatDate(data.modified)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick Action Buttons on top right */}
          <div className="flex items-center space-x-2 shrink-0">
            {/* macOS QuickLook */}
            <button
              type="button"
              onClick={() => api.quickLookFile(path)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs transition-colors shadow-sm shadow-indigo-500/20 cursor-pointer"
              title="按空格键快速查看"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>快速查看</span>
              <kbd className="text-[10px] bg-white/20 px-1 rounded font-mono">空格</kbd>
            </button>

            {/* Open with default app */}
            <button
              type="button"
              onClick={() => api.openFilePath(path)}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-medium text-xs transition-colors cursor-pointer"
              title="在默认应用中打开"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>打开</span>
            </button>

            {/* Reveal in Finder */}
            <button
              type="button"
              onClick={() => api.revealInFinder(path)}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-medium text-xs transition-colors cursor-pointer"
              title="在文件夹中显示"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>在文件夹中显示</span>
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ml-1 cursor-pointer"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. Word / Multi-tab Header (if Word document) */}
        {isWord && (data?.html_content || data?.text_content) && (
          <div className="shrink-0 px-5 py-2 border-b border-slate-200/80 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900 flex items-center space-x-2 text-xs">
            <button
              onClick={() => setActiveTab('view')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                activeTab === 'view'
                  ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-2xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              排版预览 {data?.page_count ? `(${data.page_count} 页)` : ''}
            </button>
            {data?.text_content && (
              <button
                onClick={() => setActiveTab('text')}
                className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  activeTab === 'text'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-2xs font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                提取文本 ({data.metadata?.character_count || 0} 字)
              </button>
            )}
            <button
              onClick={() => setActiveTab('meta')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                activeTab === 'meta'
                  ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-2xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              属性信息
            </button>
          </div>
        )}

        {/* 3. Main Body Preview Canvas */}
        <div className="flex-1 overflow-hidden relative flex flex-col bg-slate-100/40 dark:bg-slate-950/40">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-3">
              <LoadingState
                label="正在加载预览..."
                sublabel="正在解析排版与文本内容"
                color="indigo"
              />
            </div>
          ) : errorMessage ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto space-y-3">
              <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-500">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                加载预览失败
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {errorMessage}
              </p>
              <div className="flex items-center space-x-2 pt-2">
                <button
                  onClick={() => loadPreview(path)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium text-xs hover:bg-indigo-700 cursor-pointer"
                >
                  重试
                </button>
                <button
                  onClick={() => api.quickLookFile(path)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium text-xs hover:bg-slate-50 cursor-pointer"
                >
                  快速查看
                </button>
              </div>
            </div>
          ) : isPdf ? (
            /* PDF Preview View */
            <div className="h-full w-full flex flex-col relative">
              {data?.data_url ? (
                <iframe
                  src={data.data_url}
                  title={data.name}
                  className="w-full h-full border-0 rounded-b-none bg-slate-50 dark:bg-slate-900"
                />
              ) : data?.thumbnail_url ? (
                <div className="h-full w-full overflow-y-auto flex flex-col items-center p-6 space-y-4">
                  <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <img
                      src={data.thumbnail_url}
                      alt={data.name}
                      className="w-full h-auto object-contain"
                    />
                  </div>
                  <div className="text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    <p className="font-medium">
                      已生成首页预览，共 {data.page_count} 页
                    </p>
                    <p className="text-[11px]">
                      按空格键可使用系统快速查看全篇
                    </p>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
                  <FileText className="w-12 h-12 text-indigo-400 stroke-1" />
                  <p className="text-xs text-slate-500">
                    共 {data?.page_count || 0} 页
                  </p>
                  <button
                    onClick={() => api.quickLookFile(path)}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs shadow-sm cursor-pointer"
                  >
                    快速查看
                  </button>
                </div>
              )}
            </div>
          ) : isImage ? (
            /* Image Preview View */
            <div className="h-full w-full flex flex-col items-center justify-center p-4 relative overflow-hidden">
              {/* Image Controls toolbar */}
              <div className="absolute top-3 right-4 z-10 flex items-center space-x-1.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-2.5 py-1 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-sm text-xs">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(30, z - 25))}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                  title="缩小"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 w-10 text-center font-semibold">
                  {zoom}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(300, z + 25))}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                  title="放大"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(100)}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                  title="重置缩放"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Scalable Image Canvas */}
              <div className="h-full w-full overflow-auto flex items-center justify-center p-4">
                {data?.data_url || data?.thumbnail_url ? (
                  <img
                    src={data.data_url || data.thumbnail_url}
                    alt={data.name}
                    style={{
                      transform: `scale(${zoom / 100})`,
                      transition: 'transform 120ms ease-out',
                    }}
                    className="max-h-full max-w-full object-contain rounded-lg shadow-md border border-slate-200/60 dark:border-slate-800"
                  />
                ) : (
                  <div className="text-slate-400 text-xs">无法加载图片</div>
                )}
              </div>
            </div>
          ) : isWord ? (
            /* Word Document Preview View */
            <div className="h-full w-full relative flex flex-col overflow-hidden">
              {activeTab === 'view' && (
                data?.html_content ? (
                  <div className="w-full h-full relative">
                    <iframe
                      sandbox=""
                      referrerPolicy="no-referrer"
                      srcDoc={data.html_content}
                      title={data.name}
                      className="w-full h-full border-0 bg-slate-100/50 dark:bg-slate-950"
                    />
                  </div>
                ) : data?.data_url && data.data_url.startsWith('data:text/html') ? (
                  <div className="w-full h-full relative">
                    <iframe
                      sandbox=""
                      referrerPolicy="no-referrer"
                      src={data.data_url}
                      title={data.name}
                      className="w-full h-full border-0 bg-slate-100/50 dark:bg-slate-950"
                    />
                  </div>
                ) : data?.thumbnail_url ? (
                  <div className="h-full w-full overflow-y-auto p-6 flex flex-col items-center space-y-4">
                    <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <img
                        src={data.thumbnail_url}
                        alt={data.name}
                        className="w-full h-auto object-contain"
                      />
                    </div>
                    <div className="text-center text-xs text-slate-500 dark:text-slate-400 max-w-md space-y-1">
                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                        已生成文档缩略图
                      </p>
                      <p className="text-[11px]">
                        按空格键可使用系统快速查看全篇
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs p-6">
                    <FileText className="w-10 h-10 text-slate-300 dark:text-slate-700 stroke-1 mb-2" />
                    <span>正在准备文档视图...</span>
                  </div>
                )
              )}

              {activeTab === 'text' && (
                <div className="h-full w-full overflow-y-auto p-6">
                  <div className="max-w-3xl mx-auto space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>
                        提取文本（{data?.metadata?.paragraph_count || 0} 段落，
                        {data?.metadata?.word_count || 0} 词，{data?.metadata?.character_count || 0} 字符）
                      </span>
                      <button
                        onClick={() => {
                          if (data?.text_content) {
                            navigator.clipboard.writeText(data.text_content);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }
                        }}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center space-x-1 cursor-pointer"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? '已复制' : '复制文本'}</span>
                      </button>
                    </div>

                    <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs font-sans text-xs leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap select-text">
                      {data?.text_content || '未提取到文本'}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'meta' && (
                <div className="h-full w-full overflow-y-auto p-6">
                  <div className="max-w-lg mx-auto bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
                      文档元数据
                    </h4>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                      <div className="py-2 flex justify-between">
                        <span className="text-slate-400">预估页数:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {data?.page_count ? `${data.page_count} 页` : '流式排版'}
                        </span>
                      </div>
                      <div className="py-2 flex justify-between">
                        <span className="text-slate-400">段落数量:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {data?.metadata?.paragraph_count || 0}
                        </span>
                      </div>
                      <div className="py-2 flex justify-between">
                        <span className="text-slate-400">字符总数:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {data?.metadata?.character_count || 0} 字符
                        </span>
                      </div>
                      <div className="py-2 flex justify-between">
                        <span className="text-slate-400">词汇数量:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {data?.metadata?.word_count || 0} 词
                        </span>
                      </div>
                      <div className="py-2 flex justify-between">
                        <span className="text-slate-400">文件大小:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300 font-mono">
                          {data?.size ? formatFileSize(data.size) : '未知'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Fallback generic view */
            <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
              <FileText className="w-12 h-12 text-slate-300 dark:text-slate-700 stroke-1" />
              <div className="text-xs text-slate-600 dark:text-slate-400">
                <p className="font-semibold">{data?.name}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  支持使用系统原生应用或快速查看
                </p>
              </div>
              <button
                onClick={() => api.quickLookFile(path)}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 text-white font-medium text-xs hover:bg-indigo-700 shadow-sm cursor-pointer"
              >
                快速查看 (空格)
              </button>
            </div>
          )}
        </div>

        {/* 4. Modal Footer Bar */}
        <div className="shrink-0 px-5 py-2.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center space-x-2 min-w-0 flex-1 mr-3">
            <span className="text-slate-400 shrink-0">路径:</span>
            <span
              className="font-mono text-slate-600 dark:text-slate-300 truncate select-text"
              title={path}
            >
              {path}
            </span>
            <button
              type="button"
              onClick={handleCopyPath}
              className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
              title="复制路径"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>

          <div className="flex items-center space-x-3 shrink-0 text-[11px]">
            <span className="hidden sm:inline text-slate-400">
              快捷键: <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[10px]">空格</kbd> 快速查看 · <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[10px]">Esc</kbd> 关闭
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium text-xs transition-colors cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
