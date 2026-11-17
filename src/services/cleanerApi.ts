import { invoke } from '@tauri-apps/api/core';
import { alertDialog } from '../utils/dialog';
import { isTauriEnvironment } from './api';
import {
  DiskCleanScanResult,
  CleanExecutionRequest,
  CleanExecutionResult,
  DiskUsageEntry,
  DiskUsageScan,
  UsageDeleteResult,
  InstalledAppItem,
  UninstallAppsRequest,
  UninstallAppsResult,
  DockerScanResult,
  DockerCleanupRequest,
  DockerCleanupResult,
} from '../types/cleaner';
import { computeUninstallSummary, sumResidualBytes } from '../utils/appUninstaller';

class CleanerApiService {
  async scanDiskCleanItems(): Promise<DiskCleanScanResult> {
    if (!isTauriEnvironment()) {
      // Browser preview mock data
      return {
        supported: true,
        total_scanned_bytes: 8520000000,
        total_safe_bytes: 6200000000,
        total_recommended_bytes: 1800000000,
        total_caution_bytes: 520000000,
        total_files: 42180,
        has_permission_issues: true,
        disk_total_bytes: 256000000000,
        disk_free_bytes: 32000000000,
        full_disk_client_name: 'my-tools',
        items: [
          {
            id: 'wechat_webkit_cache',
            name: '微信网页内核缓存',
            category: 'wechat',
            risk_level: 'safe',
            description: '微信内置网页内核与小程序引擎渲染缓存，清理后按需重建',
            size_bytes: 2150000000,
            file_count: 12500,
            paths: ['~/Library/Containers/com.tencent.xinWeChat/Data/Library/Caches'],
            default_selected: true,
            is_permission_denied: false,
            details: [
              {
                path: '~/Library/Containers/com.tencent.xinWeChat/Data/Library/Caches/WebKit',
                name: 'WebKit 页面渲染缓存',
                size_bytes: 1400000000,
                file_count: 8200,
              },
              {
                path: '~/Library/Containers/com.tencent.xinWeChat/Data/Library/Caches/com.tencent.xinWeChat.MiniProgram',
                name: '小程序资源解压包',
                size_bytes: 750000000,
                file_count: 4300,
              },
            ],
          },
          {
            id: 'wechat_timeline_stream',
            name: '微信朋友圈与流媒体缓存',
            category: 'wechat',
            risk_level: 'safe',
            description: '朋友圈、公众号图文与短视频临时播放缓存，清理临时播放与缩略图缓存',
            size_bytes: 1850000000,
            file_count: 9800,
            paths: ['~/Library/Containers/com.tencent.xinWeChat/Data/Library/Caches/Timeline'],
            default_selected: true,
            is_permission_denied: false,
            details: [
              {
                path: '~/Library/Containers/com.tencent.xinWeChat/Data/Library/Caches/Images',
                name: '朋友圈缩略图片',
                size_bytes: 1100000000,
                file_count: 6500,
              },
              {
                path: '~/Library/Containers/com.tencent.xinWeChat/Data/Library/Caches/Timeline',
                name: '公众号多媒体缓存',
                size_bytes: 750000000,
                file_count: 3300,
              },
            ],
          },
          {
            id: 'wechat_chat_images',
            name: '微信聊天历史图片',
            category: 'wechat',
            risk_level: 'recommended',
            description: '聊天中收发的历史图片（清理后聊天记录中原图将提示已过期）',
            size_bytes: 2390000000,
            file_count: 20493,
            paths: ['~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/account/msg/attach'],
            default_selected: false,
            is_permission_denied: false,
            details: [
              {
                path: '~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/account/msg/attach/session1/2026-03',
                name: '2026年03月',
                size_bytes: 548110000,
                file_count: 3820,
              },
              {
                path: '~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/account/msg/attach/session1/2026-02',
                name: '2026年02月',
                size_bytes: 211980000,
                file_count: 1940,
              },
              {
                path: '~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/account/msg/attach/session1/2026-01',
                name: '2026年01月',
                size_bytes: 154740000,
                file_count: 1410,
              },
            ],
          },
          {
            id: 'qq_engine_cache',
            name: 'QQ 核心渲染与代码缓存',
            category: 'qq',
            risk_level: 'safe',
            description: 'QQ NT 架构的 GPU 渲染缓存、代码编译缓存与崩溃日志',
            size_bytes: 890000000,
            file_count: 4100,
            paths: ['~/Library/Containers/com.tencent.qq/Data/Library/Caches'],
            default_selected: true,
            is_permission_denied: false,
            details: [
              {
                path: '~/Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/GPUCache',
                name: 'GPUCache 渲染着色器',
                size_bytes: 520000000,
                file_count: 2400,
              },
            ],
          },
          {
            id: 'chrome_cache',
            name: 'Google Chrome 浏览缓存',
            category: 'browser',
            risk_level: 'safe',
            description: '网页图片、脚本与静态资源缓存，清理不影响书签与登录密码',
            size_bytes: 1250000000,
            file_count: 14200,
            paths: ['~/Library/Caches/Google/Chrome/Default/Cache'],
            default_selected: true,
            is_permission_denied: false,
            details: [],
          },
          {
            id: 'xcode_derived_data',
            name: 'Xcode 编译衍生数据 (DerivedData)',
            category: 'developer',
            risk_level: 'safe',
            description: '工程编译索引、模块缓存与中间产物，可安全删除，每次编译重新生成',
            size_bytes: 2380000000,
            file_count: 1540,
            paths: ['~/Library/Developer/Xcode/DerivedData'],
            default_selected: true,
            is_permission_denied: false,
            details: [],
          },
        ],
      };
    }

    return await invoke<DiskCleanScanResult>('scan_disk_clean_items');
  }

