import React, { useEffect, useRef, useState } from 'react';
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
  tabs?: React.ReactNode;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onEnterSuite,
  openSuiteIds = [],
  compact = false,
  tabs,
}) => {
  const enabledSuites = getEnabledSuites();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrHoverId, setQrHoverId] = useState<string | null>(null);
  const [qrOpenId, setQrOpenId] = useState<string | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!qrOpenId) return;
    const onPointer = (event: MouseEvent) => {
      if (!qrRef.current?.contains(event.target as Node)) setQrOpenId(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQrOpenId(null);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [qrOpenId]);

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
        className={`titlebar-drag shrink-0 border-b border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md ${
          tabs
            ? 'sticky top-0 z-30 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end pt-7'
            : `flex items-center justify-between ${compact ? 'py-3 px-6' : 'pt-8 pb-3.5 pl-20 pr-6'}`
        }`}
      >
        <div className={`flex items-center min-w-0 ${tabs ? 'gap-2.5 pl-20 pb-2' : 'space-x-3'}`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <LayoutGrid className="w-4 h-4" />
          </div>
          <div className="flex items-center space-x-2 min-w-0">
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
              my-tools
            </h1>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              Pro
            </span>
          </div>
        </div>

        {tabs ? (
          <div className="flex justify-center min-w-0">{tabs}</div>
        ) : null}

        <div className={`flex items-center text-xs text-slate-400 font-mono ${tabs ? 'justify-end pr-4 pb-2' : 'space-x-2'}`}>
          <span>已启用 {enabledSuites.length} 个功能模块</span>
        </div>
      </div>

      {/* Main Suite Cards Grid */}
      <div className="w-full mx-auto px-5 pt-5 pb-6 flex-1">
        <div className="grid grid-cols-4 gap-3">
          {enabledSuites.map((suite: SuiteConfig) => {
            const Icon = suite.icon;
            const subItems = suite.subItems || [];

            return (
              <div
                key={suite.id}
                onClick={() => onEnterSuite(suite.id)}
                className="group relative flex min-h-[152px] flex-col justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors duration-200 cursor-pointer overflow-hidden"
              >
                <div>
                  <div className="flex items-start gap-2 mb-2.5">
                    <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {suite.name}
                        </h2>
                        {openSuiteIds.includes(suite.id) ? (
                          <span className="shrink-0 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
                            已打开
                          </span>
                        ) : (
                          <ArrowRight className="w-3.5 h-3.5 shrink-0 text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed line-clamp-2">
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
                  <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="flex flex-wrap gap-1">
                      {subItems.slice(0, 4).map((sub) => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEnterSuite(suite.id, sub.id);
                          }}
                          className="titlebar-nodrag px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
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
                    <div className="shrink-0 flex items-center gap-3">
                      {item.qrSrc && (
                        <div
                          ref={qrRef}
                          className="relative"
                          onMouseEnter={() => setQrHoverId(item.id)}
                          onMouseLeave={() => setQrHoverId(null)}
                        >
                          <button
                            type="button"
                            title="扫码"
                            aria-label={`${item.name}小程序码`}
                            onClick={() => setQrOpenId((current) => (current === item.id ? null : item.id))}
                            className="titlebar-nodrag block rounded-md bg-white p-0.5 cursor-pointer"
                          >
                            <img src={item.qrSrc} alt="" className="h-9 w-9" />
                          </button>
                          {(qrHoverId === item.id || qrOpenId === item.id) && (
                            <div className="absolute right-0 bottom-full z-40 mb-1.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                              <img src={item.qrSrc} alt={`${item.name}小程序码`} className="block h-48 w-48 max-w-none" />
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void copySearchName(item)}
                        className="titlebar-nodrag inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedId === item.id ? '已复制' : '复制'}
                      </button>
                    </div>
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
