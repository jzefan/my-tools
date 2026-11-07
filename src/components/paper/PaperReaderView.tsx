import React, { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore } from 'react';
import {
  AnnotationColor,
  AnnotationItem,
  AnnotationType,
  CitationMatch,
  CitationMention,
  OutlineItem,
  OverviewRecord,
  PaperItem,
  PdfRect,
  ReferenceEntry,
  AiProviderConfig,
  PaperSelection,
} from '../../types/paper';
import { extractNumberedReferences, matchCitationWithReferences } from '../../utils/citations';
import { paperAiPreview } from '../../utils/paperAiPreview';
import { generatePaperOverview, overviewSource } from '../../utils/paperAi';
import { PdfCanvasViewer } from './PdfCanvasViewer';
import { DocxCanvasViewer } from './DocxCanvasViewer';
import { OverviewInspector } from './OverviewInspector';
import { CitationInspector } from './CitationInspector';
import { AnnotationsInspector } from './AnnotationsInspector';
import { AiChatInspector } from './AiChatInspector';
import { OutlineInspector } from './OutlineInspector';
import { paperJobs } from '../../services/paperJobs';
import { paperApi } from '../../services/paperApi';
import { api } from '../../services/api';
import { findPaperMatches, clampPaperPage, paperMarkdown } from '../../utils/paperReader';
import { PaperJobsInspector } from './PaperJobsInspector';
import { PaperSettingsModal } from './PaperSettingsModal';
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Crop,
  Sparkles,
  Bookmark,
  Highlighter,
  MessageSquare,
  ListTree,
  Settings,
  Edit3,
  ChevronLeft,
  ChevronRight,
  Search,
  ListChecks,
  MoreHorizontal,
} from 'lucide-react';

interface PaperReaderViewProps {
  paper: PaperItem;
  papers: PaperItem[];
  onOpenPaper: (paper: PaperItem) => void;
  pdfData: Uint8Array;
  annotations: AnnotationItem[];
  overview: OverviewRecord | null;
  config: AiProviderConfig;
  onSaveAnnotation: (item: AnnotationItem) => void;
  onUpdateAnnotation: (id: string, noteText: string, patch?: Partial<AnnotationItem>) => void;
  onDeleteAnnotation: (id: string) => void;
  onSaveOverview: (record: OverviewRecord) => void;
  onSaveConfig: (config: AiProviderConfig) => void;
  onUpdateReadingState: (
    paperId: string,
    page: number,
    zoom: number,
    viewMode: 'continuous' | 'single',
    totalPages?: number,
    rotation?: number
  ) => void;
  onSwitchToEditMode: () => void;
  onBackToLibrary: () => void;
  onInsertToDraft?: (text: string, screenshotUrl?: string) => void;
  onTextExtracted?: (pages: Array<{ pageNo: number; text: string }>) => void;
}

