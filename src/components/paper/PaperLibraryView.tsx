import React, { useState } from 'react';
import { paperJobs } from '../../services/paperJobs';
import { PaperJobsInspector } from './PaperJobsInspector';
import { buildCitationSearchQuery, matchReferenceToAsset } from '../../utils/citations';
import { paperApi } from '../../services/paperApi';
import { PaperItem, ReadStatus, ReferenceEntry } from '../../types/paper';
import { api } from '../../services/api';
import {
  BookOpen,
  Plus,
  Search,
  FolderOpen,
  Trash2,
  Edit3,
} from 'lucide-react';

interface PaperLibraryViewProps {
  papers: PaperItem[];
  onOpenPaper: (paper: PaperItem, initialMode?: 'read' | 'edit') => void;
  onImportPaper: () => void;
  importing?: boolean;
  references: Record<string, ReferenceEntry[]>;
  onDeletePaper: (paperId: string) => void;
  onUpdateStatus: (paperId: string, status: ReadStatus) => void;
}

export const PaperLibraryView: React.FC<PaperLibraryViewProps> = ({
  papers,
  onOpenPaper,
  onImportPaper,
  importing,
  references,
  onDeletePaper,
  onUpdateStatus,
}) => {
  const [notice, setNotice] = useState('');
  const [showJobs, setShowJobs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ReadStatus>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'pages'>('recent');

  const filteredPapers = papers
    .filter((p) => {
      if (statusFilter !== 'all' && p.readStatus !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = p.title.toLowerCase().includes(q);
        const inAuthor = p.authors.some((a) => a.toLowerCase().includes(q));
        const inTags = p.tags.some((t) => t.toLowerCase().includes(q));
        if (!inTitle && !inAuthor && !inTags) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'recent') return (b.lastReadAt || b.importedAt || 0) - (a.lastReadAt || a.importedAt || 0);
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return b.pageCount - a.pageCount;
    });

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/50 dark:bg-slate-950">
      {/* Top Header & Search Bar */}
      <div className="p-5 border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/80 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center space-x-2">
              <BookOpen className="w-5 h-5 text-indigo-500" />
              <span>资料库</span>
            </h2>

          </div>

          <div className="flex items-center gap-3"><button type="button" title="资料库目录" onClick={() => { void paperApi.revealData().catch(error => setNotice(String(error))); }} className="text-xs text-slate-500">目录</button><button type="button" onClick={() => {
            const config = paperApi.loadLocalAiConfig();
            void paperApi.saveMarkdown('论文研读诊断', '# 论文研读诊断\n\n' + JSON.stringify({ generatedAt: new Date().toISOString(), userAgent: navigator.userAgent, jobs: paperJobs.list(), papers: papers.map(p => ({ id: p.id, name: p.name, pageCount: p.pageCount })), ai: { provider: config.provider, model: config.model, configured: !!config.apiKey } }, null, 2)).then(path => { if (path) setNotice('诊断已导出'); }).catch(error => setNotice(String(error)));
          }} className="text-xs text-slate-500">诊断</button><button type="button" onClick={() => setShowJobs(value => !value)} className="text-xs text-slate-500">任务</button><button
            type="button"
            disabled={importing}
            onClick={onImportPaper}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{importing ? '导入中…' : '导入'}</span>
          </button></div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
          <div className="flex items-center space-x-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索标题、作者、标签..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Status Tabs */}
            <div className="flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs">
              {(
                [
                  { id: 'all', label: '全部' },
                  { id: 'reading', label: '在读' },
                  { id: 'unread', label: '未读' },
                  { id: 'completed', label: '已读' },
                  { id: 'archived', label: '归档' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    statusFilter === tab.id
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 font-semibold shadow-2xs'
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-2.5 py-1 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 focus:outline-hidden"
            >
              <option value="recent">最近阅读</option>
              <option value="title">标题首字母</option>
              <option value="pages">页数从多到少</option>
            </select>
          </div>
        </div>
      </div>

      {notice && <p role="status" className="px-5 py-2 text-xs text-slate-500">{notice} <button onClick={() => setNotice('')}>关闭</button></p>}
      {showJobs && <div className="max-h-56 overflow-auto border-b border-slate-200 dark:border-slate-800"><PaperJobsInspector onOpen={(id) => { const paper = papers.find(p => p.id === id); if (paper) onOpenPaper(paper); }} /></div>}
      {/* Main Grid View */}
      <div className="flex-1 overflow-y-auto p-5">
        {filteredPapers.length === 0 ? (
          <div className="h-80 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg m-2 space-y-3">
            <BookOpen className="w-12 h-12 text-slate-300 dark:text-slate-700 stroke-1" />
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {papers.length === 0 ? '暂无文献' : '未找到匹配文献'}
            </div>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
              支持 PDF 与 Word 文档。
            </p>
            {papers.length === 0 && (
              <button
                type="button"
                onClick={onImportPaper}
                className="mt-1 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-xs cursor-pointer"
              >
                导入文档
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPapers.map((paper) => {
              const paperPath = paper.path || '';
              const isWord = paperPath.toLowerCase().endsWith('.docx') || paperPath.toLowerCase().endsWith('.doc');
              const progressPct = Math.min(
                100,
                Math.round(((paper.lastReadAt ? paper.lastPage || 1 : 0) / (paper.pageCount || 1)) * 100)
              );

              return (
                <div
                  key={paper.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-lg p-4 shadow-2xs hover:border-indigo-300 dark:hover:border-indigo-800 transition-all flex flex-col justify-between space-y-3 group"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                          {isWord ? 'WORD' : 'PDF'}
                        </span>
                        {paper.year && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {paper.year}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-1 shrink-0">
                        <select
                          value={paper.readStatus}
                          onChange={(e) => onUpdateStatus(paper.id, e.target.value as ReadStatus)}
                          className="text-[10px] font-medium bg-slate-50 dark:bg-slate-800 text-slate-500 rounded px-1.5 py-0.5 border border-slate-200 dark:border-slate-700 focus:outline-hidden"
                        >
                          <option value="unread">未读</option>
                          <option value="reading">在读</option>
                          <option value="completed">已读</option>
                          <option value="archived">归档</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => onDeletePaper(paper.id)}
                          className="p-1 text-slate-300 hover:text-rose-500 transition-colors"
                          title="移除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <h3
                      onClick={() => onOpenPaper(paper, 'read')}
                      className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-snug line-clamp-2 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                      title={paper.title}
                    >
                      {paper.title}
                    </h3>

                    <div className="text-[11px] text-slate-400 truncate">
                      {paper.authors.length > 0 ? paper.authors.join(', ') : '未知作者'}
                    </div>

                    <details className="text-[11px] text-slate-500">
                      <summary className="cursor-pointer">引文 ({references[paper.id]?.length || 0})</summary>
                      <div className="mt-1 space-y-1 max-h-44 overflow-auto">{(references[paper.id] || []).map((entry, index) => {
                        const local = matchReferenceToAsset(entry, papers);
                        return <button key={index} className="block w-full py-1 text-left hover:text-indigo-600 line-clamp-2" title={entry.rawText} onClick={() => {
                          if (local) onOpenPaper(local); else void paperApi.openExternalUrl(paperApi.buildScholarSearchUrl(buildCitationSearchQuery(entry))).catch(error => setNotice(String(error)));
                        }}>[{entry.number}] {entry.title || entry.rawText}{local ? ' · 库内' : ''}</button>;
                      })}</div>
                    </details>
                    {paper.abstract && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed italic">
                        {paper.abstract}
                      </p>
                    )}
                  </div>

                  {/* Footer Meta & Actions */}
                  <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span>
                        第 {paper.lastPage || 1} / {paper.pageCount} 页
                      </span>
                      <span>{progressPct}% 已读</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>

                    {/* Quick Launch Buttons */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center space-x-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenPaper(paper, 'read')}
                          className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-semibold flex items-center space-x-1 transition-colors cursor-pointer"
                        >
                          <BookOpen className="w-3 h-3" />
                          <span>阅读</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onOpenPaper(paper, 'edit')}
                          className="px-2.5 py-1 rounded-lg bg-cyan-50 hover:bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 text-xs font-semibold flex items-center space-x-1 transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>编辑</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => api.revealInFinder(paper.path)}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        title="在文件夹中显示"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
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
  );
};
