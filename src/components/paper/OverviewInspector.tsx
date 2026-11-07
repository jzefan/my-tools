import React, { useState } from 'react';
import { overviewMarkdown } from '../../utils/paperReader';
import { OverviewRecord, OverviewSection } from '../../types/paper';
import { Sparkles, RefreshCw, BookmarkCheck, ArrowRight, Copy, Check } from 'lucide-react';

interface OverviewInspectorProps {
  overview: OverviewRecord | null;
  locationUnit?: '页' | '段';
  isLoading: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  preview?: ReturnType<typeof import('../../utils/paperAiPreview').paperAiPreview>;
  onJumpToPage: (pageNo: number, quote?: string) => void;
}

export const OverviewInspector: React.FC<OverviewInspectorProps> = ({
  overview,
  locationUnit = '页',
  isLoading,
  onGenerate,
  onCancel,
  preview,
  onJumpToPage,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyMarkdown = () => {
    if (!overview) return;
    const md = `# ${overview.title}\n\n${overviewMarkdown(overview, locationUnit)}`;
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/40 dark:bg-slate-900/40">
      {/* Top Header */}
      <div className="p-3 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-950">
        <div className="flex items-center space-x-1.5">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
            学术导读
          </span>
        </div>

        <div className="flex items-center space-x-1">
          {overview && (
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              title="复制"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}

          <button
            type="button"
            onClick={isLoading ? onCancel : onGenerate}
            disabled={false}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-300 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? '停止' : overview ? '重新生成' : '开始分析'}</span>
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {preview && <p className="text-[11px] text-slate-400" title={`参考价格：${preview.pricingAsOf}，最多输出 ${preview.maximumOutputTokens} tokens`}>约 {preview.tokens} tokens{preview.estimatedMaximumUsd !== undefined ? ` · 约 $${preview.estimatedMaximumUsd.toFixed(3)}` : ''}</p>}
        {overview?.rejectedCount ? <p className="text-[11px] text-slate-500">已排除 {overview.rejectedCount} 条无原文证据的作者陈述</p> : null}
        {isLoading ? (
          <div className="h-64 flex flex-col items-center justify-center text-xs text-slate-400 space-y-2">
            <RefreshCw className="w-5 h-5 text-indigo-500 animate-spin" />
            <span>正在生成导读...</span>
          </div>
        ) : !overview ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <Sparkles className="w-8 h-8 text-slate-300 dark:text-slate-600 stroke-1" />
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              暂无导读
            </div>
            <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
              点击开始分析，提炼研究问题、方法与结论。
            </p>
            <button
              type="button"
              onClick={onGenerate}
              className="mt-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-xs cursor-pointer"
            >
              生成导读
            </button>
          </div>
        ) : (
          overview.sections.map((sec: OverviewSection) => {
            const categoryBadge =
              sec.category === 'author_claim'
                ? { label: '作者陈述', color: 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800' }
                : sec.category === 'model_synthesis'
                ? { label: '模型归纳', color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' }
                : { label: '评论分析', color: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800' };

            return (
              <div
                key={sec.key}
                className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-2 shadow-2xs hover:border-indigo-200 dark:hover:border-indigo-900 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                    <BookmarkCheck className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{sec.label}</span>
                  </div>
                  {(!sec.claims || sec.claims.length <= 1) && <span className={`text-[10px] px-1.5 py-0.2 rounded border font-medium ${categoryBadge.color}`}>
                    {categoryBadge.label}
                  </span>}
                </div>

                {sec.claims?.length ? sec.claims.map((claim, index) => <div key={index} className="text-xs leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-300"><small className="text-slate-400">{claim.category === 'author_claim' ? '作者陈述' : claim.category === 'model_synthesis' ? '模型归纳' : '评论分析'}</small><p>{claim.content}</p></div>) : <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{sec.content}</p>}

                {/* Evidence Anchor Tags */}
                {sec.evidence && sec.evidence.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1">
                    <div className="text-[10px] font-semibold text-slate-400 flex items-center space-x-1">
                      <span>原文证据:</span>
                    </div>
                    {sec.evidence.map((ev, evIdx) => (
                      <button
                        key={evIdx}
                        type="button"
                        onClick={() => onJumpToPage(ev.pageNo, ev.quote)}
                        className="w-full text-left p-1.5 rounded-lg bg-indigo-50/50 hover:bg-indigo-50 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/30 text-[11px] text-slate-600 dark:text-slate-300 flex items-start justify-between group transition-colors cursor-pointer"
                        title="跳转到该页"
                      >
                        <div className="flex items-center space-x-1 min-w-0 flex-1 mr-1">
                          <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
                            [第 {ev.pageNo} {locationUnit}]
                          </span>
                          <span className="truncate italic text-slate-500 dark:text-slate-400">
                            "{ev.quote}"
                          </span>
                        </div>
                        <ArrowRight className="w-3 h-3 text-indigo-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
