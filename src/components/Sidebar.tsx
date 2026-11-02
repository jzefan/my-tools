import React from 'react';
import { Layers, Minimize2, Sparkles, Settings, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { IntegrationStatus } from '../types';

interface SidebarProps {
  activeTab: 'merge' | 'compress' | 'watermark' | 'system';
  setActiveTab: (tab: 'merge' | 'compress' | 'watermark' | 'system') => void;
  integrationStatus: IntegrationStatus | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  integrationStatus,
}) => {
  const navItems = [
    {
      id: 'merge' as const,
      label: '合并文件',
      sublabel: 'PDF / 图片 / Word',
      icon: Layers,
      color: 'text-indigo-500',
      activeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    },
    {
      id: 'compress' as const,
      label: '压缩文档',
      sublabel: '智能缩减 PDF 体积',
      icon: Minimize2,
      color: 'text-emerald-500',
      activeBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    },
    {
      id: 'watermark' as const,
      label: '去除水印',
      sublabel: '清除文字与图层水印',
      icon: Sparkles,
      color: 'text-amber-500',
      activeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    },
    {
      id: 'system' as const,
      label: '系统右键集成',
      sublabel: '访达 / Windows 菜单',
      icon: Settings,
      color: 'text-slate-500',
      activeBg: 'bg-slate-100 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700',
    },
  ];

  return (
    <aside className="w-64 flex flex-col h-full bg-slate-50/80 dark:bg-slate-900/80 border-r border-slate-200/80 dark:border-slate-800 backdrop-blur-xl select-none">
      {/* macOS window drag area & header */}
      <div className="titlebar-drag pt-8 pb-4 px-4 flex items-center space-x-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
          <FileText className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center space-x-1.5">
            <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm tracking-tight">DocTools</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">Pro</span>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">PDF 生产力套件</p>
        </div>
      </div>

      {/* Navigation tabs */}
      <nav className="flex-1 px-3 py-3 space-y-1.5 overflow-y-auto">
        <div className="text-[10px] uppercase font-semibold text-slate-400 dark:text-slate-500 px-2 py-1 tracking-wider">
          功能模块
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all flex items-center space-x-3 group ${
                isActive
                  ? `${item.activeBg} shadow-sm font-medium`
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div
                className={`p-1.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-white dark:bg-slate-900 shadow-xs'
                    : 'bg-white/60 dark:bg-slate-800/60 group-hover:bg-white dark:group-hover:bg-slate-800'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? item.color : 'text-slate-500'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate flex items-center justify-between">
                  <span>{item.label}</span>
                  {item.id === 'system' && integrationStatus?.macos_service_installed && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
                  )}
                </div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{item.sublabel}</div>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Bottom Integration Status Card */}
      <div className="p-3 border-t border-slate-200/80 dark:border-slate-800">
        <div className="bg-white/70 dark:bg-slate-800/70 rounded-xl p-2.5 border border-slate-200/60 dark:border-slate-700/60 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            <span>访达右键快捷操作</span>
            {integrationStatus?.macos_service_installed ? (
              <span className="flex items-center text-emerald-600 dark:text-emerald-400 text-[10px]">
                <CheckCircle2 className="w-3 h-3 mr-0.5" /> 已启用
              </span>
            ) : (
              <span className="flex items-center text-amber-600 dark:text-amber-400 text-[10px]">
                <AlertCircle className="w-3 h-3 mr-0.5" /> 未安装
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
            {integrationStatus?.macos_service_installed
              ? '右键文件即可唤起 DocTools 快速合并或处理'
              : '一键将合并/压缩菜单嵌入 macOS 系统右键'}
          </p>
          {!integrationStatus?.macos_service_installed && (
            <button
              onClick={() => setActiveTab('system')}
              className="mt-2 w-full py-1 px-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-medium transition-colors text-center shadow-xs"
            >
              点击去安装
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
