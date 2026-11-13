import { normalizeSound, type SoundSettings } from './preferences';
import initSqlJs, { type Database, type SqlValue } from 'sql.js/dist/sql-wasm-browser.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { SEED_ARTICLES, SEED_WORDS } from './catalog';
import { dictById } from './dicts';
import { nextReview } from './review';
import { loadDatabaseBytes, saveDatabaseBytes } from '../services/typingPersist';
import type {
  ArticleRow,
  BookId,
  LessonProgress,
  SessionRow,
  TypingSnapshot,
  WeakKey,
  WordRow,
} from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY,
  word TEXT NOT NULL,
  phonetic TEXT NOT NULL DEFAULT '',
  translation TEXT NOT NULL,
  example TEXT NOT NULL DEFAULT '',
  example_zh TEXT NOT NULL DEFAULT '',
  book TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS word_progress (
  word_id INTEGER PRIMARY KEY,
  seen INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  mastery INTEGER NOT NULL DEFAULT 0,
  wrong_book INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  skip INTEGER NOT NULL DEFAULT 0,
  next_review_at INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS key_stats (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  last_miss_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL,
  lesson_id TEXT NOT NULL DEFAULT '',
  book TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  wrong_count INTEGER NOT NULL,
  wpm REAL NOT NULL,
  accuracy REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS lesson_progress (
  lesson_id TEXT PRIMARY KEY,
  completed INTEGER NOT NULL DEFAULT 0,
  best_accuracy REAL NOT NULL DEFAULT 0,
  best_wpm REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_words_book ON words(book);
`;

const WORD_SELECT = `
SELECT w.id, w.word, w.phonetic, w.translation, w.example, w.example_zh AS exampleZh,
       w.book, w.difficulty, w.detail,
       COALESCE(p.seen, 0) AS seen,
       COALESCE(p.correct, 0) AS correctCount,
       COALESCE(p.wrong, 0) AS wrongCount,
       COALESCE(p.streak, 0) AS streak,
       COALESCE(p.mastery, 0) AS mastery,
       COALESCE(p.wrong_book, 0) AS wrongBook,
       COALESCE(p.starred, 0) AS starred,
       COALESCE(p.skip, 0) AS skip,
       COALESCE(p.next_review_at, 0) AS nextReviewAt,
       COALESCE(p.last_seen_at, 0) AS lastSeenAt
FROM words w
LEFT JOIN word_progress p ON p.word_id = w.id
`;

export const TYPING_SAVE_ERROR = 'typing-save-error';
export const TYPING_SAVE_OK = 'typing-save-ok';

export class TypingDb {
  private timer = 0;
  private dirty = false;
  private saving: Promise<void> | null = null;
  private loading = new Map<string, Promise<void>>();

  private constructor(private readonly db: Database) {}

  static async open(): Promise<TypingDb> {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const bytes = await loadDatabaseBytes();
    let database: Database;
    try {
      database = bytes && bytes.length > 0 ? new SQL.Database(bytes) : new SQL.Database();
    } catch {
      database = new SQL.Database();
    }
    const store = new TypingDb(database);
    store.migrate();
    store.seed();
    await store.flush();
    window.addEventListener('pagehide', () => {
      void store.flush().catch(() => undefined);
    });
    return store;
  }

  snapshot(dayStart: number): TypingSnapshot {
    const counts = this.one(`
      SELECT
        COALESCE(SUM(CASE WHEN mastery >= 3 OR skip = 1 THEN 1 ELSE 0 END), 0) AS mastered,
        COALESCE(SUM(CASE WHEN wrong_book = 1 THEN 1 ELSE 0 END), 0) AS wrong,
        COALESCE(SUM(CASE WHEN mastery > 0 AND mastery < 3 AND skip = 0 THEN 1 ELSE 0 END), 0) AS learning,
        COALESCE(SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END), 0) AS seenToday
      FROM word_progress
    `, [dayStart]);
    const lessons: Record<string, LessonProgress> = {};
    for (const row of this.query(`SELECT lesson_id, completed, best_accuracy, best_wpm, attempts FROM lesson_progress`)) {
      lessons[str(row.lesson_id)] = {
        completed: num(row.completed) === 1,
        bestAccuracy: num(row.best_accuracy),
        bestWpm: num(row.best_wpm),
        attempts: num(row.attempts),
      };
    }
    const bookCounts: Record<string, number> = { primary: 0, junior: 0, sentence: 0 };
    for (const row of this.query(`SELECT book, COUNT(*) AS n FROM words GROUP BY book`)) {
      bookCounts[str(row.book)] = num(row.n);
    }
    const sound = this.meta('sound');
    return {
      mastered: num(counts?.mastered),
      learning: num(counts?.learning),
      wrong: num(counts?.wrong),
      seenToday: num(counts?.seenToday),
      sessions: this.sessionsSince(dayStart - 8 * 86_400_000),
      lessons,
      weakKeys: this.weakKeys(),
      sound: sound == null ? true : sound === '1',
      bookCounts,
      soundSettings: normalizeSound({ profile: this.meta('sound_profile'), volume: this.meta('sound_volume') == null ? undefined : Number(this.meta('sound_volume')) }),
    };
  }

  listWords(book: BookId, filter: 'all' | 'wrong' | 'starred' | 'mastered'): WordRow[] {
    const clauses = ['w.book = ?'];
    if (filter === 'wrong') clauses.push('COALESCE(p.wrong_book, 0) = 1');
    if (filter === 'starred') clauses.push('COALESCE(p.starred, 0) = 1');
    if (filter === 'mastered') clauses.push('(COALESCE(p.mastery, 0) >= 3 OR COALESCE(p.skip, 0) = 1)');
    return this.query(`${WORD_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY w.difficulty, w.id`, [book]).map(mapWord);
  }

  smartQueue(book: BookId, limit: number, now: number): WordRow[] {
    return this.query(`
      ${WORD_SELECT}
      WHERE w.book = ?
        AND COALESCE(p.skip, 0) = 0
        AND COALESCE(p.mastery, 0) < 3
      ORDER BY
        CASE
          WHEN COALESCE(p.wrong_book, 0) = 1 AND COALESCE(p.next_review_at, 0) <= ? THEN 0
          WHEN COALESCE(p.seen, 0) > 0 AND COALESCE(p.next_review_at, 0) <= ? THEN 1
          WHEN p.word_id IS NULL THEN 2
          ELSE 3
        END,
        COALESCE(p.next_review_at, 0),
        w.difficulty,
        w.id
      LIMIT ?
    `, [book, now, now, limit]).map(mapWord);
  }

  freeQueue(book: BookId, limit: number): WordRow[] {
    return this.query(`
      ${WORD_SELECT}
      WHERE w.book = ? AND COALESCE(p.skip, 0) = 0
      ORDER BY RANDOM()
      LIMIT ?
    `, [book, limit]).map(mapWord);
  }

  wordsByIds(ids: number[]): WordRow[] {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(',');
    const rows = this.query(`${WORD_SELECT} WHERE w.id IN (${marks})`, ids).map(mapWord);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  listArticles(): ArticleRow[] {
    return this.query(`SELECT id, title, title_zh, body, book FROM articles ORDER BY id`).map((row) => ({
      id: num(row.id),
      title: str(row.title),
      titleZh: str(row.title_zh),
      book: str(row.book) || '入门',
      sentences: parseSentences(str(row.body)),
    }));
  }

  async ensureNce(): Promise<void> {
    if (this.meta('article:nce1') === '2') return;
    const response = await fetch('/dicts/nce1.json');
    if (!response.ok) throw new Error('短文没有载入');
    const payload = await response.json() as {
      book?: string;
      articles?: { title?: string; titleZh?: string; sentences?: unknown }[];
    };
    const book = payload.book || '新概念英语1册';
    const articles = payload.articles ?? [];
    this.db.run('BEGIN');
    try {
      articles.forEach((article, index) => {
        const sentences = pairList(article.sentences);
        if (!article.title || sentences.length === 0) return;
        this.db.run(`
          INSERT INTO articles (id, title, title_zh, body, book) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            title_zh = excluded.title_zh,
            body = excluded.body,
            book = excluded.book
        `, [1100 + index, article.title, article.titleZh ?? '', JSON.stringify(sentences), book]);
      });
      this.db.run(`
        INSERT INTO meta (k, v) VALUES (?, ?)
        ON CONFLICT(k) DO UPDATE SET v = excluded.v
      `, ['article:nce1', '2']);
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
    this.dirty = true;
    await this.flush();
  }

  recordAnswer(wordId: number, correct: boolean, now: number) {
    const prev = this.one(`SELECT streak, mastery, seen, correct, wrong FROM word_progress WHERE word_id = ?`, [wordId]);
    const scheduled = nextReview(correct, {
      streak: num(prev?.streak),
      mastery: num(prev?.mastery),
    }, now);
    const seen = num(prev?.seen) + 1;
    const correctCount = num(prev?.correct) + (correct ? 1 : 0);
    const wrongCount = num(prev?.wrong) + (correct ? 0 : 1);
    this.run(`
      INSERT INTO word_progress (
        word_id, seen, correct, wrong, streak, mastery, wrong_book, next_review_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(word_id) DO UPDATE SET
        seen = excluded.seen,
        correct = excluded.correct,
        wrong = excluded.wrong,
        streak = excluded.streak,
        mastery = excluded.mastery,
        wrong_book = excluded.wrong_book,
        next_review_at = excluded.next_review_at,
        last_seen_at = excluded.last_seen_at
    `, [
      wordId,
      seen,
      correctCount,
      wrongCount,
      scheduled.streak,
      scheduled.mastery,
      scheduled.wrongBook,
      scheduled.nextReviewAt,
      now,
    ]);
    this.touch();
  }

  recordKeys(hits: Record<string, number>, misses: Record<string, number>, now: number) {
    const keys = new Set([...Object.keys(hits), ...Object.keys(misses)]);
    for (const key of keys) {
      const miss = misses[key] ?? 0;
      this.run(`
        INSERT INTO key_stats (key, hits, misses, last_miss_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          hits = key_stats.hits + excluded.hits,
          misses = key_stats.misses + excluded.misses,
          last_miss_at = CASE WHEN excluded.misses > 0 THEN excluded.last_miss_at ELSE key_stats.last_miss_at END
      `, [key, hits[key] ?? 0, miss, miss > 0 ? now : 0]);
    }
    this.touch();
  }

  recordSession(input: {
    mode: string;
    lessonId: string;
    book: string;
    startedAt: number;
    durationMs: number;
    correct: number;
    wrong: number;
    wpm: number;
    accuracy: number;
  }) {
    this.run(`
      INSERT INTO sessions (
        mode, lesson_id, book, started_at, duration_ms, correct_count, wrong_count, wpm, accuracy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      input.mode,
      input.lessonId,
      input.book,
      input.startedAt,
      input.durationMs,
      input.correct,
      input.wrong,
      input.wpm,
      input.accuracy,
    ]);
    this.touch();
  }

  recordLesson(stepId: string, accuracy: number, wpm: number, passed: boolean, now: number) {
    this.run(`
      INSERT INTO lesson_progress (lesson_id, completed, best_accuracy, best_wpm, attempts, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(lesson_id) DO UPDATE SET
        completed = MAX(lesson_progress.completed, excluded.completed),
        best_accuracy = MAX(lesson_progress.best_accuracy, excluded.best_accuracy),
        best_wpm = MAX(lesson_progress.best_wpm, excluded.best_wpm),
        attempts = lesson_progress.attempts + 1,
        updated_at = excluded.updated_at
    `, [stepId, passed ? 1 : 0, accuracy, wpm, now]);
    this.touch();
  }

  toggleStar(wordId: number): boolean {
    const current = this.one(`SELECT starred FROM word_progress WHERE word_id = ?`, [wordId]);
    const starred = num(current?.starred) === 1 ? 0 : 1;
    this.run(`
      INSERT INTO word_progress (word_id, starred) VALUES (?, ?)
      ON CONFLICT(word_id) DO UPDATE SET starred = excluded.starred
    `, [wordId, starred]);
    this.touch();
    return starred === 1;
  }

  setMastered(wordId: number, mastered: boolean, now: number) {
    if (mastered) {
      this.run(`
        INSERT INTO word_progress (word_id, mastery, skip, last_seen_at) VALUES (?, 3, 1, ?)
        ON CONFLICT(word_id) DO UPDATE SET mastery = 3, skip = 1
      `, [wordId, now]);
    } else {
      this.run(`
        INSERT INTO word_progress (word_id, mastery, skip, next_review_at) VALUES (?, 1, 0, ?)
        ON CONFLICT(word_id) DO UPDATE SET mastery = 1, skip = 0, next_review_at = excluded.next_review_at
      `, [wordId, now]);
    }
    this.touch();
  }

  setSound(on: boolean) {
    this.run(`
      INSERT INTO meta (k, v) VALUES ('sound', ?)
      ON CONFLICT(k) DO UPDATE SET v = excluded.v
    `, [on ? '1' : '0']);
    this.touch();
  }

  setSoundSettings(settings: SoundSettings) {
    const value = normalizeSound(settings);
    for (const [key, val] of [['sound_profile', value.profile], ['sound_volume', String(value.volume)]]) {
      this.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [key, val]);
    }
    this.touch();
  }

  async ensureBook(book: string): Promise<void> {
    const pending = this.loading.get(book);
    if (pending) return pending;
    const job = this.loadBook(book).finally(() => {
      this.loading.delete(book);
    });
    this.loading.set(book, job);
    return job;
  }

  private async loadBook(book: string): Promise<void> {
    const dict = dictById(book);
    if (!dict) return;
    if (this.meta(`dict:${book}`) === dict.version) return;
    const response = await fetch(dict.file);
    if (!response.ok) throw new Error('词库没有载入');
    const payload = await response.json() as { words?: unknown };
    if (!Array.isArray(payload.words)) throw new Error('词库没有载入');
    this.db.run('BEGIN');
    try {
      payload.words.forEach((row, index) => {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0]) return;
        this.db.run(`
          INSERT INTO words (id, word, phonetic, translation, example, example_zh, detail, book, difficulty)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            word = excluded.word,
            phonetic = excluded.phonetic,
            translation = excluded.translation,
            example = excluded.example,
            example_zh = excluded.example_zh,
            detail = excluded.detail,
            book = excluded.book,
            difficulty = excluded.difficulty
        `, [
          dict.base + index,
          row[0],
          typeof row[1] === 'string' ? row[1] : '',
          typeof row[2] === 'string' ? row[2] : '',
          typeof row[3] === 'string' ? row[3] : '',
          typeof row[4] === 'string' ? row[4] : '',
          detailOf(row[5], row[6]),
          book,
          index,
        ]);
      });
      this.db.run(`
        INSERT INTO meta (k, v) VALUES (?, ?)
        ON CONFLICT(k) DO UPDATE SET v = excluded.v
      `, [`dict:${book}`, dict.version]);
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
    this.dirty = true;
    await this.flush();
  }

  async flush() {
    while (this.saving) await this.saving;
    if (!this.dirty) return;
    const bytes = this.db.export();
    this.dirty = false;
    this.saving = saveDatabaseBytes(bytes);
    try {
      await this.saving;
      window.dispatchEvent(new Event(TYPING_SAVE_OK));
    } catch (error) {
      this.dirty = true;
      window.dispatchEvent(new Event(TYPING_SAVE_ERROR));
      throw error;
    } finally {
      this.saving = null;
    }
  }

  private migrate() {
    this.db.exec(SCHEMA);
    const columns = this.query(`PRAGMA table_info(words)`);
    if (!columns.some((column) => str(column.name) === 'detail')) {
      this.db.run(`ALTER TABLE words ADD COLUMN detail TEXT NOT NULL DEFAULT ''`);
    }
    const articleColumns = this.query(`PRAGMA table_info(articles)`);
    if (!articleColumns.some((column) => str(column.name) === 'book')) {
      this.db.run(`ALTER TABLE articles ADD COLUMN book TEXT NOT NULL DEFAULT ''`);
    }
    if (!articleColumns.some((column) => str(column.name) === 'title_zh')) {
      this.db.run(`ALTER TABLE articles ADD COLUMN title_zh TEXT NOT NULL DEFAULT ''`);
    }
  }

  private seed() {
    const ids = new Set<number>();
    for (const word of SEED_WORDS) {
      if (ids.has(word.id)) throw new Error(`词条编号重复: ${word.id}`);
      ids.add(word.id);
    }
    this.db.run('BEGIN');
    try {
      for (const word of SEED_WORDS) {
        this.db.run(`
          INSERT INTO words (id, word, phonetic, translation, example, example_zh, book, difficulty)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            word = excluded.word,
            phonetic = excluded.phonetic,
            translation = excluded.translation,
            example = excluded.example,
            example_zh = excluded.example_zh,
            book = excluded.book,
            difficulty = excluded.difficulty
        `, [word.id, word.word, word.phonetic, word.translation, word.example, word.exampleZh, word.book, word.difficulty]);
      }
      for (const article of SEED_ARTICLES) {
        this.db.run(`
          INSERT INTO articles (id, title, title_zh, body, book) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            title_zh = excluded.title_zh,
            body = excluded.body,
            book = excluded.book
        `, [article.id, article.title, '', JSON.stringify(article.sentences), '入门']);
      }
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
    this.dirty = true;
  }

  private sessionsSince(since: number): SessionRow[] {
    return this.query(`
      SELECT id, mode, lesson_id, book, started_at, duration_ms, correct_count, wrong_count, wpm, accuracy
      FROM sessions
      WHERE started_at >= ?
      ORDER BY started_at DESC
    `, [since]).map((row) => ({
      id: num(row.id),
      mode: str(row.mode),
      lessonId: str(row.lesson_id),
      book: str(row.book),
      startedAt: num(row.started_at),
      durationMs: num(row.duration_ms),
      correct: num(row.correct_count),
      wrong: num(row.wrong_count),
      wpm: num(row.wpm),
      accuracy: num(row.accuracy),
    }));
  }

  private weakKeys(): WeakKey[] {
    return this.query(`
      SELECT key, hits, misses FROM key_stats
      WHERE misses > 0
      ORDER BY (misses * 1.0 / (hits + misses)) DESC, misses DESC
      LIMIT 8
    `).map((row) => ({ key: str(row.key), hits: num(row.hits), misses: num(row.misses) }));
  }

  private meta(key: string): string | null {
    const row = this.one(`SELECT v FROM meta WHERE k = ?`, [key]);
    return row ? str(row.v) : null;
  }

  private touch() {
    this.dirty = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      void this.flush().catch(() => undefined);
    }, 200);
  }

  private run(sql: string, params: SqlValue[] = []) {
    this.db.run(sql, params);
  }

  private query(sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows: Record<string, SqlValue>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  private one(sql: string, params: SqlValue[] = []): Record<string, SqlValue> | null {
    return this.query(sql, params)[0] ?? null;
  }
}

