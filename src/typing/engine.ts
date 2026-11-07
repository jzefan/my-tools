import { statKey } from './keyboard.ts';
import type { ApplyResult, PracticeItem, RoundStats, SessionState } from './types.ts';

export interface KeyInput {
  key: string;
  repeat?: boolean;
}

export function createSession(items: PracticeItem[]): SessionState {
  return {
    items,
    index: 0,
    charIndex: 0,
    phase: items.length > 0 ? 'live' : 'done',
    holdToken: 0,
    startedAt: null,
    endedAt: items.length > 0 ? null : 0,
    correct: 0,
    wrong: 0,
    combo: 0,
    pendingMisses: 0,
    keyHits: {},
    keyMisses: {},
    itemWrong: items.map(() => 0),
    wordResults: [],
  };
}

export function currentItem(state: SessionState): PracticeItem | null {
  if (state.phase === 'done') return state.items[state.index] ?? null;
  return state.items[state.index] ?? null;
}

export function currentExpected(state: SessionState): string | null {
  const item = state.items[state.index];
  if (!item || state.phase !== 'live') return null;
  return item.prompt[state.charIndex] ?? null;
}

export function shouldAssist(assist: boolean, state: SessionState): boolean {
  return assist || state.pendingMisses >= 3;
}

export function applyKey(
  state: SessionState,
  input: KeyInput,
  opts: { allowBackspace: boolean; now: number },
): ApplyResult {
  if (input.repeat || state.phase !== 'live') return { state, kind: 'ignore' };
  const item = state.items[state.index];
  if (!item) return { state, kind: 'ignore' };

  if (input.key === 'Backspace') {
    if (!opts.allowBackspace || state.charIndex === 0) return { state, kind: 'ignore' };
    const next = cloneState(state);
    next.charIndex -= 1;
    touchStart(next, opts.now);
    return { state: next, kind: 'backspace' };
  }

  const produced = producedChar(input.key);
  if (produced == null) return { state, kind: 'ignore' };
  const expected = item.prompt[state.charIndex];
  if (expected == null) return { state, kind: 'ignore' };

  const next = cloneState(state);
  touchStart(next, opts.now);
  const bucket = statKey(expected);
  if (produced === expected) {
    next.correct += 1;
    next.combo += 1;
    next.pendingMisses = 0;
    next.keyHits[bucket] = (next.keyHits[bucket] ?? 0) + 1;
    next.charIndex += 1;
    if (next.charIndex >= item.prompt.length) {
      next.phase = 'hold';
      next.holdToken += 1;
      return { state: next, kind: 'need-advance' };
    }
    return { state: next, kind: 'hit' };
  }

  next.wrong += 1;
  next.combo = 0;
  next.pendingMisses += 1;
  next.itemWrong[next.index] = (next.itemWrong[next.index] ?? 0) + 1;
  next.keyMisses[bucket] = (next.keyMisses[bucket] ?? 0) + 1;
  return { state: next, kind: 'miss' };
}

export function advanceItem(state: SessionState, now: number): SessionState {
  if (state.phase === 'done') return state;
  const next = cloneState(state);
  pushWord(next);
  if (next.index + 1 >= next.items.length) {
    next.phase = 'done';
    next.endedAt = now;
    return next;
  }
  next.index += 1;
  next.charIndex = 0;
  next.pendingMisses = 0;
  next.phase = 'live';
  return next;
}

export function penalize(state: SessionState, now: number): SessionState {
  const expected = currentExpected(state);
  if (!expected) return state;
  const next = cloneState(state);
  touchStart(next, now);
  const bucket = statKey(expected);
  next.wrong += 1;
  next.combo = 0;
  next.pendingMisses += 1;
  next.itemWrong[next.index] = (next.itemWrong[next.index] ?? 0) + 1;
  next.keyMisses[bucket] = (next.keyMisses[bucket] ?? 0) + 1;
  return next;
}

export function finalize(state: SessionState, now: number): SessionState {
  if (state.phase === 'done') {
    const next = cloneState(state);
    next.endedAt = next.endedAt ?? now;
    return next;
  }
  const next = cloneState(state);
  if (next.phase === 'hold') {
    pushWord(next);
  } else {
    const item = next.items[next.index];
    if (item?.wordId) {
      const started = next.charIndex > 0 || (next.itemWrong[next.index] ?? 0) > 0;
      const complete = next.charIndex >= item.prompt.length;
      if (started) {
        next.wordResults.push({
          wordId: item.wordId,
          correct: complete && (next.itemWrong[next.index] ?? 0) === 0,
        });
      }
    }
  }
  next.phase = 'done';
  next.endedAt = now;
  return next;
}

export function finishedAll(state: SessionState): boolean {
  if (state.phase !== 'done' || state.items.length === 0) return false;
  const item = state.items[state.index];
  return state.index === state.items.length - 1 && !!item && state.charIndex >= item.prompt.length;
}

export function sessionStats(state: SessionState, now: number): RoundStats {
  const end = state.endedAt ?? now;
  const start = state.startedAt ?? end;
  const durationMs = Math.max(0, end - start);
  const minutes = durationMs / 60000;
  const total = state.correct + state.wrong;
  return {
    durationMs,
    correct: state.correct,
    wrong: state.wrong,
    accuracy: total > 0 ? state.correct / total : 1,
    wpm: minutes > 0 ? state.correct / 5 / minutes : 0,
  };
}

function producedChar(key: string): string | null {
  if (key === 'Enter') return '\n';
  if (key.length === 1) return key;
  return null;
}

function touchStart(state: SessionState, now: number) {
  if (state.startedAt == null) state.startedAt = now;
}

function pushWord(state: SessionState) {
  const item = state.items[state.index];
  if (!item?.wordId) return;
  state.wordResults.push({
    wordId: item.wordId,
    correct: (state.itemWrong[state.index] ?? 0) === 0,
  });
}

function cloneState(state: SessionState): SessionState {
  return {
    ...state,
    keyHits: { ...state.keyHits },
    keyMisses: { ...state.keyMisses },
    itemWrong: state.itemWrong.slice(),
    wordResults: state.wordResults.map((row) => ({ ...row })),
    items: state.items,
  };
}
