import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { AnnotationColor, AnnotationItem, AnnotationType, CitationMention, PdfRect, ReferenceEntry, OutlineItem, PaperSelection, SelectionSegment } from '../../types/paper';
import { findCitationMentionsInText } from '../../utils/citations';
import { readPdfOutline } from '../../utils/paperOutline';
import { normalizeRectsToCanonical, projectCanonicalRect, joinSelectedText, type CoordinateViewport } from '../../utils/paperGeometry';
import { paperApi } from '../../services/paperApi';
import { paperJobs } from '../../services/paperJobs';
import { Sparkles, Highlighter, PenLine, Copy, FileText } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
type JumpTarget = { pageNo: number; rect?: PdfRect; quote?: string; nonce: number };
interface Props {
  pdfData: Uint8Array; paperId: string; zoom: number; rotation: number; viewMode: 'continuous' | 'single';
  currentPage: number; areaMode: boolean; annotations: AnnotationItem[]; references: ReferenceEntry[];
  jumpTarget?: JumpTarget | null;
  onPageChange: (page: number) => void; onTotalPages: (total: number) => void;
  onTextExtracted: (pages: Array<{ pageNo: number; text: string }>) => void;
  onOutline?: (outline: OutlineItem[]) => void; onError?: (error: string) => void;
  onAskAi: (text: string, screenshot?: string, selection?: PaperSelection) => void;
  onAddAnnotation: (type: AnnotationType, color: AnnotationColor, pageNo: number, rects: PdfRect[], text: string, note?: string, screenshot?: string, segments?: SelectionSegment[]) => void;
  onCitationClick: (mention: CitationMention) => void;
  onInsertToDraft?: (text: string, screenshot?: string) => void;
}
interface PageLayout { active: CoordinateViewport; canonical: CoordinateViewport }
const colors: AnnotationColor[] = ['yellow', 'green', 'blue', 'purple', 'red'];
const colorValues = { yellow: '#fbbf2460', green: '#34d39960', blue: '#60a5fa60', purple: '#c084fc60', red: '#fb718560' };
const overlayStyle = (rect: PdfRect) => ({ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });

export function PdfCanvasViewer(props: Props) {
  const { pdfData, paperId, zoom, rotation, viewMode, currentPage, areaMode, annotations, jumpTarget } = props;
  const latest = useRef(props); latest.current = props;
  const root = useRef<HTMLDivElement>(null);
  const layouts = useRef(new Map<number, PageLayout>());
  const selectionVersion = useRef(0);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState(new Map<number, { width: number; height: number }>());
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<PaperSelection | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [color, setColor] = useState<AnnotationColor>('yellow');
  const [drag, setDrag] = useState<{ pageNo: number; x: number; y: number; endX: number; endY: number } | null>(null);
  const scrollFrame = useRef(0);

  useEffect(() => {
    let active = true;
    setError(''); setDoc(null); setSizes(new Map()); layouts.current.clear();
    const job = paperJobs.start('extract', paperId, () => { if (!active) return false; setRetry(value => value + 1); return true; });
    const task = pdfjs.getDocument({ data: pdfData.slice(),
      cMapUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/cmaps/`, location.href).href,
      standardFontDataUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/standard_fonts/`, location.href).href,
      wasmUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/wasm/`, location.href).href, cMapPacked: true });
    const cancel = () => { void task.destroy(); };
    job.signal.addEventListener('abort', cancel, { once: true });
    void (async () => {
      try {
        const document = await task.promise;
        if (!active) return;
        setDoc(document); latest.current.onTotalPages(document.numPages);
        void readPdfOutline(document).then(outline => { if (active) latest.current.onOutline?.(outline); }).catch(() => {});
        const measured = new Map<number, { width: number; height: number }>();
        const text = new Map<number, string>();
        let next = 1;
        const worker = async () => {
          while (next <= document.numPages && active && !job.signal.aborted) {
            const pageNo = next++;
            const page = await document.getPage(pageNo);
            const viewport = page.getViewport({ scale: 1 });
            measured.set(pageNo, { width: viewport.width, height: viewport.height });
            const content = await page.getTextContent();
            const pageText = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
            text.set(pageNo, pageText);
            if (active) setSizes(new Map(measured));
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, document.numPages) }, worker));
        if (job.signal.aborted) throw new DOMException('已停止', 'AbortError');
        if (active) latest.current.onTextExtracted([...text].sort(([a], [b]) => a - b).map(([pageNo, text]) => ({ pageNo, text })));
        paperJobs.finish(job.id);
      } catch (failure) {
        if (active) { const message = job.signal.aborted ? '已停止解析' : `PDF 解析失败：${String(failure)}`; setError(message); latest.current.onError?.(message); }
        paperJobs.finish(job.id, failure);
      }
    })();
    return () => { active = false; selectionVersion.current++; paperJobs.cancel(job.id); job.signal.removeEventListener('abort', cancel); void task.destroy(); };
  }, [pdfData, paperId, retry]);

  useEffect(() => { setSelection(null); setNoteOpen(false); setDrag(null); selectionVersion.current++; }, [rotation, viewMode, areaMode]);
  const restored = useRef('');
  useEffect(() => {
    if (!doc || !root.current || !sizes.has(currentPage)) return;
    const key = `${retry}:${viewMode}:${rotation}:${zoom}`;
    const navigationKey = `${key}:${jumpTarget?.nonce || 0}`;
    if (restored.current === navigationKey) return;
    const targetPage = jumpTarget?.pageNo || currentPage;
    const host = root.current.querySelector<HTMLElement>(`[data-page-no="${targetPage}"]`);
    if (!host) return;
    const frame = requestAnimationFrame(() => {
      if (!root.current) return;
      host.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (jumpTarget?.rect) {
        const layout = layouts.current.get(targetPage);
        const rect = layout ? projectCanonicalRect(jumpTarget.rect, layout.canonical, layout.active) : jumpTarget.rect;
        root.current.scrollTop += rect.y * host.offsetHeight - 50;
      }
      restored.current = navigationKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [doc, sizes, jumpTarget, currentPage, zoom, rotation, viewMode, retry]);

  const scroll = useCallback(() => {
    if (scrollFrame.current || viewMode !== 'continuous') return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const container = root.current; if (!container) return;
      const top = container.getBoundingClientRect().top + container.clientHeight / 3;
      const hosts = container.querySelectorAll<HTMLElement>('[data-page-no]');
      for (const host of hosts) {
        const bounds = host.getBoundingClientRect();
        if (bounds.top <= top && bounds.bottom > top) {
          const pageNo = Number(host.dataset.pageNo);
          if (pageNo !== latest.current.currentPage) latest.current.onPageChange(pageNo);
          break;
        }
      }
    });
  }, [viewMode]);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

  const captureSelection = () => {
    if (areaMode || noteOpen) return;
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount || !root.current) { setSelection(null); return; }
    const range = selected.getRangeAt(0);
    if (!root.current.contains(range.startContainer) || !root.current.contains(range.endContainer)) return;
    const segments: SelectionSegment[] = [];
    for (const host of root.current.querySelectorAll<HTMLElement>('[data-page-no]')) {
      const layer = host.querySelector<HTMLElement>('.textLayer');
      const pageNo = Number(host.dataset.pageNo), layout = layouts.current.get(pageNo);
      if (!layer || !layout || !range.intersectsNode(layer)) continue;
      const part = range.cloneRange();
      if (!layer.contains(part.startContainer)) part.setStart(layer, 0);
      if (!layer.contains(part.endContainer)) part.setEnd(layer, layer.childNodes.length);
      const text = part.toString().trim(); if (!text) continue;
      const rects = normalizeRectsToCanonical(Array.from(part.getClientRects()), host.getBoundingClientRect(), layout.active, layout.canonical);
      if (rects.length) segments.push({ pageNo, rects, selectedText: text });
    }
    if (!segments.length || segments.some((s, i) => i > 0 && s.pageNo !== segments[i - 1].pageNo + 1)) return;
    const first = segments[0];
    setSelection({ text: joinSelectedText(segments.map(s => s.selectedText)), pageNo: first.pageNo, rects: first.rects, segments });
  };
  const save = (type: AnnotationType) => {
    if (!selection) return;
    props.onAddAnnotation(type, color, selection.pageNo, selection.rects, selection.text, note, selection.screenshot, selection.segments);
    setSelection(null); setNote(''); setNoteOpen(false); window.getSelection()?.removeAllRanges();
  };
  const areaStart = (event: React.PointerEvent, pageNo: number) => {
    if (!areaMode) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    setSelection(null); setDrag({ pageNo, x, y, endX: x, endY: y });
  };
  const areaMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setDrag({ ...drag, endX: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), endY: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) });
  };
  const areaEnd = (event: React.PointerEvent) => {
    if (!drag) return;
    const host = event.currentTarget as HTMLElement, canvas = host.querySelector('canvas'), layout = layouts.current.get(drag.pageNo);
    const bounds = host.getBoundingClientRect();
    const x = Math.min(drag.x, drag.endX), y = Math.min(drag.y, drag.endY), width = Math.abs(drag.x - drag.endX), height = Math.abs(drag.y - drag.endY);
    setDrag(null);
    if (!canvas || !layout || width < 5 || height < 5) return;
    const crop = document.createElement('canvas'), scale = canvas.width / bounds.width;
    crop.width = Math.ceil(width * scale); crop.height = Math.ceil(height * scale);
    crop.getContext('2d')?.drawImage(canvas, x * scale, y * scale, width * scale, height * scale, 0, 0, crop.width, crop.height);
    const rects = normalizeRectsToCanonical([{ left: bounds.left + x, top: bounds.top + y, right: bounds.left + x + width, bottom: bounds.top + y + height, width, height }], bounds, layout.active, layout.canonical);
    setSelection({ text: '', pageNo: drag.pageNo, rects, screenshot: crop.toDataURL('image/png') });
  };
  const pages = viewMode === 'single' ? [Math.min(doc?.numPages || 1, currentPage)] : Array.from({ length: doc?.numPages || 0 }, (_, i) => i + 1);
  return <div className="relative flex-1 min-h-0 flex flex-col">
    {selection && <div className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 text-xs flex flex-wrap gap-3 items-center" onMouseDown={e => { if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) e.preventDefault(); }}>
      <span className="text-slate-400">第 {selection.pageNo} 页{selection.segments && selection.segments.length > 1 ? `–${selection.segments[selection.segments.length - 1].pageNo} 页` : ''}</span>
      <button className="flex gap-1 items-center text-indigo-600" onClick={() => props.onAskAi(selection.text, selection.screenshot, selection)}><Sparkles className="w-3.5 h-3.5" />问 AI</button>
      <button className="flex gap-1 items-center" onClick={() => save(selection.screenshot ? 'area' : 'highlight')}><Highlighter className="w-3.5 h-3.5" />高亮</button>
      <select aria-label="高亮颜色" value={color} onChange={e => setColor(e.target.value as AnnotationColor)} className="bg-transparent">{colors.map((c, i) => <option key={c} value={c}>{['黄', '绿', '蓝', '紫', '红'][i]}</option>)}</select>
      <button className="flex gap-1 items-center" onClick={() => setNoteOpen(value => !value)}><PenLine className="w-3.5 h-3.5" />笔记</button>
      {selection.text && <button title="复制选区" onClick={() => { void navigator.clipboard.writeText(selection.text); }}><Copy className="w-3.5 h-3.5" /></button>}
      {props.onInsertToDraft && <button title="插入草稿" onClick={() => props.onInsertToDraft?.(selection.text, selection.screenshot)}><FileText className="w-3.5 h-3.5" /></button>}
      <button className="ml-auto text-slate-400" onClick={() => { setSelection(null); setNoteOpen(false); window.getSelection()?.removeAllRanges(); }}>取消</button>
      {noteOpen && <div className="w-full flex gap-2"><textarea aria-label="选区笔记" value={note} onChange={e => setNote(e.target.value)} autoFocus className="flex-1 min-w-0 border border-slate-200 dark:border-slate-700 bg-transparent rounded p-2" /><button onClick={() => save('note')}>保存</button></div>}
    </div>}
    {error && <div role="alert" className="p-3 text-xs text-rose-600">{error} <button onClick={() => setRetry(value => value + 1)}>重新解析</button></div>}
    <div ref={root} onScroll={scroll} onMouseUp={captureSelection} onKeyUp={captureSelection} className="relative flex-1 min-h-0 overflow-auto bg-slate-100 dark:bg-slate-950 p-5" style={{ cursor: areaMode ? 'crosshair' : undefined }}>
      {!doc && !error && <p className="text-center text-xs text-slate-400">正在加载 PDF…</p>}
      <div className="flex flex-col items-center gap-5 min-w-fit">
        {doc && pages.map(pageNo => {
          const base = sizes.get(pageNo) || { width: 612, height: 792 };
          const size = rotation % 180 ? { width: base.height, height: base.width } : base;
          return <LazyPage key={pageNo} root={root} pageNo={pageNo} width={size.width * zoom} height={size.height * zoom} immediate={pageNo === currentPage || !!selection?.segments?.some(s => s.pageNo === pageNo)}>
            <PdfPage doc={doc} pageNo={pageNo} zoom={zoom} rotation={rotation} annotations={annotations} focus={jumpTarget?.pageNo === pageNo ? jumpTarget : null}
              areaMode={areaMode} onLayout={layout => layouts.current.set(pageNo, layout)} onError={message => latest.current.onError?.(message)} onCitation={props.onCitationClick}
              onAreaStart={e => areaStart(e, pageNo)} onAreaMove={areaMove} onAreaEnd={areaEnd}
              drag={drag?.pageNo === pageNo ? drag : null} />
          </LazyPage>;
        })}
      </div>
    </div>
  </div>;
}

function LazyPage({ root, pageNo, width, height, immediate, children }: { root: React.RefObject<HTMLDivElement | null>; pageNo: number; width: number; height: number; immediate: boolean; children: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(immediate);
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: root.current, rootMargin: '900px 0px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, [root]);
  return <div ref={host} data-page-no={pageNo} className="relative shrink-0 bg-white shadow-sm" style={{ width, height }}>{(visible || immediate) && children}</div>;
}

function quoteRects(layer: HTMLElement, host: HTMLElement, quote: string): PdfRect[] {
  const nodes: Text[] = [], positions: Array<{ node: Text; offset: number }> = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let text = '', current: Node | null;
  while ((current = walker.nextNode())) nodes.push(current as Text);
  for (const node of nodes) {
    for (let i = 0; i < node.length; i++) {
      if (/\s/u.test(node.data[i])) continue;
      text += node.data[i].toLocaleLowerCase(); positions.push({ node, offset: i });
    }
  }
  const needle = quote.replace(/\s/gu, '').toLocaleLowerCase();
  const index = needle ? text.indexOf(needle) : -1;
  if (index < 0) return [];
  const start = positions[index], end = positions[index + needle.length - 1];
  const range = document.createRange(); range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset + 1);
  const bounds = host.getBoundingClientRect();
  return Array.from(range.getClientRects()).filter(rect => rect.width && rect.height).map(rect => ({ x: (rect.left - bounds.left) / bounds.width, y: (rect.top - bounds.top) / bounds.height, width: rect.width / bounds.width, height: rect.height / bounds.height }));
}

interface PageProps {
  doc: pdfjs.PDFDocumentProxy; pageNo: number; zoom: number; rotation: number; annotations: AnnotationItem[]; focus?: JumpTarget | null; areaMode: boolean;
  onLayout: (layout: PageLayout) => void; onError: (message: string) => void; onCitation: Props['onCitationClick'];
  onAreaStart: (e: React.PointerEvent) => void; onAreaMove: (e: React.PointerEvent) => void; onAreaEnd: (e: React.PointerEvent) => void;
  drag: { x: number; y: number; endX: number; endY: number } | null;
}
function PdfPage(props: PageProps) {
  const { doc, pageNo, zoom, rotation, annotations, focus, areaMode, drag } = props;
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), layer = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  const [layout, setLayout] = useState<PageLayout | null>(null);
  const [ready, setReady] = useState(0);
  const [citations, setCitations] = useState<CitationMention[]>([]);
  const [links, setLinks] = useState<Array<{ rect: PdfRect; url?: string; dest?: unknown[] | string }>>([]);
  const [focused, setFocused] = useState<PdfRect[]>([]);
  useEffect(() => {
    let disposed = false, render: pdfjs.RenderTask | undefined, textLayer: pdfjs.TextLayer | undefined;
    void (async () => {
      try {
        const page = await doc.getPage(pageNo);
        if (disposed || !canvas.current || !layer.current) return;
        const active = page.getViewport({ scale: zoom, rotation: (page.rotate + rotation) % 360 });
        const canonical = page.getViewport({ scale: 1, rotation: 0 });
        const currentLayout = { active, canonical };
        setLayout(currentLayout); latest.current.onLayout(currentLayout);
        // A separate canvas prevents cancelled renders from racing a new zoom render.
        const scratch = document.createElement('canvas');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        scratch.width = Math.floor(active.width * dpr); scratch.height = Math.floor(active.height * dpr);
        const context = scratch.getContext('2d'); if (!context) return;
        render = page.render({ canvas: scratch, canvasContext: context, viewport: active, transform: [dpr, 0, 0, dpr, 0, 0] });
        await render.promise;
        if (disposed || !canvas.current || !layer.current) return;
        canvas.current.width = scratch.width; canvas.current.height = scratch.height;
        canvas.current.getContext('2d')?.drawImage(scratch, 0, 0); scratch.width = 0; scratch.height = 0;
        const content = await page.getTextContent();
        if (disposed || !layer.current) return;
        layer.current.replaceChildren();
        layer.current.style.setProperty('--scale-factor', String(zoom));
        textLayer = new pdfjs.TextLayer({ textContentSource: content, container: layer.current, viewport: active });
        await textLayer.render();
        if (disposed) return;
        setCitations(findCitationMentionsInText(content.items.map(i => 'str' in i ? i.str : '').join(' '), pageNo));
        const embedded = await page.getAnnotations();
        if (disposed) return;
        setLinks(embedded.filter(a => a.subtype === 'Link' && Array.isArray(a.rect)).map(a => {
          const box = [...active.convertToViewportPoint(a.rect[0], a.rect[1]), ...active.convertToViewportPoint(a.rect[2], a.rect[3])];
          return { rect: { x: Math.min(box[0], box[2]) / active.width, y: Math.min(box[1], box[3]) / active.height, width: Math.abs(box[2] - box[0]) / active.width, height: Math.abs(box[3] - box[1]) / active.height }, url: a.url, dest: a.dest };
        }));
        setReady(value => value + 1);
      } catch (error) { if (!disposed) latest.current.onError(`第 ${pageNo} 页渲染失败：${String(error)}`); }
    })();
    return () => { disposed = true; render?.cancel(); textLayer?.cancel(); };
  }, [doc, pageNo, zoom, rotation]);
  useEffect(() => {
    if (!focus || !layout || !host.current || !layer.current) { setFocused([]); return; }
    const rects = focus.rect ? [projectCanonicalRect(focus.rect, layout.canonical, layout.active)] : focus.quote ? quoteRects(layer.current, host.current, focus.quote) : [];
    setFocused(rects);
    const frame = requestAnimationFrame(() => {
      if (!host.current || !rects.length) return;
      const scrollRoot = host.current.closest('.overflow-auto');
      if (scrollRoot) scrollRoot.scrollTop += host.current.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + rects[0].y * host.current.clientHeight - 70;
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, layout, ready]);
  const openLink = async (link: { url?: string; dest?: unknown[] | string }) => {
    try {
      if (link.url) { await paperApi.openExternalUrl(link.url); }
      else if (link.dest) {
        const outline = await readPdfOutline({ numPages: doc.numPages, getOutline: async () => [{ title: 'link', dest: link.dest!, items: [] }], getDestination: name => doc.getDestination(name), getPageIndex: ref => doc.getPageIndex(ref) });
        const page = outline[0]?.pageNo;
        if (page) host.current?.closest('.overflow-auto')?.querySelector<HTMLElement>(`[data-page-no="${page}"]`)?.scrollIntoView({ block: 'start' });
      }
    } catch (error) { latest.current.onError(String(error)); }
  };
  return <div ref={host} className="absolute inset-0 overflow-hidden" onPointerDown={props.onAreaStart} onPointerMove={props.onAreaMove} onPointerUp={props.onAreaEnd} onPointerCancel={() => {}}>
    <canvas ref={canvas} className="absolute inset-0 w-full h-full pointer-events-none" />
    <div ref={layer} className="textLayer absolute inset-0" style={{ pointerEvents: areaMode ? 'none' : 'auto' }} />
    {layout && annotations.flatMap(annotation => {
      const rects = annotation.segments?.find(s => s.pageNo === pageNo)?.rects || (annotation.pageNo === pageNo ? annotation.rects : []);
      return rects.map((rect, i) => <div key={`${annotation.id}:${i}`} title={annotation.noteText || annotation.selectedText} className="absolute pointer-events-none" style={{ ...overlayStyle(projectCanonicalRect(rect, layout.canonical, layout.active)), backgroundColor: colorValues[annotation.color], mixBlendMode: 'multiply' }} />);
    })}
    {focused.map((rect, i) => <div key={i} className="absolute bg-orange-300/40 outline outline-orange-400 pointer-events-none" style={overlayStyle(rect)} />)}
    {!areaMode && links.map((link, i) => <button key={i} title={link.url || '跳转链接'} aria-label={link.url || '跳转链接'} className="absolute hover:bg-indigo-100/20" style={overlayStyle(link.rect)} onClick={() => void openLink(link)} />)}
    <div className="absolute bottom-2 right-2 flex flex-wrap gap-1 max-w-[80%]">{citations.map((citation, i) => <button key={i} className="text-[10px] px-1 bg-white/90 text-indigo-600 border border-slate-200 rounded" onClick={() => props.onCitation(citation)}>{citation.marker}</button>)}</div>
    {drag && <div className="absolute border border-dashed border-indigo-500 bg-indigo-100/20 pointer-events-none" style={{ left: Math.min(drag.x, drag.endX), top: Math.min(drag.y, drag.endY), width: Math.abs(drag.x - drag.endX), height: Math.abs(drag.y - drag.endY) }} />}
  </div>;
}
