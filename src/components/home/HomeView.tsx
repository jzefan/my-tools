import React from 'react';
import {
  ArrowRight,
  LayoutGrid,
  PlusCircle,
} from 'lucide-react';
import { SuiteConfig, SuiteId, ActiveTabId, getEnabledSuites } from '../../suites';

interface HomeViewProps {
  onEnterSuite: (suiteId: SuiteId, initialTab?: ActiveTabId) => void;
  openSuiteIds?: SuiteId[];
  compact?: boolean;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onEnterSuite,
  openSuiteIds = [],
  compact = false,
}) => {
  const enabledSuites = getEnabledSuites();

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 select-none">
      {/* Top Header & Window Drag Area with safe-area for macOS traffic lights */}
      <div
        className={`titlebar-drag flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md shrink-0 ${
          compact ? 'py-3 px-6' : 'pt-8 pb-3.5 pl-20 pr-6'
        }`}
      >
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <LayoutGrid className="w-4 h-4" />
          </div>
          <div className="flex items-center space-x-2">
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
              工作台
            </h1>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              Pro
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-400 font-mono">
          <span>已启用 {enabledSuites.length} 个功能模块</span>
        </div>
      </div>

      {/* Main Suite Cards Grid */}
      <div className="max-w-5xl w-full mx-auto p-8 flex-1 flex flex-col justify-center">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {enabledSuites.map((suite: SuiteConfig) => {
            const Icon = suite.icon;
            const subItems = suite.subItems || [];

            return (
              <div
                key={suite.id}
                onClick={() => onEnterSuite(suite.id)}
                className="group relative flex flex-col justify-between p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all duration-200 cursor-pointer overflow-hidden"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-xl bg-indigo-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 group-hover:scale-105 transition-transform">
                      <Icon className="w-6 h-6" />
                    </div>
                    {openSuiteIds.includes(suite.id) ? (
                      <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                        已打开
                      </span>
                    ) : (
                      <span className="opacity-0 group-hover:opacity-100 text-indigo-600 dark:text-indigo-400 transition-opacity flex items-center text-xs font-medium">
                        进入模块
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </span>
                    )}
                  </div>

                  {/* Title & Short Description */}
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {suite.name}
                  </h2>
                  <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed mb-4">
                    {suite.id === 'docs' && 'PDF 与文档合并、格式转换、智能压缩及水印清除'}
                    {suite.id === 'paper' && '文献研读、全文高亮批注、AI 学术问答与手稿工作台'}
                    {suite.id === 'cleaner' && '目录占用、微信与 QQ 专清、缓存与系统瘦身'}
                    {suite.id === 'netdisk' && '百度、阿里、夸克等网盘资源搜索与收藏'}
                    {suite.id === 'typing' && '边打字边记英语单词'}
                    {suite.id === 'media' && '多平台短视频与图文一键分发、账号矩阵与互动管理'}
                  </p>
                </div>

                {/* Sub-item quick pills */}
                {subItems.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="flex flex-wrap gap-1.5">
                      {subItems.slice(0, 4).map((sub) => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEnterSuite(suite.id, sub.id);
                          }}
                          className="titlebar-nodrag px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                        >
                          {sub.label}
                        </button>
                      ))}
                      {subItems.length > 4 && (
                        <span className="px-1.5 py-1 text-[10px] text-slate-400">
                          +{subItems.length - 4}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Future Modules Slot Placeholder */}
          <div className="border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-center text-center text-slate-400 min-h-[200px] bg-slate-50/50 dark:bg-slate-900/30">
            <PlusCircle className="w-8 h-8 text-slate-300 dark:text-slate-700 mb-2 stroke-1" />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              更多工作台模块
            </span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              可继续扩展新功能套件
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
