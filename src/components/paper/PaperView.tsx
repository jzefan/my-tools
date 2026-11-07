import { useState, useEffect, useRef, useCallback } from 'react';
import type { AnnotationItem, OverviewRecord, PaperDraftEdit, PaperItem, ReadStatus, AiProviderConfig } from '../../types/paper';
import { paperApi, type PaperLibraryState } from '../../services/paperApi';
import { paperChats } from '../../services/paperChats';
import { paperJobs } from '../../services/paperJobs';
import { PaperLibraryView } from './PaperLibraryView';
import { PaperReaderView } from './PaperReaderView';
import { PaperEditorView } from './PaperEditorView';
import { RefreshCw } from 'lucide-react';
import { confirmDialog, alertDialog } from '../../utils/dialog';
import { extractNumberedReferences } from '../../utils/citations';
import { clampPaperPage } from '../../utils/paperReader';
import { getCurrentWebview } from '@tauri-apps/api/webview';

interface PaperViewProps { initialFile?: string; activeSubTab?: string; onSubTabChange?: (subTab: string) => void }
export function PaperView({ initialFile, activeSubTab, onSubTabChange }: PaperViewProps) {
  const [library, setLibrary] = useState<PaperLibraryState>({ papers: [], annotations: {}, overviews: {}, drafts: {}, aiConfig: paperApi.loadLocalAiConfig() });
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [view, setView] = useState<'library' | 'read' | 'edit'>('library');
  const [paperId, setPaperId] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [opening, setOpening] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pagesText, setPagesText] = useState<Array<{ pageNo: number; text: string }>>([]);
  const openRequest = useRef(0);
  const importedInitial = useRef<string | null>(null);
  const alive = useRef(true);
  const importLock = useRef(false);
  const pendingImports = useRef<Array<{ paths: string[]; open: boolean }>>([]);
  const activePaper = library.papers.find(p => p.id === paperId) || null;
  const updateLibrary = useCallback((updater: (prev: PaperLibraryState) => PaperLibraryState) => {
    setLibrary(previous => { const next = updater(previous); return next === previous ? previous : { ...next, updatedAt: Date.now() }; });
  }, []);
  const load = async () => {
    setLoading(true); setLoadError('');
    try { const state = await paperApi.loadLibrary(); if (alive.current) setLibrary(state); }
    catch (error) { if (alive.current) setLoadError(String(error instanceof Error ? error.message : error)); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; openRequest.current++; }; }, []);
  useEffect(() => {
    if (loading || loadError || !library.updatedAt) return;
    let cancelled = false;
    void paperApi.saveLibrary(library).then(() => { if (!cancelled) setSaveError(''); }).catch(error => {
      if (!cancelled) setSaveError(`保存失败：${String(error)}`);
    });
    return () => { cancelled = true; };
  }, [library, loading, loadError]);

  const openPaper = async (paper: PaperItem, mode: 'read' | 'edit' = 'read') => {
    const request = ++openRequest.current;
    setOpening(true);
    try {
      if (!paper.sha256) {
        const managed = await paperApi.importFile(paper.path);
        paper = { ...paper, path: managed.path, sourcePath: managed.sourcePath, sha256: managed.sha256 };
        const upgraded = paper;
        updateLibrary(previous => ({ ...previous, papers: previous.papers.map(p => p.id === upgraded.id ? upgraded : p) }));
      }
      const bytes = await paperApi.readPdfBinary(paper.path, paper.sha256);
      if (!alive.current || request !== openRequest.current) return;
      setPaperId(paper.id); setPdfData(bytes); setPagesText([]); setView(mode);
      onSubTabChange?.(mode === 'edit' ? 'paper_editor' : 'paper_reader');
      updateLibrary(previous => ({ ...previous, papers: previous.papers.map(p => p.id === paper.id ? { ...p, lastReadAt: Date.now(), readStatus: p.readStatus === 'unread' ? 'reading' : p.readStatus } : p) }));
    } catch (error) { if (request === openRequest.current && alive.current) await alertDialog(`无法读取文件：${String(error)}`); }
    finally { if (request === openRequest.current && alive.current) setOpening(false); }
  };

  const importPaths = async (paths: string[], open = true) => {
    if (loadError || loading) return;
    if (importLock.current) { pendingImports.current.push({ paths, open }); return; }
    importLock.current = true; setImporting(true);
    let last: PaperItem | undefined;
    const references: NonNullable<PaperLibraryState['references']> = {};
    const failed: string[] = [];
    // Stage one batch together so a duplicate within the same batch keeps its ID.
    let papers = [...libraryRef.current.papers];
    for (const path of paths) {
      const job = paperJobs.start('import', undefined, () => { if (!alive.current) return false; void importRef.current([path]); return true; });
      try {
        const meta = await paperApi.importFile(path);
        if (job.signal.aborted) throw new DOMException('导入已停止', 'AbortError');
        const existing = papers.find(p => p.sha256 === meta.sha256 || (!p.sha256 && (p.path === meta.sourcePath || p.sourcePath === meta.sourcePath)));
        last = existing ? { ...existing, path: meta.path, sourcePath: meta.sourcePath, sha256: meta.sha256 } : {
          id: crypto.randomUUID(), path: meta.path, sourcePath: meta.sourcePath, sha256: meta.sha256,
          name: meta.name, title: meta.name.replace(/\.[^/.]+$/, ''), authors: [], pageCount: 1,
          fileSize: meta.size, readStatus: 'unread', lastReadAt: 0, importedAt: Date.now(),
          lastPage: 1, lastZoom: 1.15, lastRotation: 0, lastViewMode: 'continuous', lastPositionUnit: /\.docx$/i.test(meta.name) ? 'paragraph' : 'page', tags: [],
        };
        papers = [last, ...papers.filter(p => p.id !== last!.id)];
        paperJobs.finish(job.id);
        const extraction = paperJobs.start('extract', last.id);
        try {
          const { extractPaperContent } = await import('../../utils/paperExtract');
          const pages = await extractPaperContent(await paperApi.readPdfBinary(last.path, last.sha256), extraction.signal);
          references[last.id] = extractNumberedReferences(pages);
          last = { ...last, pageCount: pages.length || 1 };
          papers = papers.map(p => p.id === last!.id ? last! : p);
          paperJobs.finish(extraction.id);
        } catch (error) { paperJobs.finish(extraction.id, error); }

      } catch (error) { failed.push(`${path.split(/[\\/]/).pop()}：${String(error)}`); paperJobs.finish(job.id, error); }
    }
    if (alive.current) {
      const imported = papers.filter(p => paths.includes(p.sourcePath || ''));
      updateLibrary(previous => ({ ...previous, papers: [...imported, ...previous.papers.filter(p => !imported.some(next => next.id === p.id))], references: { ...previous.references, ...references } }));
      if (last && open) await openPaper(last);
      if (failed.length) await alertDialog(failed.join('\n'));
      setImporting(false);
    }
    importLock.current = false;
    const next = pendingImports.current.shift();
    if (next && alive.current) void importRef.current(next.paths, next.open);
  };
  const importDialog = async () => { try { await importPaths(await paperApi.chooseFiles()); } catch (error) { await alertDialog(String(error)); } };
  const importRef = useRef(importPaths); importRef.current = importPaths;
  useEffect(() => {
    if (loading || loadError || !initialFile || importedInitial.current === initialFile) return;
    importedInitial.current = initialFile; void importRef.current([initialFile]);
  }, [initialFile, loading, loadError]);
  useEffect(() => {
    let disposed = false; let unlisten: (() => void) | undefined;
    try { void getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === 'drop') void importRef.current(event.payload.paths.filter(path => /\.(pdf|docx|doc)$/i.test(path)));
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {}); } catch {}
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const handleTextExtracted = useCallback((pages: Array<{ pageNo: number; text: string }>) => {
    setPagesText(pages);
  }, []);
  const openRef = useRef(openPaper); openRef.current = openPaper;
  useEffect(() => {
    if (loading || loadError) return;
    if (activeSubTab === 'paper_library') setView('library');
    else if (activeSubTab === 'paper_reader' || activeSubTab === 'paper_editor') {
      const mode = activeSubTab === 'paper_editor' ? 'edit' : 'read';
      if (paperId && pdfData) setView(mode);
      else {
        const recent = [...libraryRef.current.papers].sort((a, b) => b.lastReadAt - a.lastReadAt)[0];
        if (recent) void openRef.current(recent, mode);
      }
    }
  }, [activeSubTab, loading, loadError]);
  const saveAnnotation = (item: AnnotationItem) => updateLibrary(previous => ({ ...previous, annotations: { ...previous.annotations,
    [item.paperId]: [item, ...(previous.annotations[item.paperId] || []).filter(a => a.id !== item.id)] } }));
  const saveOverview = (record: OverviewRecord) => updateLibrary(previous => ({ ...previous, overviews: { ...previous.overviews, [record.paperId]: record } }));
  useEffect(() => {
    const receive = (event: Event) => {
      const record = (event as CustomEvent<OverviewRecord>).detail;
      updateLibrary(previous => previous.papers.some(p => p.id === record.paperId)
        ? { ...previous, overviews: { ...previous.overviews, [record.paperId]: record } } : previous);
    };
    window.addEventListener('paper-overview', receive); return () => window.removeEventListener('paper-overview', receive);
  }, [updateLibrary]);
  const saveDraft = (draft: PaperDraftEdit) => updateLibrary(previous => ({ ...previous, drafts: { ...previous.drafts, [draft.paperId]: draft } }));
  const saveConfig = (config: AiProviderConfig) => { paperApi.saveLocalAiConfig(config); updateLibrary(previous => ({ ...previous, aiConfig: config })); };
  const deletePaper = async (id: string) => {
    if (!await confirmDialog('移除此论文及其笔记？')) return;
    paperChats.remove(id);
    paperJobs.list().filter(job => job.paperId === id && job.status === 'running').forEach(job => paperJobs.cancel(job.id));
    updateLibrary(previous => {
      const annotations = { ...previous.annotations }, overviews = { ...previous.overviews }, drafts = { ...previous.drafts };
      delete annotations[id]; delete overviews[id]; delete drafts[id];
      const references = { ...previous.references }; delete references[id];
      return { ...previous, papers: previous.papers.filter(p => p.id !== id), annotations, overviews, drafts, references };
    });
    if (paperId === id) { openRequest.current++; setPaperId(null); setPdfData(null); setPagesText([]); setView('library'); }
  };
  const updateReading = useCallback((id: string, page: number, zoom: number, mode: 'continuous' | 'single', total?: number, rotation?: number) => {
    updateLibrary(previous => {
      const paper = previous.papers.find(p => p.id === id); if (!paper) return previous;
      const count = total && total > 0 ? total : paper.pageCount;
      const lastPage = clampPaperPage(page, count);
      if (paper.lastPage === lastPage && paper.lastZoom === zoom && paper.lastViewMode === mode && paper.pageCount === count && (paper.lastRotation || 0) === (rotation || 0)) return previous;
      return { ...previous, papers: previous.papers.map(p => p.id === id ? { ...p, lastPage, lastZoom: zoom, lastViewMode: mode, pageCount: count, lastRotation: rotation || 0, lastPositionUnit: /\.docx$/i.test(p.path) ? 'paragraph' : 'page' } : p) };
    });
  }, [updateLibrary]);

  if (loading) return <div className="flex-1 grid place-items-center text-xs text-slate-400"><RefreshCw className="w-4 h-4 animate-spin" /></div>;
  if (loadError) return <div className="flex-1 grid place-content-center gap-3 text-xs"><p role="alert">{loadError}</p><button onClick={() => void load()}>重新读取</button></div>;
  return <div className="flex-1 flex flex-col min-h-0 min-w-0">
    {saveError && <div role="alert" className="px-3 py-1 text-xs text-rose-600 flex gap-2"><span>{saveError}</span><button onClick={() => { void paperApi.saveLibrary(libraryRef.current).then(() => setSaveError('')).catch(e => setSaveError(String(e))); }}>重试</button></div>}
    {opening ? <div className="flex-1 grid place-content-center text-xs text-slate-400">正在加载文档…</div>
      : view === 'edit' && activePaper ? <PaperEditorView key={activePaper.id} paper={activePaper} pdfData={pdfData} config={library.aiConfig!} allReferences={extractNumberedReferences(pagesText)} extractedPagesText={pagesText} draft={library.drafts[activePaper.id] || null} onSaveDraft={saveDraft} onClose={() => { setView('read'); onSubTabChange?.('paper_reader'); }} />
      : view === 'read' && activePaper && pdfData ? <PaperReaderView key={activePaper.id} paper={activePaper} papers={library.papers} onOpenPaper={openPaper} pdfData={pdfData}
          annotations={library.annotations[activePaper.id] || []} overview={library.overviews[activePaper.id] || null} config={library.aiConfig!}
          onSaveAnnotation={saveAnnotation} onUpdateAnnotation={(id, noteText, patch) => updateLibrary(previous => ({ ...previous, annotations: { ...previous.annotations,
            [activePaper.id]: (previous.annotations[activePaper.id] || []).map(a => a.id === id ? { ...a, ...patch, noteText, updatedAt: Date.now() } : a) } }))}
          onDeleteAnnotation={id => updateLibrary(previous => ({ ...previous, annotations: { ...previous.annotations,
            [activePaper.id]: (previous.annotations[activePaper.id] || []).filter(a => a.id !== id) } }))}
          onSaveOverview={saveOverview} onSaveConfig={saveConfig} onUpdateReadingState={updateReading}
          onSwitchToEditMode={() => { setView('edit'); onSubTabChange?.('paper_editor'); }}
          onBackToLibrary={() => { setView('library'); onSubTabChange?.('paper_library'); }}
          onInsertToDraft={(text, screenshot) => {
            const draft = libraryRef.current.drafts[activePaper.id];
            saveDraft({ paperId: activePaper.id, title: draft?.title || activePaper.title, abstract: draft?.abstract || '',
              content: (draft?.content || '') + `\n\n${screenshot ? `![摘录](${screenshot})` : `> ${text}`}\n`, references: draft?.references || [], lastModified: Date.now() });
          }} onTextExtracted={handleTextExtracted} />
      : <PaperLibraryView papers={library.papers} onOpenPaper={openPaper} onImportPaper={importDialog} references={library.references || {}} importing={importing} onDeletePaper={deletePaper}
          onUpdateStatus={(id: string, status: ReadStatus) => updateLibrary(previous => ({ ...previous, papers: previous.papers.map(p => p.id === id ? { ...p, readStatus: status } : p) }))} />}
  </div>;
}
