import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Sidebar } from './components/Sidebar';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { HomeView } from './components/home/HomeView';
import { FinderColumnMergeView } from './components/FinderColumnMergeView';
import { TabErrorBoundary } from './components/common/TabErrorBoundary';
import { LoadingState } from './components/common/LoadingState';
import { api } from './services/api';
import { IntegrationStatus, LaunchContext } from './types';
import {
  SuiteId,
  ActiveTabId,
  getDefaultSuite,
  getEnabledSuites,
  isSuiteEnabled,
  resolveLaunchTarget,
} from './suites';
import './App.css';

// Lazy load views for optimal code-splitting and modular compilation
const MergeView = lazy(() =>
  import('./components/MergeView').then((m) => ({ default: m.MergeView }))
);
const ConvertView = lazy(() =>
  import('./components/ConvertView').then((m) => ({ default: m.ConvertView }))
);
const CompressView = lazy(() =>
  import('./components/CompressView').then((m) => ({ default: m.CompressView }))
);
const WatermarkView = lazy(() =>
  import('./components/WatermarkView').then((m) => ({ default: m.WatermarkView }))
);
const SystemView = lazy(() =>
  import('./components/SystemView').then((m) => ({ default: m.SystemView }))
);
const PaperView = lazy(() =>
  import('./components/paper/PaperView').then((m) => ({ default: m.PaperView }))
);
const DiskCleanerView = lazy(() =>
  import('./components/cleaner/DiskCleanerView').then((m) => ({ default: m.DiskCleanerView }))
);
const NetdiskView = lazy(() =>
  import('./components/netdisk/NetdiskView').then((m) => ({ default: m.NetdiskView }))
);
const TypingView = lazy(() =>
  import('./components/typing/TypingView').then((m) => ({ default: m.TypingView }))
);
const MediaView = lazy(() =>
  import('./components/media/MediaView').then((m) => ({ default: m.MediaView }))
);

interface OpenModule {
  suiteId: SuiteId;
  tab: ActiveTabId;
}

