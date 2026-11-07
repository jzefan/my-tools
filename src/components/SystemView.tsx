import React, { useState } from 'react';
import {
  Settings,
  CheckCircle2,
  AlertCircle,
  Download,
  Terminal,
  RefreshCw,
  Copy,
  Check,
  MousePointerClick,
  Sparkles,
} from 'lucide-react';
import { api } from '../services/api';
import { IntegrationStatus } from '../types';

interface SystemViewProps {
  status: IntegrationStatus | null;
  refreshStatus: () => void;
}

export const SystemView: React.FC<SystemViewProps> = ({ status, refreshStatus }) => {
  const [isInstalling, setIsInstalling] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedReg, setCopiedReg] = useState(false);
  const [windowsRegContent, setWindowsRegContent] = useState<string | null>(null);

  const handleInstallService = async () => {
    setIsInstalling(true);
    setMessage(null);
    try {
      const res = await api.installFinderService();
      setMessage(res);
      refreshStatus();
    } catch (err: any) {
      setMessage(`安装失败: ${typeof err === 'string' ? err : err?.message}`);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleUninstallService = async () => {
    setIsUninstalling(true);
    setMessage(null);
    try {
      const res = await api.uninstallFinderService();
      setMessage(res);
      refreshStatus();
    } catch (err: any) {
      setMessage(`卸载失败: ${typeof err === 'string' ? err : err?.message}`);
    } finally {
      setIsUninstalling(false);
    }
  };

  const handleShowWindowsReg = async () => {
    try {
      const reg = await api.getWindowsRegContent();
      setWindowsRegContent(reg);
    } catch (err) {
      setMessage(String(err));
    }
  };

  const copyRegToClipboard = () => {
    if (windowsRegContent) {
      navigator.clipboard.writeText(windowsRegContent);
      setCopiedReg(true);
      setTimeout(() => setCopiedReg(false), 2000);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50/50 dark:bg-slate-950 overflow-y-auto">
      <div className="titlebar-nodrag max-w-3xl w-full mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center space-x-2">
            <Settings className="w-5 h-5 text-indigo-500" />
            <span>系统集成</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            在系统右键菜单中快速调用 DocTools
          </p>
        </div>

        {/* macOS Finder Integration Card */}
        {status?.platform === 'macos' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <MousePointerClick className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  访达快捷操作
                </h3>
                <p className="text-xs text-slate-400">
                  在访达中选中文件右键即可快速打开
                </p>
              </div>
            </div>

            <div>
              {status?.macos_service_installed ? (
                <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-semibold text-xs flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>已启用</span>
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-semibold text-xs flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>未配置</span>
                </span>
              )}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-300 flex items-center space-x-2">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>安装后，在访达中选中文件，通过「快捷操作 &gt; DocTools」直接处理。</span>
          </div>

          {message && (
            <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs whitespace-pre-line leading-relaxed">
              {message}
            </div>
          )}

          <div className="flex items-center space-x-3 pt-1">
            <button
              onClick={handleInstallService}
              disabled={isInstalling}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium text-xs flex items-center space-x-2 transition-colors cursor-pointer shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isInstalling ? 'animate-spin' : ''}`} />
              <span>{status?.macos_service_installed ? '重新安装' : '安装服务'}</span>
            </button>

            {status?.macos_service_installed && (
              <button
                onClick={handleUninstallService}
                disabled={isUninstalling}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-300 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-400 font-medium text-xs transition-colors cursor-pointer"
              >
                {isUninstalling ? '正在卸载...' : '卸载服务'}
              </button>
            )}
          </div>
        </div>

        )}

        {/* Windows Context Menu Card */}
        {status?.platform === 'windows' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                Windows 注册表菜单
              </h3>
              <p className="text-xs text-slate-400">
                导出 .reg 注册表脚本，用于在 Windows 资源管理器右键中集成 DocTools
              </p>
            </div>
          </div>

          {!windowsRegContent ? (
            <button
              onClick={handleShowWindowsReg}
              className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>查看注册表配置</span>
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-500">DocTools.reg 脚本内容:</span>
                <button
                  onClick={copyRegToClipboard}
                  className="px-2 py-0.5 rounded text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex items-center space-x-1"
                >
                  {copiedReg ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedReg ? '已复制' : '复制脚本'}</span>
                </button>
              </div>
              <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-40">
                {windowsRegContent}
              </pre>
            </div>
          )}
        </div>

        )}
        {status?.platform !== 'macos' && message && <p className="text-xs text-rose-600">{message}</p>}

        {/* Engine Diagnostics */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-3">
          <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
            环境依赖检测
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="text-[11px] text-slate-400 mb-1">Ghostscript (PDF 压缩)</div>
              <div className="flex items-center space-x-1 text-xs font-semibold">
                {status?.ghostscript_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 已就绪
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center">
                    <AlertCircle className="w-3.5 h-3.5 mr-1" /> 未安装（使用原生引擎）
                  </span>
                )}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="text-[11px] text-slate-400 mb-1">LibreOffice (文档转换)</div>
              <div className="flex items-center space-x-1 text-xs font-semibold">
                {status?.libreoffice_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 已就绪
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center">
                    <AlertCircle className="w-3.5 h-3.5 mr-1" /> 未安装（转换功能受限）
                  </span>
                )}
              </div>
            </div>

            {status?.platform === 'macos' && <div className="p-3 rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="text-[11px] text-slate-400 mb-1">macOS textutil (系统内置)</div>
              <div className="flex items-center space-x-1 text-xs font-semibold">
                {status?.textutil_available ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 系统内置
                  </span>
                ) : (
                  <span className="text-slate-400">不可用</span>
                )}
              </div>
            </div>}
          </div>
        </div>
      </div>
    </div>
  );
};
