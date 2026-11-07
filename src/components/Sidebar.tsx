import React from 'react';
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { IntegrationStatus } from '../types';
import {
  SuiteId,
  ActiveTabId,
  getEnabledSuites,
  SuiteConfig,
} from '../suites';

interface SidebarProps {
  activeSuite: SuiteId;
  activeTab: ActiveTabId;
  setActiveTab: (tab: any) => void;
  integrationStatus: IntegrationStatus | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  flushTop?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSuite,
  activeTab,
  setActiveTab,
  integrationStatus,
  isCollapsed,
  onToggleCollapse,
  flushTop = false,
}) => {
  const enabledSuites = getEnabledSuites();
  const currentSuite: SuiteConfig =
    enabledSuites.find((s) => s.id === activeSuite) || enabledSuites[0];

  const subItems = currentSuite.subItems || [];

  return (
    <aside
      className={`flex flex-col h-full overflow-hidden bg-slate-50/80 dark:bg-slate-900/80 border-r border-slate-200/80 dark:border-slate-800 backdrop-blur-xl select-none shrink-0 transition-all duration-200 ${
        isCollapsed ? 'w-16 items-center' : 'w-64'
      }`}
    >
      {/* macOS window drag area & header */}
      <div
        className={`titlebar-drag ${flushTop ? 'pt-3' : 'pt-8'} pb-3 flex items-center shrink-0 ${
          isCollapsed ? 'px-2 justify-center' : 'px-4 justify-between space-x-2.5'
        }`}
      >
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-1.5">
                <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm tracking-tight truncate">
                  {enabledSuites.length === 1 && enabledSuites[0].id === 'paper'
                    ? 'PaperDesk'
                    : enabledSuites.length === 1 && enabledSuites[0].id === 'cleaner'
                    ? 'Cleaner'
                    : enabledSuites.length === 1 && enabledSuites[0].id === 'media'
                    ? 'MediaDesk'
                    : '工作台'}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
                  Pro
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                {enabledSuites.length > 1 ? currentSuite.name : '生产力工具集'}
              </p>
            </div>
          )}
        </div>

        {/* Toggle Collapse Button */}
        <button
          type="button"
          onClick={onToggleCollapse}
          title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Navigation Submenu */}
      <nav
        className={`flex-1 min-h-0 py-2 space-y-1 overflow-y-auto w-full ${
          isCollapsed ? 'px-1.5' : 'px-3'
        }`}
      >
        {!isCollapsed && (
          <div className="text-[10px] uppercase font-semibold text-slate-400 dark:text-slate-500 px-2 py-1 tracking-wider">
            {currentSuite.name}
          </div>
        )}
        {subItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeTab === item.id ||
            (currentSuite.id === 'paper' && activeTab === 'paper' && item.id === 'paper_library');

          if (isCollapsed) {
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                title={`${item.label} - ${item.sublabel}`}
                className={`w-full py-2.5 rounded-xl border transition-all flex items-center justify-center group cursor-pointer relative ${
                  isActive
                    ? `${item.activeBg} shadow-sm font-medium`
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? item.color : 'text-slate-500'}`} />
                {item.id === 'system' && integrationStatus?.macos_service_installed && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
                )}
              </button>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all flex items-center space-x-3 group cursor-pointer ${
                isActive
                  ? `${item.activeBg} shadow-sm font-medium`
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div
                className={`p-1.5 rounded-lg transition-colors shrink-0 ${
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
                <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                  {item.sublabel}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Bottom Integration Status Card (Shown under Document Tools when expanded) */}
      {!isCollapsed && currentSuite.id === 'docs' && (
        <div className="p-3 border-t border-slate-200/80 dark:border-slate-800 w-full">
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
                ? '右键文件快速处理'
                : '在访达右键中直接使用'}
            </p>
            {!integrationStatus?.macos_service_installed && (
              <button
                type="button"
                onClick={() => setActiveTab('system')}
                className="mt-2 w-full py-1 px-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-medium transition-colors text-center shadow-xs cursor-pointer"
              >
                前往配置
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
