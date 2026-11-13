export const SOUND_PROFILES = [
  { id: 'mechanical', name: '青轴', detail: '清脆 · 段落感' },
  { id: 'thock', name: '奶油轴', detail: '低沉 · 饱满' },
  { id: 'soft', name: '静音红轴', detail: '轻柔 · 干净' },
  { id: 'typewriter', name: '打字机', detail: '金属 · 复古' },
  { id: 'arcade', name: '街机', detail: '电子 · 短音' },
] as const;
export type SoundProfile = typeof SOUND_PROFILES[number]['id'];
export interface SoundSettings { profile: SoundProfile; volume: number }
export const DEFAULT_SOUND: SoundSettings = { profile: 'thock', volume: 0.55 };
export function normalizeSound(value: unknown): SoundSettings {
  const input = value && typeof value === 'object' ? value as Partial<SoundSettings> : {};
  return {
    profile: SOUND_PROFILES.some((p) => p.id === input.profile) ? input.profile! : DEFAULT_SOUND.profile,
    volume: typeof input.volume === 'number' && Number.isFinite(input.volume)
      ? Math.min(1, Math.max(0, input.volume)) : DEFAULT_SOUND.volume,
  };
}
