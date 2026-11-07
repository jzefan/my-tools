import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Video,
  Image as ImageIcon,
  Send,
  Plus,
  X,
  Upload,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Clock,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  PlatformType,
  MediaAccount,
  MediaContent,
  CreatePublishTaskRequest,
  PlatformOverrideConfig,
  PublishMode,
  CannedReply,
  VideoMetaInfo,
  PLATFORM_METAS,
} from '../../types/media';
import { mediaApi, extractTags } from '../../services/mediaApi';
import { formatFileSize } from '../../utils/format';
import { PlatformIcon } from './PlatformIcon';

interface MediaPublisherProps {
  onNavigate?: (tab: string) => void;
  onNotify?: (message: string) => void;
}

export const MediaPublisher: React.FC<MediaPublisherProps> = ({
  onNavigate,
  onNotify,
}) => {
  // Accounts state
  const [accounts, setAccounts] = useState<MediaAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [activeGroupFilter, setActiveGroupFilter] = useState<string>('all');

  // Content type
  const [contentType, setContentType] = useState<'video' | 'post'>('video');

  // Video assets
  const [videoPath, setVideoPath] = useState<string>('');
  const [videoMeta, setVideoMeta] = useState<VideoMetaInfo | null>(null);
  const [coverPath, setCoverPath] = useState<string>('');

  // Post assets
  const [imagePaths, setImagePaths] = useState<string[]>([]);

  // Text inputs
  const [title, setTitle] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState<string>('');

  // Canned replies
  const [cannedReplies, setCannedReplies] = useState<CannedReply[]>([]);
  const [isRepliesDropdownOpen, setIsRepliesDropdownOpen] = useState(false);

  // Settings
  const [scheduleMode, setScheduleMode] = useState<'now' | 'scheduled'>('now');
  const [scheduleDateTime, setScheduleDateTime] = useState<string>('');
  const [publishMode, setPublishMode] = useState<PublishMode>('silent');

  // Platform overrides accordion
  const [overrides, setOverrides] = useState<Record<string, PlatformOverrideConfig>>({});
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<string>>(new Set());

  // Submitting
  const [isSubmitting, setIsSubmitting] = useState(false);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Load initial accounts and canned replies
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [loadedAccounts, loadedReplies] = await Promise.all([
          mediaApi.getAccounts(),
          mediaApi.getCannedReplies(),
        ]);
        if (mounted) {
          setAccounts(loadedAccounts);
          setCannedReplies(loadedReplies);
          // Default select first 3 active accounts
          const activeIds = loadedAccounts
            .filter((a) => a.status === 'active')
            .map((a) => a.id);
          setSelectedAccountIds(activeIds);
        }
      } catch (err) {
        console.error('Failed to load accounts/replies:', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Compute available groups
  const groups = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach((a) => {
      if (a.group) set.add(a.group);
    });
    return Array.from(set);
  }, [accounts]);

  // Filtered accounts based on group
  const filteredAccounts = useMemo(() => {
    if (activeGroupFilter === 'all') return accounts;
    return accounts.filter((a) => a.group === activeGroupFilter);
  }, [accounts, activeGroupFilter]);

  // Selected accounts objects
  const selectedAccounts = useMemo(() => {
    return accounts.filter((a) => selectedAccountIds.includes(a.id));
  }, [accounts, selectedAccountIds]);

  // Platforms represented in current selection
  const selectedPlatforms = useMemo(() => {
    const map = new Map<PlatformType, MediaAccount[]>();
    for (const acc of selectedAccounts) {
      if (!map.has(acc.platform)) {
        map.set(acc.platform, []);
      }
      map.get(acc.platform)!.push(acc);
    }
    return map;
  }, [selectedAccounts]);

  // Video inspect probe
  const handleVideoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const realPath = (file as any).path || file.name;
    setVideoPath(realPath);
    try {
      const meta = await mediaApi.inspectVideo(realPath);
      setVideoMeta(meta);
    } catch {
      // fallback
      setVideoMeta(null);
    }
  };

  const handleCoverFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const realPath = (file as any).path || file.name;
    setCoverPath(realPath);
  };

  const handleAddImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newPaths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const realPath = (file as any).path || file.name;
      newPaths.push(realPath);
    }
    setImagePaths((prev) => [...prev, ...newPaths].slice(0, 35));
  };

  const handleRemoveImage = (index: number) => {
    setImagePaths((prev) => prev.filter((_, i) => i !== index));
  };

  // Account selection helpers
  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    setSelectedAccountIds(accounts.map((a) => a.id));
  };

  const handleClearSelection = () => {
    setSelectedAccountIds([]);
  };

  // Tag helpers
  const handleAddTag = (rawTag: string) => {
    const clean = rawTag.replace(/^#+/, '').trim();
    if (clean && !tags.includes(clean)) {
      setTags((prev) => [...prev, clean]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  };

  // Suggest tags from content
  const suggestedTags = useMemo(() => {
    const combined = `${title} ${content}`;
    const extracted = extractTags(combined);
    return extracted.filter((t) => !tags.includes(t)).slice(0, 6);
  }, [title, content, tags]);

  // Insert canned reply into content
  const handleInsertCannedReply = (reply: CannedReply) => {
    setContent((prev) => (prev ? `${prev}\n\n${reply.content}` : reply.content));
    setIsRepliesDropdownOpen(false);
    onNotify?.(`已插入话术：${reply.title}`);
  };

  // Toggle platform override accordion
  const toggleAccordion = (plat: string) => {
    setExpandedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(plat)) {
        next.delete(plat);
      } else {
        next.add(plat);
      }
      return next;
    });
  };

  const updatePlatformOverride = (plat: PlatformType, updates: Partial<PlatformOverrideConfig>) => {
    setOverrides((prev) => ({
      ...prev,
      [plat]: {
        ...prev[plat],
        platform: plat,
        ...updates,
      },
    }));
  };

  // Submit task
  const handleSubmit = async () => {
    if (selectedAccountIds.length === 0) {
      onNotify?.('请至少选择一个分发账号');
      return;
    }
    if (!title.trim()) {
      onNotify?.('请输入内容标题');
      return;
    }
    if (contentType === 'video' && !videoPath) {
      onNotify?.('请选择待发布的视频文件');
      return;
    }
    if (contentType === 'post' && imagePaths.length === 0) {
      onNotify?.('请至少上传一张配图');
      return;
    }

    setIsSubmitting(true);
    try {
      const mediaContent: MediaContent = {
        type: contentType,
        title: title.trim(),
        content: content.trim(),
        tags,
        videoPath: contentType === 'video' ? videoPath : undefined,
        imagePaths: contentType === 'post' ? imagePaths : undefined,
        coverPath: coverPath || undefined,
      };

      let scheduledTimestamp: number | undefined;
      if (scheduleMode === 'scheduled' && scheduleDateTime) {
        scheduledTimestamp = new Date(scheduleDateTime).getTime();
      }

      const req: CreatePublishTaskRequest = {
        accountIds: selectedAccountIds,
        content: mediaContent,
        mode: publishMode,
        scheduleTime: scheduledTimestamp,
        platformOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      };

      await mediaApi.createPublishTask(req);
      onNotify?.('分发任务已提交');
      if (onNavigate) {
        onNavigate('media_tasks');
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      <div className="max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-5">
        {/* Type & Mode Selection Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xs">
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setContentType('video')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                contentType === 'video'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              <span>短视频</span>
            </button>
            <button
              type="button"
              onClick={() => setContentType('post')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                contentType === 'post'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>图文动态</span>
            </button>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setPublishMode('silent')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition-colors ${
                  publishMode === 'silent'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500'
                }`}
                title="后台静默自动发布"
              >
                <EyeOff className="w-3 h-3 text-indigo-500" />
                <span>隐式发布</span>
              </button>
              <button
                type="button"
                onClick={() => setPublishMode('visible')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition-colors ${
                  publishMode === 'visible'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500'
                }`}
                title="开启窗口交互填单"
              >
                <Eye className="w-3 h-3 text-emerald-500" />
                <span>显示发布</span>
              </button>
            </div>

            <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setScheduleMode('now')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition-colors ${
                  scheduleMode === 'now'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>立即</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode('scheduled')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition-colors ${
                  scheduleMode === 'scheduled'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                <Calendar className="w-3 h-3" />
                <span>定时</span>
              </button>
            </div>

            {scheduleMode === 'scheduled' && (
              <input
                type="datetime-local"
                value={scheduleDateTime}
                onChange={(e) => setScheduleDateTime(e.target.value)}
                className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-xs focus:outline-hidden focus:border-indigo-500"
              />
            )}
          </div>
        </div>

        {/* Media Assets Section */}
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span>{contentType === 'video' ? '视频素材' : '图片素材'}</span>
            {contentType === 'post' && (
              <span className="text-slate-400 font-normal">已选 {imagePaths.length} / 35 张</span>
            )}
          </div>

          {contentType === 'video' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Video Selector */}
              <div className="md:col-span-2 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-3 hover:border-indigo-400 transition-colors">
                <input
                  type="file"
                  ref={videoInputRef}
                  accept="video/*"
                  onChange={handleVideoFileChange}
                  className="hidden"
                />
                {videoPath ? (
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 min-w-0 pr-2">
                      <div className="flex items-center space-x-2">
                        <Video className="w-4 h-4 text-indigo-500 shrink-0" />
                        <span className="text-xs font-medium truncate block max-w-sm" title={videoPath}>
                          {videoPath.split(/[/\\]/).pop()}
                        </span>
                      </div>
                      {videoMeta && (
                        <div className="flex items-center space-x-2 text-[11px] text-slate-500 font-mono">
                          <span>{videoMeta.width}x{videoMeta.height}</span>
                          <span>•</span>
                          <span>{videoMeta.aspectRatio}</span>
                          <span>•</span>
                          <span>{videoMeta.duration}s</span>
                          <span>•</span>
                          <span>{formatFileSize(videoMeta.sizeBytes)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center space-x-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => videoInputRef.current?.click()}
                        className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        更换
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVideoPath('');
                          setVideoMeta(null);
                        }}
                        className="p-1 text-slate-400 hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => videoInputRef.current?.click()}
                    className="flex flex-col items-center justify-center py-5 cursor-pointer text-slate-500 hover:text-indigo-600 transition-colors"
                  >
                    <Upload className="w-5 h-5 mb-1 text-slate-400" />
                    <span className="text-xs">选择本地视频 (MP4 / MOV)</span>
                  </div>
                )}
              </div>

              {/* Cover Selector */}
              <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-3 hover:border-indigo-400 transition-colors">
                <input
                  type="file"
                  ref={coverInputRef}
                  accept="image/*"
                  onChange={handleCoverFileChange}
                  className="hidden"
                />
                {coverPath ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 min-w-0 pr-1">
                      <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span className="text-xs truncate" title={coverPath}>
                        {coverPath.split(/[/\\]/).pop()}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCoverPath('')}
                      className="p-1 text-slate-400 hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => coverInputRef.current?.click()}
                    className="flex flex-col items-center justify-center py-5 cursor-pointer text-slate-500 hover:text-indigo-600 transition-colors"
                  >
                    <ImageIcon className="w-5 h-5 mb-1 text-slate-400" />
                    <span className="text-xs">选择视频封面 (可选)</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <input
                type="file"
                ref={imageInputRef}
                accept="image/*"
                multiple
                onChange={handleAddImages}
                className="hidden"
              />
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {imagePaths.map((_, idx) => (
                  <div
                    key={idx}
                    className="relative group aspect-square rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden"
                  >
                    <div className="text-[10px] text-slate-400 truncate px-1 text-center">
                      图 {idx + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(idx)}
                      className="absolute top-1 right-1 p-0.5 bg-black/60 rounded text-white hover:bg-red-600 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {imagePaths.length < 35 && (
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="aspect-square border border-dashed border-slate-300 dark:border-slate-700 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:text-indigo-600 hover:border-indigo-400 transition-colors"
                  >
                    <Plus className="w-4 h-4 mb-0.5" />
                    <span className="text-[11px]">添加图片</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Account Matrix Selector */}
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                发布账号矩阵
              </span>
              <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                ({selectedAccountIds.length} / {accounts.length})
              </span>
            </div>

            <div className="flex items-center space-x-1.5 text-xs">
              <button
                type="button"
                onClick={handleSelectAll}
                className="px-2 py-0.5 text-slate-600 dark:text-slate-300 hover:text-indigo-600 transition-colors"
              >
                全选
              </button>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <button
                type="button"
                onClick={handleClearSelection}
                className="px-2 py-0.5 text-slate-600 dark:text-slate-300 hover:text-indigo-600 transition-colors"
              >
                清空
              </button>
            </div>
          </div>

          {/* Group Filter Chips */}
          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setActiveGroupFilter('all')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  activeGroupFilter === 'all'
                    ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                全部
              </button>
              {groups.map((group) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => setActiveGroupFilter(group)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    activeGroupFilter === group
                      ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>
          )}

          {/* Account Chips Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-1">
            {filteredAccounts.map((account) => {
              const isSelected = selectedAccountIds.includes(account.id);
              const meta = PLATFORM_METAS[account.platform];
              const isOnline = account.status === 'active';

              return (
                <div
                  key={account.id}
                  onClick={() => toggleAccount(account.id)}
                  className={`flex items-center space-x-2 px-2.5 py-2 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-slate-900 dark:text-slate-100'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                  }`}
                >
                  <PlatformIcon platform={account.platform} className="w-3.5 h-3.5 shrink-0 text-slate-600 dark:text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{account.name}</div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {meta?.label || account.platform}
                    </div>
                  </div>
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isOnline ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                    title={isOnline ? '在线' : '需重新登录'}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Content Inputs (Title, Content, Tags) */}
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
              <span className="font-semibold">标题</span>
              <span className="text-slate-400 font-mono">{title.length} / 80</span>
            </div>
            <input
              type="text"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入发布标题"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-hidden focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 transition-colors"
            />
          </div>

          {/* Description & Canned replies */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
              <span className="font-semibold">正文描述</span>
              <div className="flex items-center space-x-3">
                {/* Insert Canned Reply Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsRepliesDropdownOpen((prev) => !prev)}
                    className="flex items-center space-x-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700"
                  >
                    <span>插入话术</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>

                  {isRepliesDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 w-56 max-h-56 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg z-20 py-1">
                      {cannedReplies.map((reply) => (
                        <button
                          key={reply.id}
                          type="button"
                          onClick={() => handleInsertCannedReply(reply)}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 truncate block"
                        >
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {reply.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-slate-400 font-mono">{content.length} / 2000</span>
              </div>
            </div>
            <textarea
              rows={5}
              value={content}
              maxLength={2000}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入正文简介、话题与互动指引..."
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-hidden focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 transition-colors resize-y"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
              <span className="font-semibold">话题标签</span>
              {suggestedTags.length > 0 && (
                <div className="flex items-center space-x-1 text-[11px] text-slate-400">
                  <Sparkles className="w-3 h-3 text-indigo-500" />
                  <span>推荐：</span>
                  {suggestedTags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleAddTag(t)}
                      className="hover:text-indigo-600 transition-colors"
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 p-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center space-x-1 px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs"
                >
                  <span>#{tag}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-red-500"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag(tagInput);
                  }
                }}
                placeholder="输入标签按回车"
                className="flex-1 min-w-[120px] bg-transparent text-xs focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        {/* Platform Overrides Accordion */}
        {selectedPlatforms.size > 0 && (
          <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <div className="flex items-center space-x-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                <span>各平台独立参数覆盖 (选填)</span>
              </div>
              <span className="text-[11px] font-normal text-slate-400">
                可针对不同平台定制差异化标题与分区
              </span>
            </div>

            <div className="space-y-2">
              {Array.from(selectedPlatforms.keys()).map((plat) => {
                const isExpanded = expandedPlatforms.has(plat);
                const meta = PLATFORM_METAS[plat];
                const conf = overrides[plat] || {};

                return (
                  <div
                    key={plat}
                    className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleAccordion(plat)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/40 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <PlatformIcon platform={plat} className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                        <span>{meta?.label || plat}</span>
                        {conf.title && (
                          <span className="text-[10px] text-indigo-500 font-normal">已覆盖标题</span>
                        )}
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="p-3 bg-white dark:bg-slate-900 space-y-3 text-xs border-t border-slate-100 dark:border-slate-800">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            专属标题 (留空跟随全局)
                          </label>
                          <input
                            type="text"
                            value={conf.title || ''}
                            onChange={(e) =>
                              updatePlatformOverride(plat, { title: e.target.value })
                            }
                            placeholder={title || '跟随全局标题'}
                            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-xs focus:outline-hidden focus:border-indigo-500"
                          />
                        </div>

                        {plat === 'bilibili' && (
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">
                              B站目标分区
                            </label>
                            <input
                              type="text"
                              value={(conf.customConfig?.tid as string) || ''}
                              onChange={(e) =>
                                updatePlatformOverride(plat, {
                                  customConfig: { ...conf.customConfig, tid: e.target.value },
                                })
                              }
                              placeholder="例如：科技 / 软件应用"
                              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-xs focus:outline-hidden focus:border-indigo-500"
                            />
                          </div>
                        )}

                        {plat === 'zhihu' && (
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">
                              知乎关联话题
                            </label>
                            <input
                              type="text"
                              value={(conf.customConfig?.topic as string) || ''}
                              onChange={(e) =>
                                updatePlatformOverride(plat, {
                                  customConfig: { ...conf.customConfig, topic: e.target.value },
                                })
                              }
                              placeholder="例如：生产力工具、软件推荐"
                              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-xs focus:outline-hidden focus:border-indigo-500"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Action Bar */}
        <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <span>已选</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono">
              {selectedAccountIds.length}
            </span>
            <span>个账号</span>
            <span>•</span>
            <span>{contentType === 'video' ? '视频发布' : '图文发布'}</span>
            <span>•</span>
            <span>{publishMode === 'silent' ? '隐式后台' : '显示交互'}</span>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || selectedAccountIds.length === 0 || !title.trim()}
            className="flex items-center space-x-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSubmitting ? '分发中...' : '一键分发'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