  async scanDiskUsage(path: string): Promise<DiskUsageScan> {
    if (!isTauriEnvironment()) {
      return mockDiskUsage(path);
    }
    return await invoke<DiskUsageScan>('scan_disk_usage', { path });
  }

  async executeClean(request: CleanExecutionRequest): Promise<CleanExecutionResult> {
    if (!isTauriEnvironment()) {
      return {
        freed_bytes: 4200000000,
        deleted_files_count: 18500,
        errors: [],
        success: true,
      };
    }
    return await invoke<CleanExecutionResult>('execute_disk_clean', { request });
  }

  async deleteUsagePath(path: string): Promise<UsageDeleteResult> {
    if (!isTauriEnvironment()) {
      if (!path.startsWith('/Users/me/')) {
        return { success: false, errors: ['只能删除用户目录下的文件夹'] };
      }
      return { success: true, errors: [] };
    }
    return await invoke<UsageDeleteResult>('delete_disk_usage_path', { path });
  }

  async cleanSpecificPath(path: string): Promise<CleanExecutionResult> {
    if (!isTauriEnvironment()) {
      return {
        freed_bytes: 520000000,
        deleted_files_count: 320,
        errors: [],
        success: true,
      };
    }
    return await invoke<CleanExecutionResult>('execute_disk_clean_path', { path });
  }

  async openFullDiskAccessSettings(): Promise<boolean> {
    if (!isTauriEnvironment()) {
      await alertDialog('请在 macOS「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中授权。');
      return false;
    }
    await invoke('open_disk_clean_settings');
    return true;
  }

  async hasFullDiskAccess(): Promise<boolean> {
    if (!isTauriEnvironment()) return false;
    return await invoke<boolean>('full_disk_access_enabled');
  }

  async scanInstalledApps(): Promise<InstalledAppItem[]> {
    if (!isTauriEnvironment()) {
      return mockInstalledApps.filter((app) => !uninstalledMockAppIds.has(app.id));
    }
    return await invoke<InstalledAppItem[]>('scan_installed_apps');
  }

  async uninstallApps(request: UninstallAppsRequest): Promise<UninstallAppsResult> {
    if (!isTauriEnvironment()) {
      const available = mockInstalledApps.filter((app) => !uninstalledMockAppIds.has(app.id));
      const result = computeUninstallSummary(available, request.targets);
      for (const outcome of result.outcomes) {
        uninstalledMockAppIds.add(outcome.app_id);
      }
      return result;
    }
    return await invoke<UninstallAppsResult>('uninstall_apps', { request });
  }