export function App() {
  const enabledSuites = getEnabledSuites();
  const defaultSuite = getDefaultSuite();
  const multiSuite = enabledSuites.length > 1;
  const [openModules, setOpenModules] = useState<OpenModule[]>(() =>
    getEnabledSuites().length > 1
      ? []
      : [{ suiteId: getDefaultSuite().id, tab: getDefaultSuite().defaultTab }]
  );
  const [activeSuite, setActiveSuite] = useState<SuiteId>(defaultSuite.id);
  const [isHomeView, setIsHomeView] = useState<boolean>(multiSuite);
  const [launchContext, setLaunchContext] = useState<LaunchContext | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [isQuickMergeMode, setIsQuickMergeMode] = useState<boolean>(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  const activeTab =
    openModules.find((module) => module.suiteId === activeSuite)?.tab ?? defaultSuite.defaultTab;

  const tabOf = useCallback(
    (suiteId: SuiteId) =>
      openModules.find((module) => module.suiteId === suiteId)?.tab ??
      enabledSuites.find((suite) => suite.id === suiteId)?.defaultTab ??
      activeTab,
    [openModules, enabledSuites, activeTab]
  );

  const isOpen = useCallback(
    (suiteId: SuiteId) => openModules.some((module) => module.suiteId === suiteId),
    [openModules]
  );

  const openSuite = useCallback((suiteId: SuiteId, initialTab?: ActiveTabId) => {
    const suite = getEnabledSuites().find((item) => item.id === suiteId);
    if (!suite || !isSuiteEnabled(suiteId)) return;
    setOpenModules((prev) => {
      const existing = prev.find((module) => module.suiteId === suiteId);
      const tab = initialTab ?? existing?.tab ?? suite.defaultTab;
      if (existing && existing.tab === tab) return prev;
      if (existing) {
        return prev.map((module) => (module.suiteId === suiteId ? { suiteId, tab } : module));
      }
      return [...prev, { suiteId, tab }];
    });
    setActiveSuite(suiteId);
    setIsHomeView(false);
  }, []);

  const handleReturnHome = useCallback(() => {
    setIsHomeView(true);
  }, []);

  const closeSuite = useCallback(
    (suiteId: SuiteId) => {
      const idx = openModules.findIndex((module) => module.suiteId === suiteId);
      if (idx < 0) return;
      const next = openModules.filter((module) => module.suiteId !== suiteId);
      setOpenModules(next);
      if (isHomeView || activeSuite !== suiteId) return;
      const neighbor = next[idx] ?? next[idx - 1];
      if (neighbor) setActiveSuite(neighbor.suiteId);
      else setIsHomeView(true);
    },
    [openModules, isHomeView, activeSuite]
  );

  const updateSuiteTab = useCallback((suiteId: SuiteId, tab: ActiveTabId) => {
    setOpenModules((prev) =>
      prev.map((module) => (module.suiteId === suiteId ? { ...module, tab } : module))
    );
  }, []);

  const handleSelectTab = useCallback(
    (tab: ActiveTabId) => {
      updateSuiteTab(activeSuite, tab);
    },
    [activeSuite, updateSuiteTab]
  );

  // Refresh system integration status
  const refreshIntegrationStatus = useCallback(async () => {
    try {
      const status = await api.getIntegrationStatus();
      setIntegrationStatus(status);
    } catch (err) {
      console.error('Failed to get integration status:', err);
    }
  }, []);

  // Handle entering quick merge mode (compact floating modal over Finder)
  const enterQuickMergeMode = useCallback(async (_ctx: LaunchContext) => {
    setIsQuickMergeMode(true);
    try {
      const win = getCurrentWindow();
      await win.show();
      await win.unminimize();
      await win.setFocus();
      await api.setWindowMode('compact');
    } catch {
      // fallback
    }
  }, []);

  // Handle expanding to full studio
  const handleExpandToFullStudio = useCallback(async () => {
    setIsQuickMergeMode(false);
    if (isSuiteEnabled('docs')) openSuite('docs', 'merge');
    else setIsHomeView(false);
    try {
      await api.setWindowMode('full');
    } catch {
      // fallback
    }
  }, [openSuite]);

  // Handle close in quick merge mode (dismiss floating HUD)
  const handleClose = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.hide();
    } catch {
      // ignore
    }
  }, []);

  // Check launch context on mount
  useEffect(() => {
    const init = async () => {
      try {
        const ctx = await api.getLaunchContext();
        setLaunchContext(ctx);

        if (
          isSuiteEnabled('docs') &&
          ctx.initial_paths &&
          ctx.initial_paths.length > 0 &&
          ctx.initial_action === 'merge'
        ) {
          // Enter embedded compact in-place mode directly
          enterQuickMergeMode(ctx);
        } else if (
          (ctx.initial_paths && ctx.initial_paths.length > 0) ||
          (ctx.initial_action && ctx.initial_action !== 'browse')
        ) {
          const target = resolveLaunchTarget(ctx.initial_action);
          openSuite(target.suiteId, target.tab);
        } else if (getEnabledSuites().length > 1) {
          setIsHomeView(true);
        }
      } catch (err) {
        console.error('Failed to get launch context:', err);
      }
      refreshIntegrationStatus();
    };
    init();
  }, [enterQuickMergeMode, refreshIntegrationStatus, openSuite]);

  // Poll for pending actions (when triggered from Finder right-click while running)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const pending = await api.pollPendingAction();
        if (pending) {
          setLaunchContext(pending);
          if (
            isSuiteEnabled('docs') &&
            pending.initial_action === 'merge' &&
            pending.initial_paths.length > 0
          ) {
            enterQuickMergeMode(pending);
          } else {
            setIsQuickMergeMode(false);
            api.setWindowMode('full');
            const target = resolveLaunchTarget(pending.initial_action);
            openSuite(target.suiteId, target.tab);
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [enterQuickMergeMode, openSuite]);

  // If in Quick Merge mode: Render the Finder-style multi-column in-place directory expansion view
  if (isQuickMergeMode) {
    return (
      <div className="h-screen w-screen overflow-hidden antialiased font-sans">
        <FinderColumnMergeView
          key={launchContext?.initial_directory || 'quick_merge'}
          initialDirectory={launchContext?.initial_directory || ''}
          initialFiles={launchContext?.initial_paths || []}
          onExpandToFullStudio={handleExpandToFullStudio}
          onClose={handleClose}
        />
      </div>
    );
  }

  const showHome = multiSuite && isHomeView;
  const isDocsActive = !showHome && activeSuite === 'docs';
  const isPaperActive = !showHome && activeSuite === 'paper';
  const isCleanerActive = !showHome && activeSuite === 'cleaner';
  const isNetdiskActive = !showHome && activeSuite === 'netdisk';
  const isTypingActive = !showHome && activeSuite === 'typing';
  const isMediaActive = !showHome && activeSuite === 'media';
  const docsTab = tabOf('docs');

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 antialiased font-sans">
      {multiSuite && (
        <WorkspaceTabs
          suites={enabledSuites}
          openIds={openModules.map((module) => module.suiteId)}
          activeId={showHome ? null : activeSuite}
          onSelectHome={handleReturnHome}
          onSelect={(suiteId) => openSuite(suiteId)}
          onClose={closeSuite}
          onOpen={(suiteId) => openSuite(suiteId)}
        />
      )}

      {multiSuite && (
        <div className={showHome ? 'flex flex-1 min-h-0' : 'hidden'}>
          <HomeView
            onEnterSuite={openSuite}
            openSuiteIds={openModules.map((module) => module.suiteId)}
            compact
          />
        </div>
      )}

      <div className={showHome ? 'hidden' : 'flex flex-1 min-h-0'}>
      {openModules.length > 0 && <>
      <Sidebar
        activeSuite={activeSuite}
        activeTab={activeTab}
        setActiveTab={handleSelectTab}
        integrationStatus={integrationStatus}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        flushTop={multiSuite}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-slate-950">
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <LoadingState label="加载中..." />
            </div>
          }
        >
          {/* Document Processing Suite Views */}
          {isOpen('docs') && (
            <>
              <div
                className={`h-full flex flex-col flex-1 ${
                  isDocsActive && docsTab === 'merge' ? '' : 'hidden'
                }`}
              >
                <TabErrorBoundary tabName="合并文件">
                  <MergeView
                    key={launchContext?.initial_directory || 'default_merge'}
                    initialDirectory={launchContext?.initial_directory || ''}
                    initialFiles={launchContext?.initial_paths || []}
                  />
                </TabErrorBoundary>
              </div>

              <div
                className={`h-full flex flex-col flex-1 ${
                  isDocsActive && docsTab === 'convert' ? '' : 'hidden'
                }`}
              >
                <TabErrorBoundary tabName="格式转换">
                  <ConvertView
                    key={launchContext?.initial_paths?.[0] || 'default_convert'}
                    initialFile={launchContext?.initial_paths?.[0]}
                  />
                </TabErrorBoundary>
              </div>

              <div
                className={`h-full flex flex-col flex-1 ${
                  isDocsActive && docsTab === 'compress' ? '' : 'hidden'
                }`}
              >
                <TabErrorBoundary tabName="压缩文档">
                  <CompressView
                    key={launchContext?.initial_paths?.[0] || 'default_compress'}
                    initialFile={launchContext?.initial_paths?.[0]}
                    integrationStatus={integrationStatus}
                  />
                </TabErrorBoundary>
              </div>

              <div
                className={`h-full flex flex-col flex-1 ${
                  isDocsActive && docsTab === 'watermark' ? '' : 'hidden'
                }`}
              >
                <TabErrorBoundary tabName="文档水印">
                  <WatermarkView
                    key={launchContext?.initial_paths?.[0] || 'default_watermark'}
                    initialFile={launchContext?.initial_paths?.[0]}
                  />
                </TabErrorBoundary>
              </div>

              <div
                className={`h-full flex flex-col flex-1 ${
                  isDocsActive && docsTab === 'system' ? '' : 'hidden'
                }`}
              >
                <TabErrorBoundary tabName="系统设置">
                  <SystemView
                    status={integrationStatus}
                    refreshStatus={refreshIntegrationStatus}
                  />
                </TabErrorBoundary>
              </div>
            </>
          )}

          {/* Paper Study Suite Views */}
          {isOpen('paper') && (
            <div
              className={`h-full flex flex-col flex-1 ${
                isPaperActive ? '' : 'hidden'
              }`}
            >
              <TabErrorBoundary tabName="论文研读">
                <PaperView
                  key={launchContext?.initial_paths?.[0] || 'default_paper'}
                  initialFile={launchContext?.initial_paths?.[0]}
                  activeSubTab={tabOf('paper')}
                  onSubTabChange={(subTab) => updateSuiteTab('paper', subTab)}
                />
              </TabErrorBoundary>
            </div>
          )}

          {/* Disk Cleaner Suite Views */}
          {isOpen('netdisk') && (
            <div className={`h-full min-h-0 flex-col flex-1 ${isNetdiskActive ? 'flex' : 'hidden'}`}>
              <TabErrorBoundary tabName="网盘搜索">
                <NetdiskView activeSubTab={tabOf('netdisk')} onSubTabChange={(subTab) => updateSuiteTab('netdisk', subTab)} />
              </TabErrorBoundary>
            </div>
          )}
          {isOpen('typing') && (
            <div className={`h-full min-h-0 flex-col flex-1 ${isTypingActive ? 'flex' : 'hidden'}`}>
              <TabErrorBoundary tabName="打字记词">
                <TypingView activeSubTab={tabOf('typing')} />
              </TabErrorBoundary>
            </div>
          )}
          {isOpen('media') && (
            <div className={`h-full min-h-0 flex-col flex-1 ${isMediaActive ? 'flex' : 'hidden'}`}>
              <TabErrorBoundary tabName="自媒体分发">
                <MediaView activeSubTab={tabOf('media')} onSubTabChange={(subTab) => updateSuiteTab('media', subTab)} />
              </TabErrorBoundary>
            </div>
          )}
          {isOpen('cleaner') && (
            <div
              className={`h-full flex flex-col flex-1 ${
                isCleanerActive ? '' : 'hidden'
              }`}
            >
              <TabErrorBoundary tabName="磁盘清理">
                <DiskCleanerView activeSubTab={tabOf('cleaner')} />
              </TabErrorBoundary>
            </div>
          )}
        </Suspense>
      </main>
      </>}
      </div>
    </div>
  );
}

export default App;
