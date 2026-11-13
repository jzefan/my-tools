import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Pause, Play, Star, Volume2 } from 'lucide-react';
import { Arcade } from './Arcade';
import { HandGuide } from './HandGuide';
import { ScreenKeyboard } from './ScreenKeyboard';
import { advanceItem, applyKey, createSession, currentExpected, currentItem, finalize, penalize, sessionStats, shouldAssist, resumeSession } from '../../typing/engine';
import { clock, displayGlyph, pct, wpmText } from '../../typing/format';
import { fingersForChar } from '../../typing/keyboard';
import { playTick, speak, stopSpeaking } from '../../typing/sound';
import type { SoundSettings } from '../../typing/preferences';
import { loadWordMeta, lookupWordExtra, type WordExtra } from '../../typing/wordMeta';
import type { PlayMode, PracticeItem, PracticeRun, SessionState } from '../../typing/types';

interface PracticeStageProps {
  run: PracticeRun; sound: boolean; soundSettings: SoundSettings; suspended: boolean;
  starred: Set<number>; mastered: Set<number>;
  onFinish: (state: SessionState, play: PlayMode) => void;
  onStar: (wordId: number) => void; onMaster: (wordId: number) => void;
}
const PLAYS: { id: PlayMode; label: string }[] = [
  { id: 'focus', label: '专注' }, { id: 'mole', label: '地鼠' },
  { id: 'shooter', label: '射击' }, { id: 'tower', label: '堆塔' },
];

function isCompositionKey(event: KeyboardEvent) {
  // Some WebViews report the IME confirmation key as 229 after composition has ended.
  return event.isComposing || event.key === 'Process' || event.keyCode === 229;
}

