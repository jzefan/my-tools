import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Star, Volume2, VolumeX } from 'lucide-react';
import { Arcade } from './Arcade';
import { HandGuide } from './HandGuide';
import { ScreenKeyboard } from './ScreenKeyboard';
import {
  advanceItem,
  applyKey,
  currentExpected,
  currentItem,
  finalize,
  penalize,
  sessionStats,
  shouldAssist,
} from '../../typing/engine';
import { clock, displayGlyph, pct, wpmText } from '../../typing/format';
import { fingersForChar } from '../../typing/keyboard';
import { playTick, speak } from '../../typing/sound';
import { loadWordMeta, lookupWordExtra, type WordExtra } from '../../typing/wordMeta';
import type { PlayMode, PracticeItem, PracticeRun, SessionState } from '../../typing/types';

interface PracticeStageProps {
  run: PracticeRun;
  sound: boolean;
  starred: Set<number>;
  mastered: Set<number>;
  onFinish: (state: SessionState, play: PlayMode) => void;
  onToggleSound: () => void;
  onStar: (wordId: number) => void;
  onMaster: (wordId: number) => void;
}

const PLAYS: { id: PlayMode; label: string }[] = [
  { id: 'focus', label: '专注' },
  { id: 'mole', label: '地鼠' },
  { id: 'shooter', label: '射击' },
  { id: 'tower', label: '堆塔' },
];

