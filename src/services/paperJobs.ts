export interface PaperJob {
  id: string;
  paperId?: string;
  type: 'import' | 'extract' | 'overview' | 'qa';
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  updatedAt: number;
  error?: string;
  attempt: number;
}
const key = 'doc_tools_paper_jobs';
class PaperJobs {
  private jobs: PaperJob[] = [];
  private listeners = new Set<() => void>();
  private controllers = new Map<string, AbortController>();
  private retries = new Map<string, () => boolean | void>();
  constructor() {
    try { this.jobs = JSON.parse(localStorage.getItem(key) || '[]').map((job: PaperJob) => ({ ...job, status: job.status === 'running' ? 'interrupted' : job.status })); } catch {}
  }
  list = () => this.jobs;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish() {
    try { localStorage.setItem(key, JSON.stringify(this.jobs.slice(0, 100))); } catch {}
    this.listeners.forEach(listener => listener());
  }
  start(type: PaperJob['type'], paperId?: string, retry?: () => boolean | void) {
    const controller = new AbortController();
    const job: PaperJob = { id: crypto.randomUUID(), paperId, type, status: 'running', updatedAt: Date.now(), attempt: 1 };
    this.controllers.set(job.id, controller);
    if (retry) this.retries.set(job.id, retry);
    this.jobs = [job, ...this.jobs].slice(0, 100);
    this.publish();
    return { id: job.id, signal: controller.signal };
  }
  finish(id: string, error?: unknown) {
    const cancelled = this.controllers.get(id)?.signal.aborted;
    this.controllers.delete(id);
    this.jobs = this.jobs.map(job => job.id === id ? { ...job, status: cancelled ? 'cancelled' : error ? 'failed' : 'succeeded', error: error ? String(error instanceof Error ? error.message : error) : undefined, updatedAt: Date.now() } : job);
    this.publish();
  }
  cancel(id: string) { this.controllers.get(id)?.abort(); }
  canCancel(id: string) { return this.controllers.has(id); }
  canRetry(id: string) { return this.retries.has(id); }
  retry(id: string) { const retry = this.retries.get(id); return retry ? retry() !== false : false; }
}
export const paperJobs = new PaperJobs();
