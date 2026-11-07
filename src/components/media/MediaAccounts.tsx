import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  ExternalLink,
  Edit2,
  Trash2,
  X,
} from 'lucide-react';
import {
  MediaAccount,
  PlatformType,
  PLATFORM_METAS,
} from '../../types/media';
import { mediaApi } from '../../services/mediaApi';
import { confirmDialog } from '../../utils/dialog';
import { PlatformIcon } from './PlatformIcon';

interface MediaAccountsProps {
  onNotify?: (message: string) => void;
}

const ALL_PLATFORMS: PlatformType[] = [
  'douyin',
  'xiaohongshu',
  'bilibili',
  'wechat_channel',
  'kuaishou',
  'zhihu',
  'wechat_mp',
  'toutiao',
  'baijiahao',
  'weibo',
  'custom',
];

export const MediaAccounts: React.FC<MediaAccountsProps> = ({ onNotify }) => {
  const [accounts, setAccounts] = useState<MediaAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<MediaAccount | null>(null);

  // Form fields
  const [formPlatform, setFormPlatform] = useState<PlatformType>('douyin');
  const [formName, setFormName] = useState('');
  const [formGroup, setFormGroup] = useState('');
  const [formCookies, setFormCookies] = useState('');
  const [formCustomName, setFormCustomName] = useState('');
  const [formCustomLoginUrl, setFormCustomLoginUrl] = useState('');
  const [formCustomPublishUrl, setFormCustomPublishUrl] = useState('');

  // Load accounts
  const loadAccounts = async () => {
    setIsLoading(true);
    try {
      const data = await mediaApi.getAccounts();
      setAccounts(data);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '加载账号失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  // Compute available groups
  const groups = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach((a) => {
      if (a.group) set.add(a.group);
    });
    return Array.from(set);
  }, [accounts]);

  // Filter accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchGroup = selectedGroup === 'all' || acc.group === selectedGroup;
      const matchSearch =
        !searchQuery.trim() ||
        acc.name.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        (acc.group && acc.group.toLowerCase().includes(searchQuery.toLowerCase().trim()));
      return matchGroup && matchSearch;
    });
  }, [accounts, selectedGroup, searchQuery]);

  // Open modal for add or edit
  const openModal = (account?: MediaAccount) => {
    if (account) {
      setEditingAccount(account);
      setFormPlatform(account.platform);
      setFormName(account.name);
      setFormGroup(account.group || '');
      setFormCookies(account.loginCookies || '');
      setFormCustomName(account.platform === 'custom' ? account.name : '');
      setFormCustomLoginUrl(account.customConfig?.loginUrl || '');
      setFormCustomPublishUrl(account.customConfig?.publishUrl || '');
    } else {
      setEditingAccount(null);
      setFormPlatform('douyin');
      setFormName('');
      setFormGroup('');
      setFormCookies('');
      setFormCustomName('');
      setFormCustomLoginUrl('');
      setFormCustomPublishUrl('');
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingAccount(null);
  };

  // Save account
  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = formPlatform === 'custom' ? formCustomName.trim() : formName.trim();
    if (!finalName) {
      onNotify?.('请输入账号名称');
      return;
    }

    try {
      const now = Date.now();
      const payload: MediaAccount = {
        id: editingAccount?.id || `acc_${now}_${Math.random().toString(36).substring(2, 6)}`,
        platform: formPlatform,
        name: finalName,
        group: formGroup.trim() || undefined,
        status: editingAccount?.status || 'active',
        loginCookies: formCookies.trim() || undefined,
        customConfig:
          formPlatform === 'custom'
            ? {
                loginUrl: formCustomLoginUrl.trim() || undefined,
                publishUrl: formCustomPublishUrl.trim() || undefined,
              }
            : undefined,
        lastCheckedAt: now,
        createdAt: editingAccount?.createdAt || now,
        updatedAt: now,
      };

      await mediaApi.saveAccount(payload);
      onNotify?.(editingAccount ? '账号已更新' : '账号已添加');
      closeModal();
      await loadAccounts();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '保存账号失败');
    }
  };

  // Check single account
  const handleCheckAccount = async (id: string) => {
    setCheckingId(id);
    try {
      await mediaApi.checkAccountStatus(id);
      onNotify?.('状态检测完成');
      await loadAccounts();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '检测失败');
    } finally {
      setCheckingId(null);
    }
  };

  // Batch check all accounts
  const handleBatchCheck = async () => {
    setIsLoading(true);
    try {
      await mediaApi.batchCheckAccounts();
      onNotify?.('批量检测完成');
      await loadAccounts();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '批量检测失败');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete account
  const handleDeleteAccount = async (account: MediaAccount) => {
    const ok = await confirmDialog(`确定删除账号「${account.name}」吗？`);
    if (!ok) return;

    try {
      await mediaApi.deleteAccount(account.id);
      onNotify?.('账号已删除');
      await loadAccounts();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '删除失败');
    }
  };

  // Open creator center
  const handleOpenCreatorCenter = (account: MediaAccount) => {
    let url = '';
    if (account.platform === 'custom') {
      url = account.customConfig?.publishUrl || account.customConfig?.loginUrl || '';
    } else {
      url = PLATFORM_METAS[account.platform]?.defaultPublishUrl || '';
    }
    if (url) {
      window.open(url, '_blank');
    } else {
      onNotify?.('该平台未配置网页链接');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      <div className="max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-4">
        {/* Header Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xs">
          {/* Search & Groups */}
          <div className="flex items-center space-x-2 flex-1 min-w-[200px] max-w-md">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索账号或分组..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            {groups.length > 0 && (
              <select
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-hidden focus:border-indigo-500"
              >
                <option value="all">全部分组</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleBatchCheck}
              disabled={isLoading}
              className="flex items-center space-x-1 px-3 py-1.5 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-300 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>批量检测</span>
            </button>

            <button
              type="button"
              onClick={() => openModal()}
              className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加账号</span>
            </button>
          </div>
        </div>

        {/* Accounts List Table / Cards */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs">
          {filteredAccounts.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              暂无匹配账号
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredAccounts.map((account) => {
                const meta = PLATFORM_METAS[account.platform];
                const isOnline = account.status === 'active';
                const isChecking = checkingId === account.id;

                return (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    {/* Left: Platform Icon, Name, Group */}
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
                        <PlatformIcon platform={account.platform} className="w-4 h-4" />
                      </div>

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {account.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            {meta?.label || account.platform}
                          </span>
                          {account.group && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                              {account.group}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                          <span>
                            检测时间：
                            {account.lastCheckedAt
                              ? new Date(account.lastCheckedAt).toLocaleTimeString('zh-CN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '未检测'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Status badge & Actions */}
                    <div className="flex items-center space-x-3 shrink-0">
                      <span
                        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          isOnline
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isOnline ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                        />
                        <span>{isOnline ? '在线' : '需重新登录'}</span>
                      </span>

                      <div className="flex items-center space-x-1 text-slate-500">
                        <button
                          type="button"
                          onClick={() => handleCheckAccount(account.id)}
                          disabled={isChecking}
                          title="检测登录状态"
                          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 transition-colors"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenCreatorCenter(account)}
                          title="打开创作者中心"
                          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openModal(account)}
                          title="编辑账号"
                          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAccount(account)}
                          title="删除账号"
                          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-red-600 transition-colors"
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
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {editingAccount ? '编辑账号' : '添加分发账号'}
              </span>
              <button
                type="button"
                onClick={closeModal}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAccount} className="p-4 space-y-3 text-xs">
              {/* Platform selector */}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  平台
                </label>
                <select
                  value={formPlatform}
                  onChange={(e) => setFormPlatform(e.target.value as PlatformType)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                >
                  {ALL_PLATFORMS.map((plat) => (
                    <option key={plat} value={plat}>
                      {PLATFORM_METAS[plat]?.label || plat}
                    </option>
                  ))}
                </select>
              </div>

              {/* Account nickname */}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  账号名称
                </label>
                <input
                  type="text"
                  required
                  value={formPlatform === 'custom' ? formCustomName : formName}
                  onChange={(e) =>
                    formPlatform === 'custom'
                      ? setFormCustomName(e.target.value)
                      : setFormName(e.target.value)
                  }
                  placeholder="例如：科技官方号"
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              {/* Group */}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  分组标签
                </label>
                <input
                  type="text"
                  value={formGroup}
                  onChange={(e) => setFormGroup(e.target.value)}
                  placeholder="例如：短视频矩阵 / 知识科普"
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              {/* Custom platform URLs */}
              {formPlatform === 'custom' && (
                <>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      登录入口 URL
                    </label>
                    <input
                      type="url"
                      value={formCustomLoginUrl}
                      onChange={(e) => setFormCustomLoginUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      发布地址 URL
                    </label>
                    <input
                      type="url"
                      value={formCustomPublishUrl}
                      onChange={(e) => setFormCustomPublishUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                </>
              )}

              {/* Cookie / Token */}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  登录凭证 (Cookie / Token 选填)
                </label>
                <textarea
                  rows={3}
                  value={formCookies}
                  onChange={(e) => setFormCookies(e.target.value)}
                  placeholder="粘贴平台登录 Cookie 或身份凭据"
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:outline-hidden focus:border-indigo-500 font-mono text-[11px]"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
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