export function PracticeStage({ run, sound, soundSettings, suspended, starred, mastered, onFinish, onStar, onMaster }: PracticeStageProps) {
  const [state, setState] = useState<SessionState>(() => createSession(run.items));
  const [play, setPlay] = useState<PlayMode>('focus');
  const [fx, setFx] = useState({ hit: 0, miss: 0, hitChar: '', pressed: '' });
  const [now, setNow] = useState(() => Date.now());
  const [ime, setIme] = useState(false);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(true);
  const stopped = paused || suspended;
  const stateRef = useRef(state); stateRef.current = state;
  const playRef = useRef(play); playRef.current = play;
  const onFinishRef = useRef(onFinish); onFinishRef.current = onFinish;
  const pauseAt = useRef<number | null>(null);
  const reported = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  function update(next: SessionState) { stateRef.current = next; setState(next); }
  useEffect(() => {
    if (stopped) return;
    inputRef.current?.focus({ preventScroll: true });

    const restoreFocus = () => {
      if (document.hidden) return;
      const active = document.activeElement;
      if (active == null || active === document.body || active === document.documentElement) {
        inputRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('focus', restoreFocus);
    document.addEventListener('visibilitychange', restoreFocus);
    return () => {
      window.removeEventListener('focus', restoreFocus);
      document.removeEventListener('visibilitychange', restoreFocus);
    };
  }, [play, stopped]);
  useEffect(() => {
    if (stopped) { pauseAt.current = Date.now(); stopSpeaking(); }
    else if (pauseAt.current != null) {
      update(resumeSession(stateRef.current, Date.now() - pauseAt.current));
      pauseAt.current = null;
      setNow(Date.now());
    }
  }, [stopped]);
  useEffect(() => {
    if (paused && !suspended) resumeRef.current?.focus();
  }, [paused, suspended]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !suspended && !isCompositionKey(e)) {
        e.preventDefault();
        setPaused(value => !value);
      }
    };
    const away = () => {
      if (stateRef.current.startedAt != null) setPaused(true);
    };
    const visibility = () => { if (document.hidden) away(); };
    document.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', away);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', away); window.clearTimeout(flashTimer.current); stopSpeaking(); };
  }, [suspended]);
  useEffect(() => {
    if (stopped) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [stopped]);
  useEffect(() => {
    if (state.phase !== 'done' || reported.current) return;
    reported.current = true;
    onFinishRef.current(state, playRef.current);
  }, [state]);
  useEffect(() => {
    if (stopped || state.phase !== 'hold') return;
    const timer = window.setTimeout(() => update(advanceItem(stateRef.current, Date.now())), 280);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.holdToken, stopped]);
  useEffect(() => {
    if (stopped || !run.timedMs || state.startedAt == null || state.phase === 'done') return;
    const deadline = state.startedAt + run.timedMs;
    const timer = window.setTimeout(() => update(finalize(stateRef.current, deadline)), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [run.timedMs, state.startedAt, state.phase, stopped]);
  useEffect(() => {
    const item = state.items[state.index];
    if (!stopped && item && run.speakOnShow && state.phase !== 'done') speak(item.speak || item.prompt);
  }, [state.index, run.speakOnShow, state.items, stopped]);

  function commit(next: SessionState, kind: string, hitChar: string, key = '') {
    update(next);
    if (sound) playTick(kind !== 'miss', soundSettings, key);
    if (kind === 'hit' || kind === 'need-advance') setFx(prev => ({ ...prev, hit: prev.hit + 1, hitChar, pressed: key }));
    else if (kind === 'miss') setFx(prev => ({ ...prev, miss: prev.miss + 1, pressed: key }));
    else setFx(prev => ({ ...prev, pressed: key }));
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFx(prev => ({ ...prev, pressed: '' })), 110);
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (stopped || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isCompositionKey(event.nativeEvent)) {
      setIme(true);
      return;
    }
    if (event.key.length !== 1 && event.key !== 'Backspace' && event.key !== 'Enter') return;
    // A source switch can interrupt composition without sending compositionend.
    // The current keyboard event decides whether typing can resume.
    setIme(false);
    event.preventDefault();
    const before = currentExpected(stateRef.current);
    const result = applyKey(stateRef.current, { key: event.key, repeat: event.repeat }, { allowBackspace: run.allowBackspace, now: Date.now() });
    if (result.kind !== 'ignore') commit(result.state, result.kind, before ?? '', event.key);
  }
  function breach() {
    if (stopped) return;
    const next = penalize(stateRef.current, Date.now());
    if (next !== stateRef.current) commit(next, 'miss', '');
  }
  const item = currentItem(state), expected = currentExpected(state);
  const assist = shouldAssist(run.assist, state);
  const stats = sessionStats(state, stopped ? pauseAt.current ?? now : now);
  const total = stats.correct + stats.wrong;
  const progress = item ? (state.index + Math.min(1, state.charIndex / Math.max(1, item.prompt.length))) / state.items.length : 0;
  const remain = run.timedMs == null ? null : Math.max(0, run.timedMs - stats.durationMs);
  const fingers = fingersForChar(assist ? expected : null);

  return <div className="tg-stage" onClick={event => { if (!stopped && !(event.target as HTMLElement).closest('button, input, a, select')) inputRef.current?.focus(); }}>
    <input
      ref={inputRef}
      aria-label="打字"
      className="tg-capture"
      lang="en"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      value=""
      onChange={() => undefined}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setIme(false);
      }}
      onCompositionStart={() => setIme(true)}
      onCompositionEnd={() => setIme(false)}
    />
    <header className="tg-stage-header"><div className="tg-run-title"><span className="tg-eyebrow">TRAINING IN PROGRESS</span><h1>{run.title}</h1></div>
      <div className="tg-play-modes" aria-label="练习玩法">{PLAYS.map(option => <button key={option.id} aria-pressed={play === option.id} onClick={() => { setPlay(option.id); inputRef.current?.focus(); }}>{option.label}</button>)}</div>
      <button className="tg-icon" aria-label="暂停训练" title="暂停 · Esc" onClick={() => setPaused(true)}><Pause/></button>
    </header>
    <div className="tg-hud"><div><span>速度</span><strong>{total > 0 ? wpmText(stats.wpm) : '—'}<small>WPM</small></strong></div><div><span>正确率</span><strong>{total > 0 ? pct(stats.accuracy) : '—'}</strong></div><div className={state.combo >= 10 ? 'tg-combo is-hot' : 'tg-combo'}><span>连续命中</span><strong key={Math.floor(state.combo / 10)}>{state.combo.toString().padStart(2, '0')}<small>COMBO</small></strong></div><div><span>{remain == null ? '进度' : '倒计时'}</span><strong>{remain == null ? `${Math.min(state.index + 1, state.items.length)} / ${state.items.length}` : clock(remain)}</strong></div></div>
    <div className="tg-progress" role="progressbar" aria-label="练习进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ transform: `scaleX(${progress})` }}/></div>
    <div className={`tg-practice-area tg-mode-${play}`}>
      <div className="tg-live-status" role="status">{ime ? '请切换到英文输入法' : !focused && !stopped ? <button onClick={() => inputRef.current?.focus()}>点击此处，继续输入</button> : state.startedAt == null ? '敲下第一个字母，开始训练' : state.phase === 'hold' ? '✓ 完成' : state.pendingMisses > 0 ? '再试一次，节奏还在。' : state.combo >= 10 ? `${state.combo} 连击 · 保持节奏` : '\u00a0'}</div>
      <div className={`tg-target ${state.pendingMisses ? 'tg-target-miss' : ''}`}>
        {play === 'focus' ? item && <PracticeBody item={item} state={state} run={run}/> : <>{item && <div className="tg-arcade-prompt"><Prompt item={item} state={state} run={run}/><Glyphs item={item} state={state} mono={run.mono}/></div>}<Arcade mode={play} glyph={assist && expected ? displayGlyph(expected) : '?'} hitTick={fx.hit} missTick={fx.miss} hitChar={fx.hitChar} active={!stopped && state.startedAt != null && state.phase === 'live'} onBreach={breach}/></>}
      </div>
      {item?.wordId != null && <div className="tg-word-actions"><IconButton title="朗读" onClick={() => { speak(item.speak || item.prompt); inputRef.current?.focus(); }}><Volume2 size={15}/></IconButton><IconButton title={starred.has(item.wordId) ? '取消收藏' : '收藏'} onClick={() => onStar(item.wordId!)} active={starred.has(item.wordId)}><Star size={15} fill={starred.has(item.wordId) ? 'currentColor' : 'none'}/></IconButton><IconButton title={mastered.has(item.wordId) ? '恢复练习' : '已掌握'} onClick={() => onMaster(item.wordId!)} active={mastered.has(item.wordId)}><Check size={15}/></IconButton></div>}
    </div>
    <div className="tg-keyboard-deck"><div className="tg-hand"><HandGuide fingers={fingers}/></div><ScreenKeyboard expected={expected} assist={assist} pressed={fx.pressed}/><div className="tg-key-legend"><span><kbd>Esc</kbd>暂停</span><span><kbd>⇧</kbd>大写</span><span><kbd>↵</kbd>换行</span></div></div>
    {paused && !suspended && <div className="tg-pause-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="tg-pause-title" className="tg-pause" onKeyDown={e => { if (e.key === 'Tab') { const buttons = e.currentTarget.querySelectorAll('button'); if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons[1].focus(); } else if (!e.shiftKey && document.activeElement === buttons[1]) { e.preventDefault(); buttons[0].focus(); } } }}><span className="tg-eyebrow">TAKE A BREATH</span><h2 id="tg-pause-title">训练已暂停</h2><p>进度已保留，准备好就继续。</p><button ref={resumeRef} className="tg-button tg-primary" onClick={() => setPaused(false)}><Play size={16}/>继续训练</button><button className="tg-button" onClick={() => update(finalize(stateRef.current, pauseAt.current ?? Date.now()))}>结束并结算</button></section></div>}
  </div>;
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
          {item.speak && item.wordId == null && (
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
  return <div className={`tg-glyphs ${chars.length > 28 ? 'tg-glyphs-long' : ''} ${mono ? 'tg-glyphs-mono' : ''}`} aria-label={conceal ? '输入单词' : item.prompt}>
    {chars.map((ch, index) => {
      const done = index < state.charIndex, current = index === state.charIndex && state.phase === 'live';
      const hidden = conceal && !done && !(current && state.pendingMisses >= 3);
      const tone = done ? 'is-done' : current && state.pendingMisses > 0 ? 'is-wrong' : current ? 'is-current' : '';
      return <span key={`${item.id}-${index}`} className={`${tone} ${ch === ' ' ? 'is-space' : ''}`} aria-hidden="true">{hidden ? '_' : ch === ' ' ? '\u00a0' : ch === '\n' ? '↵' : ch}{ch === '\n' && <br/>}</span>;
    })}
  </div>;
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
      aria-label={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`tg-icon ${active ? 'is-active' : ''}`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
