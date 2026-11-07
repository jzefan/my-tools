export type PlatformType =
  | 'douyin'
  | 'xiaohongshu'
  | 'bilibili'
  | 'wechat_channel'
  | 'kuaishou'
  | 'zhihu'
  | 'wechat_mp'
  | 'toutiao'
  | 'baijiahao'
  | 'weibo'
  | 'custom';

export type ContentType = 'video' | 'post';

export interface PlatformMeta {
  id: PlatformType;
  label: string;
  icon: string;
  defaultPublishUrl: string;
  allowedTypes: ('video' | 'post')[];
  maxTitleLen: number;
  maxContentLen: number;
  maxImages: number;
  tagPrefix: string;
  description?: string;
}

export interface CustomConfig {
  loginUrl?: string;
  publishUrl?: string;
  userAgent?: string;
  cookie?: string;
  headers?: Record<string, string>;
  selectors?: {
    titleInput?: string;
    contentInput?: string;
    uploadButton?: string;
    publishButton?: string;
    tagInput?: string;
  };
  [key: string]: unknown;
}

export interface PlatformOverrideConfig {
  platform: PlatformType;
  title?: string;
  content?: string;
  tags?: string[];
  coverPath?: string;
  visibility?: 'public' | 'private' | 'friends';
  customConfig?: Record<string, unknown>;
}

export type PublishMode = 'silent' | 'visible';

export interface MediaContent {
  type: ContentType;
  title: string;
  content: string;
  tags: string[];
  videoPath?: string;
  imagePaths?: string[];
  coverPath?: string;
  linkUrl?: string;
}

