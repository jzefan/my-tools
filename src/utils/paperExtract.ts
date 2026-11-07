import * as pdfjs from 'pdfjs-dist';
import JSZip from 'jszip';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
export async function extractPaperContent(bytes: Uint8Array, signal: AbortSignal): Promise<Array<{ pageNo: number; text: string }>> {
  if (signal.aborted) throw new DOMException('已停止', 'AbortError');
  if (bytes[0] === 0x25) {
    const task = pdfjs.getDocument({ data: bytes.slice(),
      cMapUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/cmaps/`, location.href).href,
      standardFontDataUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/standard_fonts/`, location.href).href,
      wasmUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/wasm/`, location.href).href, cMapPacked: true });
    const cancel = () => { void task.destroy(); }; signal.addEventListener('abort', cancel, { once: true });
    try {
      const doc = await task.promise, pages = [];
      for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
        if (signal.aborted) throw new DOMException('已停止', 'AbortError');
        const page = await doc.getPage(pageNo), content = await page.getTextContent();
        pages.push({ pageNo, text: content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') });
      }
      return pages;
    } finally { signal.removeEventListener('abort', cancel); await task.destroy(); }
  }
  const zip = await JSZip.loadAsync(bytes), entry = zip.file('word/document.xml');
  if (!entry) throw new Error('Word 正文不存在');
  const xml = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Word 正文格式无效');
  const body = xml.getElementsByTagNameNS('*', 'body')[0];
  if (!body) throw new Error('Word 正文为空');
  return Array.from(body.children).filter(node => ['p', 'tbl'].includes(node.localName)).map(node => ({ text: Array.from(node.getElementsByTagNameNS('*', 't')).map(text => text.textContent || '').join(node.localName === 'tbl' ? '\n' : '') }))
    .filter(block => block.text.trim()).map((block, index) => ({ pageNo: index + 1, ...block }));
}