  async scanDockerReclaim(): Promise<DockerScanResult> {
    if (!isTauriEnvironment()) {
      return mockDockerScan();
    }
    return await invoke<DockerScanResult>('scan_docker_reclaim');
  }

  async executeDockerCleanup(request: DockerCleanupRequest): Promise<DockerCleanupResult> {
    if (!isTauriEnvironment()) {
      const selected = mockDockerScan().actions.filter((a) => request.action_ids.includes(a.id));
      const freed = selected.reduce((sum, a) => sum + a.reclaimable_bytes, 0);
      return {
        freed_bytes: freed,
        actions_run: selected.map((a) => a.id),
        errors: [],
        success: selected.length > 0,
      };
    }
    return await invoke<DockerCleanupResult>('execute_docker_cleanup', { request });
  }
}

export const cleanerApi = new CleanerApiService();

const GiB = 1024 ** 3;

function usageEntry(
  name: string,
  path: string,
  size: number,
  kind: DiskUsageEntry['kind'] = 'dir',
  fileCount = 1,
  denied = false,
): DiskUsageEntry {
  return {
    name,
    path,
    size_bytes: size,
    file_count: fileCount,
    kind,
    permission_denied: denied,
  };
}

function mockScan(
  path: string,
  entries: DiskUsageEntry[],
  volumes: DiskUsageEntry[] = [],
  denied = false,
): DiskUsageScan {
  return {
    supported: true,
    root_path: path,
    root_name: path === '/' ? '本机磁盘' : path.split('/').filter(Boolean).pop() || path,
    home_path: '/Users/me',
    size_bytes: entries.reduce((sum, entry) => sum + entry.size_bytes, 0),
    file_count: entries.reduce((sum, entry) => sum + entry.file_count, 0),
    entries,
    volumes,
    permission_denied: denied,
    disk_total_bytes: 500 * 1000 ** 3,
    disk_free_bytes: 80 * 1000 ** 3,
  };
}

