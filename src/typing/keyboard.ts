import type { FingerId } from './types.ts';

export const FINGER_COLOR: Record<FingerId, string> = {
  lp: '#e11d48',
  lr: '#ea580c',
  lm: '#d97706',
  li: '#16a34a',
  ri: '#0f766e',
  rm: '#2563eb',
  rr: '#7c3aed',
  rp: '#db2777',
  th: '#475569',
};

export const FINGER_LABEL: Record<FingerId, string> = {
  lp: '左小指',
  lr: '左无名指',
  lm: '左中指',
  li: '左食指',
  ri: '右食指',
  rm: '右中指',
  rr: '右无名指',
  rp: '右小指',
  th: '拇指',
};

const FINGER_BY_KEY: Record<string, FingerId> = {
  '`': 'lp', '1': 'lp', q: 'lp', a: 'lp', z: 'lp',
  '2': 'lr', w: 'lr', s: 'lr', x: 'lr',
  '3': 'lm', e: 'lm', d: 'lm', c: 'lm',
  '4': 'li', '5': 'li', r: 'li', t: 'li', f: 'li', g: 'li', v: 'li', b: 'li',
  '6': 'ri', '7': 'ri', y: 'ri', u: 'ri', h: 'ri', j: 'ri', n: 'ri', m: 'ri',
  '8': 'rm', i: 'rm', k: 'rm', ',': 'rm',
  '9': 'rr', o: 'rr', l: 'rr', '.': 'rr',
  '0': 'rp', '-': 'rp', '=': 'rp', p: 'rp', '[': 'rp', ']': 'rp', '\\': 'rp',
  ';': 'rp', "'": 'rp', '/': 'rp',
  ' ': 'th',
};

const SHIFT_FROM: Record<string, string> = {
  '~': '`', '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7',
  '*': '8', '(': '9', ')': '0', _: '-', '+': '=', '{': '[', '}': ']', '|': '\\',
  ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
};

export interface KeyCap {
  id: string;
  label: string;
  shiftLabel?: string;
  w: number;
  finger?: FingerId;
}

export const KEY_ROWS: KeyCap[][] = [
  [
    cap('`', '`', '~', 1), cap('1', '1', '!', 1), cap('2', '2', '@', 1), cap('3', '3', '#', 1),
    cap('4', '4', '$', 1), cap('5', '5', '%', 1), cap('6', '6', '^', 1), cap('7', '7', '&', 1),
    cap('8', '8', '*', 1), cap('9', '9', '(', 1), cap('0', '0', ')', 1), cap('-', '-', '_', 1),
    cap('=', '=', '+', 1), { id: 'backspace', label: '⌫', w: 2, finger: 'rp' },
  ],
  [
    { id: 'tab', label: 'Tab', w: 1.5, finger: 'lp' },
    cap('q', 'Q', undefined, 1), cap('w', 'W', undefined, 1), cap('e', 'E', undefined, 1),
    cap('r', 'R', undefined, 1), cap('t', 'T', undefined, 1), cap('y', 'Y', undefined, 1),
    cap('u', 'U', undefined, 1), cap('i', 'I', undefined, 1), cap('o', 'O', undefined, 1),
    cap('p', 'P', undefined, 1), cap('[', '[', '{', 1), cap(']', ']', '}', 1),
    cap('\\', '\\', '|', 1.5),
  ],
  [
    { id: 'caps', label: 'Caps', w: 1.75, finger: 'lp' },
    cap('a', 'A', undefined, 1), cap('s', 'S', undefined, 1), cap('d', 'D', undefined, 1),
    cap('f', 'F', undefined, 1), cap('g', 'G', undefined, 1), cap('h', 'H', undefined, 1),
    cap('j', 'J', undefined, 1), cap('k', 'K', undefined, 1), cap('l', 'L', undefined, 1),
    cap(';', ';', ':', 1), cap("'", "'", '"', 1),
    { id: 'enter', label: 'Enter', w: 2.25, finger: 'rp' },
  ],
  [
    { id: 'shift-l', label: 'Shift', w: 2.25, finger: 'lp' },
    cap('z', 'Z', undefined, 1), cap('x', 'X', undefined, 1), cap('c', 'C', undefined, 1),
    cap('v', 'V', undefined, 1), cap('b', 'B', undefined, 1), cap('n', 'N', undefined, 1),
    cap('m', 'M', undefined, 1), cap(',', ',', '<', 1), cap('.', '.', '>', 1), cap('/', '/', '?', 1),
    { id: 'shift-r', label: 'Shift', w: 2.75, finger: 'rp' },
  ],
  [{ id: 'space', label: '', w: 8, finger: 'th' }],
];

