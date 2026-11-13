import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Crosshair, Lock, Play, RotateCcw, Trophy } from 'lucide-react';
import { GameShell } from './GameShell';
import { DEFAULT_SOUND, type SoundSettings } from '../../typing/preferences';
import { enterTypingFullscreen } from '../../typing/fullscreen';
import { PracticeStage } from './PracticeStage';
import { catalogSize, DICT_GROUPS, dictById, dictsInGroup } from '../../typing/dicts';
import {
  LESSONS,
  buildWarmup,
  warmupKeys,
  continueTarget,
  isLessonUnlocked,
  lessonComplete,
  lessonRun,
} from '../../typing/curriculum';
import { openTypingDb, TYPING_SAVE_ERROR, TYPING_SAVE_OK, type TypingDb } from '../../typing/db';
import { finishedAll, sessionStats } from '../../typing/engine';
import { clock, pct, startOfLocalDay, wpmText } from '../../typing/format';
import { rankWeakKeys } from '../../typing/review';
import { articleRun, bookLabel, wordRun } from '../../typing/runs';
import type {
  ArticleRow,
  BookId,
  PlayMode,
  PracticeRun,
  SessionState,
  WordMode,
  WordRow,
} from '../../typing/types';

interface TypingViewProps {
  activeSubTab?: string;
  isActive?: boolean;
  onExit?: () => void;
}

type Screen =
  | { kind: 'hub' }
  | { kind: 'run'; run: PracticeRun; attempt: number }
  | { kind: 'result'; run: PracticeRun; state: SessionState; play: PlayMode };

type WordFilter = 'wrong' | 'starred' | 'mastered';