function mockDiskUsage(path: string): DiskUsageScan {
  const mocks: Record<string, DiskUsageScan> = {
    '/': mockScan(
      '/',
      [
        usageEntry('Users', '/Users', 180 * GiB, 'dir', 820000),
        usageEntry('Applications', '/Applications', 42 * GiB, 'dir', 64000),
        usageEntry('private', '/private', 28 * GiB, 'dir', 210000),
        usageEntry('Library', '/Library', 16 * GiB, 'dir', 90000),
        usageEntry('System', '/System', 14 * GiB, 'dir', 310000),
        usageEntry('usr', '/usr', 6 * GiB, 'dir', 48000),
        usageEntry('opt', '/opt', 2 * GiB, 'dir', 12000),
      ],
      [
        usageEntry('WorkBuddy', '/Volumes/WorkBuddy', 18 * GiB, 'volume'),
        usageEntry('nix', '/nix', 6 * GiB, 'volume'),
      ],
    ),
    '/Users': mockScan('/Users', [
      usageEntry('me', '/Users/me', 178 * GiB, 'dir', 800000),
      usageEntry('Shared', '/Users/Shared', 2 * GiB, 'dir', 20000),
    ]),
    '/Users/me': mockScan('/Users/me', [
      usageEntry('Library', '/Users/me/Library', 110 * GiB, 'dir', 540000),
      usageEntry('Downloads', '/Users/me/Downloads', 40 * GiB, 'dir', 1800),
      usageEntry('Movies', '/Users/me/Movies', 18 * GiB, 'dir', 240),
      usageEntry('Documents', '/Users/me/Documents', 8 * GiB, 'dir', 3200),
      usageEntry('.npm', '/Users/me/.npm', 4 * GiB, 'dir', 90000),
    ]),
    '/Users/me/Library': mockScan(
      '/Users/me/Library',
      [
        usageEntry('Application Support', '/Users/me/Library/Application Support', 70 * GiB, 'dir', 220000),
        usageEntry('Containers', '/Users/me/Library/Containers', 22 * GiB, 'dir', 160000),
        usageEntry('Caches', '/Users/me/Library/Caches', 12 * GiB, 'dir', 140000),
        usageEntry('Mail', '/Users/me/Library/Mail', 0, 'dir', 0, true),
      ],
      [],
      true,
    ),
    '/Users/me/Library/Application Support': mockScan('/Users/me/Library/Application Support', [
      usageEntry('Cursor', '/Users/me/Library/Application Support/Cursor', 28 * GiB, 'dir', 40000),
      usageEntry('Code', '/Users/me/Library/Application Support/Code', 16 * GiB, 'dir', 30000),
      usageEntry('Steam', '/Users/me/Library/Application Support/Steam', 14 * GiB, 'dir', 8000),
    ]),
    '/Users/me/Downloads': mockScan('/Users/me/Downloads', [
      usageEntry('讲座.mp4', '/Users/me/Downloads/讲座.mp4', 22 * GiB, 'file', 1),
      usageEntry('Xcode.dmg', '/Users/me/Downloads/Xcode.dmg', 8 * GiB, 'file', 1),
      usageEntry('安装包', '/Users/me/Downloads/安装包', 10 * GiB, 'dir', 40),
    ]),
    '/Applications': mockScan('/Applications', [
      usageEntry('Xcode.app', '/Applications/Xcode.app', 18 * GiB, 'dir', 20000),
      usageEntry('Docker.app', '/Applications/Docker.app', 4 * GiB, 'dir', 3000),
      usageEntry('微信.app', '/Applications/微信.app', 1.2 * GiB, 'dir', 800),
    ]),
    '/System': mockScan('/System', [
      usageEntry('Volumes', '/System/Volumes', 9 * GiB, 'dir', 4000),
      usageEntry('Library', '/System/Library', 5 * GiB, 'dir', 180000),
    ]),
    '/System/Volumes': mockScan('/System/Volumes', [
      usageEntry('Data', '/System/Volumes/Data', 8 * GiB, 'dir', 3000),
    ]),
    '/nix': mockScan('/nix', [usageEntry('store', '/nix/store', 6 * GiB, 'dir', 90000)]),
    '/Volumes/WorkBuddy': mockScan('/Volumes/WorkBuddy', [
      usageEntry('Applications', '/Volumes/WorkBuddy/Applications', 18 * GiB, 'dir', 4000),
    ]),
  };
  return (
    mocks[path] ??
    mockScan(path, [
      usageEntry('资料', `${path}/资料`, 2 * GiB, 'dir', 120),
      usageEntry('归档.zip', `${path}/归档.zip`, 800 * 1024 * 1024, 'file', 1),
    ])
  );
}

const MiB = 1024 ** 2;
const uninstalledMockAppIds = new Set<string>();