export function PracticeStage({
  run,
  sound,
  starred,
  mastered,
  onFinish,
  onToggleSound,
  onStar,
  onMaster,
}: PracticeStageProps) {
  const [state, setState] = useState<SessionState>(() => ({
    items: run.items,
    index: 0,
    charIndex: 0,
    phase: run.items.length > 0 ? 'live' : 'done',
    holdToken: 0,
    startedAt: null,
    endedAt: run.items.length > 0 ? null : 0,
    correct: 0,
    wrong: 0,
    combo: 0,
    pendingMisses: 0,
    keyHits: {},
    keyMisses: {},
    itemWrong: run.items.map(() => 0),
    wordResults: [],
  }));
  const [play, setPlay] = useState<PlayMode>('focus');
  const [fx, setFx] = useState({ hit: 0, miss: 0, hitChar: '' });
  const [now, setNow] = useState(() => Date.now());
  const [ime, setIme] = useState(false);
  const stateRef = useRef(state);
  const playRef = useRef(play);
  const soundRef = useRef(sound);
  const onFinishRef = useRef(onFinish);
  const reported = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  stateRef.current = state;
  playRef.current = play;
  soundRef.current = sound;
  onFinishRef.current = onFinish;

  useEffect(() => {
    inputRef.current?.focus();
  }, [play]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state.phase !== 'done' || reported.current) return;
    reported.current = true;
    onFinishRef.current(state, playRef.current);
  }, [state]);

  useEffect(() => {
    if (!run.timedMs || !state.startedAt || state.phase === 'done') return;
    const left = run.timedMs - (Date.now() - state.startedAt);
    const timer = window.setTimeout(() => {
      setState((prev) => {
        const next = finalize(prev, Date.now());
        stateRef.current = next;
        return next;
      });
    }, Math.max(0, left));
    return () => window.clearTimeout(timer);
  }, [run.timedMs, state.startedAt, state.phase]);

  useEffect(() => {
    const item = state.items[state.index];
    if (!item || !run.speakOnShow || state.phase === 'done') return;
    speak(item.speak || item.prompt);
  }, [state.index, run.speakOnShow, state.items]);

  function commit(next: SessionState, kind: string, hitChar: string) {
    stateRef.current = next;
    setState(next);
    if (kind === 'hit' || kind === 'need-advance') {
      if (soundRef.current) playTick(true);
      setFx((prev) => ({ hit: prev.hit + 1, miss: prev.miss, hitChar }));
    }
    if (kind === 'miss') {
      if (soundRef.current) playTick(false);
      setFx((prev) => ({ ...prev, miss: prev.miss + 1 }));
    }
    if (kind === 'need-advance') {
      const token = next.holdToken;
      window.setTimeout(() => {
        if (stateRef.current.holdToken !== token || stateRef.current.phase === 'done') return;
        const advanced = advanceItem(stateRef.current, Date.now());
        stateRef.current = advanced;
        setState(advanced);
      }, 280);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const before = currentExpected(stateRef.current);
    const result = applyKey(stateRef.current, { key: event.key, repeat: event.repeat }, {
      allowBackspace: run.allowBackspace,
      now: Date.now(),
    });
    if (result.kind === 'ignore') return;
    commit(result.state, result.kind, before ?? '');
  }

  function breach() {
    const next = penalize(stateRef.current, Date.now());
    if (next === stateRef.current) return;
    commit(next, 'miss', '');
  }

  const item = currentItem(state);
  const expected = currentExpected(state);
  const assist = shouldAssist(run.assist, state);
  const stats = sessionStats(state, now);
  const total = stats.correct + stats.wrong;
  const progress = item ? (state.index + Math.min(1, state.charIndex / Math.max(1, item.prompt.length))) / state.items.length : 0;
  const remain = run.timedMs == null
    ? null
    : state.startedAt == null
      ? run.timedMs
      : Math.max(0, run.timedMs - (now - state.startedAt));
  const fingers = fingersForChar(assist ? expected : null);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-slate-950"
      onMouseDown={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        aria-label="打字"
        className="fixed top-0 -left-8 h-px w-px opacity-0"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value=""
        onChange={() => undefined}
        onKeyDown={onKeyDown}
        onCompositionStart={() => setIme(true)}
        onCompositionEnd={() => setIme(false)}
      />
      <div className="h-0.5 bg-slate-100 dark:bg-slate-800">
        <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
        <div className="min-w-0 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
          {run.title}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {PLAYS.map((option) => (
              <button
                key={option.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setPlay(option.id)}
                className={`rounded-md px-2 py-1 text-xs ${
                  play === option.id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-500'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs tabular-nums text-slate-500">
            <span>{total > 0 ? wpmText(stats.wpm) : '—'}</span>
            <span>{total > 0 ? pct(stats.accuracy) : '—'}</span>
            {remain != null && <span>{clock(remain)}</span>}
            {remain == null && <span>{state.index + 1}/{state.items.length}</span>}
          </div>
          <button
            type="button"
            title={sound ? '关闭按键声' : '打开按键声'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onToggleSound}
            className="text-slate-400 hover:text-slate-600"
          >
            {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setState((prev) => {
                const next = finalize(prev, Date.now());
                stateRef.current = next;
                return next;
              });
            }}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            结束
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {play === 'focus' && (
          <aside className="hidden w-44 shrink-0 border-r border-slate-200 px-3 py-4 md:block dark:border-slate-800">
            <HandGuide fingers={fingers} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-6 py-3">
          {ime && <div className="mb-2 shrink-0 text-center text-xs text-amber-600">请切换到英文输入</div>}
          <div className={`min-h-0 flex-1 ${play === 'focus' ? 'overflow-y-auto' : 'flex flex-col overflow-hidden'}`}>
            {play === 'focus' || !item ? (
              item && <PracticeBody item={item} state={state} run={run} />
            ) : (
              <>
                {item && <Prompt item={item} state={state} run={run} />}
                <Arcade
                  mode={play}
                  glyph={assist && expected ? displayGlyph(expected) : '?'}
                  hitTick={fx.hit}
                  missTick={fx.miss}
                  hitChar={fx.hitChar}
                  active={state.startedAt != null}
                  onBreach={breach}
                />
              </>
            )}
          </div>
          {item?.wordId != null && (
            <div className="mt-3 flex justify-center gap-2">
              <IconButton
                title="朗读"
                onClick={() => speak(item.speak || item.prompt)}
              >
                <Volume2 className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                title={starred.has(item.wordId) ? '取消收藏' : '收藏'}
                onClick={() => onStar(item.wordId!)}
                active={starred.has(item.wordId)}
              >
                <Star className={`h-3.5 w-3.5 ${starred.has(item.wordId) ? 'fill-current' : ''}`} />
              </IconButton>
              <IconButton
                title={mastered.has(item.wordId) ? '恢复练习' : '已掌握'}
                onClick={() => onMaster(item.wordId!)}
                active={mastered.has(item.wordId)}
              >
                <Check className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          )}
        </div>
      </div>
      <ScreenKeyboard expected={expected} assist={assist} />
    </div>
  );
}

function PracticeBody({ item, state, run }: { item: PracticeItem; state: SessionState; run: PracticeRun }) {
  const showSpelling = item.conceal !== true || state.phase !== 'live';
  const dictation = run.speakOnShow && item.wordId != null && !showSpelling && state.pendingMisses < 3;
  if (dictation) return <div className="flex min-h-full items-center justify-center"><Glyphs item={item} state={state} mono={run.mono} /></div>;
  if (item.wordId != null && showSpelling && run.showExample) {
    return <WordSheet item={item} state={state} />;
  }
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 py-4">
      {item.note && <div className="text-xs tracking-[0.3em] text-slate-400">{item.note}</div>}
      <Glyphs item={item} state={state} mono={run.mono} />
      {item.meaning && (
        <div className="flex max-w-2xl items-start justify-center gap-2 text-center">
          <p className="text-sm leading-6 text-slate-500">{item.meaning}</p>
          {item.speak && (
            <button type="button" title="朗读" onMouseDown={(event) => event.preventDefault()} onClick={() => speak(item.speak || item.prompt)} className="mt-0.5 text-slate-400 hover:text-slate-700">
              <Volume2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function useWordExtra(word: string): WordExtra | null {
  const [map, setMap] = useState<Map<string, WordExtra> | null>(null);
  useEffect(() => {
    let live = true;
    loadWordMeta().then((next) => {
      if (live) setMap(next);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return lookupWordExtra(map, word);
}

function WordSheet({ item, state }: { item: PracticeItem; state: SessionState }) {
  const examples = item.examples ?? [];
  const phrases = item.phrases ?? [];
  const extra = useWordExtra(item.prompt);
  const synos = extra?.synos ?? [];
  const origins = extra?.etymology ?? [];
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-3">
      <button
        type="button"
        title="朗读"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => speak(item.speak || item.prompt)}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
      >
        <span>{item.phonetic || '朗读'}</span>
        <Volume2 className="h-3.5 w-3.5" />
      </button>
      <Glyphs item={item} state={state} mono={false} />
      {item.meaning && <p className="text-center text-sm leading-6 text-slate-600 dark:text-slate-300">{item.meaning}</p>}
      {examples.length > 0 && (
        <div className="w-full space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          {examples.map((example) => (
            <div key={example.en}>
              <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">{markTerm(example.en, item.prompt)}</p>
              {example.zh && <p className="text-xs leading-5 text-slate-400">{example.zh}</p>}
            </div>
          ))}
        </div>
      )}
      {phrases.length > 0 && (
        <div className="w-full space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="text-xs text-slate-400">短语</div>
          {phrases.map((phrase) => (
            <div key={phrase.en} className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
              <span className="text-slate-700 dark:text-slate-200">{markTerm(phrase.en, item.prompt)}</span>
              {phrase.zh && <span className="text-xs leading-5 text-slate-400">{phrase.zh}</span>}
            </div>
          ))}
        </div>
      )}
      {synos.length > 0 && (
        <div className="w-full space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="text-xs text-slate-400">同近义词</div>
          {synos.map((sense) => (
            <div key={`${sense.pos}-${sense.cn}`} className="text-sm leading-6">
              <span className="text-slate-500">{[sense.pos, sense.cn].filter(Boolean).join(' ')}</span>
              {sense.words && <p className="text-slate-700 dark:text-slate-200">{sense.words}</p>}
            </div>
          ))}
        </div>
      )}
      {origins.length > 0 && (
        <div className="w-full space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="text-xs text-slate-400">词源</div>
          {origins.map((origin) => (
            <div key={origin.title || origin.text}>
              {origin.title && <p className="text-sm text-slate-700 dark:text-slate-200">{origin.title}</p>}
              {origin.text && <p className="whitespace-pre-line text-xs leading-5 text-slate-500">{origin.text}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function markTerm(sentence: string, term: string) {
  const needle = term.trim();
  if (!needle) return sentence;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = sentence.split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((part, index) => (
    part.toLowerCase() === needle.toLowerCase()
      ? <span key={index} className="text-indigo-600">{part}</span>
      : <span key={index}>{part}</span>
  ));
}

function Prompt({ item, state, run }: { item: PracticeItem; state: SessionState; run: PracticeRun }) {
  const showSpelling = item.conceal !== true || state.phase !== 'live';
  const dictation = run.speakOnShow && item.wordId != null && !showSpelling && state.pendingMisses < 3;
  if (dictation) return null;
  return (
    <div className="shrink-0 text-center">
      {item.meaning && <div className="text-sm text-slate-600 dark:text-slate-300">{item.meaning}</div>}
      {item.phonetic && showSpelling && <div className="mt-0.5 text-xs text-slate-400">{item.phonetic}</div>}
    </div>
  );
}

function Glyphs({ item, state, mono }: { item: PracticeItem; state: SessionState; mono: boolean }) {
  const chars = [...item.prompt];
  const conceal = item.conceal === true && state.phase === 'live';
  const flow = item.prompt.includes(' ');
  const size = chars.length > 28 ? 'text-xl' : 'text-4xl';
  return (
    <div className={flow
      ? `max-w-2xl text-left text-lg leading-8 ${mono ? 'font-mono text-base' : ''}`
      : `flex flex-wrap justify-center gap-x-px leading-relaxed ${size} ${mono ? 'font-mono text-lg' : 'font-medium'}`}>
      {chars.map((ch, index) => {
        if (ch === '\n') return <span key={`${item.id}-${index}`} className="basis-full block h-3" />;
        const done = index < state.charIndex;
        const current = index === state.charIndex && state.phase === 'live';
        const hidden = conceal && !done;
        const space = ch === ' ';
        if (flow && space) return <span key={`${item.id}-${index}`}> </span>;
        const tone = hidden
          ? 'text-transparent'
          : done
            ? 'text-emerald-600'
            : current && state.pendingMisses > 0
              ? 'text-rose-600'
              : current
                ? 'text-slate-900 underline decoration-indigo-500 decoration-2 underline-offset-4 dark:text-slate-100'
                : 'text-slate-300 dark:text-slate-600';
        return (
          <span key={`${item.id}-${index}`} className={flow ? tone : `px-px ${tone}`}>
            {ch}
          </span>
        );
      })}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`rounded-md border px-2 py-1 ${
        active
          ? 'border-indigo-200 text-indigo-600 dark:border-indigo-800'
          : 'border-slate-200 text-slate-400 hover:text-slate-600 dark:border-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
