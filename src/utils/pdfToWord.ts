import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions, OPS, Util } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';

const office = 'http://schemas.openxmlformats.org';
const relationships = `${office}/officeDocument/2006/relationships`;
const word = `${office}/wordprocessingml/2006/main`;
const drawing = `${office}/drawingml/2006`;
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const xmlText = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const emu = (points: number) => Math.round(points * 12700);
const twips = (points: number) => Math.round(points * 20);

interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  font: string;
}

async function editableText(page: PDFPageProxy, scale: number): Promise<TextBox[]> {
  const content = await page.getTextContent();
  const items = content.items.filter(item => 'str' in item).filter(item => item.str.trim());
  if (!items.length || (await page.getAnnotations()).some(item => item.subtype !== 'Link')) return [];

  const { fnArray, argsArray } = await page.getOperatorList();
  const characterCount = items.reduce((count, item) => count + item.str.trim().length, 0);
  const pathCount = fnArray.filter(op => op === OPS.constructPath).length;
  if (characterCount < 80 && pathCount > 100) return [];
  // Hidden OCR layers and clipping text need the original page appearance.
  if (fnArray.some((op, index) => op === OPS.setTextRenderingMode && argsArray[index][0] !== 0)) return [];

  const viewport = page.getViewport({ scale });
  const boxes: TextBox[] = [];
  for (const item of items) {
    const [a, b, c, d, x, baseline] = Util.transform(viewport.transform, item.transform);
    const style = content.styles[item.fontName];
    if (item.dir !== 'ltr' || style?.vertical || a <= 0 || d >= 0 ||
        Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || item.str.includes('\uFFFD')) return [];
    const size = -d;
    const width = item.width * scale;
    if (![x, baseline, size, width].every(Number.isFinite) || size < 1 || width <= 0) return [];
    const family = style?.fontFamily ?? '';
    const font = family.includes('mono') ? 'Courier New'
      : family.includes('serif') && !family.includes('sans-serif') ? 'Times New Roman' : 'Arial';
    const ascent = style?.ascent && style.ascent > 0 && style.ascent <= 1.5 ? style.ascent : 0.85;
    boxes.push({ text: item.str, x, y: baseline - size * ascent, width, size, font });
  }
  return boxes;
}

function anchoredDrawing(id: number, x: number, y: number, width: number, height: number,
                         behind: boolean, graphic: string) {
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"
    relativeHeight="${id}" behindDoc="${Number(behind)}" locked="0" layoutInCell="1" allowOverlap="1">
    <wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(x)}</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="page"><wp:posOffset>${emu(y)}</wp:posOffset></wp:positionV>
    <wp:extent cx="${emu(width)}" cy="${emu(height)}"/><wp:wrapNone/><wp:docPr id="${id}" name="PDF ${id}"/>
    <a:graphic>${graphic}</a:graphic></wp:anchor></w:drawing></w:r>`;
}

function pagePicture(id: number, relationshipId: string, width: number, height: number) {
  return anchoredDrawing(id, 0, 0, width, height, true,
    `<a:graphicData uri="${drawing}/picture"><pic:pic>
      <pic:nvPicPr><pic:cNvPr id="${id}" name="PDF page"/><pic:cNvPicPr/></pic:nvPicPr>
      <pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
      <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
    </pic:pic></a:graphicData>`);
}

const shapeNamespace = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
function wordTextBox(id: number, box: TextBox, eastAsiaFont: string) {
  const width = box.width + box.size * 2;
  const height = box.size * 1.5;
  const halfPoints = Math.round(box.size * 2);
  return anchoredDrawing(id, box.x, box.y, width, height, false,
    `<a:graphicData uri="${shapeNamespace}"><wps:wsp><wps:cNvSpPr txBox="1"/>
    <wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>
    <wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="${box.font}" w:hAnsi="${box.font}" w:eastAsia="${eastAsiaFont}" w:hint="eastAsia"/>
        <w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr>
        <w:t xml:space="preserve">${xmlText(box.text)}</w:t></w:r></w:p></w:txbxContent></wps:txbx>
    <wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" wrap="none"><a:noAutofit/></wps:bodyPr>
    </wps:wsp></a:graphicData>`);
}

function pageSection(width: number, height: number) {
  return `<w:sectPr><w:type w:val="nextPage"/>
    <w:pgSz w:w="${twips(width)}" w:h="${twips(height)}"${width > height ? ' w:orient="landscape"' : ''}/>
    <w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>`;
}

export async function pdfToWord(data: Uint8Array, pages: number[]) {
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const asset = (name: string) => new URL(`${import.meta.env.BASE_URL}pdfjs/${name}/`, location.href).href;
  const task = getDocument({
    data, cMapUrl: asset('cmaps'), standardFontDataUrl: asset('standard_fonts'),
    iccUrl: asset('iccs'), wasmUrl: asset('wasm'), stopAtErrors: true,
  });
  const zip = new JSZip();
  const eastAsiaFont = navigator.platform.startsWith('Mac') ? 'Songti SC' : 'SimSun';
  const body: string[] = [];
  const media: string[] = [];
  let drawingId = 1;
  let imagePages = 0;
  let lastSection = '';
  try {
    const pdf = await task.promise;
    for (const pageNo of pages) {
      const page = await pdf.getPage(pageNo);
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(1, 1584 / Math.max(original.width, original.height));
      const { width, height } = page.getViewport({ scale });
      const boxes = await editableText(page, scale);
      if (!boxes.length) imagePages++;
      const viewport = page.getViewport({
        scale: Math.min(2, 4096 / Math.max(original.width, original.height)),
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({
          canvas, viewport,
          operationsFilter: boxes.length ? (index, list) => list.fnArray[index] !== OPS.showText : undefined,
        }).promise;
        const image = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法渲染 PDF 页面')), 'image/jpeg', 0.94);
        });
        const name = `page-${pageNo}.jpg`;
        const id = `rIdPage${pageNo}`;
        zip.file(`word/media/${name}`, await image.arrayBuffer());
        media.push(`<Relationship Id="${id}" Type="${relationships}/image" Target="media/${name}"/>`);
        lastSection = pageSection(width, height);
        const section = media.length < pages.length ? lastSection : '';
        const props = `<w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${section}</w:pPr>`;
        const picture = pagePicture(drawingId++, id, width, height);
        const text = boxes.map(box => wordTextBox(drawingId++, box, eastAsiaFont)).join('');
        body.push(`<w:p>${props}${picture}${text}</w:p>`);
      } finally {
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }
  } finally {
    await task.destroy();
  }

  const packageRels = `${office}/package/2006/relationships`;
  zip.file('[Content_Types].xml', `${xmlHeader}<Types xmlns="${office}/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="jpg" ContentType="image/jpeg"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`);
  zip.file('_rels/.rels', `${xmlHeader}<Relationships xmlns="${packageRels}">
    <Relationship Id="rId1" Type="${relationships}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `${xmlHeader}<Relationships xmlns="${packageRels}">${media.join('')}</Relationships>`);
  zip.file('word/document.xml', `${xmlHeader}<w:document xmlns:w="${word}" xmlns:r="${relationships}"
    xmlns:a="${drawing}/main" xmlns:wp="${drawing}/wordprocessingDrawing" xmlns:pic="${drawing}/picture"
    xmlns:wps="${shapeNamespace}" xmlns:mc="${office}/markup-compatibility/2006" mc:Ignorable="wps">
    <w:body>${body.join('')}${lastSection}</w:body></w:document>`, { compression: 'DEFLATE' });
  return { bytes: await zip.generateAsync({ type: 'uint8array' }), imagePages };
}