export function TypingView({ activeSubTab = 'typing', isActive = true, onExit }: TypingViewProps) {
  const [tab, setTab] = useState(activeSubTab);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundSettings, setSoundSettings] = useState<SoundSettings>(DEFAULT_SOUND);
  useEffect(() => { if (isActive) void enterTypingFullscreen(); }, [isActive]);
  const dbRef = useRef<TypingDb | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<Screen>({ kind: 'hub' });
  const [snapshotTick, setSnapshotTick] = useState(0);
  const [sound, setSound] = useState(true);
  const [stats, setStats] = useState<ReturnType<TypingDb['snapshot']> | null>(null);
  const [book, setBook] = useState<BookId>('primary');
  const [wordMode, setWordMode] = useState<WordMode>('follow');
  const [plan, setPlan] = useState<'smart' | 'free'>('smart');
  const [filter, setFilter] = useState<WordFilter | null>(null);
  const [rows, setRows] = useState<WordRow[]>([]);
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [concealRead, setConcealRead] = useState(false);
  const [notice, setNotice] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    const failed = () => setSaveFailed(true);
    const saved = () => setSaveFailed(false);
    window.addEventListener(TYPING_SAVE_ERROR, failed);
    window.addEventListener(TYPING_SAVE_OK, saved);
    return () => { window.removeEventListener(TYPING_SAVE_ERROR, failed); window.removeEventListener(TYPING_SAVE_OK, saved); };
  }, []);
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const [marks, setMarks] = useState({ starred: new Set<number>(), mastered: new Set<number>() });

  const reload = useCallback(async () => {
    const db = await openTypingDb();
    dbRef.current = db;
    const snap = db.snapshot(startOfLocalDay());
    setStats(snap);
    setSound(snap.sound);
    setSoundSettings(snap.soundSettings);
    setReady(true);
  }, []);

  useEffect(() => {
    let live = true;
    reload().catch((err: unknown) => {
      if (live) setError(err instanceof Error ? err.message : '词库没有打开');
    });
    return () => {
      live = false;
    };
  }, [reload, snapshotTick]);

  useEffect(() => {
    setTab(activeSubTab);
  }, [activeSubTab]);

  useEffect(() => {
    if (tab !== 'typing_words' || !filter || !ready) return;
    const db = dbRef.current;
    if (!db) return;
    setRows(db.listWords(book, filter));
  }, [tab, filter, book, ready, snapshotTick, screen.kind]);

  useEffect(() => {
    if (tab !== 'typing_read' || !ready) return;
    const db = dbRef.current;
    if (!db) return;
    let live = true;
    db.ensureNce().then(() => {
      if (live) setArticles(db.listArticles());
    }).catch(() => {
      if (live) setArticles(db.listArticles());
    });
    return () => {
      live = false;
    };
  }, [tab, ready, snapshotTick]);

  async function remember(run: PracticeRun) {
    const db = await openTypingDb();
    const words = db.wordsByIds(run.items.flatMap((item) => (item.wordId ? [item.wordId] : [])));
    setMarks({
      starred: new Set(words.filter((word) => word.starred).map((word) => word.id)),
      mastered: new Set(words.filter((word) => word.skip || word.mastery >= 3).map((word) => word.id)),
    });
  }

  function start(run: PracticeRun) {
    if (run.items.length === 0) {
      setNotice('这组词暂时没有要复习的');
      return;
    }
    setNotice('');
    void remember(run).catch(() => setNotice('单词标记暂未载入'));
    setScreen({ kind: 'run', run, attempt: Date.now() });
  }

  async function finish(state: SessionState, play: PlayMode) {
    if (screen.kind !== 'run') return;
    const run = screen.run;
    if (state.correct + state.wrong === 0) {
      setScreen({ kind: 'hub' });
      return;
    }
    const db = await openTypingDb();
    const now = state.endedAt ?? Date.now();
    const round = sessionStats(state, now);
    db.recordKeys(state.keyHits, state.keyMisses, now);
    for (const word of state.wordResults) db.recordAnswer(word.wordId, word.correct, now);
    const lessonId = run.source.type === 'lesson' ? `${run.source.lessonId}:${run.source.stepIndex}` : '';
    const bookId = run.source.type === 'words' ? run.source.book : '';
    db.recordSession({
      mode: sessionMode(run, play),
      lessonId,
      book: bookId,
      startedAt: state.startedAt ?? now,
      durationMs: round.durationMs,
      correct: round.correct,
      wrong: round.wrong,
      wpm: round.wpm,
      accuracy: round.accuracy,
    });
    if (run.source.type === 'lesson' && run.passAccuracy != null && finishedAll(state)) {
      db.recordLesson(lessonId, round.accuracy, round.wpm, round.accuracy >= run.passAccuracy, now);
    }
    setScreen({ kind: 'result', run, state, play });
    try { await db.flush(); } catch { setSaveFailed(true); }
    setSnapshotTick((value) => value + 1);
  }

  async function chooseBook(next: string) {
    setBook(next);
    setFilter(null);
    if (!dictById(next)) return;
    setNotice('');
    try {
      const db = await openTypingDb();
      await db.ensureBook(next);
      setSnapshotTick((value) => value + 1);
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : '词库没有载入');
    }
  }

  function toggleStar(wordId: number) {
    const db = dbRef.current;
    if (!db) return;
    const on = db.toggleStar(wordId);
    setMarks(prev => {
      const starred = new Set(prev.starred);
      if (on) starred.add(wordId); else starred.delete(wordId);
      return { ...prev, starred };
    });
  }

  function toggleMaster(wordId: number) {
    const on = !marks.mastered.has(wordId);
    dbRef.current?.setMastered(wordId, on, Date.now());
    setMarks(prev => {
      const mastered = new Set(prev.mastered);
      if (on) mastered.add(wordId); else mastered.delete(wordId);
      return { ...prev, mastered };
    });
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    void openTypingDb().then((db) => db.setSound(next));
  }

  function changeSoundSettings(settings: SoundSettings) {
    setSoundSettings(settings);
    dbRef.current?.setSoundSettings(settings);
  }

  function shell(children: ReactNode) {
    return <GameShell tab={screen.kind === 'result' ? 'result' : tab} inRun={screen.kind === 'run'} sound={sound} settings={soundSettings}
      settingsOpen={settingsOpen} notice={saveFailed ? '记录暂未保存，请重试。' : notice}
      onRetrySave={saveFailed ? () => { void dbRef.current?.flush().catch(() => setSaveFailed(true)); } : undefined} onSettings={setSettingsOpen} onToggleSound={toggleSound}
      onSoundSettings={changeSoundSettings} onExit={onExit}
      onTab={next => { setTab(next); setScreen({ kind: 'hub' }); setNotice(''); }}>{children}</GameShell>;
  }

  if (error) return shell(<div className="tg-loading" role="alert"><h1>词库暂未就绪</h1><p>{error}</p><button className="tg-button" onClick={() => { setError(''); setSnapshotTick(t => t + 1); }}>重试</button></div>);
  if (!ready || !stats) return shell(<div className="tg-loading" role="status"><span className="tg-eyebrow">KEYLINE</span><h1>准备训练</h1><div className="tg-loading-bar"/></div>);

  if (screen.kind === 'run') {
    return shell(
      <PracticeStage
        key={screen.attempt}
        run={screen.run}
        sound={sound}
        soundSettings={soundSettings}
        suspended={settingsOpen || !isActive}
        starred={marks.starred}
        mastered={marks.mastered}
        onFinish={(state, play) => { void finish(state, play); }}
        onStar={toggleStar}
        onMaster={toggleMaster}
      />
    );
  }

  if (screen.kind === 'result') {
    return shell(
      <Result
        screen={screen}
        onRetry={() => start(screen.run)}
        onHome={() => { setTab('typing'); setScreen({ kind: 'hub' }); }}
        onNext={(run) => start(run)}
      />
    );
  }

  return shell(
    <div className={tab === 'typing' ? 'tg-lobby-body' : 'tg-hub-scroll'}>
      <div className={tab === 'typing' ? '' : 'tg-hub-content'}>
        {tab !== 'typing' && <div className="tg-section-heading"><span className="tg-eyebrow">{tab === 'typing_lesson' ? '01 / CAMPAIGN' : tab === 'typing_words' ? '02 / VOCABULARY' : tab === 'typing_read' ? '03 / READING' : '04 / RECORDS'}</span><h1>{tab === 'typing_lesson' ? '从基准键，向前一步。' : tab === 'typing_words' ? '让单词成为肌肉记忆。' : tab === 'typing_read' ? '进入英语的语境。' : '每一步，都有迹可循。'}</h1></div>}
        {tab === 'typing_lesson' && (
          <LessonHub
            progress={stats.lessons}
            openLesson={openLesson}
            onToggle={(id) => setOpenLesson((current) => (current === id ? null : id))}
            onStart={(lessonId, stepIndex) => {
              const lesson = LESSONS.find((item) => item.id === lessonId);
              if (lesson) start(lessonRun(lesson, stepIndex));
            }}
          />
        )}
        {tab === 'typing_words' && (
          <WordHub
            book={book}
            mode={wordMode}
            plan={plan}
            filter={filter}
            rows={rows}
            notice={notice}
            counts={stats}
            onBook={(next) => { void chooseBook(next); }}
            onMode={setWordMode}
            onPlan={setPlan}
            onFilter={(next) => setFilter((current) => (current === next ? null : next))}
            onStart={() => {
              void (async () => {
                const db = await openTypingDb();
                try {
                  await db.ensureBook(book);
                } catch (err: unknown) {
                  setNotice(err instanceof Error ? err.message : '词库没有载入');
                  return;
                }
                const words = plan === 'smart' ? db.smartQueue(book, 20, Date.now()) : db.freeQueue(book, 20);
                start(wordRun(words, wordMode, `${bookLabel(book)} · ${modeLabel(wordMode)}`, {
                  type: 'words',
                  book,
                  mode: wordMode,
                  plan,
                }));
              })();
            }}
            onPractice={(words) => {
              start(wordRun(words, wordMode, modeLabel(wordMode), { type: 'ids' }));
            }}
            onRestore={(wordId) => {
              const db = dbRef.current;
              if (!db) return;
              db.setMastered(wordId, false, Date.now());
              setSnapshotTick((value) => value + 1);
            }}
          />
        )}
        {tab === 'typing_read' && (
          <ReadHub
            articles={articles}
            conceal={concealRead}
            onConceal={setConcealRead}
            onStart={(article) => start(articleRun(article, concealRead))}
          />
        )}
        {tab === 'typing_stats' && <StatsHub stats={stats} />}
        {tab === 'typing' && (
          <TodayHub
            stats={stats}
            onWords={() => setTab('typing_words')}
            onWarmup={() => start(buildWarmup(rankWeakKeys(stats.weakKeys)))}
            onContinue={() => {
              const target = continueTarget(stats.lessons);
              start(lessonRun(target.lesson, target.stepIndex));
            }}
          />
        )}
      </div>
    </div>
  );
}

