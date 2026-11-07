import { getPathBasename } from '../utils/format';
import React, { useState, useEffect } from 'react';
import {
  Minimize2,
  FileText,
  Upload,
  CheckCircle2,
  RefreshCw,
  Sliders,
  Zap,
  Eye,
} from 'lucide-react';
import { api } from '../services/api';
import { CompressResult, IntegrationStatus } from '../types';
import { formatFileSize, generateDefaultOutputPath } from '../utils/format';
import { OperationStatusBanner } from './common/OperationStatusBanner';
import { DocumentPreviewModal } from './common/DocumentPreviewModal';

interface CompressViewProps {
  initialFile?: string;
  integrationStatus: IntegrationStatus | null;
}

export const CompressView: React.FC<CompressViewProps> = ({
  initialFile,
  integrationStatus,
}) => {
  const [inputPath, setInputPath] = useState(initialFile || '');
  const [inputSize, setInputSize] = useState<number | null>(null);
  const [outputPath, setOutputPath] = useState('');

  // Compression presets: 'recommended' | 'high' | 'extreme' | 'custom'
  const [preset, setPreset] = useState<'recommended' | 'high' | 'extreme' | 'custom'>('recommended');
  const [maxDpi, setMaxDpi] = useState<number>(150);
  const [quality, setQuality] = useState<number>(75);
  const [stripMetadata, setStripMetadata] = useState<boolean>(true);
  const [useAdvancedEngine, setUseAdvancedEngine] = useState<boolean>(true);

  const [isCompressing, setIsCompressing] = useState(false);
  const [result, setResult] = useState<CompressResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  // When initialFile changes or is set
  useEffect(() => {
    if (initialFile) {
      handleSelectFile(initialFile);
    }
  }, [initialFile]);

  const handleSelectFile = async (path: string) => {
    setInputPath(path);
    setOutputPath(generateDefaultOutputPath(path, 'compressed'));
    setResult(null);
    setErrorMessage(null);
    try {
      const meta = await api.getFileInfo(path);
      setInputSize(meta.size);
    } catch {
      setInputSize(null);
    }
  };

  // Update preset parameters
  const selectPreset = (type: 'recommended' | 'high' | 'extreme' | 'custom') => {
    setPreset(type);
    if (type === 'recommended') {
      setMaxDpi(150);
      setQuality(75);
    } else if (type === 'high') {
      setMaxDpi(96);
      setQuality(60);
    } else if (type === 'extreme') {
      setMaxDpi(72);
      setQuality(45);
    }
  };

  const handleCompress = async () => {
    if (!inputPath.trim()) {
      setErrorMessage('请选择需要压缩的 PDF 文件');
      return;
    }
    if (!outputPath.trim()) {
      setErrorMessage('请指定压缩后输出路径');
      return;
    }

    setIsCompressing(true);
    setErrorMessage(null);
    setResult(null);

    const startTime = Date.now();
    try {
      const res = await api.compressPdf({
        input_path: inputPath.trim(),
        output_path: outputPath.trim(),
        quality,
        max_dpi: maxDpi,
        strip_metadata: stripMetadata,
        use_advanced_engine: useAdvancedEngine && (integrationStatus?.ghostscript_available ?? false),
      });

      const elapsed = Date.now() - startTime;
      if (elapsed < 700) {
        await new Promise((resolve) => setTimeout(resolve, 700 - elapsed));
      }

      if (res.success) {
        setResult(res);
      } else {
        setErrorMessage(res.message || '压缩失败');
      }
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }
      setErrorMessage(typeof err === 'string' ? err : err?.message || '压缩失败');
    } finally {
      setIsCompressing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50/50 dark:bg-slate-950 overflow-y-auto">
      <div className="titlebar-nodrag max-w-3xl w-full mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center space-x-2">
            <Minimize2 className="w-5 h-5 text-emerald-500" />
            <span>PDF 压缩</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            在保留清晰度的同时减小 PDF 文件体积
          </p>
        </div>

        {/* File Input Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            待压缩 PDF 文件
          </label>

          {inputPath ? (
            <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 flex items-center justify-between">
              <div className="flex items-center space-x-3 min-w-0 flex-1 mr-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {getPathBasename(inputPath) || inputPath}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono truncate">{inputPath}</div>
                </div>
              </div>
              <div className="flex items-center space-x-3 shrink-0">
                {inputSize !== null && (
                  <div className="text-right">
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {formatFileSize(inputSize)}
                    </div>
                    <div className="text-[10px] text-slate-400">原文件大小</div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewPath(inputPath)}
                  className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-emerald-300/80 dark:border-emerald-700/80 bg-white/80 dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium text-xs transition-colors cursor-pointer"
                  title="预览原文件"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>预览原文件</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center text-xs text-slate-400 space-y-2">
              <Upload className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto stroke-1" />
              <div>
                <span className="font-medium text-slate-600 dark:text-slate-400">输入或粘贴 PDF 文件路径</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">支持拖拽或系统右键直接打开</span>
              </div>
            </div>
          )}

          <div>
            <input
              type="text"
              value={inputPath}
              onChange={(e) => handleSelectFile(e.target.value)}
              placeholder="输入或粘贴 PDF 文件路径"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 font-mono"
            />
          </div>
        </div>

        {/* Compression Presets */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              压缩等级预设
            </label>
            <span className="text-[11px] text-slate-400">推荐平衡清晰度与体积</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {/* Recommended */}
            <button
              onClick={() => selectPreset('recommended')}
              className={`p-3.5 rounded-xl border text-left transition-all relative ${
                preset === 'recommended'
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 ring-1 ring-emerald-500/20'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-white dark:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">标准压缩</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 font-medium">
                  150 DPI
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                保留良好清晰度，适合日常阅读与传阅
              </p>
            </button>

            {/* High */}
            <button
              onClick={() => selectPreset('high')}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                preset === 'high'
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 ring-1 ring-emerald-500/20'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-white dark:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">深度压缩</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-medium">
                  96 DPI
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                大幅缩小体积，适合移动端与邮件限制
              </p>
            </button>

            {/* Extreme */}
            <button
              onClick={() => selectPreset('extreme')}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                preset === 'extreme'
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 ring-1 ring-emerald-500/20'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-white dark:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">极限压缩</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 font-medium">
                  72 DPI
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                最大限度缩减体积，适合归档与节省空间
              </p>
            </button>
          </div>

          {/* Custom Settings Accordion */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <button
              onClick={() => selectPreset('custom')}
              className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center space-x-1.5 hover:text-emerald-600 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{preset === 'custom' ? '收起自定义参数' : '展开自定义参数'}</span>
            </button>

            {preset === 'custom' && (
              <div className="mt-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex justify-between text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      <span>分辨率上限:</span>
                      <span className="font-bold text-emerald-600">{maxDpi} DPI</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="300"
                      step="10"
                      value={maxDpi}
                      onChange={(e) => setMaxDpi(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      <span>图片质量:</span>
                      <span className="font-bold text-emerald-600">{quality}%</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="95"
                      step="5"
                      value={quality}
                      onChange={(e) => setQuality(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-4 pt-1 text-xs text-slate-600 dark:text-slate-300">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stripMetadata}
                      onChange={(e) => setStripMetadata(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>移除元数据与缩略图</span>
                  </label>

                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useAdvancedEngine}
                      onChange={(e) => setUseAdvancedEngine(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>优先使用 Ghostscript 引擎</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Output Setting */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-3">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            输出保存路径
          </label>
          <input
            type="text"
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            placeholder="/path/to/compressed.pdf"
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 font-mono"
          />
        </div>

        {/* Loading & Status feedback */}
        <OperationStatusBanner
          status={
            isCompressing ? 'loading' : errorMessage ? 'error' : result ? 'success' : 'idle'
          }
          loadingLabel="正在压缩 PDF..."
          loadingSublabel="正在优化图像分辨率与数据流"
          accentColor="emerald"
          pixelVariant="Drive"
          successTitle={`压缩完成，体积缩减 ${result?.reduction_percent.toFixed(1)}%`}
          successMessage={result?.message || '文档已保存'}
          outputPath={result?.output_path}
          errorTitle="压缩失败"
          errorMessage={errorMessage}
          onRetry={handleCompress}
          onPreview={setPreviewPath}
          onDismiss={() => {
            setErrorMessage(null);
            setResult(null);
          }}
        />

        {/* Compression Statistics Breakdown Card */}
        {result && (
          <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-2xl p-5 space-y-4 animate-pop-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-emerald-700 dark:text-emerald-300 font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span>压缩结果</span>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500 text-white font-bold text-xs shadow-xs">
                缩减 {result.reduction_percent.toFixed(1)}%
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 bg-white/70 dark:bg-slate-900/70 p-3 rounded-xl border border-emerald-200/50 dark:border-emerald-800/50 text-center">
              <div>
                <div className="text-[11px] text-slate-400">压缩前</div>
                <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {formatFileSize(result.original_size)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">压缩后</div>
                <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {formatFileSize(result.compressed_size)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">节省空间</div>
                <div className="text-sm font-bold text-teal-600 dark:text-teal-400">
                  {formatFileSize(result.original_size - result.compressed_size)}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-emerald-200/50 dark:border-emerald-800/50 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 font-mono truncate mr-2">{result.output_path}</span>
              <button
                type="button"
                onClick={() => setPreviewPath(result.output_path)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs shadow-2xs transition-colors shrink-0 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>预览文件</span>
              </button>
            </div>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleCompress}
          disabled={isCompressing || !inputPath.trim()}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-40 text-white font-medium text-xs shadow-md shadow-emerald-500/20 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {isCompressing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>正在压缩...</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              <span>开始压缩</span>
            </>
          )}
        </button>
      </div>

      {/* Document Preview Modal */}
      <DocumentPreviewModal
        path={previewPath}
        onClose={() => setPreviewPath(null)}
      />
    </div>
  );
};