export interface CreatePublishTaskRequest {
  accountIds: string[];
  content: MediaContent;
  mode: PublishMode;
  scheduleTime?: number;
  platformOverrides?: Record<string, PlatformOverrideConfig>;
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type AccountPublishStage =
  | 'queued'
  | 'validating'
  | 'uploading'
  | 'filling'
  | 'publishing'
  | 'done'
  | 'failed';

export interface TaskLogItem {
  id: string;
  timestamp: number;
  accountId?: string;
  platform?: PlatformType;
  stage?: AccountPublishStage;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  detail?: string;
}

export interface AccountPublishProgress {
  accountId: string;
  platform: PlatformType;
  accountName: string;
  stage: AccountPublishStage;
  progress: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  publishUrl?: string;
  errorMessage?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface PublishTask {
  id: string;
  status: TaskStatus;
  mode: PublishMode;
  content: MediaContent;
  accounts: AccountPublishProgress[];
  platformOverrides?: Record<string, PlatformOverrideConfig>;
  logs: TaskLogItem[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  scheduledAt?: number;
  summary?: {
    total: number;
    success: number;
    failed: number;
  };
}

export type CannedReplyCategory = 'intro' | 'outro' | 'copyright' | 'comment' | 'general';

export interface CannedReply {
  id: string;
  title: string;
  content: string;
  category: CannedReplyCategory;
  tags?: string[];
  platforms?: PlatformType[];
  usageCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface KeywordRule {
  id: string;
  name: string;
  keywords: string[];
  matchType: 'exact' | 'contains' | 'regex';
  replyContent: string;
  enabled: boolean;
  platforms?: PlatformType[];
  createdAt: number;
  updatedAt: number;
}

export interface MediaAccount {
  id: string;
  platform: PlatformType;
  name: string;
  avatar?: string;
  status: 'active' | 'expired' | 'error' | 'unauthorized';
  lastCheckedAt?: number;
  loginCookies?: string;
  browserProfileId?: string;
  group?: string;
  customConfig?: CustomConfig;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface VideoMetaInfo {
  path: string;
  duration: number;
  width: number;
  height: number;
  aspectRatio: string;
  sizeBytes: number;
  format: string;
  bitrate?: number;
  fps?: number;
  hasAudio: boolean;
  suggestedPlatforms: PlatformType[];
}

export interface CopyPolishResult {
  original: string;
  polishedTitle: string;
  polishedContent: string;
  suggestedTags: string[];
  platformTips?: string[];
  characterCount: number;
}

export const PLATFORM_METAS: Record<PlatformType, PlatformMeta> = {
  douyin: {
    id: 'douyin',
    label: '抖音',
    icon: 'Video',
    defaultPublishUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    allowedTypes: ['video', 'post'],
    maxTitleLen: 30,
    maxContentLen: 1000,
    maxImages: 35,
    tagPrefix: '#',
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    label: '小红书',
    icon: 'Camera',
    defaultPublishUrl: 'https://creator.xiaohongshu.com/publish/publish',
    allowedTypes: ['post', 'video'],
    maxTitleLen: 20,
    maxContentLen: 1000,
    maxImages: 18,
    tagPrefix: '#',
  },
  bilibili: {
    id: 'bilibili',
    label: '哔哩哔哩',
    icon: 'Tv',
    defaultPublishUrl: 'https://member.bilibili.com/platform/upload/video/frame',
    allowedTypes: ['video', 'post'],
    maxTitleLen: 80,
    maxContentLen: 2000,
    maxImages: 9,
    tagPrefix: '#',
  },
  wechat_channel: {
    id: 'wechat_channel',
    label: '微信视频号',
    icon: 'Film',
    defaultPublishUrl: 'https://channels.weixin.qq.com/platform/post/create',
    allowedTypes: ['video', 'post'],
    maxTitleLen: 30,
    maxContentLen: 1000,
    maxImages: 9,
    tagPrefix: '#',
  },
  kuaishou: {
    id: 'kuaishou',
    label: '快手',
    icon: 'Flame',
    defaultPublishUrl: 'https://cp.kuaishou.com/article/publish/video',
    allowedTypes: ['video', 'post'],
    maxTitleLen: 50,
    maxContentLen: 1000,
    maxImages: 9,
    tagPrefix: '#',
  },
  zhihu: {
    id: 'zhihu',
    label: '知乎',
    icon: 'BookOpen',
    defaultPublishUrl: 'https://zhuanlan.zhihu.com/write',
    allowedTypes: ['post', 'video'],
    maxTitleLen: 100,
    maxContentLen: 10000,
    maxImages: 50,
    tagPrefix: '#',
  },
  wechat_mp: {
    id: 'wechat_mp',
    label: '微信公众号',
    icon: 'FileText',
    defaultPublishUrl: 'https://mp.weixin.qq.com',
    allowedTypes: ['post'],
    maxTitleLen: 64,
    maxContentLen: 20000,
    maxImages: 100,
    tagPrefix: '#',
  },
  toutiao: {
    id: 'toutiao',
    label: '今日头条',
    icon: 'Newspaper',
    defaultPublishUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    allowedTypes: ['post', 'video'],
    maxTitleLen: 30,
    maxContentLen: 5000,
    maxImages: 30,
    tagPrefix: '#',
  },
  baijiahao: {
    id: 'baijiahao',
    label: '百家号',
    icon: 'Feather',
    defaultPublishUrl: 'https://baijiahao.baidu.com/builder/rc/edit',
    allowedTypes: ['post', 'video'],
    maxTitleLen: 30,
    maxContentLen: 5000,
    maxImages: 30,
    tagPrefix: '#',
  },
  weibo: {
    id: 'weibo',
    label: '微博',
    icon: 'Send',
    defaultPublishUrl: 'https://weibo.com',
    allowedTypes: ['post', 'video'],
    maxTitleLen: 30,
    maxContentLen: 2000,
    maxImages: 18,
    tagPrefix: '#',
  },
  custom: {
    id: 'custom',
    label: '自定义平台',
    icon: 'Globe',
    defaultPublishUrl: '',
    allowedTypes: ['post', 'video'],
    maxTitleLen: 100,
    maxContentLen: 5000,
    maxImages: 20,
    tagPrefix: '#',
  },
};