function sessionMode(run: PracticeRun, play: PlayMode): string {
  if (run.source.type === 'warmup') return 'warmup';
  if (run.source.type === 'article') return 'article';
  if (run.source.type === 'lesson') return play === 'focus' ? 'lesson' : play;
  return play === 'focus' ? 'word' : play;
}

function modeLabel(mode: WordMode): string {
  if (mode === 'recall') return '默写';
  if (mode === 'dictation') return '听写';
  return '跟打';
}

function TodayHub({ stats, onWarmup, onContinue, onWords }: {
  stats: NonNullable<ReturnType<TypingDb['snapshot']>>;
  onWarmup: () => void; onContinue: () => void; onWords: () => void;
}) {
  const today = stats.sessions.filter(session => session.startedAt >= startOfLocalDay());
  const duration = today.reduce((sum, session) => sum + session.durationMs, 0);
  const correct = today.reduce((sum, session) => sum + session.correct, 0);
  const wrong = today.reduce((sum, session) => sum + session.wrong, 0);
  const target = continueTarget(stats.lessons);
  const completed = LESSONS.filter(lesson => lessonComplete(lesson, stats.lessons)).length;
  const keys = warmupKeys(rankWeakKeys(stats.weakKeys));
  return <div className="tg-home">
    <div className="tg-home-title"><div className="tg-eyebrow"><span className="tg-tag">TRAINING 01</span> 键入世界 · 从这里开始</div>
      <h1>每一键，<br/>都是进阶<span>。</span></h1>
      <p className="tg-home-sub">指尖的节奏，成为你的英语直觉。</p>
      <div className="tg-home-actions"><button className="tg-button tg-primary" onClick={onContinue}><Play size={17} fill="currentColor"/>开始训练<ArrowRight size={18}/></button><button className="tg-button" onClick={onWords}>单词自由练习</button></div>
      <div className="tg-current-mission"><span className="tg-eyebrow">当前关卡</span><strong>{target.lesson.title}</strong><span>{target.lesson.steps[target.stepIndex].title}</span><div className="tg-mission-pips" aria-label={`已完成 ${completed} / ${LESSONS.length} 关`}>{LESSONS.map((lesson, i) => <i key={lesson.id} data-done={i < completed} data-current={lesson.id === target.lesson.id}/>)}</div></div>
    </div>
    <div className="tg-dock-label"><span className="tg-eyebrow">THE KEYBOARD DOCK</span><span>训练基地 / 01</span><div/></div>
    <div className="tg-home-bottom"><button className="tg-warmup" onClick={onWarmup}><Crosshair size={23}/><span><strong>60 秒热身</strong><small>{keys.join(' · ').toUpperCase()}</small></span><ArrowRight size={18}/></button>
      <dl className="tg-daily"><div><dt>今日训练</dt><dd>{clock(duration)}<small>时长</small></dd></div><div><dt>正确率</dt><dd>{correct + wrong > 0 ? pct(correct / (correct + wrong)) : '—'}<small>ACCURACY</small></dd></div><div><dt>今日单词</dt><dd>{stats.seenToday.toString().padStart(2, '0')}<small>WORDS</small></dd></div></dl>
    </div>
  </div>;
}

