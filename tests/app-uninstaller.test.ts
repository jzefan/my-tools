import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESIDUAL_ALERT_THRESHOLD_BYTES,
  computeUninstallSummary,
  filterAndSortApps,
  findLargeResidualApps,
  getAppResidualBytes,
  getAppTotalBytes,
  isLargeResidualApp,
} from '../src/utils/appUninstaller';
import type { InstalledAppItem } from '../src/types/cleaner';

const MiB = 1024 * 1024;

function makeApp(
  id: string,
  name: string,
  appMiB: number,
  residualMiBs: number[]
): InstalledAppItem {
  const residuals = residualMiBs.map((sizeMiB, idx) => ({
    id: `${id}_res_${idx}`,
    name: `残余-${idx}`,
    path: `~/Library/Caches/${id}/${idx}`,
    size_bytes: sizeMiB * MiB,
    file_count: 10,
    kind: 'cache' as const,
  }));
  return {
    id,
    name,
    bundle_id: `com.example.${id}`,
    version: '1.0.0',
    category: '测试',
    app_path: `/Applications/${name}.app`,
    app_size_bytes: appMiB * MiB,
    residual_size_bytes: residuals.reduce((s, r) => s + r.size_bytes, 0),
    residuals,
  };
}

test('isLargeResidualApp strictly triggers only when residual bytes > 100 MiB', () => {
  const exact100 = makeApp('a', 'Exact100', 200, [100]);
  const below100 = makeApp('b', 'Below100', 200, [60, 39]);
  const above100 = makeApp('c', 'Above100', 200, [60, 41]);

  assert.equal(getAppResidualBytes(exact100), RESIDUAL_ALERT_THRESHOLD_BYTES);
  assert.equal(isLargeResidualApp(exact100), false);
  assert.equal(isLargeResidualApp(below100), false);
  assert.equal(isLargeResidualApp(above100), true);
});

test('findLargeResidualApps filters apps exceeding 100 MiB residuals', () => {
  const apps = [
    makeApp('small', 'SmallApp', 150, [25]),
    makeApp('large1', 'LargeOne', 500, [120, 30]),
    makeApp('exact', 'BoundaryApp', 300, [100]),
    makeApp('large2', 'LargeTwo', 100, [101]),
  ];

  const large = findLargeResidualApps(apps);
  assert.deepEqual(
    large.map((a) => a.id),
    ['large1', 'large2']
  );
});

test('filterAndSortApps filters by query and large_residual mode and sorts accurately', () => {
  const apps = [
    makeApp('raycast', 'Raycast', 120, [24]),
    makeApp('docker', 'Docker Desktop', 1900, [580, 60]),
    makeApp('ps', 'Adobe Photoshop', 3200, [980, 460]),
  ];

  assert.deepEqual(
    filterAndSortApps(apps, 'dock', 'all', 'total_desc').map((a) => a.id),
    ['docker']
  );
  assert.deepEqual(
    filterAndSortApps(apps, '', 'large_residual', 'residual_desc').map((a) => a.id),
    ['ps', 'docker']
  );
  assert.deepEqual(
    filterAndSortApps(apps, '', 'all', 'name_asc').map((a) => a.id),
    ['ps', 'docker', 'raycast']
  );
  assert.equal(getAppTotalBytes(apps[1]), (1900 + 640) * MiB);
});

test('computeUninstallSummary handles deleting vs retaining residuals per app', () => {
  const apps = [
    makeApp('docker', 'Docker Desktop', 1900, [640]),
    makeApp('ps', 'Adobe Photoshop', 3200, [1440]),
    makeApp('raycast', 'Raycast', 120, [24]),
  ];

  const result = computeUninstallSummary(apps, [
    { app_id: 'docker', delete_residuals: true },
    { app_id: 'ps', delete_residuals: false },
    { app_id: 'raycast', delete_residuals: true },
  ]);

  assert.equal(result.success, true);
  assert.equal(result.outcomes.length, 3);
  assert.equal(result.freed_app_bytes, (1900 + 3200 + 120) * MiB);
  assert.equal(result.freed_residual_bytes, (640 + 24) * MiB);
  assert.equal(result.retained_residual_bytes, 1440 * MiB);
  assert.equal(result.freed_bytes, (1900 + 3200 + 120 + 640 + 24) * MiB);
});