function mockDockerScan(): DockerScanResult {
  return {
    cli_available: true,
    daemon_running: true,
    docker_path: '/usr/local/bin/docker',
    version: '29.8.0',
    total_size_bytes: Math.round(20.13 * GiB),
    total_reclaimable_bytes: Math.round(12.4 * GiB),
    types: [
      {
        type_name: 'Images',
        total_count: 18,
        active_count: 4,
        size_bytes: Math.round(8.2 * GiB),
        reclaimable_bytes: Math.round(5.1 * GiB),
      },
      {
        type_name: 'Containers',
        total_count: 12,
        active_count: 3,
        size_bytes: Math.round(1.4 * GiB),
        reclaimable_bytes: Math.round(0.9 * GiB),
      },
      {
        type_name: 'Local Volumes',
        total_count: 8,
        active_count: 3,
        size_bytes: Math.round(6.5 * GiB),
        reclaimable_bytes: Math.round(1.2 * GiB),
      },
      {
        type_name: 'Build Cache',
        total_count: 42,
        active_count: 0,
        size_bytes: Math.round(4.0 * GiB),
        reclaimable_bytes: Math.round(4.0 * GiB),
      },
    ],
    actions: [
      {
        id: 'stopped_containers',
        name: '已停止的容器',
        risk_level: 'safe',
        description: '删除 exited 容器',
        reclaimable_bytes: Math.round(0.9 * GiB),
        item_count: 9,
        default_selected: true,
      },
      {
        id: 'dangling_images',
        name: '悬空镜像',
        risk_level: 'safe',
        description: '无标签中间层镜像',
        reclaimable_bytes: Math.round(1.8 * GiB),
        item_count: 6,
        default_selected: true,
      },
      {
        id: 'unused_images',
        name: '未使用镜像',
        risk_level: 'recommended',
        description: '未被容器引用的镜像',
        reclaimable_bytes: Math.round(5.1 * GiB),
        item_count: 14,
        default_selected: false,
      },
      {
        id: 'unused_networks',
        name: '未使用网络',
        risk_level: 'safe',
        description: '无容器引用的网络',
        reclaimable_bytes: 0,
        item_count: 3,
        default_selected: true,
      },
      {
        id: 'build_cache',
        name: '构建缓存',
        risk_level: 'safe',
        description: 'BuildKit / builder 缓存',
        reclaimable_bytes: Math.round(4.0 * GiB),
        item_count: 42,
        default_selected: true,
      },
      {
        id: 'unused_volumes',
        name: '未使用数据卷',
        risk_level: 'caution',
        description: '可能含数据库数据',
        reclaimable_bytes: Math.round(1.2 * GiB),
        item_count: 5,
        default_selected: false,
      },
    ],
  };
}

function createMockApp(
  item: Omit<InstalledAppItem, 'residual_size_bytes' | 'removable' | 'origin'> & {
    removable?: boolean;
    origin?: InstalledAppItem['origin'];
  }
): InstalledAppItem {
  return {
    ...item,
    residual_size_bytes: sumResidualBytes(item.residuals),
    removable: item.removable ?? true,
    origin: item.origin ?? 'user',
  };
}