function LessonHub({
  progress,
  openLesson,
  onToggle,
  onStart,
}: {
  progress: ReturnType<TypingDb['snapshot']>['lessons'];
  openLesson: string | null;
  onToggle: (id: string) => void;
  onStart: (lessonId: string, stepIndex: number) => void;
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium">课程</h2>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {LESSONS.map((lesson, index) => {
          const unlocked = isLessonUnlocked(index, progress);
          const done = lessonComplete(lesson, progress);
          const open = openLesson === lesson.id && unlocked;
          return (
            <div key={lesson.id}>
              <button
                type="button"
                disabled={!unlocked}
                aria-expanded={open}
                onClick={() => onToggle(lesson.id)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:opacity-40"
              >
                <span className="w-5 text-xs tabular-nums text-slate-400">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{lesson.title}</span>
                  <span className="text-[11px] text-slate-400">{lesson.newKeys}</span>
                </span>
                {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : unlocked ? null : <Lock className="h-3.5 w-3.5 text-slate-300" />}
              </button>
              {open && (
                <div className="space-y-1 px-3 pb-3">
                  {lesson.steps.map((step, stepIndex) => {
                    const saved = progress[step.id];
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => onStart(lesson.id, stepIndex)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                      >
                        <span className="text-sm">{step.title}</span>
                        <span className="text-[11px] tabular-nums text-slate-400">
                          {saved ? pct(saved.bestAccuracy) : '开始'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DictPicker({
  book,
  counts,
  onBook,
}: {
  book: string;
  counts: Record<string, number>;
  onBook: (book: string) => void;
}) {
  const record = dictById(book);
  const activeGroup = !record || record.group === '小学' ? '入门' : record.group;
  const [group, setGroup] = useState(activeGroup);
  useEffect(() => {
    setGroup(activeGroup);
  }, [activeGroup]);
  const shown = group === '入门'
    ? [
        ...dictsInGroup('小学').map((item) => ({ id: item.id, name: item.name, count: item.count })),
        { id: 'primary', name: '常用', count: counts.primary ?? 0 },
        { id: 'junior', name: '初中起步', count: counts.junior ?? 0 },
        { id: 'sentence', name: '句子', count: counts.sentence ?? 0 },
      ]
    : dictsInGroup(group).map((item) => ({ id: item.id, name: item.name, count: item.count }));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {['入门', ...DICT_GROUPS].map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={group === name}
            onClick={() => setGroup(name)}
            className={`rounded-md px-2 py-1 text-xs ${
              group === name ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shown.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={book === item.id}
            onClick={() => onBook(item.id)}
            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left ${
              book === item.id
                ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40'
                : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900'
            }`}
          >
            <span className="text-sm">{item.name}</span>
            <span className="text-[11px] tabular-nums text-slate-400">{item.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function WordHub(props: {
  book: BookId;
  mode: WordMode;
  plan: 'smart' | 'free';
  filter: WordFilter | null;
  rows: WordRow[];
  notice: string;
  counts: ReturnType<TypingDb['snapshot']>;
  onBook: (book: BookId) => void;
  onMode: (mode: WordMode) => void;
  onPlan: (plan: 'smart' | 'free') => void;
  onFilter: (filter: WordFilter) => void;
  onStart: () => void;
  onPractice: (words: WordRow[]) => void;
  onRestore: (wordId: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">单词</h2>
        <button type="button" onClick={props.onStart} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white">
          开始
        </button>
      </div>
      <DictPicker book={props.book} counts={props.counts.bookCounts} onBook={props.onBook} />
      <div className="flex flex-wrap gap-2">
        <Segment
          value={props.mode}
          options={[
            { id: 'follow' as const, label: '跟打' },
            { id: 'recall' as const, label: '默写' },
            { id: 'dictation' as const, label: '听写' },
          ]}
          onChange={props.onMode}
        />
        <Segment
          value={props.plan}
          options={[
            { id: 'smart' as const, label: '智能' },
            { id: 'free' as const, label: '自由' },
          ]}
          onChange={props.onPlan}
        />
      </div>
      <div className="flex gap-3 text-xs text-slate-500">
        <FilterButton on={props.filter === 'wrong'} onClick={() => props.onFilter('wrong')}>错词 {props.counts.wrong}</FilterButton>
        <FilterButton on={props.filter === 'starred'} onClick={() => props.onFilter('starred')}>收藏</FilterButton>
        <FilterButton on={props.filter === 'mastered'} onClick={() => props.onFilter('mastered')}>已掌握 {props.counts.mastered}</FilterButton>
      </div>
      {props.notice && <div className="text-xs text-slate-400">{props.notice}</div>}
      {props.filter && (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs text-slate-400 dark:border-slate-800">
            <span>{props.rows.length}</span>
            {props.rows.length > 0 && (
              <button type="button" className="text-indigo-600" onClick={() => props.onPractice(props.rows.slice(0, 20))}>
                练习这些
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {props.rows.map((word) => (
              <div key={word.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0 dark:border-slate-800">
                <button type="button" onClick={() => props.onPractice([word])} className="min-w-0 flex-1 text-left">
                  <span className="block text-sm">{word.word}</span>
                  <span className="text-xs text-slate-400">{word.translation}</span>
                </button>
                {props.filter === 'mastered' && (
                  <button type="button" className="text-[11px] text-slate-400" onClick={() => props.onRestore(word.id)}>
                    恢复
                  </button>
                )}
              </div>
            ))}
            {props.rows.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-400">空</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function groupArticles(articles: ArticleRow[]): { book: string; articles: ArticleRow[] }[] {
  const order = ['入门', '新概念英语1册', '新概念英语2册', '新概念英语3册', '新概念英语4册'];
  const groups = new Map<string, ArticleRow[]>();
  for (const article of articles) {
    const book = article.book || '入门';
    const list = groups.get(book) ?? [];
    list.push(article);
    groups.set(book, list);
  }
  const rank = (name: string) => {
    const index = order.indexOf(name);
    return index === -1 ? order.length : index;
  };
  return [...groups.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((book) => ({ book, articles: groups.get(book) ?? [] }));
}

function ReadHub({
  articles,
  conceal,
  onConceal,
  onStart,
}: {
  articles: ArticleRow[];
  conceal: boolean;
  onConceal: (value: boolean) => void;
  onStart: (article: ArticleRow) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">短文</h2>
        <Segment
          value={conceal ? 'recall' : 'follow'}
          options={[
            { id: 'follow', label: '跟打' },
            { id: 'recall', label: '默写' },
          ]}
          onChange={(id) => onConceal(id === 'recall')}
        />
      </div>
      {groupArticles(articles).map((group) => (
        <div key={group.book}>
          <div className="mb-1 text-xs text-slate-400">{group.book}</div>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {group.articles.map((article) => (
              <button
                key={article.id}
                type="button"
                onClick={() => onStart(article)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
              >
                <span>
                  <span className="block text-sm">{article.title}</span>
                  <span className="text-[11px] text-slate-400">{[article.titleZh, `${article.sentences.length} 句`].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-xs text-indigo-600">开始</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatsHub({ stats }: { stats: ReturnType<TypingDb['snapshot']> }) {
  const days = lastDays(stats.sessions, 7);
  const max = Math.max(1, ...days.map((day) => day.ms));
  const keys = rankWeakKeys(stats.weakKeys, 8);
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium">记录</h2>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="已掌握" value={String(stats.mastered)} />
        <Stat label="学习中" value={String(stats.learning)} />
        <Stat label="错词" value={String(stats.wrong)} />
      </div>
      <div className="flex h-24 items-end gap-2">
        {days.map((day) => (
          <div key={day.label} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-16 w-full items-end">
              <div className="w-full rounded-sm bg-indigo-500/80" style={{ height: `${Math.max(4, (day.ms / max) * 100)}%` }} />
            </div>
            <span className="text-[10px] text-slate-400">{day.label}</span>
          </div>
        ))}
      </div>
      <div className="text-xs text-slate-500">
        易错键 {keys.length > 0 ? keys.join(' ') : '暂无'}
      </div>
      <div className="text-[11px] text-slate-400">词库 {catalogSize(stats.bookCounts)}</div>
    </div>
  );
}

function Result({
  screen,
  onRetry,
  onHome,
  onNext,
}: {
  screen: Extract<Screen, { kind: 'result' }>;
  onRetry: () => void;
  onHome: () => void;
  onNext: (run: PracticeRun) => void;
}) {
  const round = sessionStats(screen.state, screen.state.endedAt ?? Date.now());
  const complete = finishedAll(screen.state);
  const passed = screen.run.passAccuracy == null ? null : complete && round.accuracy >= screen.run.passAccuracy;
  const misses = Object.entries(screen.state.keyMisses).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const wrongWords = screen.state.wordResults.filter((word) => !word.correct);
  const coming = passed ? nextRun(screen.run) : null;
  const timedComplete = screen.run.timedMs != null && round.durationMs >= screen.run.timedMs;
  const grade = round.accuracy >= .98 ? 'S' : round.accuracy >= .95 ? 'A' : round.accuracy >= .85 ? 'B' : 'C';
  return <div className="tg-result"><div className="tg-result-body">
    <span className="tg-eyebrow">TRAINING REPORT / 训练报告</span>
    <div className="tg-result-title"><div><h1>{passed === true ? '关卡完成' : timedComplete ? '热身完成' : complete ? '训练完成' : '本次训练已结束'}</h1><p>{screen.run.title}</p></div><div className="tg-grade" aria-label={`评级 ${grade}`}>{grade}<small>RANK</small></div></div>
    <div className="tg-result-stats"><Stat label="正确率" value={pct(round.accuracy)}/><Stat label="速度 · WPM" value={wpmText(round.wpm)}/><Stat label="训练时长" value={clock(round.durationMs)}/></div>
    <div className="tg-result-line"><Trophy size={16}/><span>正确敲击 <b>{round.correct}</b></span><span>失误 <b>{round.wrong}</b></span></div>
    {passed === false && <p className="tg-result-note">{complete ? `达到 ${pct(screen.run.passAccuracy ?? 0)} 正确率解锁下一节` : '完成全部练习后解锁下一节'}</p>}
    {misses.length > 0 && <div className="tg-result-note">待加强 {misses.map(([key]) => <kbd key={key}>{key === 'space' ? '空格' : key}</kbd>)}</div>}
    {wrongWords.length > 0 && <WrongWords ids={wrongWords.map(word => word.wordId)}/>}
    <div className="tg-result-actions"><button className="tg-button" onClick={onHome}>返回大厅</button><button className={`tg-button ${coming ? '' : 'tg-primary'}`} onClick={onRetry}><RotateCcw size={15}/>再来一次</button>{coming && <button className="tg-button tg-primary" onClick={() => onNext(coming)}>下一节<ArrowRight size={16}/></button>}</div>
  </div></div>;
}

function WrongWords({ ids }: { ids: number[] }) {
  const [words, setWords] = useState<WordRow[]>([]);
  useEffect(() => {
    let live = true;
    openTypingDb().then((db) => {
      if (live) setWords(db.wordsByIds(ids).slice(0, 6));
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ids]);
  if (words.length === 0) return null;
  return (
    <div className="mt-3 space-y-1 text-left text-xs text-slate-500">
      {words.map((word) => (
        <div key={word.id} className="flex justify-between gap-3">
          <span>{word.word}</span>
          <span className="text-slate-400">{word.translation}</span>
        </div>
      ))}
    </div>
  );
}

function nextRun(run: PracticeRun): PracticeRun | null {
  const source = run.source;
  if (source.type !== 'lesson') return null;
  const index = LESSONS.findIndex((lesson) => lesson.id === source.lessonId);
  if (index < 0) return null;
  const lesson = LESSONS[index];
  if (source.stepIndex + 1 < lesson.steps.length) return lessonRun(lesson, source.stepIndex + 1);
  const next = LESSONS[index + 1];
  return next ? lessonRun(next, 0) : null;
}

function lastDays(sessions: ReturnType<TypingDb['snapshot']>['sessions'], count: number) {
  const days = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const start = date.getTime();
    const rows = sessions.filter((session) => session.startedAt >= start && session.startedAt < start + 86_400_000);
    days.push({
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      ms: rows.reduce((sum, session) => sum + session.durationMs, 0),
    });
  }
  return days;
}

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-md px-2.5 py-1 text-xs ${
            value === option.id
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-500'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FilterButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={on ? 'text-indigo-600' : 'hover:text-slate-800 dark:hover:text-slate-200'}>
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-2 py-2 dark:border-slate-800">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}
