import {
  Layers,
  Minimize2,
  Sparkles,
  Settings,
  ArrowLeftRight,
  BookOpen,
  Files,
  Library,
  FileEdit,
  BookMarked,
  Trash2,
  FolderTree,
  MessageCircle,
  MessageSquare,
  Code2,
  HardDrive,
  Cloud,
  Search,
  Bookmark,
  Keyboard,
  Timer,
  BarChart3,
  Share2,
  Send,
  Users,
  Clock,
  MessageSquareText,
  Wrench,
} from 'lucide-react';
import { SuiteConfig, SuiteId, ActiveTabId, DocSubTab } from './types';

// Document Processing Suite Definition
export const DOCS_SUITE: SuiteConfig = {
  id: 'docs',
  name: '文档处理',
  shortName: '文档',
  icon: Files,
  defaultTab: 'merge',
  subItems: [
    {
      id: 'merge',
      label: '合并文件',
      sublabel: 'PDF / 图片 / Word',
      icon: Layers,
      color: 'text-indigo-500',
      activeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    },
    {
      id: 'convert',
      label: '格式转换',
      sublabel: 'Word 与 PDF / 图片互转',
      icon: ArrowLeftRight,
      color: 'text-blue-500',
      activeBg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    },
    {
      id: 'compress',
      label: '压缩文档',
      sublabel: '优化文档体积',
      icon: Minimize2,
      color: 'text-emerald-500',
      activeBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    },
    {
      id: 'watermark',
      label: '去除水印',
      sublabel: '清除文字与图层水印',
      icon: Sparkles,
      color: 'text-amber-500',
      activeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    },
    {
      id: 'system',
      label: '系统右键集成',
      sublabel: '访达 / Windows 菜单',
      icon: Settings,
      color: 'text-slate-500',
      activeBg: 'bg-slate-100 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700',
    },
  ],
};

// Paper Study Suite Definition
export const PAPER_SUITE: SuiteConfig = {
  id: 'paper',
  name: '论文研读',
  shortName: '论文',
  icon: BookOpen,
  defaultTab: 'paper',
  subItems: [
    {
      id: 'paper_library',
      label: '文献资料库',
      sublabel: '管理已导入文献与元数据',
      icon: Library,
      color: 'text-teal-500',
      activeBg: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800',
    },
    {
      id: 'paper_reader',
      label: '阅读与批注',
      sublabel: '全文导读、批注与 AI 问答',
      icon: BookMarked,
      color: 'text-indigo-500',
      activeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    },
    {
      id: 'paper_editor',
      label: '手稿工作台',
      sublabel: '草稿撰写与 AI 学术润色',
      icon: FileEdit,
      color: 'text-violet-500',
      activeBg: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
    },
  ],
};

// Disk Cleaner Suite Definition (Inspired by Mole)
export const CLEANER_SUITE: SuiteConfig = {
  id: 'cleaner',
  name: '磁盘清理',
  shortName: '清理',
  icon: Trash2,
  defaultTab: 'cleaner',
  subItems: [
    {
      id: 'cleaner',
      label: '全部扫描',
      sublabel: '一键扫描与安全清理',
      icon: Sparkles,
      color: 'text-indigo-500',
      activeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    },
    {
      id: 'cleaner_usage',
      label: '空间分布',
      sublabel: '目录占用',
      icon: FolderTree,
      color: 'text-sky-500',
      activeBg: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    },
    {
      id: 'cleaner_wechat',
      label: '微信专清',
      sublabel: '网页内核、朋友圈流媒体',
      icon: MessageCircle,
      color: 'text-emerald-500',
      activeBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    },
    {
      id: 'cleaner_qq',
      label: 'QQ 专清',
      sublabel: '渲染缓存、表情包缩略图',
      icon: MessageSquare,
      color: 'text-blue-500',
      activeBg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    },
    {
      id: 'cleaner_developer',
      label: '开发者缓存',
      sublabel: 'Xcode、Node、Homebrew',
      icon: Code2,
      color: 'text-amber-500',
      activeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    },
    {
      id: 'cleaner_system',
      label: '系统与应用日志',
      sublabel: '通用缓存、崩溃报告、废纸篓',
      icon: HardDrive,
      color: 'text-slate-500',
      activeBg: 'bg-slate-100 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700',
    },
  ],
};