let opening: Promise<TypingDb> | null = null;

export function openTypingDb(): Promise<TypingDb> {
  if (!opening) {
    opening = TypingDb.open().catch((error) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

function mapWord(row: Record<string, SqlValue>): WordRow {
  const book = str(row.book);
  return {
    id: num(row.id),
    word: str(row.word),
    phonetic: str(row.phonetic),
    translation: str(row.translation),
    example: str(row.example),
    exampleZh: str(row.exampleZh),
    ...parseDetail(str(row.detail)),
    book,
    difficulty: num(row.difficulty),
    seen: num(row.seen),
    correct: num(row.correctCount),
    wrong: num(row.wrongCount),
    streak: num(row.streak),
    mastery: num(row.mastery),
    wrongBook: num(row.wrongBook) === 1,
    starred: num(row.starred) === 1,
    skip: num(row.skip) === 1,
    nextReviewAt: num(row.nextReviewAt),
    lastSeenAt: num(row.lastSeenAt),
  };
}

function detailOf(examples: unknown, phrases: unknown): string {
  return JSON.stringify({
    examples: pairList(examples),
    phrases: pairList(phrases),
  });
}

function parseDetail(raw: string): { examples: { en: string; zh: string }[]; phrases: { en: string; zh: string }[] } {
  const empty = { examples: [], phrases: [] };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as { examples?: unknown; phrases?: unknown };
    return { examples: pairList(parsed.examples), phrases: pairList(parsed.phrases) };
  } catch {
    return empty;
  }
}

function pairList(value: unknown): { en: string; zh: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((pair) => {
    if (Array.isArray(pair) && typeof pair[0] === 'string' && pair[0]) {
      return [{ en: pair[0], zh: typeof pair[1] === 'string' ? pair[1] : '' }];
    }
    if (pair && typeof pair === 'object' && 'en' in pair && typeof pair.en === 'string' && pair.en) {
      return [{ en: pair.en, zh: 'zh' in pair && typeof pair.zh === 'string' ? pair.zh : '' }];
    }
    return [];
  });
}

function parseSentences(body: string): { en: string; zh: string }[] {
  try {
    const parsed = JSON.parse(body) as { en?: string; zh?: string }[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((sentence) => sentence && typeof sentence.en === 'string')
      .map((sentence) => ({ en: sentence.en ?? '', zh: sentence.zh ?? '' }));
  } catch {
    return [];
  }
}

function num(value: SqlValue | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

function str(value: SqlValue | undefined): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
