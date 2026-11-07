type Rect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height' | 'right' | 'bottom'>;
export type CoordinateViewport = {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
};
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export const normalizeRects = (rects: Rect[], pageBounds: Rect) => rects
  .filter((rect) => rect.width > 0 && rect.height > 0)
  .map((rect) => {
    const left = clamp((rect.left - pageBounds.left) / pageBounds.width);
    const top = clamp((rect.top - pageBounds.top) / pageBounds.height);
    const right = clamp((rect.right - pageBounds.left) / pageBounds.width);
    const bottom = clamp((rect.bottom - pageBounds.top) / pageBounds.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
  })
  .filter((rect) => rect.width > 0 && rect.height > 0);

/** Convert client rectangles from the active zoom/rotation into rotation-zero page coordinates. */
export const normalizeRectsToCanonical = (
  rects: Rect[],
  pageBounds: Rect,
  activeViewport: CoordinateViewport,
  canonicalViewport: CoordinateViewport,
) => rects
  .filter((rect) => rect.width > 0 && rect.height > 0)
  .map((rect) => {
    const corners = [
      [rect.left - pageBounds.left, rect.top - pageBounds.top],
      [rect.right - pageBounds.left, rect.top - pageBounds.top],
      [rect.left - pageBounds.left, rect.bottom - pageBounds.top],
      [rect.right - pageBounds.left, rect.bottom - pageBounds.top],
    ] as const;
    const projected = corners.map(([x, y]) => {
      const [pdfX, pdfY] = activeViewport.convertToPdfPoint(x, y);
      return canonicalViewport.convertToViewportPoint(pdfX, pdfY);
    });
    const xs = projected.map(([x]) => x);
    const ys = projected.map(([, y]) => y);
    const left = clamp(Math.min(...xs) / canonicalViewport.width);
    const top = clamp(Math.min(...ys) / canonicalViewport.height);
    const right = clamp(Math.max(...xs) / canonicalViewport.width);
    const bottom = clamp(Math.max(...ys) / canonicalViewport.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
  })
  .filter((rect) => rect.width > 0 && rect.height > 0);

/** Project a stored rotation-zero rectangle into the active zoom/rotation. */
export const projectCanonicalRect = (
  rect: { x: number; y: number; width: number; height: number },
  canonicalViewport: CoordinateViewport,
  activeViewport: CoordinateViewport,
) => {
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ].map(([x, y]) => {
    const [pdfX, pdfY] = canonicalViewport.convertToPdfPoint(x * canonicalViewport.width, y * canonicalViewport.height);
    return activeViewport.convertToViewportPoint(pdfX, pdfY);
  });
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const left = clamp(Math.min(...xs) / activeViewport.width);
  const top = clamp(Math.min(...ys) / activeViewport.height);
  const right = clamp(Math.max(...xs) / activeViewport.width);
  const bottom = clamp(Math.max(...ys) / activeViewport.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export function joinSelectedText(parts: readonly string[]): string {
  return parts.reduce((joined, part) => {
    const next = part.trim();
    if (!next) return joined;
    if (!joined) return next;
    // PDF text layers commonly omit a DOM separator at the page edge. Keep
    // words distinct, except where a hyphen explicitly joins a split word.
    return /[-\u2010-\u2015]$/u.test(joined) ? `${joined}${next}` : `${joined} ${next}`;
  }, '');
}
