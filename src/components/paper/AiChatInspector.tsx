import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AiProviderConfig, PaperSelection } from '../../types/paper';
import { paperAiPreview } from '../../utils/paperAiPreview';
import { answerPaperQuestion, overviewSource, type PaperAnswer } from '../../utils/paperAi';
import { paperChats, type PaperChatTurn }  from '../../services/paperChats';
import { paperJobs } from '../../services/paperJobs';
import { Sparkles, Send, Settings, BookmarkPlus, Copy, Square } from 'lucide-react';

interface Props {
  paperId: string;
  locationUnit?: '页' | '段';
  paperTitle: string;
  pages: Array<{ pageNo: number; text: string }>;
  currentPage: number;
  selection: PaperSelection | null;
  config: AiProviderConfig;
  onOpenSettings: () => void;
  onJumpToPage: (pageNo: number) => void;
  onSaveAsAnnotation: (question: string, result: PaperAnswer, selection: PaperSelection) => void;
}
export function AiChatInspector({ locationUnit = '页', paperId, paperTitle, pages, currentPage, selection: incomingSelection, config, onOpenSettings, onJumpToPage, onSaveAsAnnotation }: Props) {
  const [selection, setSelection] = useState(incomingSelection || paperChats.selection(paperId));
  useEffect(() => { if (incomingSelection) { setSelection(incomingSelection); paperChats.setSelection(paperId, incomingSelection); } }, [incomingSelection, paperId]);
  const [question, setQuestion] = useState(() => paperChats.draft(paperId));
  const subscribe = useCallback((listener: () => void) => paperChats.subscribe(paperId, listener), [paperId]);
  const turns = useSyncExternalStore(subscribe, () => paperChats.list(paperId));
  const jobs = useSyncExternalStore(paperJobs.subscribe, paperJobs.list);
  const activeJob = jobs.find(job => job.paperId === paperId && job.type === 'qa' && job.status === 'running');
  const busy = !!activeJob;
  const setTurns = (update: Parameters<typeof paperChats.update>[1]) => paperChats.update(paperId, update);
  const [includeSelection, setIncludeSelection] = useState(true);
  const [includeNearby, setIncludeNearby] = useState(true);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const nearbyPages = includeNearby ? overviewSource(pages.filter(p => Math.abs(p.pageNo - (selection?.pageNo || currentPage)) <= 1), 30000) : [];
  const requestPreview = paperAiPreview(config.model, question.length + nearbyPages.reduce((count, page) => count + page.text.length, 0) + (includeSelection ? Math.min(selection?.text.length || 0, 20000) : 0), includeScreenshot && selection?.screenshot ? 1 : 0);
  const active = useRef<string | null>(null); active.current = activeJob?.id || null;
  const alive = useRef(true);
  const lastQuestion = useRef('');
  const sendRef = useRef<(text: string) => void>(() => {});
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { paperChats.setDraft(paperId, question); }, [paperId, question]);
  useEffect(() => { if (!busy && turns[turns.length - 1]?.answer && !turns[turns.length - 1]?.error) setQuestion(paperChats.draft(paperId)); }, [busy, turns.length, paperId]);
  useEffect(() => { setIncludeSelection(true); setIncludeNearby(true); setIncludeScreenshot(true); }, [selection]);
  const send = async (text = question) => {
    if (!text.trim() || active.current) return;
    const source = selection || { text: '', pageNo: currentPage, rects: [] };
    const snapshot = { ...source, rects: [...source.rects] };
    const nearby = pages.filter(p => Math.abs(p.pageNo - snapshot.pageNo) <= 1);
    const index = Math.min(turns.length, 49);
    lastQuestion.current = text;
    const job = paperJobs.start('qa', paperId, () => { if (!alive.current) return false; sendRef.current(lastQuestion.current); return true; });
    active.current = job.id;
    setTurns(previous => [...previous, { question: text, answer: '', evidence: [], status: 'missing', running: true, selection: snapshot }]);
    const change = (update: Partial<PaperChatTurn>) => { setTurns(previous => previous.map((turn, i) => i === index ? { ...turn, ...update } : turn)); };
    try {
      const result = await answerPaperQuestion({ title: paperTitle, question: text, pages: nearby, selection: snapshot, includeSelection, includeNearby, includeScreenshot }, config,
        { signal: job.signal, onDelta: answer => change({ answer }), onReasoning: reasoning => change({ reasoning }) });
      if (job.signal.aborted) throw new DOMException('已停止', 'AbortError');
      change({ ...result, running: false });
      paperChats.setDraft(paperId, '');
      if (alive.current) setQuestion('');
      paperJobs.finish(job.id);
    } catch (error) {
      change({ running: false, error: job.signal.aborted ? '已停止' : error instanceof Error ? error.message : String(error) });
      paperJobs.finish(job.id, error);
    } finally { active.current = null; }
  };
  sendRef.current = text => { void send(text); };
  return <section className="flex-1 flex flex-col min-h-0 text-xs" aria-label="AI 问答">
    <header className="flex items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-800"><Sparkles className="w-4 h-4 text-indigo-500" /><strong className="font-medium flex-1">AI 问答</strong><button title="AI 设置" onClick={onOpenSettings}><Settings className="w-3.5 h-3.5 text-slate-400" /></button></header>
    <div className="flex-1 overflow-auto p-3 space-y-4 break-words" aria-live="polite">
      {!turns.length && <div className="space-y-1">{['总结核心贡献', '解释这段内容', '有哪些假设与局限？'].map(q => <button key={q} className="block w-full text-left py-2 text-slate-600 dark:text-slate-300 hover:text-indigo-600" onClick={() => setQuestion(q)}>{q}</button>)}</div>}
      {turns.map((turn, i) => <article key={i} className="space-y-2 border-b border-slate-100 dark:border-slate-800 pb-3">
        <p className="font-medium">{turn.question}</p>
        {turn.reasoning && <details className="text-slate-400"><summary>思考过程</summary><p className="whitespace-pre-wrap mt-1">{turn.reasoning}</p></details>}
        <p className="whitespace-pre-wrap leading-relaxed">{turn.answer || (busy && i === turns.length - 1 ? '正在思考…' : '')}</p>
        {turn.error && <p role="status" className="text-rose-600">{turn.error} <button disabled={busy} className="underline" onClick={() => void send(turn.question)}>重试</button></p>}
        {turn.evidence.map((e, n) => <button key={n} className="text-indigo-600 mr-2" onClick={() => onJumpToPage(e.pageNo)}>第 {e.pageNo} {locationUnit}</button>)}
        {turn.answer && <div className="flex gap-3 text-[11px] text-slate-500">
          <span>{turn.status === 'verified' ? '引用已核验' : turn.status === 'invalid' ? '引用无效 · 草稿' : '无引用 · 草稿'}</span>
          <button title="复制回答" onClick={() => { void navigator.clipboard.writeText(turn.answer); }}><Copy className="w-3.5 h-3.5" /></button>
          <button disabled={turn.saved || busy} className="flex gap-1 items-center disabled:opacity-50" onClick={() => {
            onSaveAsAnnotation(turn.question, { answer: turn.answer, evidence: turn.evidence, status: turn.error ? 'missing' : turn.status }, turn.selection);
            setTurns(previous => previous.map((t, n) => n === i ? { ...t, saved: true } : t));
          }}><BookmarkPlus className="w-3.5 h-3.5" />{turn.saved ? '已保存' : '存为批注'}</button>
        </div>}
      </article>)}
    </div>
    <div className="border-t border-slate-200 dark:border-slate-800 p-3 space-y-2">
      {selection?.text && <p className="line-clamp-3 text-slate-500" title={selection.text}>选区：{selection.text}</p>}
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
        {selection?.text && <label><input type="checkbox" checked={includeSelection} disabled={busy} onChange={e => { setIncludeSelection(e.target.checked); if (!e.target.checked) setIncludeNearby(false); }} /> 选区</label>}
        <label><input type="checkbox" checked={includeNearby} disabled={busy || (!!selection?.text && !includeSelection)} onChange={e => setIncludeNearby(e.target.checked)} /> 附近正文</label>
        {selection?.screenshot && <label><input type="checkbox" checked={includeScreenshot} disabled={busy} onChange={e => setIncludeScreenshot(e.target.checked)} /> 截图</label>}
        <span className="truncate" title={config.model}>{config.model}</span><span title={`参考价格：${requestPreview.pricingAsOf}，最多输出 ${requestPreview.maximumOutputTokens} tokens`}>约 {requestPreview.tokens} tokens{requestPreview.estimatedMaximumUsd !== undefined ? ` · 约 $${requestPreview.estimatedMaximumUsd.toFixed(3)}` : ''}</span>
      </div>
      <details className="text-[11px] text-slate-400"><summary className="cursor-pointer">发送范围 · {includeNearby ? nearbyPages.map(p => `${p.pageNo}`).join(', ') : selection && includeSelection ? selection.pageNo : '无正文'} {locationUnit}{includeScreenshot && selection?.screenshot ? ' · 1 张截图' : ''}</summary><p className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap">{includeSelection ? selection?.text : ''}{includeNearby ? nearbyPages.map(p => p.text).join('\n') : ''}</p></details>
      <div className="flex items-end gap-2"><textarea aria-label="论文问题" rows={2} value={question} onChange={e => setQuestion(e.target.value)} disabled={busy} placeholder="输入问题" className="min-w-0 flex-1 resize-none rounded border border-slate-200 dark:border-slate-700 bg-transparent p-2 focus:outline-none focus:border-indigo-500" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <button aria-label={busy ? '停止回答' : '发送问题'} disabled={!busy && !question.trim()} className="p-2 text-indigo-600 disabled:opacity-40" onClick={() => busy ? active.current && paperJobs.cancel(active.current) : void send()}>{busy ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}</button>
      </div>
    </div>
  </section>;
}
