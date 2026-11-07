import React, { useState, useEffect, useMemo } from 'react';
import {
  RotateCcw,
  Ban,
  Trash2,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Video,
  Image as ImageIcon,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  PublishTask,
  TaskStatus,
  AccountPublishStage,
} from '../../types/media';
import { mediaApi } from '../../services/mediaApi';
import { confirmDialog } from '../../utils/dialog';
import { PlatformIcon } from './PlatformIcon';

interface MediaTaskCenterProps {
  onNotify?: (message: string) => void;
}

type FilterStatus = 'all' | 'running' | 'completed' | 'failed';

const STAGE_LABELS: Record<AccountPublishStage, string> = {
  queued: '排队中',
  validating: '校验中',
  uploading: '上传素材',
  filling: '表单填充',
  publishing: '发布确认',
  done: '成功',
  failed: '失败',
};

export const MediaTaskCenter: React.FC<MediaTaskCenterProps> = ({ onNotify }) => {
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  // Load tasks
  const loadTasks = async () => {
    setIsLoading(true);
    try {
      const data = await mediaApi.getTasks();
      setTasks(data);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '加载任务失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
    const timer = setInterval(loadTasks, 5000);
    return () => clearInterval(timer);
  }, []);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filter === 'running') return task.status === 'running' || task.status === 'pending';
      if (filter === 'completed') return task.status === 'completed';
      if (filter === 'failed') {
        return (
          task.status === 'failed' ||
          task.status === 'partial' ||
          task.status === 'cancelled' ||
          task.accounts.some((a) => a.status === 'failed')
        );
      }
      return true;
    });
  }, [tasks, filter]);

  // Toggle log expansion
  const toggleLog = (taskId: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  // Retry failed accounts in task
  const handleRetry = async (taskId: string) => {
    try {
      await mediaApi.retryTask(taskId);
      onNotify?.('已重试失败账号');
      await loadTasks();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '重试失败');
    }
  };

  // Cancel task
  const handleCancel = async (taskId: string) => {
    const ok = await confirmDialog('确定取消该任务吗？');
    if (!ok) return;

    try {
      await mediaApi.cancelTask(taskId);
      onNotify?.('任务已取消');
      await loadTasks();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '取消失败');
    }
  };

  // Clear completed tasks
  const handleClearCompleted = async () => {
    try {
      await mediaApi.clearCompletedTasks();
      onNotify?.('已清空已完成任务');
      await loadTasks();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : '清空失败');
    }
  };

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'completed':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
            已完成
          </span>
        );
      case 'running':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 animate-pulse">
            进行中
          </span>
        );
      case 'pending':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            排队中
          </span>
        );
      case 'partial':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
            部分成功
          </span>
        );
      case 'failed':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
            失败
          </span>
        );
      case 'cancelled':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500">
            已取消
          </span>
        );
    }
  };

  const getStageBadgeColor = (stage: AccountPublishStage) => {
    switch (stage) {
      case 'done':
        return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800';
      case 'failed':
        return 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800';
      case 'publishing':
      case 'filling':
      case 'uploading':
      case 'validating':
        return 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800';
      default:
        return 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      <div className="max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-4">
        {/* Toolbar Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xs">
          {/* Status Filters */}
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              全部 ({tasks.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('running')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === 'running'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              进行中 (
              {tasks.filter((t) => t.status === 'running' || t.status === 'pending').length}
              )
            </button>
            <button
              type="button"
              onClick={() => setFilter('completed')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === 'completed'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              已完成 ({tasks.filter((t) => t.status === 'completed').length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('failed')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === 'failed'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              失败/异常 (
              {
                tasks.filter(
                  (t) =>
                    t.status === 'failed' ||
                    t.status === 'partial' ||
                    t.status === 'cancelled' ||
                    t.accounts.some((a) => a.status === 'failed')
                ).length
              }
              )
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleClearCompleted}
              className="flex items-center space-x-1 px-3 py-1.5 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>清空已完成</span>
            </button>

            <button
              type="button"
              onClick={loadTasks}
              disabled={isLoading}
              className="p-1.5 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
              title="刷新任务列表"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Task Cards List */}
        {filteredTasks.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
            暂无任务记录
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTasks.map((task) => {
              const isExpanded = expandedLogs.has(task.id);
              const finishedAccountsCount = task.accounts.filter(
                (a) => a.status === 'completed' || a.status === 'failed'
              ).length;
              const hasFailedAccounts = task.accounts.some((a) => a.status === 'failed');
              const canCancel = task.status === 'pending' || task.status === 'running';

              return (
                <div
                  key={task.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xs space-y-3.5"
                >
                  {/* Task Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate max-w-md">
                        {task.content.title}
                      </span>
                      <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        {task.content.type === 'video' ? (
                          <>
                            <Video className="w-2.5 h-2.5" />
                            <span>短视频</span>
                          </>
                        ) : (
                          <>
                            <ImageIcon className="w-2.5 h-2.5" />
                            <span>图文</span>
                          </>
                        )}
                      </span>
                      <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        {task.mode === 'silent' ? (
                          <>
                            <EyeOff className="w-2.5 h-2.5" />
                            <span>隐式</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-2.5 h-2.5" />
                            <span>显示</span>
                          </>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2.5 shrink-0">
                      <span className="text-[11px] text-slate-400 font-mono">
                        {new Date(task.createdAt).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {getStatusBadge(task.status)}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                      <span>分发进度</span>
                      <span>
                        {finishedAccountsCount} / {task.accounts.length}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                        style={{
                          width: `${(finishedAccountsCount / Math.max(1, task.accounts.length)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Account sub-tasks grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                    {task.accounts.map((acc) => {
                      return (
                        <div
                          key={acc.accountId}
                          className="flex items-center justify-between p-2 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-xs"
                        >
                          <div className="flex items-center space-x-2 min-w-0 pr-1">
                            <PlatformIcon platform={acc.platform} className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <div className="truncate font-medium text-slate-700 dark:text-slate-300">
                              {acc.accountName}
                            </div>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${getStageBadgeColor(
                                acc.stage
                              )}`}
                            >
                              {STAGE_LABELS[acc.stage] || acc.stage}
                            </span>

                            {acc.publishUrl && (
                              <a
                                href={acc.publishUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1 text-indigo-600 hover:text-indigo-800"
                                title="查看已发布链接"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Error messages if any */}
                  {task.accounts.some((a) => a.errorMessage) && (
                    <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-[11px] text-rose-600 dark:text-rose-400 space-y-0.5">
                      {task.accounts
                        .filter((a) => a.errorMessage)
                        .map((a) => (
                          <div key={a.accountId}>
                            <span className="font-semibold">{a.accountName}：</span>
                            <span>{a.errorMessage}</span>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Logs stream section */}
                  {task.logs && task.logs.length > 0 && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => toggleLog(task.id)}
                        className="flex items-center space-x-1 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                        <span>执行日志 ({task.logs.length} 条)</span>
                      </button>

                      {isExpanded && (
                        <div className="mt-2 p-2 bg-slate-900 text-slate-300 rounded-lg text-[11px] font-mono max-h-36 overflow-y-auto space-y-1">
                          {task.logs.map((log) => (
                            <div key={log.id} className="leading-tight">
                              <span className="text-slate-500">
                                [{new Date(log.timestamp).toLocaleTimeString()}]
                              </span>{' '}
                              <span
                                className={
                                  log.level === 'error'
                                    ? 'text-rose-400'
                                    : log.level === 'warn'
                                    ? 'text-amber-400'
                                    : log.level === 'success'
                                    ? 'text-emerald-400'
                                    : 'text-slate-300'
                                }
                              >
                                {log.message}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Card actions */}
                  <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {hasFailedAccounts && (
                      <button
                        type="button"
                        onClick={() => handleRetry(task.id)}
                        className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md text-slate-700 dark:text-slate-300 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>重试失败平台</span>
                      </button>
                    )}

                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => handleCancel(task.id)}
                        className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-rose-50 hover:text-rose-600 rounded-md text-slate-600 dark:text-slate-400 transition-colors"
                      >
                        <Ban className="w-3 h-3" />
                        <span>取消任务</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
