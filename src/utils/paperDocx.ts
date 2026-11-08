import JSZip from 'jszip';
const byName = (node: Element, name: string) => Array.from(node.children).find(child => child.localName === name);
const val = (node: Element | undefined, name = 'val') => node ? Array.from(node.attributes).find(attribute => attribute.localName === name)?.value : undefined;
const descendants = (node: Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name));
const safeNumber = (value: string | undefined, max = 64) => Math.max(1, Math.min(max, Number(value) || 1));

/** Structural fallback for valid DOCX packages without optional styles/numbering parts. */
export async function renderPaperDocx(bytes: Uint8Array): Promise<HTMLElement> {
  const zip = await JSZip.loadAsync(bytes), part = zip.file('word/document.xml');
  if (!part) throw new Error('Word 正文不存在');
  const xml = new DOMParser().parseFromString(await part.async('string'), 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Word 正文格式无效');
  const body = xml.getElementsByTagNameNS('*', 'body')[0]; if (!body) throw new Error('Word 正文为空');
  const relationships = new Map<string, string>();
  const rels = zip.file('word/_rels/document.xml.rels');
  if (rels) {
    const doc = new DOMParser().parseFromString(await rels.async('string'), 'application/xml');
    for (const relationship of doc.getElementsByTagNameNS('*', 'Relationship')) {
      if (relationship.getAttribute('TargetMode') === 'External') continue;
      const path = relationship.getAttribute('Target') || '';
      const segments: string[] = [];
      for (const segment of ('word/' + path).split('/')) { if (segment === '..') segments.pop(); else if (segment !== '.') segments.push(segment); }
      const target = segments.join('/');
      if (/^word\/media\//.test(target)) relationships.set(relationship.getAttribute('Id') || '', target);
    }
  }
  const inline = async (node: Element, into: HTMLElement, depth = 0): Promise<void> => {
    if (depth > 64 || ['del', 'moveFrom', 'pPr', 'rPr'].includes(node.localName)) return;
    if (node.localName === 't') { into.append(document.createTextNode(node.textContent || '')); return; }
    if (node.localName === 'br') { into.append(document.createElement('br')); return; }
    if (node.localName === 'tab') { into.append(document.createTextNode('\t')); return; }
    if (node.localName === 'blip') {
      const id = val(node, 'embed'), path = id && relationships.get(id), file = path && zip.file(path);
      if (file && /\.(png|jpe?g|gif|webp)$/i.test(path!)) {
        const image = document.createElement('img'), ext = path!.split('.').pop()!.toLowerCase();
        image.src = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${await file.async('base64')}`;
        image.alt = '文档图片'; image.style.maxWidth = '100%'; into.append(image);
      }
      return;
    }
    const run = node.localName === 'r' ? document.createElement('span') : into;
    if (run !== into) {
      const properties = byName(node, 'rPr');
      if (properties && byName(properties, 'b') && val(byName(properties, 'b')) !== '0') run.style.fontWeight = 'bold';
      if (properties && byName(properties, 'i') && val(byName(properties, 'i')) !== '0') run.style.fontStyle = 'italic';
      into.append(run);
    }
    for (const child of node.children) await inline(child, run, depth + 1);
  };
  const paragraph = async (node: Element) => {
    const properties = byName(node, 'pPr'), style = properties && val(byName(properties, 'pStyle'));
    const heading = /^Heading([1-6])$/i.exec(style || '');
    const p = document.createElement(heading ? `h${heading[1]}` : 'p');
    p.style.margin = '0 0 10px'; p.style.lineHeight = '1.7';
    const align = properties && val(byName(properties, 'jc'));
    if (align && ['center', 'right', 'left', 'justify'].includes(align)) p.style.textAlign = align;
    if (heading) { p.style.fontWeight = '600'; p.style.fontSize = heading[1] === '1' ? '18px' : '16px'; }
    await inline(node, p); return p;
  };
  const table = async (node: Element, depth = 0): Promise<HTMLTableElement> => {
    if (depth > 16) throw new Error('Word 表格嵌套过深');
    const result = document.createElement('table');
    result.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;margin:12px 0;font-size:14px';
    const grid = byName(node, 'tblGrid'), widths = grid ? Array.from(grid.children).map(col => Number(val(col, 'w')) || 1) : [];
    const sum = widths.reduce((total, width) => total + width, 0);
    if (sum) { const cols = document.createElement('colgroup'); widths.forEach(width => { const col = document.createElement('col'); col.style.width = `${width * 100 / sum}%`; cols.append(col); }); result.append(cols); }
    const tblPr = byName(node, 'tblPr'), tblBorders = tblPr && byName(tblPr, 'tblBorders');
    const hasTblBorder = tblBorders ? Array.from(tblBorders.children).some(b => {
      const v = val(b);
      const sz = Number(val(b, 'sz')) || 0;
      return v && !['none', 'nil'].includes(v.toLowerCase()) && sz > 0;
    }) : false;
    const merges = new Map<number, HTMLTableCellElement>();
    for (const row of Array.from(node.children).filter(child => child.localName === 'tr')) {
      const tr = document.createElement('tr'); let column = 0;
      for (const cell of Array.from(row.children).filter(child => child.localName === 'tc')) {
        const properties = byName(cell, 'tcPr'), span = properties ? safeNumber(val(byName(properties, 'gridSpan'))) : 1;
        const merge = properties && byName(properties, 'vMerge');
        if (merge && val(merge) !== 'restart' && merges.has(column)) {
          const previous = merges.get(column)!; previous.rowSpan += 1; column += span; continue;
        }
        for (let index = column; index < column + span; index++) merges.delete(index);
        const tcBorders = properties && byName(properties, 'tcBorders');
        const hasTcBorder = tcBorders ? Array.from(tcBorders.children).some(b => {
          const v = val(b);
          const sz = Number(val(b, 'sz')) || 0;
          return v && !['none', 'nil'].includes(v.toLowerCase()) && sz > 0;
        }) : false;
        const isBordered = hasTcBorder || (hasTblBorder && !tcBorders);
        const td = document.createElement('td'); td.colSpan = span;
        td.style.cssText = `${isBordered ? 'border:1px solid #cbd5e1;padding:7px;' : 'border:none;padding:4px 8px;'}overflow-wrap:anywhere;vertical-align:top`;
        const fill = properties && val(byName(properties, 'shd'), 'fill'); if (fill && /^[0-9a-f]{6}$/i.test(fill)) td.style.backgroundColor = `#${fill}`;
        const align = properties && val(byName(properties, 'vAlign')); if (align === 'center' || align === 'bottom') td.style.verticalAlign = align === 'center' ? 'middle' : 'bottom';
        for (const child of cell.children) {
          if (child.localName === 'p') td.append(await paragraph(child));
          if (child.localName === 'tbl') td.append(await table(child, depth + 1));
        }
        if (merge && val(merge) === 'restart') for (let index = column; index < column + span; index++) merges.set(index, td);
        tr.append(td); column += span;
      }
      result.append(tr);
    }
    return result;
  };
  const wrapper = document.createElement('div'), section = document.createElement('section'), article = document.createElement('article');
  section.style.cssText = 'background:white;width:760px;padding:48px;min-height:900px;box-sizing:border-box;font-family:serif';
  for (const node of body.children) {
    if (node.localName === 'p') { const p = await paragraph(node); if (p.textContent?.trim() || p.querySelector('img')) article.append(p); }
    if (node.localName === 'tbl') article.append(await table(node));
  }
  if (!article.children.length && !descendants(body, 'blip').length) throw new Error('Word 没有可显示正文');
  section.append(article); wrapper.append(section); return wrapper;
}
