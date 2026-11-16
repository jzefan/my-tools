import React, { useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, PackageX, Trash2, X } from 'lucide-react';
import type { InstalledAppItem, UninstallAppTarget } from '../../types/cleaner';
import { formatFileSize } from '../../utils/format';
import {
  findLargeResidualApps,
  getAppResidualBytes,
  isLargeResidualApp,
} from '../../utils/appUninstaller';

interface UninstallConfirmModalProps {
  apps: InstalledAppItem[];
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (targets: UninstallAppTarget[]) => void;
}

export const UninstallConfirmModal: React.FC<UninstallConfirmModalProps> = ({
  apps,
  isSubmitting,
  onCancel,
  onConfirm,
}) => {
  const [deleteResidualsMap, setDeleteResidualsMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const app of apps) {
      initial[app.id] = true;
    }
    setDeleteResidualsMap(initial);
  }, [apps]);

  if (apps.length === 0) return null;

  const isSingle = apps.length === 1;
  const singleApp = isSingle ? apps[0] : null;
  const largeResidualApps = findLargeResidualApps(apps);
  const hasLargeResiduals = largeResidualApps.length > 0;

  const toggleResidualChoice = (appId: string) => {
    setDeleteResidualsMap((prev) => ({
      ...prev,
      [appId]: !prev[appId],
    }));
  };

  const totalAppBytes = apps.reduce((sum, app) => sum + app.app_size_bytes, 0);
  const totalSelectedResidualBytes = apps.reduce(
    (sum, app) => sum + (deleteResidualsMap[app.id] ? getAppResidualBytes(app) : 0),
    0
  );

  const handleConfirmBatch = () => {
    onConfirm(
      apps.map((app) => ({
        app_id: app.id,
        delete_residuals: Boolean(deleteResidualsMap[app.id]),
      }))
    );
  };

  const handleSingleChoice = (deleteResiduals: boolean) => {
    if (!singleApp) return;
    onConfirm([{ app_id: singleApp.id, delete_residuals: deleteResiduals }]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
      onClick={() => {
        if (!isSubmitting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="uninstall-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400">
              <PackageX className="w-4 h-4" />
            </div>
            <div>
              <h3 id="uninstall-modal-title" className="text-sm font-bold">
                {isSingle ? `卸载「${singleApp?.name}」` : `批量卸载 ${apps.length} 个软件`}
              </h3>
              <p className="text-[11px] text-slate-400">
                主程序体积 {formatFileSize(totalAppBytes)}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            aria-label="关闭卸载确认窗口"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {hasLargeResiduals && (
            <div
              role="alert"
              className="rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-1.5"
            >
              <div className="flex items-center space-x-2 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>检测到残余文件大于 100 MB</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                {isSingle && singleApp
                  ? `「${singleApp.name}」的关联缓存、支持文件或容器残余共 ${formatFileSize(
                      getAppResidualBytes(singleApp)
                    )}，超过 100 MB。请确认是否把残余文件也一并删除。`
                  : `以下 ${largeResidualApps.length} 个软件的残余文件大于 100 MB，请逐项确认是否将残余文件也删除：`}
              </p>
            </div>
          )}

          {/* Per-app breakdown */}
          <div className="space-y-2.5">
            {apps.map((app) => {
              const residualBytes = getAppResidualBytes(app);
              const isLarge = isLargeResidualApp(app);
              const checked = Boolean(deleteResidualsMap[app.id]);

              return (
                <div
                  key={app.id}
                  className={`rounded-xl border p-3 space-y-2 ${
                    isLarge
                      ? 'border-amber-200 dark:border-amber-800/70 bg-amber-50/40 dark:bg-amber-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-semibold truncate">{app.name}</span>
                        {isLarge && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                            残余 &gt; 100 MB
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono truncate">
                        {app.app_path}
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono text-[11px]">
                      <div className="text-slate-700 dark:text-slate-200">
                        主程序 {formatFileSize(app.app_size_bytes)}
                      </div>
                      <div className={isLarge ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-400'}>
                        残余 {formatFileSize(residualBytes)}
                      </div>
                    </div>
                  </div>

                  {residualBytes > 0 && (!isSingle || !isLarge) && (
                    <label className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/60 cursor-pointer text-xs">
                      <span className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleResidualChoice(app.id)}
                          className="w-3.5 h-3.5 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                        />
                        <span>同时删除残余文件</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {formatFileSize(residualBytes)}
                      </span>
                    </label>
                  )}

                  {app.residuals.length > 0 && (
                    <div className="pt-1 space-y-1">
                      {app.residuals.map((res) => (
                        <div
                          key={res.id}
                          className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400"
                        >
                          <span className="flex items-center space-x-1.5 min-w-0 truncate">
                            <FolderOpen className="w-3 h-3 shrink-0 text-slate-400" />
                            <span className="truncate">{res.name}</span>
                          </span>
                          <span className="font-mono shrink-0 ml-2">
                            {formatFileSize(res.size_bytes)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
          >
            取消
          </button>

          {isSingle && singleApp && isLargeResidualApp(singleApp) ? (
            <>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleSingleChoice(false)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50"
              >
                仅卸载主程序（保留残余）
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleSingleChoice(true)}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {isSubmitting
                    ? '正在卸载...'
                    : `卸载并删除残余 (${formatFileSize(
                        singleApp.app_size_bytes + getAppResidualBytes(singleApp)
                      )})`}
                </span>
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleConfirmBatch}
              className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>
                {isSubmitting
                  ? '正在卸载...'
                  : `确认卸载 (${formatFileSize(totalAppBytes + totalSelectedResidualBytes)})`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
