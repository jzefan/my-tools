import React, { useState, useEffect, useMemo } from 'react';
import {
  MessageSquareText,
  Bot,
  Plus,
  Copy,
  Trash2,
  Check,
  X,
  Search,
} from 'lucide-react';
import {
  CannedReply,
  KeywordRule,
  CannedReplyCategory,
} from '../../types/media';
import { mediaApi } from '../../services/mediaApi';
import { confirmDialog } from '../../utils/dialog';

interface MediaRepliesHubProps {
  onNotify?: (message: string) => void;
}

const CATEGORY_MAP: Record<CannedReplyCategory, string> = {
  intro: '引流导流',
  copyright: '原创声明',
  outro: '互动回复',
  comment: '评论置顶',
  general: '通用模板',
};

export const MediaRepliesHub: React.FC<MediaRepliesHubProps> = ({ onNotify }) => {
  const [activeTab, setActiveTab] = useState<'canned' | 'rules'>('canned');

  // Canned replies state
  const [replies, setReplies] = useState<CannedReply[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [replySearch, setReplySearch] = useState('');
  const [isReplyModalOpen, setIsReplyModalOpen] = useState(false);
  const [replyTitle, setReplyTitle] = useState('');
  const [replyCategory, setReplyCategory] = useState<CannedReplyCategory>('intro');
  const [replyContent, setReplyContent] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Keyword rules state
  const [rules, setRules] = useState<KeywordRule[]>([]);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleKeywords, setRuleKeywords] = useState('');
  const [ruleMatchType, setRuleMatchType] = useState<'contains' | 'exact' | 'regex'>('contains');
  const [ruleReplyContent, setRuleReplyContent] = useState('');

  // Load initial data
  const loadData = async () => {
    try {
      const [loadedReplies, loadedRules] = await Promise.all([
        mediaApi.getCannedReplies(),
        mediaApi.getKeywordRules(),
      ]);
      setReplies(loadedReplies);
      setRules(loadedRules);
    } catch (err) {
      console.error('Failed to load replies/rules:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered canned replies
  const filteredReplies = useMemo(() => {
    return replies.filter((r) => {
      const matchCat = selectedCategory === 'all' || r.category === selectedCategory;
      const matchQuery =
        !replySearch.trim() ||
        r.title.toLowerCase().includes(replySearch.toLowerCase().trim()) ||
        r.content.toLowerCase().includes(replySearch.toLowerCase().trim());
      return matchCat && matchQuery;
    });
  }, [replies, selectedCategory, replySearch]);

  // Copy reply text
  const handleCopyReply = async (r: CannedReply) => {
    try {
      await navigator.clipboard.writeText(r.content);
      setCopiedId(r.id);
      onNotify?.('已复制到剪贴板');
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      onNotify?.('复制失败');
    }
  };

  // Delete reply
  const handleDeleteReply = async (id: string) => {
    const ok = await confirmDialog('确定删除该话术吗？');
    if (!ok) return;

    try {
      await mediaApi.deleteCannedReply(id);
      onNotify?.('话术已删除');
      await loadData();
    } catch (err) {
      onNotify?.('删除失败');
    }
  };

  // Save new reply
  const handleSaveReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyTitle.trim() || !replyContent.trim()) {
      onNotify?.('请填写完整话术标题与内容');
      return;
    }

    try {
      const now = Date.now();
      await mediaApi.saveCannedReply({
        id: `cr_${now}_${Math.random().toString(36).substring(2, 6)}`,
        title: replyTitle.trim(),
        category: replyCategory,
        content: replyContent.trim(),
        createdAt: now,
        updatedAt: now,
      });

      onNotify?.('话术已保存');
      setIsReplyModalOpen(false);
      setReplyTitle('');
      setReplyContent('');
      await loadData();
    } catch (err) {
      onNotify?.('保存失败');
    }
  };

  // Toggle rule enabled
  const handleToggleRule = async (rule: KeywordRule) => {
    try {
      await mediaApi.saveKeywordRule({
        ...rule,
        enabled: !rule.enabled,
        updatedAt: Date.now(),
      });
      await loadData();
    } catch (err) {
      onNotify?.('切换状态失败');
    }
  };

  // Delete rule
  const handleDeleteRule = async (id: string) => {
    const ok = await confirmDialog('确定删除该回复规则吗？');
    if (!ok) return;

    try {
      await mediaApi.deleteKeywordRule(id);
      onNotify?.('规则已删除');
      await loadData();
    } catch (err) {
      onNotify?.('删除失败');
    }
  };

  // Save new rule
  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const kws = ruleKeywords
      .split(/[,，\n]/)
      .map((k) => k.trim())
      .filter(Boolean);

    if (!ruleName.trim() || kws.length === 0 || !ruleReplyContent.trim()) {
      onNotify?.('请填写完整规则名称、关键词与回复内容');
      return;
    }

    try {
      const now = Date.now();
      await mediaApi.saveKeywordRule({
        id: `kr_${now}_${Math.random().toString(36).substring(2, 6)}`,
        name: ruleName.trim(),
        keywords: kws,
        matchType: ruleMatchType,
        replyContent: ruleReplyContent.trim(),
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });

      onNotify?.('规则已保存');
      setIsRuleModalOpen(false);
      setRuleName('');
      setRuleKeywords('');
      setRuleReplyContent('');
      await loadData();
    } catch (err) {
      onNotify?.('保存失败');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      <div className="max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-4">
        {/* Hub Tabs Header */}
        <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xs">
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('canned')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'canned'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <MessageSquareText className="w-3.5 h-3.5" />
              <span>常用话术库</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'rules'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>关键词自动回复</span>
            </button>
          </div>

          <div>
            {activeTab === 'canned' ? (
              <button
                type="button"
                onClick={() => setIsReplyModalOpen(true)}
                className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加话术</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsRuleModalOpen(true)}
                className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新建规则</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab 1: Canned Replies */}
        {activeTab === 'canned' && (
          <div className="space-y-3">
            {/* Category Filter & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    selectedCategory === 'all'
                      ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  全部
                </button>
                {Object.entries(CATEGORY_MAP).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedCategory(key)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      selectedCategory === key
                        ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative w-48">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={replySearch}
                  onChange={(e) => setReplySearch(e.target.value)}
                  placeholder="搜索话术..."
                  className="w-full pl-7 pr-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-xs focus:outline-hidden focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Replies Grid */}
            {filteredReplies.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                暂无话术
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredReplies.map((reply) => {
                  const isCopied = copiedId === reply.id;

                  return (
                    <div
                      key={reply.id}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs flex flex-col justify-between space-y-2.5"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {reply.title}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            {CATEGORY_MAP[reply.category] || reply.category}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-3 leading-relaxed whitespace-pre-line">
                          {reply.content}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                        <span className="text-[10px] text-slate-400 font-mono">
                          使用 {reply.usageCount || 0} 次
                        </span>

                        <div className="flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopyReply(reply)}
                            className="flex items-center space-x-1 px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-500" />
                                <span>已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteReply(reply.id)}
                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Keyword Rules */}
        {activeTab === 'rules' && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs">
            {rules.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                暂无自动回复规则
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="p-4 flex items-start justify-between space-x-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors text-xs"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {rule.name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {rule.matchType === 'exact'
                            ? '精确匹配'
                            : rule.matchType === 'regex'
                            ? '正则匹配'
                            : '包含匹配'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[11px] text-slate-400">关键词：</span>
                        {rule.keywords.map((kw, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 text-[11px]"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>

                      <div className="text-slate-600 dark:text-slate-400 pt-0.5 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800 text-[11px]">
                        {rule.replyContent}
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(rule)}
                        className={`w-8 h-4.5 rounded-full transition-colors relative cursor-pointer ${
                          rule.enabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                        }`}
                        title={rule.enabled ? '已启用' : '已停用'}
                      >
                        <span
                          className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                            rule.enabled ? 'left-4' : 'left-0.5'
                          }`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                        title="删除规则"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Reply Modal */}
      {isReplyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                添加常用话术
              </span>
              <button
                type="button"
                onClick={() => setIsReplyModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveReply} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  话术分类
                </label>
                <select
                  value={replyCategory}
                  onChange={(e) => setReplyCategory(e.target.value as CannedReplyCategory)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                >
                  {Object.entries(CATEGORY_MAP).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  标题
                </label>
                <input
                  type="text"
                  required
                  value={replyTitle}
                  onChange={(e) => setReplyTitle(e.target.value)}
                  placeholder="例如：置顶资源获取方式"
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  正文内容
                </label>
                <textarea
                  rows={4}
                  required
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  placeholder="输入话术正文..."
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReplyModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-md"
                >
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Rule Modal */}
      {isRuleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                新建自动回复规则
              </span>
              <button
                type="button"
                onClick={() => setIsRuleModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  规则名称
                </label>
                <input
                  type="text"
                  required
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="例如：课件获取自动回复"
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  匹配类型
                </label>
                <select
                  value={ruleMatchType}
                  onChange={(e) =>
                    setRuleMatchType(e.target.value as 'contains' | 'exact' | 'regex')
                  }
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                >
                  <option value="contains">包含关键词</option>
                  <option value="exact">完全匹配</option>
                  <option value="regex">正则表达式</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  触发关键词 (逗号或换行分隔)
                </label>
                <input
                  type="text"
                  required
                  value={ruleKeywords}
                  onChange={(e) => setRuleKeywords(e.target.value)}
                  placeholder="求资料, 课件, 源码, 链接"
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  自动回复内容
                </label>
                <textarea
                  rows={4}
                  required
                  value={ruleReplyContent}
                  onChange={(e) => setRuleReplyContent(e.target.value)}
                  placeholder="输入自动发送的回复内容..."
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRuleModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-md"
                >
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
