import { invoke } from '@tauri-apps/api/core';
import {
  MediaAccount,
  PublishTask,
  CreatePublishTaskRequest,
  CannedReply,
  KeywordRule,
  VideoMetaInfo,
  CopyPolishResult,
  PlatformType,
  AccountPublishProgress,
  PLATFORM_METAS,
} from '../types/media';

const STORAGE_KEYS = {
  ACCOUNTS: 'doc_tools_media_accounts',
  TASKS: 'doc_tools_media_tasks',
  CANNED_REPLIES: 'doc_tools_media_canned_replies',
  KEYWORD_RULES: 'doc_tools_media_keyword_rules',
};

export const PRESET_ACCOUNTS: MediaAccount[] = [
  {
    id: 'acc_douyin_default',
    platform: 'douyin',
    name: '抖音创作者号',
    status: 'active',
    group: '短视频矩阵',
    browserProfileId: 'profile_douyin_01',
    notes: '主发布账号',
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
  {
    id: 'acc_xhs_default',
    platform: 'xiaohongshu',
    name: '小红书生活志',
    status: 'active',
    group: '生活种草',
    browserProfileId: 'profile_xhs_01',
    notes: '图文与日常精选',
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
  {
    id: 'acc_bilibili_default',
    platform: 'bilibili',
    name: 'B站科技区',
    status: 'active',
    group: '长视频与深度',
    browserProfileId: 'profile_bili_01',
    notes: '高清横屏视频发布',
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
  {
    id: 'acc_wechat_channel_default',
    platform: 'wechat_channel',
    name: '微信视频号',
    status: 'active',
    group: '私域运营',
    browserProfileId: 'profile_sph_01',
    notes: '微信生态分发',
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
  {
    id: 'acc_zhihu_default',
    platform: 'zhihu',
    name: '知乎专栏',
    status: 'active',
    group: '深度图文',
    browserProfileId: 'profile_zhihu_01',
    notes: '技术专栏与干货',
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
];

export const PRESET_CANNED_REPLIES: CannedReply[] = [
  {
    id: 'cr_intro_1',
    title: '开场介绍',
    content: '哈喽大家好！欢迎来到本期内容，今天为大家带来关于效率工具与自媒体实战技巧。',
    category: 'intro',
    tags: ['通用', '开场'],
    usageCount: 12,
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
  {
    id: 'cr_outro_1',
    title: '三连与互动引导',
    content: '如果本期内容对你有帮助，欢迎点赞、收藏、转发支持！有任何疑问欢迎在评论区交流。',
    category: 'outro',
    tags: ['互动', '收尾'],
    usageCount: 28,
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
  {
    id: 'cr_copyright_1',
    title: '原创声明',
    content: '原创内容，未经作者许可严禁转载、洗稿或抄袭。',
    category: 'copyright',
    tags: ['版权', '声明'],
    usageCount: 35,
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
  {
    id: 'cr_comment_1',
    title: '置顶资源说明',
    content: '文中提到的工具和配置文件已整理在置顶评论与简介中，可自行获取。',
    category: 'comment',
    tags: ['资源', '评论'],
    usageCount: 19,
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
  {
    id: 'cr_general_1',
    title: '通用感谢',
    content: '感谢大家的关注与支持，后续会持续更新更多实用技巧。',
    category: 'general',
    tags: ['感谢', '日常'],
    usageCount: 8,
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
];

export const PRESET_KEYWORD_RULES: KeywordRule[] = [
  {
    id: 'kr_1',
    name: '资料与源码咨询',
    keywords: ['求资料', '源码', '链接', '课件', '求链接'],
    matchType: 'contains',
    replyContent: '资料已整理在简介链接与置顶评论中，请自取~ 如有问题随时留言。',
    enabled: true,
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
  {
    id: 'kr_2',
    name: '商务与合作交流',
    keywords: ['商务合作', '交流群', '加群', '联系方式'],
    matchType: 'contains',
    replyContent: '商务与交流合作请私信，并注明来意与单位。',
    enabled: true,
    createdAt: 1714000000000,
    updatedAt: 1714000000000,
  },
];

// In-memory store fallback when window.localStorage is not available
const inMemoryStore = new Map<string, string>();

function safeStorageGet(key: string): string | null {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      return window.localStorage.getItem(key);
    } catch {
      // ignore
    }
  }
  return inMemoryStore.get(key) ?? null;
}

function safeStorageSet(key: string, value: string): void {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }
  inMemoryStore.set(key, value);
}

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  const hashTagRegex = /#([\w\u4e00-\u9fa5]+)(?:#|\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = hashTagRegex.exec(text)) !== null) {
    if (match[1]) tags.add(match[1]);
  }

  // Common topic keywords matching
  const keywords = ['科技', '数码', '工具', '设计', 'AI', '生产力', '自媒体', '办公', '干货', '实测'];
  for (const kw of keywords) {
    if (text.includes(kw)) {
      tags.add(kw);
    }
  }

  return Array.from(tags);
}

export function matchKeywordRule(text: string, rules: KeywordRule[]): KeywordRule | null {
  const content = text.trim();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const kw of rule.keywords) {
      if (!kw) continue;
      if (rule.matchType === 'exact' && content === kw) {
        return rule;
      }
      if (rule.matchType === 'contains' && content.includes(kw)) {
        return rule;
      }
      if (rule.matchType === 'regex') {
        try {
          const re = new RegExp(kw, 'i');
          if (re.test(content)) return rule;
        } catch {
          // ignore invalid regex
        }
      }
    }
  }
  return null;
}

export class MediaApiService {
  // Accounts
  async getAccounts(): Promise<MediaAccount[]> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<MediaAccount[]>('media_get_accounts');
      } catch (err) {
        console.warn('Native media_get_accounts failed, using fallback:', err);
      }
    }

    const saved = safeStorageGet(STORAGE_KEYS.ACCOUNTS);
    if (!saved) {
      const initial = [...PRESET_ACCOUNTS];
      safeStorageSet(STORAGE_KEYS.ACCOUNTS, JSON.stringify(initial));
      return initial;
    }

    try {
      return JSON.parse(saved) as MediaAccount[];
    } catch {
      return [...PRESET_ACCOUNTS];
    }
  }

  async saveAccount(account: MediaAccount): Promise<MediaAccount> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<MediaAccount>('media_save_account', { account });
      } catch (err) {
        console.warn('Native media_save_account failed, using fallback:', err);
      }
    }

    const accounts = await this.getAccounts();
    const now = Date.now();
    const targetId = account.id || `acc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const index = accounts.findIndex((a) => a.id === targetId);

    const updated: MediaAccount = {
      ...account,
      id: targetId,
      createdAt: account.createdAt || now,
      updatedAt: now,
    };

    if (index >= 0) {
      accounts[index] = updated;
    } else {
      accounts.push(updated);
    }

    safeStorageSet(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts));
    return updated;
  }

  async deleteAccount(id: string): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        await invoke('media_delete_account', { id });
        return;
      } catch (err) {
        console.warn('Native media_delete_account failed, using fallback:', err);
      }
    }

    const accounts = await this.getAccounts();
    const filtered = accounts.filter((a) => a.id !== id);
    safeStorageSet(STORAGE_KEYS.ACCOUNTS, JSON.stringify(filtered));
  }

  async checkAccountStatus(id: string): Promise<MediaAccount> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<MediaAccount>('media_check_account_status', { id });
      } catch (err) {
        console.warn('Native media_check_account_status failed, using fallback:', err);
      }
    }

    const accounts = await this.getAccounts();
    const account = accounts.find((a) => a.id === id);
    if (!account) {
      throw new Error(`Account not found: ${id}`);
    }

    account.lastCheckedAt = Date.now();
    account.status = account.status === 'expired' ? 'expired' : 'active';
    await this.saveAccount(account);
    return account;
  }

  async batchCheckAccounts(): Promise<MediaAccount[]> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<MediaAccount[]>('media_batch_check_accounts');
      } catch (err) {
        console.warn('Native media_batch_check_accounts failed, using fallback:', err);
      }
    }

    const accounts = await this.getAccounts();
    const now = Date.now();
    const updatedList: MediaAccount[] = accounts.map((acc) => ({
      ...acc,
      lastCheckedAt: now,
    }));

    safeStorageSet(STORAGE_KEYS.ACCOUNTS, JSON.stringify(updatedList));
    return updatedList;
  }

  // Tasks
  async getTasks(): Promise<PublishTask[]> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<PublishTask[]>('media_get_tasks');
      } catch (err) {
        console.warn('Native media_get_tasks failed, using fallback:', err);
      }
    }

    const saved = safeStorageGet(STORAGE_KEYS.TASKS);
    if (!saved) return [];
    try {
      return JSON.parse(saved) as PublishTask[];
    } catch {
      return [];
    }
  }

  async createPublishTask(req: CreatePublishTaskRequest): Promise<PublishTask> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<PublishTask>('media_create_publish_task', { req });
      } catch (err) {
        console.warn('Native media_create_publish_task failed, using fallback:', err);
      }
    }

    if (!req.accountIds || req.accountIds.length === 0) {
      throw new Error('请选择至少一个发布账号');
    }

    const accounts = await this.getAccounts();
    const now = Date.now();

    const progressAccounts: AccountPublishProgress[] = req.accountIds.map((accId) => {
      const acc = accounts.find((a) => a.id === accId);
      const platform: PlatformType = acc ? acc.platform : 'custom';
      return {
        accountId: accId,
        platform,
        accountName: acc?.name || '未知账号',
        stage: 'queued',
        progress: 0,
        status: 'pending',
      };
    });

    const task: PublishTask = {
      id: `task_${now}_${Math.random().toString(36).substring(2, 7)}`,
      status: 'pending',
      mode: req.mode,
      content: req.content,
      accounts: progressAccounts,
      platformOverrides: req.platformOverrides,
      logs: [
        {
          id: `log_${now}_0`,
          timestamp: now,
          level: 'info',
          message: `发布任务已创建，等待调度 (${progressAccounts.length} 个账号)`,
        },
      ],
      createdAt: now,
      scheduledAt: req.scheduleTime,
      summary: {
        total: progressAccounts.length,
        success: 0,
        failed: 0,
      },
    };

    const tasks = await this.getTasks();
    tasks.unshift(task);
    safeStorageSet(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    return task;
  }

  async cancelTask(taskId: string): Promise<PublishTask> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<PublishTask>('media_cancel_task', { taskId });
      } catch (err) {
        console.warn('Native media_cancel_task failed, using fallback:', err);
      }
    }

    const tasks = await this.getTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status === 'completed' || task.status === 'cancelled') {
      return task;
    }

    const now = Date.now();
    task.status = 'cancelled';
    task.completedAt = now;

    for (const acc of task.accounts) {
      if (acc.status === 'pending' || acc.status === 'running') {
        acc.status = 'failed';
        acc.errorMessage = '发布已被用户取消';
        acc.finishedAt = now;
      }
    }

    task.logs.push({
      id: `log_${now}_${Math.random().toString(36).substring(2, 5)}`,
      timestamp: now,
      level: 'warn',
      message: '用户已取消任务执行',
    });

    if (task.summary) {
      task.summary.success = task.accounts.filter((a) => a.status === 'completed').length;
      task.summary.failed = task.accounts.filter((a) => a.status === 'failed').length;
    }

    safeStorageSet(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    return task;
  }

  async retryTask(taskId: string): Promise<PublishTask> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<PublishTask>('media_retry_task', { taskId });
      } catch (err) {
        console.warn('Native media_retry_task failed, using fallback:', err);
      }
    }

    const tasks = await this.getTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    let retryCount = 0;
    for (const acc of task.accounts) {
      if (acc.status === 'failed') {
        acc.status = 'pending';
        acc.stage = 'queued';
        acc.progress = 0;
        acc.errorMessage = undefined;
        acc.finishedAt = undefined;
        retryCount++;
      }
    }

    if (retryCount > 0) {
      const now = Date.now();
      task.status = 'pending';
      task.completedAt = undefined;
      task.logs.push({
        id: `log_${now}_${Math.random().toString(36).substring(2, 5)}`,
        timestamp: now,
        level: 'info',
        message: `重试已触发，重置 ${retryCount} 个失败账号子项`,
      });

      if (task.summary) {
        task.summary.success = task.accounts.filter((a) => a.status === 'completed').length;
        task.summary.failed = 0;
      }

      safeStorageSet(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    }

    return task;
  }

  async clearCompletedTasks(): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        await invoke('media_clear_completed_tasks');
        return;
      } catch (err) {
        console.warn('Native media_clear_completed_tasks failed, using fallback:', err);
      }
    }

    const tasks = await this.getTasks();
    const activeTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
    safeStorageSet(STORAGE_KEYS.TASKS, JSON.stringify(activeTasks));
  }

  // Canned Replies
  async getCannedReplies(): Promise<CannedReply[]> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<CannedReply[]>('media_get_canned_replies');
      } catch (err) {
        console.warn('Native media_get_canned_replies failed, using fallback:', err);
      }
    }

    const saved = safeStorageGet(STORAGE_KEYS.CANNED_REPLIES);
    if (!saved) {
      const initial = [...PRESET_CANNED_REPLIES];
      safeStorageSet(STORAGE_KEYS.CANNED_REPLIES, JSON.stringify(initial));
      return initial;
    }

    try {
      return JSON.parse(saved) as CannedReply[];
    } catch {
      return [...PRESET_CANNED_REPLIES];
    }
  }

  async saveCannedReply(reply: CannedReply): Promise<CannedReply> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<CannedReply>('media_save_canned_reply', { reply });
      } catch (err) {
        console.warn('Native media_save_canned_reply failed, using fallback:', err);
      }
    }

    const replies = await this.getCannedReplies();
    const now = Date.now();
    const targetId = reply.id || `cr_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const index = replies.findIndex((r) => r.id === targetId);

    const updated: CannedReply = {
      ...reply,
      id: targetId,
      createdAt: reply.createdAt || now,
      updatedAt: now,
    };

    if (index >= 0) {
      replies[index] = updated;
    } else {
      replies.push(updated);
    }

    safeStorageSet(STORAGE_KEYS.CANNED_REPLIES, JSON.stringify(replies));
    return updated;
  }

  async deleteCannedReply(id: string): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        await invoke('media_delete_canned_reply', { id });
        return;
      } catch (err) {
        console.warn('Native media_delete_canned_reply failed, using fallback:', err);
      }
    }

    const replies = await this.getCannedReplies();
    const filtered = replies.filter((r) => r.id !== id);
    safeStorageSet(STORAGE_KEYS.CANNED_REPLIES, JSON.stringify(filtered));
  }

  // Keyword Rules
  async getKeywordRules(): Promise<KeywordRule[]> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<KeywordRule[]>('media_get_keyword_rules');
      } catch (err) {
        console.warn('Native media_get_keyword_rules failed, using fallback:', err);
      }
    }

    const saved = safeStorageGet(STORAGE_KEYS.KEYWORD_RULES);
    if (!saved) {
      const initial = [...PRESET_KEYWORD_RULES];
      safeStorageSet(STORAGE_KEYS.KEYWORD_RULES, JSON.stringify(initial));
      return initial;
    }

    try {
      return JSON.parse(saved) as KeywordRule[];
    } catch {
      return [...PRESET_KEYWORD_RULES];
    }
  }

  async saveKeywordRule(rule: KeywordRule): Promise<KeywordRule> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<KeywordRule>('media_save_keyword_rule', { rule });
      } catch (err) {
        console.warn('Native media_save_keyword_rule failed, using fallback:', err);
      }
    }

    const rules = await this.getKeywordRules();
    const now = Date.now();
    const targetId = rule.id || `kr_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const index = rules.findIndex((r) => r.id === targetId);

    const updated: KeywordRule = {
      ...rule,
      id: targetId,
      createdAt: rule.createdAt || now,
      updatedAt: now,
    };

    if (index >= 0) {
      rules[index] = updated;
    } else {
      rules.push(updated);
    }

    safeStorageSet(STORAGE_KEYS.KEYWORD_RULES, JSON.stringify(rules));
    return updated;
  }

  async deleteKeywordRule(id: string): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        await invoke('media_delete_keyword_rule', { id });
        return;
      } catch (err) {
        console.warn('Native media_delete_keyword_rule failed, using fallback:', err);
      }
    }

    const rules = await this.getKeywordRules();
    const filtered = rules.filter((r) => r.id !== id);
    safeStorageSet(STORAGE_KEYS.KEYWORD_RULES, JSON.stringify(filtered));
  }

  // Media Inspection & AI Polish
  async inspectVideo(path: string): Promise<VideoMetaInfo> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<VideoMetaInfo>('media_inspect_video', { path });
      } catch (err) {
        console.warn('Native media_inspect_video failed, using fallback:', err);
      }
    }

    const isVertical = /(vertical|portrait|reel|short|9[-_x]16)/i.test(path);
    const width = isVertical ? 1080 : 1920;
    const height = isVertical ? 1920 : 1080;
    const format = path.split('.').pop()?.toLowerCase() || 'mp4';

    return {
      path,
      duration: 60,
      width,
      height,
      aspectRatio: isVertical ? '9:16' : '16:9',
      sizeBytes: 25 * 1024 * 1024,
      format,
      bitrate: 3500000,
      fps: 30,
      hasAudio: true,
      suggestedPlatforms: isVertical
        ? ['douyin', 'xiaohongshu', 'kuaishou', 'wechat_channel']
        : ['bilibili', 'zhihu', 'toutiao', 'baijiahao', 'wechat_mp'],
    };
  }

  async aiPolishCopy(text: string, platformHint?: string): Promise<CopyPolishResult> {
    if (isTauriEnvironment()) {
      try {
        return await invoke<CopyPolishResult>('media_ai_polish_copy', { text, platformHint });
      } catch (err) {
        console.warn('Native media_ai_polish_copy failed, using fallback:', err);
      }
    }

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const rawHeadline = lines[0] || '精选内容推荐';
    const cleanHeadline = rawHeadline.replace(/^#+/, '').trim();

    let polishedTitle = cleanHeadline;
    const platform = (platformHint || '').toLowerCase() as PlatformType;
    const meta = PLATFORM_METAS[platform];

    if (platform === 'xiaohongshu') {
      polishedTitle = `✨ ${cleanHeadline}`.slice(0, 20);
    } else if (platform === 'douyin') {
      polishedTitle = `🔥 ${cleanHeadline}`.slice(0, 30);
    } else if (platform === 'bilibili') {
      polishedTitle = `【干货】${cleanHeadline}`.slice(0, 80);
    } else if (meta && polishedTitle.length > meta.maxTitleLen) {
      polishedTitle = polishedTitle.slice(0, meta.maxTitleLen);
    }

    const extracted = extractTags(text);
    const defaultTags = ['干货分享', '实用工具', '自媒体运营'];
    const mergedTags = Array.from(new Set([...extracted, ...defaultTags]));

    const tipsMap: Record<string, string[]> = {
      xiaohongshu: ['建议配 3-6 张高质感图片', '首图大字突出核心痛点', '正文适当搭配 Emoji 增强节奏'],
      douyin: ['前 3 秒快速亮明核心结论', '背景音乐控制在合适音量', '置顶评论引导互动与提问'],
      bilibili: ['设置 16:9 高清封面', '添加章节分P更易获得长完播', '简介区附带完整资源参考'],
      wechat_channel: ['时长控制在 1-3 分钟最佳', '封面核心元素居中避免裁切', '转发朋友圈附带专属推荐语'],
    };

    const platformTips = tipsMap[platform] || [
      '发布前确认无违规关键词与引流联系方式',
      '选择对应垂直分区与 3-5 个热门话题',
    ];

    const polishedContent = lines.join('\n\n');

    return {
      original: text,
      polishedTitle,
      polishedContent,
      suggestedTags: mergedTags,
      platformTips,
      characterCount: polishedContent.length,
    };
  }
}

export const mediaApi = new MediaApiService();
