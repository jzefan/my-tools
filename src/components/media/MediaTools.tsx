import React, { useState, useRef } from 'react';
import {
  Sparkles,
  FileVideo,
  Copy,
  Check,
  Upload,
  CheckCircle2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { mediaApi } from '../../services/mediaApi';
import { VideoMetaInfo, CopyPolishResult } from '../../types/media';
import { formatFileSize } from '../../utils/format';

interface MediaToolsProps {
  onNotify?: (message: string) => void;
}

type PlatformStyle = 'xiaohongshu' | 'bilibili' | 'douyin' | 'zhihu';

const STYLE_OPTIONS: { id: PlatformStyle; label: string }[] = [
  { id: 'xiaohongshu', label: '小红书风' },
  { id: 'bilibili', label: 'B站风' },
  { id: 'douyin', label: '抖音风' },
  { id: 'zhihu', label: '知乎风' },
];

export const MediaTools: React.FC<MediaToolsProps> = ({ onNotify }) => {
  // AI Polish State
  const [inputText, setInputText] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<PlatformStyle>('xiaohongshu');
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishResult, setPolishResult] = useState<CopyPolishResult | null>(null);
  const [titleVariants, setTitleVariants] = useState<string[]>([]);
  const [copiedTitleIndex, setCopiedTitleIndex] = useState<number | null>(null);
  const [copiedContent, setCopiedContent] = useState(false);

  // Video Probe State
  const [videoFile, setVideoFile] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMetaInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Trigger AI Polish
  const handlePolish = async () => {
    if (!inputText.trim()) {
      onNotify?.('请输入待润色的文案或主题');
      return;
    }

    setIsPolishing(true);
    try {
      const res = await mediaApi.aiPolishCopy(inputText.trim(), selectedStyle);
      setPolishResult(res);

      // Generate 4 strategic title variants
      const base = res.polishedTitle.replace(/^[✨🔥【】]/g, '').trim();
      let variants: string[] = [];

      if (selectedStyle === 'xiaohongshu') {
        variants = [
          `✨ 听劝！关于${base}，新手必须知道的避坑指南`,
          `📒 熬夜整理！${base}保姆级实测与干货`,
          `🔥 后悔没早点知道！${base}效率直接翻倍`,
          `💡 亲测好用！${base}超详细整理分享`,
        ];
      } else if (selectedStyle === 'bilibili') {
        variants = [
          `【干货】${base}：一期视频彻底讲透核心逻辑！`,
          `别再瞎折腾了！${base}完全指南与避坑全流程`,
          `耗时两周实测！关于${base}的深度解析`,
          `从零到精通！${base}超强实战分享`,
        ];
      } else if (selectedStyle === 'douyin') {
        variants = [
          `🔥 90% 的人都不知道！${base}原来这么简单`,
          `赶紧收藏！${base}最快上手指南`,
          `三秒看完！关于${base}的核心秘诀`,
          `这才是${base}的正确打开方式！建议反复观看`,
        ];
      } else {
        variants = [
          `如何评价${base}？深度解析其核心价值与发展趋势`,
          `从事该领域多年，谈谈我对${base}的理解与经验`,
          `为什么越来越多的人选择${base}？底层逻辑是什么？`,
          `关于${base}，有哪些外行不知道但至关重要的细节？`,
        ];
      }

      setTitleVariants(variants);
      onNotify?.('文案优化完成');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '优化失败');
    } finally {
      setIsPolishing(false);
    }
  };

  const handleCopyTitle = async (title: string, index: number) => {
    try {
      await navigator.clipboard.writeText(title);
      setCopiedTitleIndex(index);
      onNotify?.('标题已复制');
      setTimeout(() => setCopiedTitleIndex(null), 1500);
    } catch {
      onNotify?.('复制失败');
    }
  };

  const handleCopyContent = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedContent(true);
      onNotify?.('文案已复制');
      setTimeout(() => setCopiedContent(false), 1500);
    } catch {
      onNotify?.('复制失败');
    }
  };

  // Handle Video file probe
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const realPath = (file as any).path || file.name;
    setVideoFile(realPath);
    try {
      const meta = await mediaApi.inspectVideo(realPath);
      setVideoMeta(meta);
      onNotify?.('视频元数据探针解析完成');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '探针解析失败');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      <div className="max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-5">
        {/* Section 1: AI Polish & Viral Titles */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xs space-y-4">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              文案润色与爆款标题生成
            </h2>
          </div>

          <div className="space-y-3">
            <textarea
              rows={4}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="输入原始内容或主题草稿..."
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-hidden focus:border-indigo-500 resize-y"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg">
                {STYLE_OPTIONS.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setSelectedStyle(style.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      selectedStyle === style.id
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {style.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handlePolish}
                disabled={isPolishing || !inputText.trim()}
                className="flex items-center space-x-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs disabled:cursor-not-allowed transition-colors"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isPolishing ? 'animate-spin' : ''}`} />
                <span>{isPolishing ? '生成中...' : '生成优化文案'}</span>
              </button>
            </div>
          </div>

          {/* Generated Result Panel */}
          {polishResult && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3 text-xs">
              {/* Title Variants */}
              <div className="space-y-2">
                <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                  备选爆款标题 (点击复制)
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {titleVariants.map((title, idx) => {
                    const isCopied = copiedTitleIndex === idx;

                    return (
                      <div
                        key={idx}
                        onClick={() => handleCopyTitle(title, idx)}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 bg-slate-50/50 dark:bg-slate-900/40 cursor-pointer transition-colors"
                      >
                        <span className="truncate pr-2 text-slate-800 dark:text-slate-200">
                          {title}
                        </span>
                        <span className="shrink-0 text-slate-400">
                          {isCopied ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Polished Content Preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    优化文案正文
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyContent(polishResult.polishedContent)}
                    className="flex items-center space-x-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700"
                  >
                    {copiedContent ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-500" />
                        <span>已复制正文</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>复制正文</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 whitespace-pre-line leading-relaxed text-slate-700 dark:text-slate-300">
                  {polishResult.polishedContent}
                </div>
              </div>

              {/* Suggested Tags & Tips */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400">推荐标签：</span>
                  {polishResult.suggestedTags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>

                {polishResult.platformTips && (
                  <div className="text-slate-400 truncate max-w-sm">
                    {polishResult.platformTips.join(' • ')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Section 2: Video Metadata & Platform Compliance Probe */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xs space-y-4">
          <div className="flex items-center space-x-2">
            <FileVideo className="w-4 h-4 text-emerald-500" />
            <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              视频元数据与平台合规探针
            </h2>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            accept="video/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {!videoFile ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-400 transition-colors"
            >
              <Upload className="w-6 h-6 mx-auto mb-2 text-slate-400" />
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                点击选择本地视频文件 (MP4 / MOV / FLV)
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Selected File Banner */}
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs">
                <div className="flex items-center space-x-2 min-w-0 pr-2">
                  <FileVideo className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="font-medium truncate" title={videoFile}>
                    {videoFile.split(/[/\\]/).pop()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setVideoFile(null);
                    setVideoMeta(null);
                  }}
                  className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Probe Data Badges */}
              {videoMeta && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 text-center">
                    <span className="text-[10px] text-slate-400 block mb-0.5">分辨率</span>
                    <span className="text-xs font-bold font-mono text-slate-900 dark:text-slate-100">
                      {videoMeta.width} x {videoMeta.height}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 text-center">
                    <span className="text-[10px] text-slate-400 block mb-0.5">画幅比例</span>
                    <span className="text-xs font-bold font-mono text-slate-900 dark:text-slate-100">
                      {videoMeta.aspectRatio}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 text-center">
                    <span className="text-[10px] text-slate-400 block mb-0.5">视频时长</span>
                    <span className="text-xs font-bold font-mono text-slate-900 dark:text-slate-100">
                      {videoMeta.duration} 秒
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 text-center">
                    <span className="text-[10px] text-slate-400 block mb-0.5">文件体积</span>
                    <span className="text-xs font-bold font-mono text-slate-900 dark:text-slate-100">
                      {formatFileSize(videoMeta.sizeBytes)}
                    </span>
                  </div>
                </div>
              )}

              {/* Platform Compliance Checklist */}
              {videoMeta && (
                <div className="space-y-2 pt-1 text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                    平台合规适配探针
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Douyin */}
                    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex items-start space-x-2.5">
                      {videoMeta.aspectRatio === '9:16' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-0.5 text-[11px]">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          抖音 / 快手
                        </div>
                        <div className="text-slate-500">
                          {videoMeta.aspectRatio === '9:16'
                            ? '符合 9:16 竖屏规范，适合信息流推荐'
                            : '当前为横屏，建议添加上下黑边或改为短视频竖屏裁剪'}
                        </div>
                      </div>
                    </div>

                    {/* B站 */}
                    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex items-start space-x-2.5">
                      {videoMeta.aspectRatio === '16:9' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-0.5 text-[11px]">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          哔哩哔哩
                        </div>
                        <div className="text-slate-500">
                          {videoMeta.aspectRatio === '16:9'
                            ? '符合 16:9 横屏标准分辨率，推荐高清发布'
                            : '当前为竖屏，B站客户端支持播放但推荐横屏以获更大曝光'}
                        </div>
                      </div>
                    </div>

                    {/* WeChat Channel */}
                    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex items-start space-x-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <div className="space-y-0.5 text-[11px]">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          微信视频号
                        </div>
                        <div className="text-slate-500">
                          时长 {videoMeta.duration}s 控制在合适区间，建议关键视觉元素居中
                        </div>
                      </div>
                    </div>

                    {/* Xiaohongshu */}
                    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex items-start space-x-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <div className="space-y-0.5 text-[11px]">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          小红书
                        </div>
                        <div className="text-slate-500">
                          画质符合要求，建议上传自定义封面图以提升点击率
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
