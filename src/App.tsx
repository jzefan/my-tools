import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { MergeView } from './components/MergeView';
import { CompressView } from './components/CompressView';
import { WatermarkView } from './components/WatermarkView';
import { SystemView } from './components/SystemView';
import { api } from './services/api';
import { IntegrationStatus, LaunchContext } from './types';
import './App.css';

export function App() {
  const [activeTab, setActiveTab] = useState<'merge' | 'compress' | 'watermark' | 'system'>('merge');
  const [launchContext, setLaunchContext] = useState<LaunchContext | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);

  // Refresh system integration status
  const refreshIntegrationStatus = useCallback(async () => {
    try {
      const status = await api.getIntegrationStatus();
      setIntegrationStatus(status);
    } catch (err) {
      console.error('Failed to get integration status:', err);
    }
  }, []);

  // Check launch context on mount
  useEffect(() => {
    const init = async () => {
      try {
        const ctx = await api.getLaunchContext();
        setLaunchContext(ctx);
        if (ctx.initial_action === 'compress') {
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
  }, [refreshIntegrationStatus]);

  // Poll for pending actions (when triggered from Finder right-click while running)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const pending = await api.pollPendingAction();
        if (pending) {
          setLaunchContext(pending);
          if (pending.initial_action === 'compress') {
            setActiveTab('compress');
          } else if (pending.initial_action === 'watermark') {
            setActiveTab('watermark');
          } else {
            setActiveTab('merge');
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 1500);

    return () => clearInterval(interval);
  }, []);

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
