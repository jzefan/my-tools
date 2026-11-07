export function playTick(ok: boolean) {
  const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const audio = getAudio(Ctx);
  if (audio.state === 'suspended') void audio.resume();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = ok ? 680 : 180;
  gain.gain.value = 0.04;
  osc.connect(gain);
  gain.connect(audio.destination);
  const now = audio.currentTime;
  gain.gain.setValueAtTime(0.04, now);
  gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.05);
  osc.start(now);
  osc.stop(now + 0.055);
}

export function speak(text: string) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en-US';
  utter.rate = 0.92;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

let audio: AudioContext | null = null;

function getAudio(Ctx: typeof AudioContext): AudioContext {
  if (!audio) audio = new Ctx();
  return audio;
}
