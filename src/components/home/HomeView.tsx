import React, { useState } from 'react';
import {
  ArrowRight,
  Calculator,
  Copy,
  ExternalLink,
  LayoutGrid,
  ScanLine,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SuiteConfig, SuiteId, ActiveTabId, getEnabledSuites } from '../../suites';
import { ONLINE_MODULES, OnlineModule } from '../../suites/online';
import { isTauriEnvironment } from '../../services/api';

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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copySearchName = async (item: Extract<OnlineModule, { kind: 'wechat' }>) => {
    try {
      await navigator.clipboard.writeText(item.searchName);
    } catch {
      const input = document.createElement('textarea');
      input.value = item.searchName;
      input.setAttribute('readonly', '');
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopiedId(item.id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === item.id ? null : current));
    }, 1500);
  };

  const openLink = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    if (!isTauriEnvironment()) return;
    event.preventDefault();
    void openUrl(url);
  };

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
              my-tools
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
                    {suite.id === 'cleaner' && '目录占用、微信与 QQ 清理、缓存与系统瘦身'}
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
        </div>

        <section className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="px-4 pt-3 pb-1 text-[11px] font-medium text-slate-400">在线</div>
          <ul>
            {ONLINE_MODULES.map((item) => {
              const Icon = item.kind === 'wechat' ? ScanLine : Calculator;
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-100 dark:border-slate-800"
                >
                  <Icon className="w-4 h-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                      {item.name}
                      {item.kind === 'wechat' && (
                        <span className="ml-1.5 text-[11px] font-normal text-slate-400">小程序</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {item.kind === 'wechat' ? `微信搜索「${item.searchName}」` : item.url.replace(/^https:\/\//, '')}
                    </div>
                  </div>
                  {item.kind === 'wechat' ? (
                    <button
                      type="button"
                      onClick={() => void copySearchName(item)}
                      className="titlebar-nodrag shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedId === item.id ? '已复制' : '复制'}
                    </button>
                  ) : (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => openLink(event, item.url)}
                      className="titlebar-nodrag shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                      <ExternalLink className="w-3 h-3" />
                      打开
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
};
