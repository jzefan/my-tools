import React, { useState, useEffect } from 'react';
import {
  Minimize2,
  FileText,
  Upload,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Sliders,
  Zap,
} from 'lucide-react';
import { api } from '../services/api';
import { CompressResult, IntegrationStatus } from '../types';
import { formatFileSize, generateDefaultOutputPath } from '../utils/format';

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

    try {
      const res = await api.compressPdf({
        input_path: inputPath.trim(),
        output_path: outputPath.trim(),
        quality,
        max_dpi: maxDpi,
        strip_metadata: stripMetadata,
        use_advanced_engine: useAdvancedEngine && (integrationStatus?.ghostscript_available ?? false),
      });
      setResult(res);
    } catch (err: any) {
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
            <span>PDF 智能压缩</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            采用智能图像重采样与流压缩技术，在保留最佳视觉清晰度的同时大幅降低 PDF 文件体积
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
                    {inputPath.split('/').pop() || inputPath}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono truncate">{inputPath}</div>
                </div>
              </div>
              {inputSize !== null && (
                <div className="text-right shrink-0">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {formatFileSize(inputSize)}
                  </div>
                  <div className="text-[10px] text-slate-400">原始体积</div>
                </div>
              )}
            </div>
          ) : (
            <div className="border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center text-xs text-slate-400 space-y-2">
              <Upload className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto stroke-1" />
              <div>
                <span className="font-medium text-slate-600 dark:text-slate-400">点击下方输入框粘贴路径</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">或通过访达右键点击 PDF 直接唤起</span>
              </div>
            </div>
          )}

          <div>
            <input
              type="text"
              value={inputPath}
              onChange={(e) => handleSelectFile(e.target.value)}
              placeholder="输入或粘贴文件绝对路径，例如 /Users/jzefan/sample.pdf"
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
            <span className="text-[11px] text-slate-400">推荐平衡画质与体积</span>
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
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">推荐压缩</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 font-medium">
                  150 DPI
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                保留最佳清晰度，适合日常办公、阅读与邮件附件
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
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">便携高压缩</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-medium">
                  96 DPI
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                大幅缩小体积，适合网页浏览、手机端阅读与限制上传
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
                最大限度缩减字节，仅供预览或存档节省磁盘空间
              </p>
            </button>
          </div>

          {/* Custom Settings Accordion */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <button
              onClick={() => selectPreset('custom')}
              className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center space-x-1.5 hover:text-emerald-600"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{preset === 'custom' ? '自定义压缩参数 (已激活)' : '展开自定义参数调节'}</span>
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
                      <span>JPEG 画质因子:</span>
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
                    <span>清除冗余元数据与缩略图</span>
                  </label>

                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useAdvancedEngine}
                      onChange={(e) => setUseAdvancedEngine(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>优先使用 Ghostscript 专业引擎</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Output Setting */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-3">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            压缩后输出目标路径
          </label>
          <input
            type="text"
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            placeholder="/path/to/compressed.pdf"
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 font-mono"
          />
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Compression Result Card */}
        {result && (
          <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-emerald-700 dark:text-emerald-300 font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span>压缩成功！</span>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500 text-white font-bold text-xs shadow-xs">
                缩减了 {result.reduction_percent.toFixed(1)}%
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

            <div className="flex justify-end space-x-2">
              <button
                onClick={() => api.revealInFinder(result.output_path)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs flex items-center space-x-1.5 shadow-2xs"
              >
                <span>在访达定位</span>
                <ExternalLink className="w-3.5 h-3.5" />
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
              <span>正在高效压缩中...</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              <span>开始压缩 PDF</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
