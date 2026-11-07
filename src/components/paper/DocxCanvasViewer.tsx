import { useEffect, useRef, useState } from 'react';
import { renderPaperDocx } from '../../utils/paperDocx';
import { renderAsync } from 'docx-preview';
import type { AnnotationColor, AnnotationItem, AnnotationType, CitationMention, PaperSelection, PdfRect, ReferenceEntry, SelectionSegment } from '../../types/paper';
import { findCitationMentionsInText } from '../../utils/citations';
import { paperJobs } from '../../services/paperJobs';
import { joinSelectedText } from '../../utils/paperGeometry';

export interface DocxCanvasViewerProps {
  legacyPage?: number;
  onResolveAnnotation?: (annotation: AnnotationItem, pageNo: number | null) => void;
  fileData: Uint8Array; paperId: string; zoom: number; currentPage: number;
  annotations: AnnotationItem[]; references?: ReferenceEntry[];
  jumpTarget?: { pageNo: number; rect?: PdfRect; quote?: string; nonce: number } | null;
  onPageChange: (page: number) => void; onTotalPages: (total: number) => void;
  onTextExtracted: (pages: Array<{ pageNo: number; text: string }>) => void;
  onAskAi: (text: string, screenshot?: string, selection?: PaperSelection) => void;
  onAddAnnotation: (type: AnnotationType, color: AnnotationColor, pageNo: number, rects: PdfRect[], text: string, note?: string, screenshot?: string, segments?: SelectionSegment[]) => void;
  onCitationClick: (mention: CitationMention) => void; onInsertToDraft?: (text: string, screenshot?: string) => void;
}
const palette = { yellow: '#fbbf2460', green: '#34d39960', blue: '#60a5fa60', purple: '#c084fc60', red: '#fb718560' };
export function DocxCanvasViewer(props: DocxCanvasViewerProps) {
  const { fileData, paperId, zoom, annotations, jumpTarget } = props;
  const latest = useRef(props); latest.current = props;
  const root = useRef<HTMLDivElement>(null), target = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [version, setVersion] = useState(0), [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<PaperSelection | null>(null), [note, setNote] = useState<string | null>(null);
  const [color, setColor] = useState<AnnotationColor>('yellow');
  const [overlays, setOverlays] = useState<Array<{ id: string; color: string; left: number; top: number; width: number; height: number }>>([]);
  const [citations, setCitations] = useState<CitationMention[]>([]);
  const jumpKey = useRef('');
  useEffect(() => {
    let active = true;
    const job = paperJobs.start('extract', paperId, () => { if (!active) return false; setRetry(value => value + 1); return true; });
    setLoading(true); setError('');
    void (async () => {
      try {
        let staged: HTMLElement = document.createElement('div');
        try { await renderAsync(fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength), staged, undefined,
          { inWrapper: true, breakPages: true, className: 'docx-paper', ignoreFonts: false, ignoreHeight: false, ignoreWidth: false }); }
        catch { staged = await renderPaperDocx(fileData); }
        if (!active || !target.current || job.signal.aborted) throw new DOMException('已停止', 'AbortError');
        target.current.replaceChildren(...Array.from(staged.childNodes));
        await Promise.all(Array.from(target.current.querySelectorAll('img')).map(image => image.decode().catch(() => {})));
        if (!active || job.signal.aborted) throw new DOMException('已停止', 'AbortError');
        // Stable source paragraph/table positions do not change with viewport pagination.
        const blocks = Array.from(target.current.querySelectorAll<HTMLElement>('section article > *')).filter(node => node.innerText.trim() || node.querySelector('img'));
        if (!blocks.length) blocks.push(target.current);
        const pages = blocks.map((node, index) => {
          node.dataset.pageNo = String(index + 1);
          const text = node.innerText || node.textContent || '';
          return { pageNo: index + 1, text };
        });
        if (latest.current.legacyPage) {
          const sections = Array.from(target.current.querySelectorAll('section'));
          const section = sections[Math.min(sections.length - 1, Math.max(0, latest.current.legacyPage - 1))];
          const index = section ? blocks.findIndex(block => section.contains(block)) : 0;
          latest.current.onPageChange(Math.max(1, index + 1));
        }
        for (const annotation of latest.current.annotations.filter(a => a.locationUnit !== 'paragraph')) {
          const needle = annotation.selectedText.replace(/\s/gu, '');
          const matches = needle ? pages.filter(page => page.text.replace(/\s/gu, '').includes(needle)) : [];
          latest.current.onResolveAnnotation?.(annotation, matches.length === 1 ? matches[0].pageNo : null);
        }
        latest.current.onTotalPages(blocks.length);
        latest.current.onTextExtracted(pages);
        setCitations(pages.flatMap(page => findCitationMentionsInText(page.text, page.pageNo)));
        setLoading(false); jumpKey.current = ''; setVersion(value => value + 1);
        paperJobs.finish(job.id);
      } catch (failure) {
        if (active) { setError(job.signal.aborted ? '已停止解析' : `Word 解析失败：${String(failure)}`); setLoading(false); }
        paperJobs.finish(job.id, failure);
      }
    })();
    return () => { active = false; paperJobs.cancel(job.id); };
  }, [fileData, paperId, retry]);
  useEffect(() => {
    if (loading || !target.current) return;
    const key = `${version}:${jumpTarget?.nonce || 0}`;
    if (jumpKey.current === key) return;
    const block = target.current.querySelector<HTMLElement>(`[data-page-no="${jumpTarget?.pageNo || latest.current.currentPage}"]`);
    if (block) { block.scrollIntoView({ block: 'start' }); jumpKey.current = key; }
  }, [loading, version, jumpTarget, zoom]);
  useEffect(() => {
    if (loading || !target.current) return;
    const marks: typeof overlays = [];
    const targetBounds = target.current.getBoundingClientRect();
    for (const annotation of annotations) {
      if (annotation.orphaned) continue;
      for (const segment of annotation.segments || [{ pageNo: annotation.pageNo, selectedText: annotation.selectedText, rects: annotation.rects }]) {
        const block = target.current.querySelector<HTMLElement>(`[data-page-no="${segment.pageNo}"]`);
        if (!block) continue;
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), chars: Array<{ node: Text; offset: number }> = [];
        let text = '', current: Node | null;
        while ((current = walker.nextNode())) for (let offset = 0; offset < (current as Text).length; offset++) {
          if (/\s/u.test((current as Text).data[offset])) continue;
          text += (current as Text).data[offset]; chars.push({ node: current as Text, offset });
        }
        const needle = segment.selectedText.replace(/\s/gu, ''), index = needle ? text.indexOf(needle) : -1;
        if (index < 0) continue;
        const range = document.createRange(), start = chars[index], end = chars[index + needle.length - 1];
        range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset + 1);
        for (const rect of range.getClientRects()) if (rect.width && rect.height) marks.push({ id: `${annotation.id}:${marks.length}`, color: palette[annotation.color], left: (rect.left - targetBounds.left) / zoom, top: (rect.top - targetBounds.top) / zoom, width: rect.width / zoom, height: rect.height / zoom });
      }
    }
    setOverlays(marks);
  }, [annotations, loading, version, zoom]);
  const capture = () => {
    if (note !== null || !target.current) return;
    const selected = window.getSelection(); if (!selected?.rangeCount || selected.isCollapsed) { setSelection(null); return; }
    const range = selected.getRangeAt(0);
    if (!target.current.contains(range.startContainer) || !target.current.contains(range.endContainer)) return;
    const segments: SelectionSegment[] = [];
    for (const block of target.current.querySelectorAll<HTMLElement>('[data-page-no]')) {
      if (!range.intersectsNode(block)) continue;
      const part = range.cloneRange();
      if (!block.contains(part.startContainer)) part.setStart(block, 0);
      if (!block.contains(part.endContainer)) part.setEnd(block, block.childNodes.length);
      const text = part.toString().trim(); if (text) segments.push({ pageNo: Number(block.dataset.pageNo), selectedText: text, rects: [] });
    }
    if (!segments.length) return;
    setSelection({ text: joinSelectedText(segments.map(s => s.selectedText)), pageNo: segments[0].pageNo, rects: [], segments });
  };
  const save = (type: AnnotationType) => {
    if (!selection) return;
    props.onAddAnnotation(type, color, selection.pageNo, [], selection.text, note || '', undefined, selection.segments);
    setSelection(null); setNote(null); window.getSelection()?.removeAllRanges();
  };
  const scroll = () => {
    if (!root.current || !target.current) return;
    const top = root.current.getBoundingClientRect().top + 30;
    let nearest: HTMLElement | undefined, distance = Infinity;
    for (const block of target.current.querySelectorAll<HTMLElement>('[data-page-no]')) {
      const next = Math.abs(block.getBoundingClientRect().top - top);
      if (next < distance) { nearest = block; distance = next; }
    }
    if (nearest && Number(nearest.dataset.pageNo) !== latest.current.currentPage) latest.current.onPageChange(Number(nearest.dataset.pageNo));
  };
  return <div className="flex-1 flex flex-col min-h-0">
    {selection && <div className="p-2 border-b border-slate-200 dark:border-slate-800 text-xs flex flex-wrap gap-3 items-center" onMouseDown={e => { if (!(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) e.preventDefault(); }}>
      <span className="text-slate-400">第 {selection.pageNo} 段</span><button onClick={() => props.onAskAi(selection.text, undefined, selection)}>问 AI</button><button onClick={() => save('highlight')}>高亮</button>
      <select aria-label="高亮颜色" value={color} onChange={e => setColor(e.target.value as AnnotationColor)} className="bg-transparent">{Object.keys(palette).map((key, i) => <option key={key} value={key}>{['黄', '绿', '蓝', '紫', '红'][i]}</option>)}</select>
      <button onClick={() => setNote('')}>笔记</button><button onClick={() => { void navigator.clipboard.writeText(selection.text); }}>复制</button>{props.onInsertToDraft && <button onClick={() => props.onInsertToDraft?.(selection.text)}>插入草稿</button>}
      <button className="ml-auto text-slate-400" onClick={() => { setSelection(null); setNote(null); }}>取消</button>
      {note !== null && <div className="w-full flex gap-2"><textarea aria-label="选区笔记" autoFocus value={note} onChange={e => setNote(e.target.value)} className="flex-1 min-w-0 border border-slate-200 dark:border-slate-700 bg-transparent rounded p-2" /><button onClick={() => save('note')}>保存</button></div>}
    </div>}
    {error && <div role="alert" className="p-3 text-xs text-rose-600">{error} <button onClick={() => setRetry(value => value + 1)}>重新解析</button></div>}
    {loading && <p className="p-3 text-xs text-slate-400">正在解析 Word…</p>}
    <div ref={root} onScroll={scroll} onMouseUp={capture} onKeyUp={capture} className="flex-1 min-h-0 overflow-auto bg-slate-100 dark:bg-slate-950 p-5">
      <div className="mx-auto relative w-fit" style={{ zoom }}>
        <div ref={target} className="docx-render-target text-slate-900" />
        {overlays.map(mark => <div key={mark.id} className="absolute pointer-events-none" style={{ left: mark.left, top: mark.top, width: mark.width, height: mark.height, backgroundColor: mark.color, mixBlendMode: 'multiply' }} />)}
      </div>
    </div>
    {!!citations.length && <div className="border-t border-slate-200 dark:border-slate-800 p-2 text-[11px] flex flex-wrap gap-2">{citations.filter(c => c.pageNo === props.currentPage).map((citation, i) => <button key={i} className="text-indigo-600" onClick={() => props.onCitationClick(citation)}>{citation.marker}</button>)}</div>}
  </div>;
}
