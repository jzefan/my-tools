import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playTick } from '../src/typing/sound.ts';
import { SOUND_PROFILES } from '../src/typing/preferences.ts';

test('five sound profiles produce distinct finite samples; silence creates no audio', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const rendered: Float32Array[] = [];
  let contexts = 0;
  let started = 0;
  class Context {
    sampleRate = 44100;
    state = 'running';
    destination = {};
    constructor() { contexts++; }
    createBuffer(_channels: number, length: number) {
      const data = new Float32Array(length);
      rendered.push(data);
      return { getChannelData: () => data };
    }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    createBufferSource() {
      return {
        buffer: null, playbackRate: { value: 1 }, onended: null as (() => void) | null,
        connect() {}, disconnect() {}, start() { started++; this.onended?.(); }, stop() { this.onended?.(); },
      };
    }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: Context } });
  try {
    playTick(true, { profile: 'thock', volume: 0 }, 'f');
    assert.equal(contexts, 0);
    for (const profile of SOUND_PROFILES) playTick(true, { profile: profile.id, volume: .5 }, 'f');
    assert.equal(contexts, 1);
    assert.equal(started, 5);
    assert.equal(rendered.length, 5);
    const signatures = rendered.map(data => Array.from(data.slice(0, 40)).join(','));
    assert.equal(new Set(signatures).size, 5);
    for (const samples of rendered) {
      assert.ok(samples.some(value => Math.abs(value) > .01));
      assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) <= .951));
    }
    playTick(true, { profile: 'thock', volume: .5 }, ' ');
    assert.equal(rendered.length, 5, 'frequent keystrokes reuse the generated samples');
    playTick(false, { profile: 'thock', volume: .5 }, 'x');
    assert.equal(rendered.length, 6, 'errors have their own audible feedback');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
