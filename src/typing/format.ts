export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function wpmText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return String(Math.round(value));
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function displayGlyph(ch: string): string {
  if (ch === ' ') return '␣';
  if (ch === '\n') return '↵';
  return ch;
}

export function startOfLocalDay(now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
