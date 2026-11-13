import { DEFAULT_SOUND, type SoundProfile, type SoundSettings } from './preferences.ts';

let audio: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
const voices = new Set<AudioBufferSourceNode>();

/** Short, pre-rendered switch samples: no downloads, no oscillator buildup per keystroke. */
export function playTick(ok: boolean, settings: SoundSettings = DEFAULT_SOUND, key = '') {
  if (settings.volume <= 0 || typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audio || audio.state === 'closed') { audio = new Ctx(); buffers.clear(); }
    if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
    const id = `${settings.profile}:${ok}`;
    let buffer = buffers.get(id);
    if (!buffer) { buffer = switchBuffer(audio, settings.profile, ok); buffers.set(id, buffer); }
    if (voices.size >= 24) voices.values().next().value?.stop();
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = buffer;
    source.playbackRate.value = key === ' ' || key === 'Backspace' ? 0.8 : 0.97 + ((key.charCodeAt(0) || 0) % 7) * 0.01;
    gain.gain.value = settings.volume * 0.38;
    source.connect(gain);
    gain.connect(audio.destination);
    voices.add(source);
    source.onended = () => { voices.delete(source); source.disconnect(); gain.disconnect(); };
    source.start();
  } catch { /* Audio is optional; unsupported devices must still accept keystrokes. */ }
}

function switchBuffer(ctx: AudioContext, profile: SoundProfile, ok: boolean): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * (profile === 'typewriter' ? 0.16 : 0.11));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 137, low = 0;
  for (let i = 0; i < length; i++) {
    const t = i / ctx.sampleRate;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 4294967296) * 2 - 1;
    low += 0.16 * (noise - low);
    const click = noise * Math.exp(-t * 600);
    const body = Math.sin(2 * Math.PI * (ok ? 170 : 100) * t) * Math.exp(-t * 65);
    let sample: number;
    switch (profile) {
      case 'mechanical': sample = click * 0.65 + noise * Math.exp(-t * 160) * 0.3 + body * 0.22; break;
      case 'thock': sample = low * Math.exp(-t * 85) * 1.4 + body * 0.6 + click * 0.15; break;
      case 'soft': sample = low * Math.exp(-t * 170) * 0.85 + body * 0.18; break;
      case 'typewriter': sample = click * 0.7 + noise * Math.exp(-t * 75) * 0.24 + Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 45) * 0.14; break;
      case 'arcade': sample = Math.sin(2 * Math.PI * (ok ? 640 : 160) * t + 9 * (1 - Math.exp(-t * 30))) * Math.exp(-t * 55) * 0.55; break;
    }
    if (!ok && profile !== 'arcade') sample += Math.sin(2 * Math.PI * 95 * t) * Math.exp(-t * 35) * 0.23;
    data[i] = Math.max(-0.95, Math.min(0.95, sample));
  }
  return buffer;
}

export function stopSpeaking() { if (typeof window !== 'undefined') window.speechSynthesis?.cancel(); }
export function speak(text: string) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en-US';
  utter.rate = 0.92;
  stopSpeaking();
  window.speechSynthesis.speak(utter);
}