// All available suites in registry
export const NETDISK_SUITE: SuiteConfig = {
  id: 'netdisk', name: '网盘搜索', shortName: '网盘', icon: Cloud, defaultTab: 'netdisk',
  subItems: [
    { id: 'netdisk', label: '资源搜索', sublabel: '搜索主流网盘资源', icon: Search, color: 'text-indigo-500', activeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' },
    { id: 'netdisk_saved', label: '我的收藏', sublabel: '已收藏的分享链接', icon: Bookmark, color: 'text-indigo-500', activeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' },
    { id: 'netdisk_sources', label: '搜索源', sublabel: '管理搜索服务', icon: Settings, color: 'text-slate-500', activeBg: 'bg-slate-100 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700' },
  ],
};

export const TYPING_SUITE: SuiteConfig = {
  id: 'typing',
  name: '打字记词',
  shortName: '记词',
  icon: Keyboard,
  defaultTab: 'typing',
  subItems: [
    {
      id: 'typing',
      label: '今日',
      sublabel: '热身与继续',
      icon: Timer,
      color: 'text-indigo-500',
      activeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    },
    {
      id: 'typing_lesson',
      label: '课程',
      sublabel: '八关指法',
      icon: Keyboard,
      color: 'text-emerald-500',
      activeBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    },
    {
      id: 'typing_words',
      label: '单词',
      sublabel: '跟打、默写、听写',
      icon: BookOpen,
      color: 'text-amber-500',
      activeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    },
    {
      id: 'typing_read',
      label: '短文',
      sublabel: '逐句跟打',
      icon: BookMarked,
      color: 'text-violet-500',
      activeBg: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
    },
    {
      id: 'typing_stats',
      label: '记录',
      sublabel: '速度、准确率、错键',
      icon: BarChart3,
      color: 'text-slate-500',
      activeBg: 'bg-slate-100 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700',
    },
  ],
};

export const MEDIA_SUITE: SuiteConfig = {
  id: 'media',
  name: '自媒体分发',
  shortName: '分发',
  icon: Share2,
  defaultTab: 'media_publish',
  subItems: [
    {
      id: 'media_publish',
      label: '一键发布',
      sublabel: '图文与视频多平台同步',
      icon: Send,
      color: 'text-indigo-500',
      activeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    },
    {
      id: 'media_accounts',
      label: '账号矩阵',
      sublabel: '多平台登录态与隔离',
      icon: Users,
      color: 'text-emerald-500',
      activeBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    },
    {
      id: 'media_tasks',
      label: '任务中心',
      sublabel: '发布进度与历史队列',
      icon: Clock,
      color: 'text-amber-500',
      activeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    },
    {
      id: 'media_replies',
      label: '话术互动',
      sublabel: '快捷话术库与关键词回复',
      icon: MessageSquareText,
      color: 'text-violet-500',
      activeBg: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
    },
    {
      id: 'media_tools',
      label: '媒体工具',
      sublabel: '文案优化与视频解析',
      icon: Wrench,
      color: 'text-slate-500',
      activeBg: 'bg-slate-100 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700',
    },
  ],
};

export const ALL_SUITES: SuiteConfig[] = [
  DOCS_SUITE,
  PAPER_SUITE,
  CLEANER_SUITE,
  NETDISK_SUITE,
  TYPING_SUITE,
  MEDIA_SUITE,
];

/**
 * Returns current compile-time enabled suite IDs
 * Configured via VITE_SUITE_TARGET env variable (e.g. 'all' | 'docs' | 'paper' | 'cleaner' | 'docs,paper,cleaner')
 */
export function getEnabledSuiteIds(): string[] {
  const target = (import.meta.env?.VITE_SUITE_TARGET || 'all').trim().toLowerCase();
  if (target === 'all' || !target) {
    return ALL_SUITES.map((s) => s.id);
  }
  const parts = target.split(',').map((p: string) => p.trim());
  return parts;
}

/**
 * Check if a suite is enabled in the current build
 */
export function isSuiteEnabled(suiteId: SuiteId): boolean {
  const enabled = getEnabledSuiteIds();
  return enabled.includes(suiteId);
}

/**
 * Return array of SuiteConfig for currently enabled suites
 */
export function getEnabledSuites(): SuiteConfig[] {
  const enabledIds = getEnabledSuiteIds();
  const suites = ALL_SUITES.filter((suite) => enabledIds.includes(suite.id));
  return suites.length > 0 ? suites : [DOCS_SUITE];
}

/**
 * Get default starting suite
 */
export function getDefaultSuite(): SuiteConfig {
  const suites = getEnabledSuites();
  return suites[0];
}

/**
 * Find suite containing given sub-tab or id
 */
export function findSuiteByTab(tab: ActiveTabId): SuiteConfig {
  const suites = getEnabledSuites();
  for (const suite of suites) {
    if (suite.defaultTab === tab) return suite;
    if (suite.subItems?.some((sub) => sub.id === tab)) {
      return suite;
    }
  }
  return suites[0];
}

/**
 * Map initial launch action to suite and tab
 */
export function resolveLaunchTarget(initialAction?: string): {
  suiteId: SuiteId;
  tab: ActiveTabId;
} {
  const suites = getEnabledSuites();
  const defaultSuite = suites[0];

  if (!initialAction) {
    return { suiteId: defaultSuite.id, tab: defaultSuite.defaultTab };
  }

  if (['netdisk', 'netdisk_saved', 'netdisk_sources'].includes(initialAction) && isSuiteEnabled('netdisk')) {
    return { suiteId: 'netdisk', tab: initialAction };
  }

  if (initialAction.startsWith('typing') && isSuiteEnabled('typing')) {
    return { suiteId: 'typing', tab: initialAction };
  }

  if (initialAction.startsWith('media') && isSuiteEnabled('media')) {
    return { suiteId: 'media', tab: initialAction };
  }

  if (initialAction === 'cleaner') {
    if (isSuiteEnabled('cleaner')) {
      return { suiteId: 'cleaner', tab: 'cleaner' };
    }
  }

  if (initialAction === 'paper') {
    if (isSuiteEnabled('paper')) {
      return { suiteId: 'paper', tab: 'paper' };
    }
  }

  const docTabs: DocSubTab[] = ['merge', 'convert', 'compress', 'watermark', 'system'];
  if (docTabs.includes(initialAction as DocSubTab)) {
    if (isSuiteEnabled('docs')) {
      return { suiteId: 'docs', tab: initialAction as DocSubTab };
    }
  }

  return { suiteId: defaultSuite.id, tab: defaultSuite.defaultTab };
}
