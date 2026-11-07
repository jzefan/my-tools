import React, { useEffect, useRef, useState } from 'react';
import { LayoutGrid, Plus, X } from 'lucide-react';
import { SuiteConfig, SuiteId } from '../suites';

interface WorkspaceTabsProps {
  suites: SuiteConfig[];
  openIds: SuiteId[];
  activeId: SuiteId | null;
  onSelectHome: () => void;
  onSelect: (id: SuiteId) => void;
  onClose: (id: SuiteId) => void;
  onOpen: (id: SuiteId) => void;
}

export const WorkspaceTabs: React.FC<WorkspaceTabsProps> = ({
  suites,
  openIds,
  activeId,
  onSelectHome,
  onSelect,
  onClose,
  onOpen,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const openSuites = openIds
    .map((id) => suites.find((suite) => suite.id === id))
    .filter((suite): suite is SuiteConfig => Boolean(suite));

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
  }, [menuOpen]);

  return (
    <div className="titlebar-drag relative z-30 shrink-0 flex items-end gap-1 pl-20 pr-2 pt-7 bg-slate-100 dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800">
      <button
        type="button"
        onClick={onSelectHome}
        title="工作台"
        className={`titlebar-nodrag flex items-center gap-1.5 h-8 px-3 text-xs rounded-t-md border-b-2 cursor-pointer ${
          activeId === null
            ? 'bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 border-indigo-500'
            : 'text-slate-500 dark:text-slate-400 border-transparent hover:text-slate-700 dark:hover:text-slate-200'
        }`}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        工作台
      </button>

      <div className="titlebar-nodrag flex-1 min-w-0 flex items-end">
        <div className="flex items-end gap-0.5 min-w-0 overflow-x-auto overflow-y-hidden">
        {openSuites.map((suite) => {
          const Icon = suite.icon;
          const active = suite.id === activeId;
          return (
            <div
              key={suite.id}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(suite.id);
              }}
              className={`group flex items-center h-8 max-w-[168px] shrink-0 rounded-t-md border-b-2 ${
                active
                  ? 'bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 border-indigo-500'
                  : 'text-slate-500 dark:text-slate-400 border-transparent hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(suite.id)}
                title={suite.name}
                className="flex items-center gap-1.5 min-w-0 h-full pl-2.5 pr-1 text-xs cursor-pointer"
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{suite.shortName}</span>
              </button>
              <button
                type="button"
                title="关闭"
                onClick={() => onClose(suite.id)}
                className={`mr-1 p-0.5 rounded cursor-pointer hover:bg-slate-200/80 dark:hover:bg-slate-800 ${
                  active ? 'opacity-80' : 'opacity-0 group-hover:opacity-70'
                }`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
        </div>

        <div ref={menuRef} className="relative shrink-0 self-center mb-1 ml-0.5">
          <button
            type="button"
            title="打开模块"
            onClick={() => setMenuOpen((open) => !open)}
            className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 min-w-36 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-md">
              {suites.map((suite) => {
                const opened = openIds.includes(suite.id);
                return (
                  <button
                    key={suite.id}
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (opened) onSelect(suite.id);
                      else onOpen(suite.id);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 ${
                      suite.id === activeId
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {suite.name}
                    {opened ? ' · 已打开' : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
