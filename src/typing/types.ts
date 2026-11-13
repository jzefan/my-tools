import type { SoundSettings } from './preferences';
export type BookId = string;

export type PlayMode = 'focus' | 'mole' | 'shooter' | 'tower';

export type WordMode = 'follow' | 'recall' | 'dictation';

export type FingerId = 'lp' | 'lr' | 'lm' | 'li' | 'ri' | 'rm' | 'rr' | 'rp' | 'th';

export interface PracticeItem {
  id: string;
  prompt: string;
  meaning?: string;
  phonetic?: string;
  example?: string;
  exampleZh?: string;
  examples?: { en: string; zh: string }[];
  phrases?: { en: string; zh: string }[];
  speak?: string;
  note?: string;
  wordId?: number;
  conceal?: boolean;
}

export type RunSource =
  | { type: 'lesson'; lessonId: string; stepIndex: number }
  | { type: 'warmup' }
  | { type: 'words'; book: BookId; mode: WordMode; plan: 'smart' | 'free' }
  | { type: 'article'; articleId: number }
  | { type: 'ids' };

export interface PracticeRun {
  title: string;
  allowBackspace: boolean;
  assist: boolean;
  speakOnShow: boolean;
  showExample: boolean;
  mono: boolean;
  passAccuracy: number | null;
  timedMs: number | null;
  items: PracticeItem[];
  source: RunSource;
}

export interface SessionState {
  items: PracticeItem[];
  index: number;
  charIndex: number;
  phase: 'live' | 'hold' | 'done';
  holdToken: number;
  startedAt: number | null;
  endedAt: number | null;
  correct: number;
  wrong: number;
  combo: number;
  pendingMisses: number;
  keyHits: Record<string, number>;
  keyMisses: Record<string, number>;
  itemWrong: number[];
  wordResults: { wordId: number; correct: boolean }[];
}

export type KeyKind = 'ignore' | 'hit' | 'miss' | 'backspace' | 'need-advance';

export interface ApplyResult {
  state: SessionState;
  kind: KeyKind;
}

export interface RoundStats {
  durationMs: number;
  correct: number;
  wrong: number;
  accuracy: number;
  wpm: number;
}

export interface SeedWord {
  id: number;
  word: string;
  phonetic: string;
  translation: string;
  example: string;
  exampleZh: string;
  book: BookId;
  difficulty: number;
}

export interface SeedArticle {
  id: number;
  title: string;
  sentences: { en: string; zh: string }[];
}

export interface LessonStep {
  id: string;
  title: string;
  items: PracticeItem[];
}

export interface Lesson {
  id: string;
  title: string;
  newKeys: string;
  passAccuracy: number;
  steps: LessonStep[];
}

export interface WordRow {
  id: number;
  word: string;
  phonetic: string;
  translation: string;
  example: string;
  exampleZh: string;
  examples: { en: string; zh: string }[];
  phrases: { en: string; zh: string }[];
  book: BookId;
  difficulty: number;
  seen: number;
  correct: number;
  wrong: number;
  streak: number;
  mastery: number;
  wrongBook: boolean;
  starred: boolean;
  skip: boolean;
  nextReviewAt: number;
  lastSeenAt: number;
}

export interface SessionRow {
  id: number;
  mode: string;
  lessonId: string;
  book: string;
  startedAt: number;
  durationMs: number;
  correct: number;
  wrong: number;
  wpm: number;
  accuracy: number;
}

export interface LessonProgress {
  completed: boolean;
  bestAccuracy: number;
  bestWpm: number;
  attempts: number;
}

export interface WeakKey {
  key: string;
  hits: number;
  misses: number;
}

export interface TypingSnapshot {
  mastered: number;
  learning: number;
  wrong: number;
  seenToday: number;
  sessions: SessionRow[];
  lessons: Record<string, LessonProgress>;
  weakKeys: WeakKey[];
  sound: boolean;
  soundSettings: SoundSettings;
  bookCounts: Record<string, number>;
}

export interface ArticleRow {
  id: number;
  title: string;
  titleZh: string;
  book: string;
  sentences: { en: string; zh: string }[];
}
