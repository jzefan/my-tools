export type PdfOutlineEntry = { title: string; level: number; pageNo: number | null };

type OutlineNode = { title: string; dest: string | unknown[] | null; items: OutlineNode[] };
type OutlineDocument = {
  numPages: number;
  getOutline(): Promise<OutlineNode[] | null>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
};

async function destinationPage(document: OutlineDocument, destination: OutlineNode['dest']): Promise<number | null> {
  try {
    const resolved = typeof destination === 'string' ? await document.getDestination(destination) : destination;
    if (!Array.isArray(resolved) || !resolved.length) return null;
    const target: unknown = resolved[0];
    let index: number;
    if (Number.isInteger(target)) {
      index = target as number;
    } else if (target && typeof target === 'object' && 'num' in target && 'gen' in target
      && Number.isInteger(target.num) && Number.isInteger(target.gen)
      && (target.num as number) > 0 && (target.gen as number) >= 0) {
      index = await document.getPageIndex(target as { num: number; gen: number });
    } else {
      return null;
    }
    return Number.isInteger(index) && index >= 0 && index < document.numPages ? index + 1 : null;
  } catch {
    // One damaged bookmark must not hide other entries or extracted headings.
    return null;
  }
}

/** Resolve only internal PDF destinations; external/unsafe links never become reader navigation. */
export async function readPdfOutline(document: OutlineDocument): Promise<PdfOutlineEntry[]> {
  const outline = await document.getOutline();
  if (!outline?.length) return [];
  const pending = outline.map((node) => ({ node, level: 0, parent: -1 })).reverse();
  const rows: Array<PdfOutlineEntry & { parent: number; visible: boolean }> = [];
  let inspected = 0;
  while (pending.length && inspected++ < 4_000 && rows.length < 2_000) {
    const { node, level, parent } = pending.pop()!;
    const title = typeof node?.title === 'string' ? node.title.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    const index = title ? rows.length : parent;
    if (title) rows.push({ title, level, pageNo: await destinationPage(document, node.dest), parent, visible: false });
    if (level < 12 && Array.isArray(node?.items)) {
      for (let child = node.items.length - 1; child >= 0; child -= 1) {
        pending.push({ node: node.items[child], level: title ? level + 1 : level, parent: index });
      }
    }
  }
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].pageNo === null && !rows[index].visible) continue;
    rows[index].visible = true;
    const parent = rows[index].parent;
    if (parent >= 0) rows[parent].visible = true;
  }
  return rows.filter((row) => row.visible).map(({ title, level, pageNo }) => ({ title, level, pageNo }));
}
