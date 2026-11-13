import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, Check, Maximize, Settings2, Volume2, VolumeX, X } from 'lucide-react';
import { GameScene } from './GameScene';
import { SOUND_PROFILES, type SoundSettings } from '../../typing/preferences';
import { playTick } from '../../typing/sound';
import { toggleTypingFullscreen } from '../../typing/fullscreen';
import './game.css';

const GAME_TABS = [
  { id: 'typing', label: '行动大厅', en: 'LOBBY' },
  { id: 'typing_lesson', label: '指法关卡', en: 'CAMPAIGN' },
  { id: 'typing_words', label: '单词训练', en: 'WORDS' },
  { id: 'typing_read', label: '文章挑战', en: 'READING' },
  { id: 'typing_stats', label: '训练档案', en: 'RECORDS' },
];

interface Props {
  children: ReactNode; tab: string; inRun: boolean; settingsOpen: boolean;
  sound: boolean; settings: SoundSettings; notice: string;
  onTab: (tab: string) => void; onExit?: () => void; onSettings: (open: boolean) => void;
  onRetrySave?: () => void;
  onToggleSound: () => void; onSoundSettings: (settings: SoundSettings) => void;
}
export function GameShell(p: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className={`typing-game ${p.inRun ? 'tg-in-run' : ''} ${p.tab === 'typing' ? 'tg-lobby' : 'tg-section'}`}>
    <GameScene />
    <header className="tg-topbar" inert={p.settingsOpen}>
      <div className="tg-brand"><span className="tg-brand-mark">K</span><span>KEYLINE<small>打字学英语</small></span></div>
      {!p.inRun && <nav aria-label="游戏导航" className="tg-nav">
        {GAME_TABS.map(tab => <button key={tab.id} type="button" aria-current={p.tab === tab.id ? 'page' : undefined} onClick={() => p.onTab(tab.id)}>{tab.label}</button>)}
      </nav>}
      <div className="tg-tools">
        <button type="button" className="tg-icon" aria-label={p.sound ? '静音' : '开启音效'} title={p.sound ? '静音' : '开启音效'} onMouseDown={e => e.preventDefault()} onClick={p.onToggleSound}>{p.sound ? <Volume2/> : <VolumeX/>}</button>
        <button ref={trigger} type="button" className="tg-icon" aria-label="声音设置" title="声音设置" aria-expanded={p.settingsOpen} onClick={() => p.onSettings(!p.settingsOpen)}><Settings2/></button>
        <button type="button" className="tg-icon" aria-label="切换全屏" title="切换全屏" onClick={() => { void toggleTypingFullscreen().catch(() => undefined); }}><Maximize/></button>
        {!p.inRun && p.onExit && <button type="button" className="tg-exit" onClick={p.onExit}><ArrowLeft/>退出</button>}
      </div>
    </header>
    {p.notice && <div className="tg-notice" role="status">{p.notice}{p.onRetrySave && <button onClick={p.onRetrySave}>重试保存</button>}</div>}
    <main className="tg-main" inert={p.settingsOpen}>{p.children}</main>
    {!p.inRun && <footer className="tg-footer"><span><i/> TRAINING SYSTEM ONLINE</span><span>每一次敲击，都更进一步。</span><span>KEYLINE / EN · 01</span></footer>}
    {p.settingsOpen && <SoundPanel sound={p.sound} settings={p.settings} onToggle={p.onToggleSound} onChange={p.onSoundSettings} onClose={() => { p.onSettings(false); trigger.current?.focus(); }}/>}
  </div>;
}

function SoundPanel({ sound, settings, onToggle, onChange, onClose }: {
  sound: boolean; settings: SoundSettings; onToggle: () => void;
  onChange: (settings: SoundSettings) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const el = panel.current;
    el?.querySelector<HTMLButtonElement>('button')?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>('button, input')].filter(item => !item.hasAttribute('disabled'));
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handle, true);
    return () => document.removeEventListener('keydown', handle, true);
  }, []);
  return <div className="tg-panel-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="tg-sound-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="tg-sound-title">
      <header><div><span className="tg-eyebrow">AUDIO / 音效</span><h2 id="tg-sound-title">你的键盘，你的声音。</h2></div><button className="tg-icon" aria-label="关闭设置" onClick={onClose}><X/></button></header>
      <div className="tg-setting-row"><span>按键音效</span><button className="tg-switch" role="switch" aria-label="按键音效" aria-checked={sound} onClick={onToggle}><i/></button></div>
      <div className="tg-sound-options" role="group" aria-label="键盘音色">
        {SOUND_PROFILES.map(p => <button key={p.id} className="tg-sound-option" aria-pressed={settings.profile === p.id} onClick={() => { onChange({ ...settings, profile: p.id }); if (sound) playTick(true, { ...settings, profile: p.id }, 'f'); }}>
          <span><strong>{p.name}</strong><small>{p.detail}</small></span>{p.id === settings.profile ? <Check size={17}/> : <span className="tg-wave">▂ ▅ ▃ ▆ ▂</span>}
        </button>)}
      </div>
      <label className="tg-volume" htmlFor="tg-volume"><span>音量</span><output>{Math.round(settings.volume * 100)}%</output></label>
      <input id="tg-volume" type="range" min="0" max="100" value={Math.round(settings.volume * 100)} onChange={e => onChange({ ...settings, volume: Number(e.target.value) / 100 })}/>
      <button className="tg-button tg-preview" disabled={!sound || settings.volume === 0} onClick={() => playTick(true, settings, 'f')}><Volume2 size={16}/>试听按键</button>
      <p className="tg-panel-note">Esc 返回 · 设置自动保存</p>
    </section>
  </div>;
}
