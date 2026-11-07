import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Send,
  Users,
  Clock,
  MessageSquareText,
  Wrench,
  CheckCircle2,
  X,
} from 'lucide-react';
import { MediaPublisher } from './MediaPublisher';
import { MediaAccounts } from './MediaAccounts';
import { MediaTaskCenter } from './MediaTaskCenter';
import { MediaRepliesHub } from './MediaRepliesHub';
import { MediaTools } from './MediaTools';

interface MediaViewProps {
  activeSubTab?: string;
  onSubTabChange?: (tab: string) => void;
}

interface SubTabItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SUB_TABS: SubTabItem[] = [
  { id: 'media_publish', label: '一键发布', icon: Send },
  { id: 'media_accounts', label: '账号矩阵', icon: Users },
  { id: 'media_tasks', label: '任务中心', icon: Clock },
  { id: 'media_replies', label: '话术互动', icon: MessageSquareText },
  { id: 'media_tools', label: '媒体工具', icon: Wrench },
];

export const MediaView: React.FC<MediaViewProps> = ({
  activeSubTab = 'media_publish',
  onSubTabChange,
}) => {
  const [currentTab, setCurrentTab] = useState<string>(activeSubTab);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external subTab prop
  useEffect(() => {
    if (activeSubTab && activeSubTab !== currentTab) {
      setCurrentTab(activeSubTab);
    }
  }, [activeSubTab]);

  const handleTabChange = useCallback(
    (tabId: string) => {
      setCurrentTab(tabId);
      onSubTabChange?.(tabId);
    },
    [onSubTabChange]
  );

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 select-none">
      {/* Top Header & Sub-tab Bar */}
      <div className="titlebar-drag pt-8 pb-3 px-6 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md shrink-0">
        {/* Navigation Tabs */}
        <div className="titlebar-nodrag flex items-center space-x-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Status / Quick Title */}
        <div className="text-xs text-slate-400 font-mono hidden sm:block">
          自媒体分发
        </div>
      </div>

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-2 px-3.5 py-1.5 bg-slate-900/95 text-white dark:bg-white/95 dark:text-slate-900 rounded-full shadow-lg text-xs animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="p-0.5 opacity-60 hover:opacity-100 transition-opacity"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {currentTab === 'media_publish' && (
          <MediaPublisher onNavigate={handleTabChange} onNotify={showToast} />
        )}
        {currentTab === 'media_accounts' && (
          <MediaAccounts onNotify={showToast} />
        )}
        {currentTab === 'media_tasks' && (
          <MediaTaskCenter onNotify={showToast} />
        )}
        {currentTab === 'media_replies' && (
          <MediaRepliesHub onNotify={showToast} />
        )}
        {currentTab === 'media_tools' && (
          <MediaTools onNotify={showToast} />
        )}
      </div>
    </div>
  );
};
