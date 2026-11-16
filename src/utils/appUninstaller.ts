import type {
  AppResidualItem,
  InstalledAppItem,
  UninstallAppsResult,
  UninstallAppTarget,
  UninstalledAppOutcome,
} from '../types/cleaner';

/** 100 MiB threshold for prompting the user about residual file deletion */
export const RESIDUAL_ALERT_THRESHOLD_BYTES = 100 * 1024 * 1024;

export type AppFilterMode = 'all' | 'large_residual';
export type AppSortMode = 'total_desc' | 'residual_desc' | 'app_desc' | 'name_asc';

export function sumResidualBytes(residuals: readonly AppResidualItem[]): number {
  return residuals.reduce((sum, item) => sum + Math.max(0, item.size_bytes), 0);
}

export function getAppResidualBytes(app: Pick<InstalledAppItem, 'residual_size_bytes' | 'residuals'>): number {
  if (app.residuals && app.residuals.length > 0) {
    return sumResidualBytes(app.residuals);
  }
  return Math.max(0, app.residual_size_bytes);
}

export function getAppTotalBytes(app: Pick<InstalledAppItem, 'app_size_bytes' | 'residual_size_bytes' | 'residuals'>): number {
  return Math.max(0, app.app_size_bytes) + getAppResidualBytes(app);
}

export function isLargeResidualApp(
  app: Pick<InstalledAppItem, 'residual_size_bytes' | 'residuals'>,
  thresholdBytes: number = RESIDUAL_ALERT_THRESHOLD_BYTES
): boolean {
  return getAppResidualBytes(app) > thresholdBytes;
}

export function findLargeResidualApps(
  apps: readonly InstalledAppItem[],
  thresholdBytes: number = RESIDUAL_ALERT_THRESHOLD_BYTES
): InstalledAppItem[] {
  return apps.filter((app) => isLargeResidualApp(app, thresholdBytes));
}

export function filterAndSortApps(
  apps: readonly InstalledAppItem[],
  query: string,
  filterMode: AppFilterMode = 'all',
  sortMode: AppSortMode = 'total_desc'
): InstalledAppItem[] {
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = apps.filter((app) => {
    if (filterMode === 'large_residual' && !isLargeResidualApp(app)) {
      return false;
    }
    if (!normalizedQuery) return true;
    return (
      app.name.toLowerCase().includes(normalizedQuery) ||
      app.bundle_id.toLowerCase().includes(normalizedQuery) ||
      app.category.toLowerCase().includes(normalizedQuery)
    );
  });

  return [...filtered].sort((a, b) => {
    switch (sortMode) {
      case 'residual_desc':
        return getAppResidualBytes(b) - getAppResidualBytes(a);
      case 'app_desc':
        return b.app_size_bytes - a.app_size_bytes;
      case 'name_asc':
        return a.name.localeCompare(b.name, 'zh-CN');
      case 'total_desc':
      default:
        return getAppTotalBytes(b) - getAppTotalBytes(a);
    }
  });
}

export function computeUninstallSummary(
  apps: readonly InstalledAppItem[],
  targets: readonly UninstallAppTarget[]
): UninstallAppsResult {
  const appMap = new Map(apps.map((app) => [app.id, app]));
  const outcomes: UninstalledAppOutcome[] = [];
  const errors: string[] = [];

  let freedAppBytes = 0;
  let freedResidualBytes = 0;
  let retainedResidualBytes = 0;

  for (const target of targets) {
    const app = appMap.get(target.app_id);
    if (!app) {
      errors.push(`未找到软件: ${target.app_id}`);
      continue;
    }

    const residualBytes = getAppResidualBytes(app);
    const appBytes = Math.max(0, app.app_size_bytes);
    const deletedResiduals = Boolean(target.delete_residuals);
    const freedRes = deletedResiduals ? residualBytes : 0;
    const retainedRes = deletedResiduals ? 0 : residualBytes;

    freedAppBytes += appBytes;
    freedResidualBytes += freedRes;
    retainedResidualBytes += retainedRes;

    outcomes.push({
      app_id: app.id,
      app_name: app.name,
      freed_app_bytes: appBytes,
      freed_residual_bytes: freedRes,
      retained_residual_bytes: retainedRes,
      deleted_residuals: deletedResiduals,
    });
  }

  return {
    success: errors.length === 0 && outcomes.length > 0,
    freed_bytes: freedAppBytes + freedResidualBytes,
    freed_app_bytes: freedAppBytes,
    freed_residual_bytes: freedResidualBytes,
    retained_residual_bytes: retainedResidualBytes,
    outcomes,
    errors,
  };
}
