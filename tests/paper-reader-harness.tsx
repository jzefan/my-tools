import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/App.css';
import { PaperLibraryView } from '../src/components/paper/PaperLibraryView';
import { PaperReaderView } from '../src/components/paper/PaperReaderView';
import type { AnnotationItem, PaperItem } from '../src/types/paper';
localStorage.clear();
const word = new URLSearchParams(location.search).has('word');
const bytes = new Uint8Array(await (await fetch(word ? '/tests/fixtures/paper-tables.docx' : '/tests/fixtures/paper-bookmarks.pdf')).arrayBuffer());
const paper: PaperItem = { id: 'test-paper', path: word ? '/test.docx' : '/test.pdf', name: 'test', title: word ? 'Word 合并表格与段落' : 'PDF 目录与引文', authors: [], pageCount: 3, fileSize: bytes.length, readStatus: 'reading', lastReadAt: 1, lastPage: 2, lastZoom: 1, lastViewMode: 'continuous', tags: [] };
const nativeFetch = window.fetch;
window.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
  if (String(input).endsWith('/chat/completions')) {
    if (options?.signal?.aborted) throw new DOMException('已停止', 'AbortError');
    const body = JSON.parse(String(options?.body || '{}'));
    if (body.response_format) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(Object.fromEntries(['researchQuestion', 'method', 'experimentalDesign', 'keyFindings', 'limitations', 'takeaways'].map(key => [key, [{ content: '可核验概述', category: 'model_synthesis', evidence: [] }]]))) } }] }), { headers: { 'Content-Type': 'application/json' } });
    return new Response(new ReadableStream({ start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"回答来自原文 "}}]}\n\n'));
      setTimeout(() => {
        if (options?.signal?.aborted) { controller.error(new DOMException('已停止', 'AbortError')); return; }
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"[source:p.2]"}}]}\n\ndata: [DONE]\n\n')); controller.close();
      }, 1200);
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  return nativeFetch(input, options);
}) as typeof fetch;
function Harness() {
  const [epoch, setEpoch] = useState(0);
  (window as unknown as { remountReader: () => void }).remountReader = () => setEpoch(value => value + 1);
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [overview, setOverview] = useState(null);
  if (new URLSearchParams(location.search).has('library')) return <div className="flex h-full"><PaperLibraryView papers={[paper]} references={{ [paper.id]: [{ number: 1, title: 'Reference paper', rawText: 'J. Doe. Reference paper. 2024.', sourcePage: 2 }] }} onOpenPaper={() => {}} onImportPaper={() => {}} onDeletePaper={() => {}} onUpdateStatus={() => {}} /></div>;
  return <div className="flex h-full"><PaperReaderView key={epoch} paper={paper} papers={[paper]} onOpenPaper={() => {}} pdfData={bytes} annotations={annotations} overview={overview}
    config={{ provider: 'deepseek', apiKey: 'test', endpoint: 'https://test.invalid/v1', model: 'test-model', temperature: 0.3 }}
    onSaveAnnotation={item => setAnnotations(old => [item, ...old])} onUpdateAnnotation={(id, noteText, patch) => setAnnotations(old => old.map(a => a.id === id ? { ...a, ...patch, noteText } : a))}
    onDeleteAnnotation={id => setAnnotations(old => old.filter(a => a.id !== id))} onSaveOverview={value => setOverview(value as never)} onSaveConfig={() => {}}
    onUpdateReadingState={(...state) => { (window as unknown as { readingState: unknown }).readingState = state; }} onSwitchToEditMode={() => {}} onBackToLibrary={() => {}} /></div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