export const PaperReaderView: React.FC<PaperReaderViewProps> = ({
  paper,
  papers,
  onOpenPaper,
  pdfData,
  annotations,
  overview,
  config,
  onSaveAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onSaveOverview,
  onSaveConfig,
  onUpdateReadingState,
  onSwitchToEditMode,
  onBackToLibrary,
  onInsertToDraft,
  onTextExtracted,
}) => {
  const isPdfData = pdfData.length >= 5 && [0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, index) => pdfData[index] === byte);

  const locationUnit = isPdfData ? '页' : '段';

  const [readingReady, setReadingReady] = useState(false);

  // Reading viewport controls
  const [currentPage, setCurrentPage] = useState<number>(paper.lastPage || 1);
  const [totalPages, setTotalPages] = useState<number>(paper.pageCount || 1);
  const [zoom, setZoom] = useState<number>(paper.lastZoom || 1.15);
  const [rotation, setRotation] = useState<number>(paper.lastRotation || 0);
  const [viewMode, setViewMode] = useState<'continuous' | 'single'>(paper.lastViewMode || 'continuous');
  const [areaMode, setAreaMode] = useState<boolean>(false);

  // Inspector Sidebar
  const [inspectorMode, setInspectorMode] = useState<
    'overview' | 'citations' | 'annotations' | 'ask' | 'outline' | 'search' | 'jobs' | null
  >('overview');
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Extracted metadata & citations
  const [extractedPages, setExtractedPages] = useState<Array<{ pageNo: number; text: string }>>([]);
  const [references, setReferences] = useState<ReferenceEntry[]>([]);
  const [activeCitationMatch, setActiveCitationMatch] = useState<CitationMatch | null>(null);
  const [activeAiQuestion, setActiveAiQuestion] = useState<PaperSelection | null>(null);
  const [jumpTarget, setJumpTarget] = useState<{ pageNo: number; rect?: PdfRect; quote?: string; nonce: number } | null>(null);
  const jobs = useSyncExternalStore(paperJobs.subscribe, paperJobs.list);
  const activeOverviewJob = jobs.find(job => job.type === 'overview' && job.paperId === paper.id && job.status === 'running');
  const isGeneratingOverview = !!activeOverviewJob;

  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [deleted, setDeleted] = useState<AnnotationItem | null>(null);
  const [nativeOutline, setNativeOutline] = useState<OutlineItem[]>([]);
  const overviewJob = useRef<string | null>(null); overviewJob.current = activeOverviewJob?.id || null;
  const alive = useRef(true);
  const generateRef = useRef<() => void>(() => {});
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const overviewPreview = useMemo(() => paperAiPreview(config.model, overviewSource(extractedPages).reduce((count, page) => count + page.text.length, 0)), [config.model, extractedPages]);
  const matches = useMemo(() => findPaperMatches(extractedPages, search), [extractedPages, search]);

  // Outline Bookmarks
  const [outline, setOutline] = useState<OutlineItem[]>([]);

  // Update reading progress to parent
  useEffect(() => {
    if (readingReady) onUpdateReadingState(paper.id, currentPage, zoom, viewMode, totalPages, rotation);
  }, [paper.id, currentPage, zoom, viewMode, totalPages, rotation, readingReady, onUpdateReadingState]);

  const handleTotalPages = useCallback((total: number) => { setTotalPages(total); setReadingReady(true); setCurrentPage(page => clampPaperPage(page, total)); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setInspectorMode('search'); setIsInspectorOpen(true); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  // When text is extracted from all pages, compute references and outline
  const handleTextExtracted = useCallback((pages: Array<{ pageNo: number; text: string }>) => {
    setExtractedPages(pages);
    onTextExtracted?.(pages);
    const refs = extractNumberedReferences(pages);
    setReferences(refs);

    // Auto-detect academic sections for outline
    const detectedHeadings: OutlineItem[] = [];
    const headingRegex = /^(?:([0-9]+(?:\.[0-9]+)*)\s+)?(Abstract|Introduction|Related\s+Work|Methodology|Method|Experiments?|Results?|Discussion|Conclusion|References|摘要|引言|方法|实验|结论|参考文献)(?:\b|\s|$)/i;
    pages.forEach((p) => {
      const lines = p.text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 3 && trimmed.length < 60 && headingRegex.test(trimmed)) {
          detectedHeadings.push({
            title: trimmed,
            pageNo: p.pageNo,
            level: 1,
          });
          break;
        }
      }
    });
    setOutline(detectedHeadings);
  }, [onTextExtracted]);

  // Keep generation independent of the selected inspector tab.
  const handleGenerateOverview = async () => {
    if (overviewJob.current) return;
    if (!extractedPages.some(p => p.text.trim())) { setMessage('没有可分析的正文'); return; }
    const job = paperJobs.start('overview', paper.id, () => { if (!alive.current) return false; generateRef.current(); return true; });
    overviewJob.current = job.id;
    setMessage('');
    try {
      const rec = await generatePaperOverview(paper.id, paper.title, extractedPages, config, { signal: job.signal });
      if (!job.signal.aborted) { await paperApi.storeOverview(rec); if (alive.current) onSaveOverview(rec); }
      paperJobs.finish(job.id);
    } catch (error) {
      if (alive.current) setMessage(job.signal.aborted ? '已停止生成' : error instanceof Error ? error.message : String(error));
      paperJobs.finish(job.id, error);
    } finally { overviewJob.current = null; }
  };
  generateRef.current = () => { if (alive.current) void handleGenerateOverview(); };

  // Add Annotation
  const handleAddAnnotation = (
    type: AnnotationType,
    color: AnnotationColor,
    pageNo: number,
    rects: PdfRect[],
    selectedText: string,
    noteText?: string,
    screenshotDataUrl?: string,
    segments?: AnnotationItem['segments']
  ) => {
    const newItem: AnnotationItem = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      paperId: paper.id,
      locationUnit: isPdfData ? 'page' : 'paragraph',
      type,
      color,
      pageNo,
      rects,
      selectedText,
      noteText: noteText || '',
      screenshotDataUrl,
      segments,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onSaveAnnotation(newItem);
    setInspectorMode('annotations');
    setIsInspectorOpen(true);
  };

  // Citation Click
  const handleCitationClick = (mention: CitationMention) => {
    const match = matchCitationWithReferences(mention, references);
    setActiveCitationMatch(match);
    setInspectorMode('citations');
    setIsInspectorOpen(true);
  };

  // Ask AI on selection or screenshot
  const handleAskAi = (text: string, screenshotUrl?: string, selection?: PaperSelection) => {
    setActiveAiQuestion(selection || { text, screenshot: screenshotUrl, pageNo: currentPage, rects: [] });
    setInspectorMode('ask');
    setIsInspectorOpen(true);
  };

  // Jump to page with optional rect or quote
  const handleJumpToPage = (pageNo: number, targetOrQuote?: any) => {
    pageNo = clampPaperPage(pageNo, totalPages);
    setCurrentPage(pageNo);
    const rect =
      typeof targetOrQuote === 'object' && targetOrQuote && 'x' in targetOrQuote
        ? (targetOrQuote as PdfRect)
        : undefined;
    setJumpTarget({ pageNo, rect, quote: typeof targetOrQuote === 'string' ? targetOrQuote : undefined, nonce: Date.now() });
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-slate-950">
      {/* Top Reading Navigation Bar */}
      <div className="px-3 py-2 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex flex-wrap gap-y-2 items-center justify-between text-xs">
        {/* Left: Back & Title */}
        <div className="flex items-center space-x-2 min-w-0 mr-2 flex-1">
          <button
            type="button"
            onClick={onBackToLibrary}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200/50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors shrink-0 cursor-pointer"
            title="返回资料库"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>

          <div className="min-w-0 flex items-center space-x-2">
            <h1 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate" title={paper.title}>
              {paper.title}
            </h1>
          </div>
        </div>

        {/* Center: Pagination & Zoom Controls */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* Page Stepper */}
          <div className="flex items-center space-x-1 font-mono text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => handleJumpToPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <input aria-label="跳转页码" key={currentPage} type="number" min={1} max={totalPages} defaultValue={currentPage}
              onBlur={e => handleJumpToPage(Number(e.target.value))}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              className="w-10 bg-transparent text-center text-slate-700 dark:text-slate-200 outline-none" />
            <span className="text-slate-400">/</span>
            <span className="text-slate-400">{totalPages}</span>
            <button
              type="button"
              onClick={() => handleJumpToPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center space-x-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.15) * 100) / 100))}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              title="缩小"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono px-1 font-medium text-slate-700 dark:text-slate-300 min-w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.15) * 100) / 100))}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              title="放大"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Rotation */}
          <button
            type="button"
            disabled={!isPdfData}
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
            title="旋转"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          {/* View Mode Switcher */}
          <button
            type="button"
            disabled={!isPdfData}
            onClick={() => setViewMode((m) => (m === 'continuous' ? 'single' : 'continuous'))}
            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer text-[11px] font-medium"
            title={viewMode === 'continuous' ? '切换为单页模式' : '切换为连续滚动'}
          >
            {viewMode === 'continuous' ? '连续' : '单页'}
          </button>

          {/* Area Crop Mode Toggle */}
          <button
            type="button"
            disabled={!isPdfData}
            onClick={() => setAreaMode(!areaMode)}
            className={`px-2 py-1 rounded-lg border text-xs font-medium flex items-center space-x-1 cursor-pointer transition-colors ${
              areaMode
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
            }`}
            title="框选区域"
          >
            <Crop className="w-3.5 h-3.5" />
            <span>框选</span>
          </button>

          <span className="w-px h-4 bg-slate-200 dark:bg-slate-800" />

          {/* Switch to Editor Button */}
          <button
            type="button"
            onClick={onSwitchToEditMode}
            className="px-2.5 py-1 rounded-lg bg-cyan-50 hover:bg-cyan-100 dark:bg-cyan-950/60 dark:hover:bg-cyan-900/60 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800 text-xs font-semibold flex items-center space-x-1 cursor-pointer transition-all"
            title="编辑手稿"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>编辑手稿</span>
          </button>
        </div>

        {/* Right: Inspector Tab Triggers */}
        <div className="flex items-center space-x-1 shrink-0 ml-3">
          {[
            { id: 'overview' as const, label: '导读', icon: Sparkles },
            { id: 'citations' as const, label: '引文', icon: Bookmark },
            { id: 'annotations' as const, label: `批注(${annotations.length})`, icon: Highlighter },
            { id: 'ask' as const, label: '问AI', icon: MessageSquare },
            { id: 'outline' as const, label: '目录', icon: ListTree },
            { id: 'search' as const, label: '搜索', icon: Search },
            { id: 'jobs' as const, label: '任务', icon: ListChecks },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = isInspectorOpen && inspectorMode === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (inspectorMode === t.id && isInspectorOpen) {
                    setIsInspectorOpen(false);
                  } else {
                    setInspectorMode(t.id);
                    setIsInspectorOpen(true);
                  }
                }}
                className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}

          <details className="relative text-xs"><summary title="更多操作" className="cursor-pointer list-none p-1.5 text-slate-400"><MoreHorizontal className="w-4 h-4" /></summary>
            <div className="absolute right-0 top-8 z-50 w-36 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 shadow-sm">
              <button className="block w-full text-left p-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { void api.openFilePath(paper.path).catch(e => setMessage(String(e))); }}>系统打开</button>
              <button className="block w-full text-left p-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { void paperApi.saveMarkdown(paper.title + '_研读笔记', paperMarkdown(paper, annotations, overview)).then(path => { if (path) setMessage('已导出'); }).catch(e => setMessage(String(e))); }}>导出 Markdown</button>
              <button disabled={!isPdfData} className="block w-full text-left p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40" onClick={() => { void import('../../utils/paperPrint').then(module => module.printPaperPdf(pdfData)).catch(e => setMessage(String(e))); }}>打印</button>
            </div>
          </details>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            title="AI 设置"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {message && <div role="status" className="flex items-center gap-3 px-3 py-1 text-xs text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800"><span className="flex-1">{message}</span><button onClick={() => setMessage('')}>关闭</button></div>}
      {deleted && <div role="status" className="px-3 py-1 text-xs flex gap-3"><span>批注已删除</span><button onClick={() => { onSaveAnnotation(deleted); setDeleted(null); }}>撤销</button><button onClick={() => setDeleted(null)}>关闭</button></div>}
      {/* Main Split: Left Document Viewer, Right Inspector Drawer */}
      <div className="flex-1 flex overflow-hidden">
        {/* Document Canvas (PDF or Word DOCX) */}
        <div className="flex-1 h-full overflow-hidden flex flex-col">
          {!isPdfData ? (
            <DocxCanvasViewer
              legacyPage={paper.lastPositionUnit === 'paragraph' ? undefined : paper.lastPage}
              onResolveAnnotation={(annotation, pageNo) => onUpdateAnnotation(annotation.id, annotation.noteText, { pageNo: pageNo || annotation.pageNo, orphaned: !pageNo, locationUnit: 'paragraph' })}
              fileData={pdfData}
              paperId={paper.id}
              zoom={zoom}
              currentPage={currentPage}
              annotations={annotations}
              references={references}
              jumpTarget={jumpTarget}
              onPageChange={setCurrentPage}
              onTotalPages={handleTotalPages}
              onTextExtracted={handleTextExtracted}
              onAskAi={handleAskAi}
              onAddAnnotation={handleAddAnnotation}
              onCitationClick={handleCitationClick}
              onInsertToDraft={onInsertToDraft}
            />
          ) : (
            <PdfCanvasViewer
              pdfData={pdfData}
              paperId={paper.id}
              zoom={zoom}
              rotation={rotation}
              viewMode={viewMode}
              currentPage={currentPage}
              areaMode={areaMode}
              annotations={annotations}
              references={references}
              jumpTarget={jumpTarget}
              onPageChange={setCurrentPage}
              onTotalPages={handleTotalPages}
              onTextExtracted={handleTextExtracted}
              onOutline={setNativeOutline}
              onError={setMessage}
              onAskAi={handleAskAi}
              onAddAnnotation={handleAddAnnotation}
              onCitationClick={handleCitationClick}
              onInsertToDraft={onInsertToDraft}
            />
          )}
        </div>

        {/* Right Inspector Drawer */}
        <div hidden={!isInspectorOpen} className={isInspectorOpen ? "flex" : "hidden"}>
          <div className="w-80 md:w-96 border-l border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full">
            {inspectorMode === 'overview' && (
              <OverviewInspector
                locationUnit={locationUnit}
                preview={overviewPreview}
                overview={overview}
                isLoading={isGeneratingOverview}
                onGenerate={handleGenerateOverview}
                onJumpToPage={handleJumpToPage}
                onCancel={() => { if (overviewJob.current) paperJobs.cancel(overviewJob.current); }}
              />
            )}

            {inspectorMode === 'citations' && (
              <CitationInspector
                locationUnit={locationUnit}
                match={activeCitationMatch}
                allReferences={references}
                paperTitle={paper.title}
                onJumpToPage={handleJumpToPage}
                onClose={() => setIsInspectorOpen(false)}
                papers={papers}
                onOpenPaper={onOpenPaper}
              />
            )}

            {inspectorMode === 'annotations' && (
              <AnnotationsInspector
                locationUnit={locationUnit}
                paperTitle={paper.title}
                annotations={annotations}
                onJumpToPage={handleJumpToPage}
                onUpdateAnnotation={onUpdateAnnotation}
                onDeleteAnnotation={id => { setDeleted(annotations.find(a => a.id === id) || null); onDeleteAnnotation(id); }}
              />
            )}

            <div className={inspectorMode === 'ask' ? 'flex flex-1 flex-col min-h-0' : 'hidden'}>
              <AiChatInspector locationUnit={locationUnit} paperId={paper.id} paperTitle={paper.title} pages={extractedPages} currentPage={currentPage}
                selection={activeAiQuestion} config={config} onOpenSettings={() => setShowSettings(true)} onJumpToPage={handleJumpToPage}
                onSaveAsAnnotation={(question, result, source) => onSaveAnnotation({
                  id: crypto.randomUUID(), paperId: paper.id, locationUnit: isPdfData ? 'page' : 'paragraph', type: 'ai_qa', color: 'purple', pageNo: source.pageNo,
                  rects: source.rects, selectedText: source.text, segments: source.segments, noteText: '', question,
                  answer: result.answer, evidence: result.evidence, model: config.model,
                  qaState: result.status === 'verified' ? 'verified' : 'draft', screenshotDataUrl: source.screenshot,
                  createdAt: Date.now(), updatedAt: Date.now(),
                })} />
            </div>
            {inspectorMode === 'search' && <section className="flex-1 flex flex-col min-h-0 p-3 text-xs" aria-label="全文搜索">
              <label className="flex items-center gap-2 border border-slate-200 dark:border-slate-700 rounded p-2"><Search className="w-3.5 h-3.5 text-slate-400" /><input aria-label="搜索论文正文" autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索正文" className="min-w-0 flex-1 bg-transparent outline-none" /></label>
              <div className="text-slate-400 py-2">{extractedPages.length ? search.trim() ? `${matches.length} 个结果${matches.length === 100 ? '（最多显示 100 条）' : ''}` : '' : '正文解析中…'}</div>
              <div className="overflow-auto">{matches.map((match, i) => <button key={i} className="block w-full text-left py-2 border-b border-slate-100 dark:border-slate-800 hover:text-indigo-600" onClick={() => handleJumpToPage(match.pageNo, search)}><span className="line-clamp-3 break-words">{match.text}</span><small className="text-slate-400">第 {match.pageNo} {locationUnit}</small></button>)}</div>
            </section>}
            {inspectorMode === 'jobs' && <PaperJobsInspector paperId={paper.id} onOpen={(_id, type) => { if (type === 'overview') void handleGenerateOverview(); else if (type === 'qa') setInspectorMode('ask'); else onOpenPaper(paper); }} />}

            {inspectorMode === 'outline' && (
              <OutlineInspector
                locationUnit={locationUnit}
                totalPages={totalPages}
                currentPage={currentPage}
                outline={nativeOutline.length ? nativeOutline : outline}
                onJumpToPage={handleJumpToPage}
              />
            )}
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <PaperSettingsModal
        config={config}
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={onSaveConfig}
      />
    </div>
  );
};
