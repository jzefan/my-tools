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
} from '../types/cleaner';

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