function cap(id: string, label: string, shiftLabel: string | undefined, w: number): KeyCap {
  return { id, label, shiftLabel, w, finger: FINGER_BY_KEY[id] };
}

export function fingerForKey(keyId: string): FingerId | null {
  return FINGER_BY_KEY[keyId] ?? null;
}

export interface KeyTarget {
  ids: string[];
  shift: boolean;
  finger: FingerId | null;
}

export function targetForChar(ch: string | null): KeyTarget {
  if (!ch) return { ids: [], shift: false, finger: null };
  if (ch === '\n') return { ids: ['enter'], shift: false, finger: 'rp' };
  if (ch === ' ') return { ids: ['space'], shift: false, finger: 'th' };
  if (ch === '\t') return { ids: ['tab'], shift: false, finger: 'lp' };
  const base = SHIFT_FROM[ch];
  if (base) {
    return { ids: [base, 'shift-l', 'shift-r'], shift: true, finger: FINGER_BY_KEY[base] ?? null };
  }
  if (ch >= 'A' && ch <= 'Z') {
    const id = ch.toLowerCase();
    return { ids: [id, 'shift-l', 'shift-r'], shift: true, finger: FINGER_BY_KEY[id] ?? null };
  }
  const id = ch.toLowerCase();
  const finger = FINGER_BY_KEY[id] ?? null;
  if (finger || id === ch) return { ids: [id], shift: false, finger };
  return { ids: [], shift: false, finger: null };
}

export function fingersForChar(ch: string | null): FingerId[] {
  const target = targetForChar(ch);
  const fingers: FingerId[] = [];
  if (target.shift) fingers.push('lp');
  if (target.finger && !fingers.includes(target.finger)) fingers.push(target.finger);
  return fingers;
}

export function statKey(expected: string): string {
  if (expected === ' ') return 'space';
  if (expected === '\n') return 'enter';
  if (expected >= 'A' && expected <= 'Z') return expected.toLowerCase();
  return expected;
}

export const HOME_ANCHOR: Record<string, string> = {
  q: 'a', w: 's', e: 'd', r: 'f', t: 'f', y: 'j', u: 'j', i: 'k', o: 'l', p: ';',
  g: 'f', h: 'j', z: 'a', x: 's', c: 'd', v: 'f', b: 'f', n: 'j', m: 'j',
  ',': 'k', '.': 'l', '/': ';',
  '1': 'a', '2': 's', '3': 'd', '4': 'f', '5': 'f', '6': 'j', '7': 'j', '8': 'k', '9': 'l', '0': ';',
};

export function homeReturn(key: string, repeats = 4): string {
  const anchor = HOME_ANCHOR[key.toLowerCase()];
  if (!anchor) return Array.from({ length: repeats }, () => key).join(' ');
  const unit = `${anchor}${key}${anchor}`;
  return Array.from({ length: repeats }, () => unit).join(' ');
}

export function homeReturnNote(key: string): string | undefined {
  const anchor = HOME_ANCHOR[key.toLowerCase()];
  if (!anchor || anchor === key.toLowerCase()) return undefined;
  return `${anchor} ${key} ${anchor}`;
}
