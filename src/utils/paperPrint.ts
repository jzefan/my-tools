import * as pdfjs from 'pdfjs-dist';

/** Render a separate print document, without toolbars or inspector panels. */
export async function printPaperPdf(bytes: Uint8Array): Promise<void> {
  const task = pdfjs.getDocument({ data: bytes.slice(),
    cMapUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/cmaps/`, location.href).href,
    standardFontDataUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/standard_fonts/`, location.href).href,
    wasmUrl: new URL(`${import.meta.env.BASE_URL}pdfjs/wasm/`, location.href).href, cMapPacked: true });
  const doc = await task.promise;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;border:0';
  document.body.append(frame);
  try {
    const target = frame.contentDocument;
    if (!target || !frame.contentWindow) throw new Error('无法打开打印窗口');
    const style = target.createElement('style');
    style.textContent = '@page{margin:0}body{margin:0}img{display:block;width:100%;break-after:page}img:last-child{break-after:auto}';
    target.head.append(style);
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('无法生成打印页面');
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const img = target.createElement('img'); img.src = canvas.toDataURL('image/png');
      target.body.append(img); await img.decode(); canvas.width = 0; canvas.height = 0;
    }
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
    frame.contentWindow.focus(); frame.contentWindow.print();
    // Some WebViews omit afterprint.
    setTimeout(() => frame.remove(), 60_000);
  } catch (error) { frame.remove(); throw error; }
  finally { await task.destroy(); }
}
