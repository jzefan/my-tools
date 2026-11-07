import { useSyncExternalStore } from 'react';
import { paperJobs } from '../../services/paperJobs';
const labels = { import: '导入', extract: '解析', overview: '导读', qa: '问答' };
const statuses = { running: '进行中', succeeded: '完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' };
export function PaperJobsInspector({ paperId, onOpen }: { paperId?: string; onOpen?: (paperId: string, type: 'overview' | 'qa' | 'import' | 'extract') => void }) {
  const jobs = useSyncExternalStore(paperJobs.subscribe, paperJobs.list);
  const visible = jobs.filter(job => !paperId || job.paperId === paperId);
  return <section className="flex-1 overflow-auto p-3 text-xs" aria-label="论文任务">
    <h3 className="font-medium mb-2">任务</h3>
    {!visible.length && <p className="text-slate-400 py-6 text-center">暂无任务</p>}
    {visible.map(job => <div key={job.id} className="py-2 border-b border-slate-200 dark:border-slate-800 flex gap-2 items-start">
      <div className="flex-1 min-w-0"><strong className="font-medium">{labels[job.type]}</strong><span className="text-slate-400 ml-2">{statuses[job.status]}</span>
        {job.error && <p className="text-rose-600 mt-1 break-words">{job.error}</p>}
        <p className="text-slate-400 text-[11px] mt-1">{new Date(job.updatedAt).toLocaleString()}</p></div>
      {job.status === 'running' && paperJobs.canCancel(job.id) && <button onClick={() => paperJobs.cancel(job.id)}>停止</button>}
      {['failed', 'cancelled', 'interrupted'].includes(job.status) && (paperJobs.canRetry(job.id)
        ? <button onClick={() => { if (!paperJobs.retry(job.id) && job.paperId) onOpen?.(job.paperId, job.type); }}>重试</button>
        : job.paperId && onOpen && <button onClick={() => onOpen(job.paperId!, job.type)}>回到论文</button>)}
    </div>)}
  </section>;
}
