import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Eye,
  FolderOpen,
  RotateCcw,
  X,
  FileCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { LoadingState, AccentColor, PixelGridVariant } from './LoadingState';
import { api } from '../../services/api';

export type OperationStatus = 'idle' | 'loading' | 'success' | 'error';

export interface OperationStatusBannerProps {
  status: OperationStatus;
  // Loading configurations
  loadingLabel?: string;
  loadingSublabel?: string;
  accentColor?: AccentColor;
  pixelVariant?: PixelGridVariant;

  // Success configurations
  successTitle?: string;
  successMessage?: string;
  outputPath?: string;
  successDetails?: Array<{ label: string; value: React.ReactNode }>;

  // Error configurations
  errorTitle?: string;
  errorMessage?: string | null;
  errorDetails?: string | null;

  // Actions & callbacks
  onRetry?: () => void;
  onDismiss?: () => void;
  onPreview?: (path: string) => void;

  className?: string;
  compact?: boolean;
}

export const OperationStatusBanner: React.FC<OperationStatusBannerProps> = ({
  status,
  loadingLabel = '处理中...',
  loadingSublabel,
  accentColor = 'indigo',
  pixelVariant = 'Drive',

  successTitle = '操作成功',
  successMessage,
  outputPath,
  successDetails,

  errorTitle = '操作失败',
  errorMessage,
  errorDetails,

  onRetry,
  onDismiss,
  onPreview,
  className = '',
  compact = false,
}) => {
  // Track elapsed time during loading, and freeze it on completion
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const startTimeRef = useRef<number | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState<boolean>(false);

  useEffect(() => {
    if (status === 'loading') {
      const now = Date.now();
      startTimeRef.current = now;
      setElapsedSeconds(0);
      const timer = setInterval(() => {
        if (startTimeRef.current) {
          const diff = (Date.now() - startTimeRef.current) / 1000;
          setElapsedSeconds(diff);
        }
      }, 100);
      return () => clearInterval(timer);
    } else if (startTimeRef.current) {
      const diff = (Date.now() - startTimeRef.current) / 1000;
      setElapsedSeconds(diff);
      startTimeRef.current = null;
    }
  }, [status]);

  if (status === 'idle') {
    return null;
  }

  const formatElapsed = (sec: number) => {
    if (sec < 60) return `${sec.toFixed(1)} 秒`;
    return `${Math.floor(sec / 60)} 分 ${(sec % 60).toFixed(1)} 秒`;
  };

  // 1. Loading State (Beautiful UI inspired pixel-grid + shimmer)
  if (status === 'loading') {
    return (
      <div
        className={`w-full rounded-xl border border-indigo-200/90 dark:border-indigo-900/80 bg-gradient-to-r from-indigo-50/80 via-white to-indigo-50/50 dark:from-indigo-950/50 dark:via-slate-900 dark:to-indigo-950/30 shadow-xs p-3.5 transition-all animate-pop-in ${className}`}
      >
        <div className="flex items-center justify-between gap-2">
          <LoadingState
            label={loadingLabel}
            sublabel={loadingSublabel}
            variant={pixelVariant}
            color={accentColor}
            size={compact ? 'sm' : 'md'}
            elapsedSeconds={elapsedSeconds}
          />

          <span className="text-[10px] uppercase font-mono tracking-wider font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 shrink-0 shadow-2xs">
            处理中
          </span>
        </div>
      </div>
    );
  }

  // 2. Success State
  if (status === 'success') {
    return (
      <div
        className={`w-full rounded-xl border border-emerald-200/90 dark:border-emerald-900/70 bg-gradient-to-br from-emerald-50/70 via-white to-emerald-50/40 dark:from-emerald-950/40 dark:via-slate-900 dark:to-emerald-950/20 p-3.5 text-xs text-slate-800 dark:text-slate-200 shadow-sm transition-all animate-pop-in space-y-2.5 ${className}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="p-1 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-emerald-800 dark:text-emerald-200">
                  {successTitle}
                </span>
                {elapsedSeconds > 0 && (
                  <span className="text-[10px] font-mono text-emerald-600/80 dark:text-emerald-400/80 bg-emerald-100/60 dark:bg-emerald-900/40 px-1.5 py-0.2 rounded-md tabular-nums">
                    用时 {formatElapsed(elapsedSeconds)}
                  </span>
                )}
              </div>
              {successMessage && (
                <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-normal">
                  {successMessage}
                </p>
              )}
            </div>
          </div>

          {onDismiss && (
            <button
              onClick={onDismiss}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded transition-colors"
              title="关闭"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Output path and quick action buttons */}
        {outputPath && (
          <div className="pt-2 border-t border-emerald-200/50 dark:border-emerald-900/40 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1 flex items-center space-x-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              <FileCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="truncate" title={outputPath}>
                {outputPath}
              </span>
            </div>

            <div className="flex items-center space-x-1.5 shrink-0">
              {onPreview && (
                <button
                  type="button"
                  onClick={() => onPreview(outputPath)}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-[11px] transition-colors shadow-2xs cursor-pointer"
                  title="预览"
                >
                  <Eye className="w-3 h-3" />
                  <span>预览</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => api.openFilePath(outputPath)}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md ${
                  onPreview
                    ? 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs'
                } font-medium text-[11px] transition-colors cursor-pointer`}
                title="打开"
              >
                <ExternalLink className="w-3 h-3" />
                <span>打开</span>
              </button>

              <button
                type="button"
                onClick={() => api.revealInFinder(outputPath)}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium text-[11px] transition-colors cursor-pointer"
                title="在文件夹中显示"
              >
                <FolderOpen className="w-3 h-3" />
                <span>在文件夹中显示</span>
              </button>
            </div>
          </div>
        )}

        {/* Additional custom details */}
        {successDetails && successDetails.length > 0 && (
          <div className="pt-2 border-t border-emerald-200/50 dark:border-emerald-900/40 grid grid-cols-2 gap-2 text-[11px]">
            {successDetails.map((item, idx) => (
              <div key={idx} className="flex items-center space-x-1">
                <span className="text-slate-400">{item.label}:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 3. Error State (Clear failure reason reporting)
  return (
    <div
      className={`w-full rounded-xl border border-rose-300/90 dark:border-rose-900/70 bg-gradient-to-br from-rose-50/80 via-white to-rose-50/50 dark:from-rose-950/40 dark:via-slate-900 dark:to-rose-950/20 p-3.5 text-xs shadow-sm transition-all animate-pop-in space-y-2.5 ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start space-x-2.5 min-w-0 flex-1">
          <div className="p-1 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-rose-800 dark:text-rose-200">
                {errorTitle}
              </span>
              {elapsedSeconds > 0 && (
                <span className="text-[10px] font-mono text-rose-600/80 dark:text-rose-400/80 bg-rose-100/60 dark:bg-rose-900/40 px-1.5 py-0.2 rounded-md tabular-nums">
                  耗时 {formatElapsed(elapsedSeconds)}
                </span>
              )}
            </div>

            {/* Prominent Failure Reason */}
            <div className="mt-1 p-2 rounded-lg bg-rose-100/60 dark:bg-rose-950/50 border border-rose-200/80 dark:border-rose-900/60">
              <span className="font-medium text-rose-900 dark:text-rose-200 text-xs block leading-relaxed break-words">
                {errorMessage || '操作未成功，请检查文件或重试'}
              </span>
            </div>
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded transition-colors shrink-0"
            title="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Expandable technical details (e.g. stack trace, CLI error) */}
      {errorDetails && (
        <div>
          <button
            type="button"
            onClick={() => setShowErrorDetails(!showErrorDetails)}
            className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline flex items-center space-x-1 font-medium cursor-pointer"
          >
            <span>{showErrorDetails ? '收起详情' : '查看详情'}</span>
            {showErrorDetails ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
          {showErrorDetails && (
            <pre className="mt-1.5 p-2 rounded-md bg-slate-900 text-slate-200 dark:bg-black/60 dark:text-slate-300 font-mono text-[10px] max-h-32 overflow-y-auto whitespace-pre-wrap break-all border border-slate-800">
              {errorDetails}
            </pre>
          )}
        </div>
      )}

      {/* Action / Retry */}
      {onRetry && (
        <div className="pt-2 border-t border-rose-200/50 dark:border-rose-900/40 flex justify-end">
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium text-[11px] transition-colors shadow-2xs cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>重试</span>
          </button>
        </div>
      )}
    </div>
  );
};