const mockInstalledApps: InstalledAppItem[] = [
  createMockApp({
    id: 'app_photoshop',
    name: 'Adobe Photoshop 2025',
    bundle_id: 'com.adobe.Photoshop',
    version: '26.3.0',
    category: '设计创意',
    app_path: '/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app',
    app_size_bytes: Math.round(3.2 * GiB),
    last_used_at: Date.now() - 12 * 86400 * 1000,
    residuals: [
      {
        id: 'ps_cache',
        name: 'Photoshop 暂存盘与渲染缓存',
        path: '~/Library/Caches/Adobe/Photoshop 2025',
        size_bytes: 980 * MiB,
        file_count: 4320,
        kind: 'cache',
      },
      {
        id: 'ps_support',
        name: 'Adobe 预设、插件与字体支持文件',
        path: '~/Library/Application Support/Adobe/Adobe Photoshop 2025',
        size_bytes: 460 * MiB,
        file_count: 1850,
        kind: 'support',
      },
      {
        id: 'ps_logs',
        name: '崩溃日志与运行诊断记录',
        path: '~/Library/Logs/Adobe/Photoshop',
        size_bytes: 42 * MiB,
        file_count: 210,
        kind: 'logs',
      },
    ],
  }),
  createMockApp({
    id: 'app_docker',
    name: 'Docker Desktop',
    bundle_id: 'com.docker.docker',
    version: '4.38.0',
    category: '开发工具',
    app_path: '/Applications/Docker.app',
    app_size_bytes: Math.round(1.9 * GiB),
    last_used_at: Date.now() - 3 * 86400 * 1000,
    residuals: [
      {
        id: 'docker_vm',
        name: '虚拟磁盘镜像与容器缓存 (Docker.raw)',
        path: '~/Library/Containers/com.docker.docker/Data/vms',
        size_bytes: 580 * MiB,
        file_count: 68,
        kind: 'container',
      },
      {
        id: 'docker_logs',
        name: '守护进程与引擎日志',
        path: '~/Library/Group Containers/group.com.docker/logs',
        size_bytes: 60 * MiB,
        file_count: 340,
        kind: 'logs',
      },
    ],
  }),
  createMockApp({
    id: 'app_wechat',
    name: '微信 (WeChat)',
    bundle_id: 'com.tencent.xinWeChat',
    version: '4.0.3',
    category: '社交通讯',
    app_path: '/Applications/WeChat.app',
    app_size_bytes: 680 * MiB,
    last_used_at: Date.now() - 1 * 86400 * 1000,
    residuals: [
      {
        id: 'wx_container',
        name: '聊天多媒体与小程序沙盒数据',
        path: '~/Library/Containers/com.tencent.xinWeChat/Data',
        size_bytes: 345 * MiB,
        file_count: 9120,
        kind: 'container',
      },
      {
        id: 'wx_prefs',
        name: '偏好设置与账号配置缓存',
        path: '~/Library/Preferences/com.tencent.xinWeChat.plist',
        size_bytes: 18 * MiB,
        file_count: 24,
        kind: 'preferences',
      },
    ],
  }),
  createMockApp({
    id: 'app_chrome',
    name: 'Google Chrome',
    bundle_id: 'com.google.Chrome',
    version: '134.0.6998',
    category: '网络浏览器',
    app_path: '/Applications/Google Chrome.app',
    app_size_bytes: 540 * MiB,
    last_used_at: Date.now() - 2 * 86400 * 1000,
    residuals: [
      {
        id: 'chrome_profile',
        name: '用户配置、扩展程序与网页离线存储',
        path: '~/Library/Application Support/Google/Chrome',
        size_bytes: 215 * MiB,
        file_count: 5400,
        kind: 'support',
      },
      {
        id: 'chrome_cache',
        name: '媒体与脚本缓存',
        path: '~/Library/Caches/Google/Chrome',
        size_bytes: 95 * MiB,
        file_count: 3200,
        kind: 'cache',
      },
    ],
  }),
  createMockApp({
    id: 'app_raycast',
    name: 'Raycast',
    bundle_id: 'com.raycast.macos',
    version: '1.93.2',
    category: '效率启动',
    app_path: '/Applications/Raycast.app',
    app_size_bytes: 120 * MiB,
    last_used_at: Date.now() - 5 * 86400 * 1000,
    residuals: [
      {
        id: 'raycast_support',
        name: '扩展插件与剪贴板索引',
        path: '~/Library/Application Support/com.raycast.macos',
        size_bytes: 24 * MiB,
        file_count: 145,
        kind: 'support',
      },
      {
        id: 'raycast_prefs',
        name: '快捷键与偏好配置',
        path: '~/Library/Preferences/com.raycast.macos.plist',
        size_bytes: 2 * MiB,
        file_count: 4,
        kind: 'preferences',
      },
    ],
  }),
  createMockApp({
    id: 'app_typora',
    name: 'Typora',
    bundle_id: 'abnerworks.Typora',
    version: '1.9.5',
    category: '文档写作',
    app_path: '/Applications/Typora.app',
    app_size_bytes: 95 * MiB,
    last_used_at: Date.now() - 20 * 86400 * 1000,
    residuals: [
      {
        id: 'typora_support',
        name: '主题样式与草稿自动备份',
        path: '~/Library/Application Support/abnerworks.Typora',
        size_bytes: 48 * MiB,
        file_count: 320,
        kind: 'support',
      },
    ],
  }),
  createMockApp({
    id: 'app_keka',
    name: 'Keka',
    bundle_id: 'com.aone.keka',
    version: '1.4.8',
    category: '系统工具',
    app_path: '/Applications/Keka.app',
    app_size_bytes: 78 * MiB,
    last_used_at: Date.now() - 40 * 86400 * 1000,
    residuals: [
      {
        id: 'keka_prefs',
        name: '压缩规则配置与缓存',
        path: '~/Library/Containers/com.aone.keka/Data/Library/Preferences',
        size_bytes: 6 * MiB,
        file_count: 14,
        kind: 'preferences',
      },
    ],
  }),
];
