import { useState } from 'react';
import type { CitationMatch, ReferenceEntry, PaperItem } from '../../types/paper';
import { paperApi } from '../../services/paperApi';
import { buildCitationSearchQuery, matchReferenceToAsset } from '../../utils/citations';
import { Bookmark, ArrowRight, Search } from 'lucide-react';
interface Props { locationUnit?: '页' | '段'; match: CitationMatch | null; allReferences: ReferenceEntry[]; paperTitle: string; onJumpToPage: (pageNo: number) => void; onClose: () => void; papers: PaperItem[]; onOpenPaper: (paper: PaperItem) => void }
export function CitationInspector({ locationUnit = '页', match, allReferences, onJumpToPage, onClose, papers, onOpenPaper }: Props) {
  void locationUnit;
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const entries = match?.candidates || allReferences.map(entry => ({ entry, confidence: 'high' as const }));
  const open = (url: string) => { void paperApi.openExternalUrl(url).catch(e => setError(String(e))); };
  return <section className="flex-1 flex flex-col min-h-0 text-xs" aria-label="引文追踪">
    <header className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2"><Bookmark className="w-4 h-4 text-indigo-500" /><strong className="font-medium flex-1">{match ? `引文 ${match.mention.marker}` : `参考文献 (${entries.length})`}</strong><button className="text-slate-400" onClick={onClose}>关闭</button></header>
    {error && <p className="px-3 py-2 text-rose-600" role="alert">{error}</p>}
    <div className="flex-1 overflow-auto p-3 space-y-3">
      {!entries.length && <p className="text-slate-400 py-8 text-center">未识别到编号参考文献</p>}
      {entries.map(({ entry, confidence }, i) => {
        const key = `${entry.number}:${i}`, query = queries[key] ?? buildCitationSearchQuery(entry), local = matchReferenceToAsset(entry, papers);
        return <article key={key} className="border-b border-slate-200 dark:border-slate-800 pb-3 space-y-2">
          <div className="flex gap-2"><strong className="font-medium">[{entry.number}]</strong><span className="text-slate-400">{confidence === 'high' ? '已匹配' : '编号重复 · 待确认'}</span></div>
          <p className="leading-relaxed break-words">{entry.rawText}</p>
          <div className="flex flex-wrap gap-3 text-indigo-600">
            <button className="flex items-center gap-1" onClick={() => onJumpToPage(entry.sourcePage)}><ArrowRight className="w-3 h-3" />定位条目</button>
            {local && <button onClick={() => onOpenPaper(local)}>打开库内论文</button>}
            {entry.doi && <button onClick={() => open(paperApi.buildDoiUrl(entry.doi!))}>DOI</button>}
            {entry.url && <button onClick={() => open(entry.url!)}>原文链接</button>}
          </div>
          <div className="flex gap-2"><input aria-label={`引文 ${entry.number} 搜索词`} value={query} onChange={e => setQueries(previous => ({ ...previous, [key]: e.target.value }))} className="flex-1 min-w-0 p-1.5 border border-slate-200 dark:border-slate-700 rounded bg-transparent" /><button title="学术搜索" disabled={!query.trim()} onClick={() => open(paperApi.buildScholarSearchUrl(query))}><Search className="w-3.5 h-3.5" /></button></div>
        </article>;
      })}
      {match?.unmatchedNumbers.map(number => <p className="text-slate-500" key={number}>未找到 [{number}] 对应条目</p>)}
    </div>
  </section>;
}
