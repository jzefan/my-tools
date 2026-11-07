import React, { useState } from 'react';
import { OutlineItem } from '../../types/paper';
import { ListTree, LayoutGrid } from 'lucide-react';

interface OutlineInspectorProps {
  totalPages: number;
  locationUnit?: '页' | '段';
  currentPage: number;
  outline: OutlineItem[];
  onJumpToPage: (pageNo: number) => void;
}

export const OutlineInspector: React.FC<OutlineInspectorProps> = ({
  totalPages,
  locationUnit = '页',
  currentPage,
  outline,
  onJumpToPage,
}) => {
  const [tab, setTab] = useState<'outline' | 'thumbnails'>('outline');

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/40 dark:bg-slate-900/40">
      {/* Switcher Tab */}
      <div className="p-2 border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between">
        <div className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200/70 dark:border-slate-700/60 w-full">
          <button
            type="button"
            onClick={() => setTab('outline')}
            className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all flex items-center justify-center space-x-1 cursor-pointer ${
              tab === 'outline'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <ListTree className="w-3.5 h-3.5" />
            <span>目录</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('thumbnails')}
            className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all flex items-center justify-center space-x-1 cursor-pointer ${
              tab === 'thumbnails'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>{locationUnit === '段' ? '段落' : '页码'}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'outline' ? (
          outline.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-center text-xs text-slate-400 space-y-1">
              <ListTree className="w-6 h-6 text-slate-300 dark:text-slate-600 stroke-1" />
              <div>无内置目录</div>
              <div className="text-[11px]">可按位置跳转</div>
            </div>
          ) : (
            <div className="space-y-1">
              {outline.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={item.pageNo === null}
                  onClick={() => { if (item.pageNo !== null) onJumpToPage(item.pageNo); }}
                  style={{ paddingLeft: `${item.level * 14 + 8}px` }}
                  className={`w-full text-left py-1.5 pr-2 rounded-lg text-xs transition-colors flex items-center justify-between group cursor-pointer ${
                    currentPage === item.pageNo
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate mr-2">{item.title}</span>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">
                    {item.pageNo}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onJumpToPage(p)}
                className={`p-2 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${
                  currentPage === p
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shadow-xs ring-1 ring-indigo-400'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-indigo-300'
                }`}
              >
                <span className="text-[10px] font-mono font-medium">第 {p} {locationUnit}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
