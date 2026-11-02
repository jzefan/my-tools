import { useState, useEffect, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Sidebar } from './components/Sidebar';
import { MergeView } from './components/MergeView';
import { CompressView } from './components/CompressView';
import { WatermarkView } from './components/WatermarkView';
import { SystemView } from './components/SystemView';
import { EmbeddedMergeModal } from './components/EmbeddedMergeModal';
import { api } from './services/api';
import { IntegrationStatus, LaunchContext } from './types';
import './App.css';

export function App() {
  const [activeTab, setActiveTab] = useState<'merge' | 'compress' | 'watermark' | 'system'>('merge');
  const [launchContext, setLaunchContext] = useState<LaunchContext | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [isQuickMergeMode, setIsQuickMergeMode] = useState<boolean>(false);

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
      await api.setWindowMode('compact');
    } catch {
      // fallback
    }
  }, []);

  // Handle expanding to full studio
  const handleExpandToFullStudio = useCallback(async () => {
    setIsQuickMergeMode(false);
    try {
      await api.setWindowMode('full');
    } catch {
      // fallback
    }
  }, []);

  // Handle close in quick merge mode
  const handleClose = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.minimize();
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

        if (ctx.initial_paths && ctx.initial_paths.length > 0 && ctx.initial_action === 'merge') {
          // Enter embedded compact in-place mode directly!
          enterQuickMergeMode(ctx);
        } else if (ctx.initial_action === 'compress') {
          setActiveTab('compress');
        } else if (ctx.initial_action === 'watermark') {
          setActiveTab('watermark');
        } else {
          setActiveTab('merge');
        }
      } catch (err) {
        console.error('Failed to get launch context:', err);
      }
      refreshIntegrationStatus();
    };
    init();
  }, [enterQuickMergeMode, refreshIntegrationStatus]);

  // Poll for pending actions (when triggered from Finder right-click while running)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const pending = await api.pollPendingAction();
        if (pending) {
          setLaunchContext(pending);
          if (pending.initial_action === 'merge' && pending.initial_paths.length > 0) {
            enterQuickMergeMode(pending);
          } else if (pending.initial_action === 'compress') {
            setIsQuickMergeMode(false);
            setActiveTab('compress');
            api.setWindowMode('full');
          } else if (pending.initial_action === 'watermark') {
            setIsQuickMergeMode(false);
            setActiveTab('watermark');
            api.setWindowMode('full');
          } else {
            setActiveTab('merge');
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [enterQuickMergeMode]);

  // If in Quick Merge mode: Render the embedded in-place directory expansion modal!
  if (isQuickMergeMode) {
    return (
      <div className="h-screen w-screen overflow-hidden antialiased font-sans">
        <EmbeddedMergeModal
          key={launchContext?.initial_directory || 'quick_merge'}
          initialDirectory={launchContext?.initial_directory || ''}
          initialFiles={launchContext?.initial_paths || []}
          onExpandToFullStudio={handleExpandToFullStudio}
          onClose={handleClose}
        />
      </div>
    );
  }

  // Full Pro Studio Layout
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 antialiased font-sans">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        integrationStatus={integrationStatus}
      />

      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-slate-950">
        {activeTab === 'merge' && (
          <MergeView
            key={launchContext?.initial_directory || 'default_merge'}
            initialDirectory={launchContext?.initial_directory || ''}
            initialFiles={launchContext?.initial_paths || []}
          />
        )}

        {activeTab === 'compress' && (
          <CompressView
            key={launchContext?.initial_paths?.[0] || 'default_compress'}
            initialFile={launchContext?.initial_paths?.[0]}
            integrationStatus={integrationStatus}
          />
        )}

        {activeTab === 'watermark' && (
          <WatermarkView
            key={launchContext?.initial_paths?.[0] || 'default_watermark'}
            initialFile={launchContext?.initial_paths?.[0]}
          />
        )}

        {activeTab === 'system' && (
          <SystemView
            status={integrationStatus}
            refreshStatus={refreshIntegrationStatus}
          />
        )}
      </main>
    </div>
  );
}

export default App;
