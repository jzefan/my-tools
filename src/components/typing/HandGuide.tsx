import { FINGER_COLOR, FINGER_LABEL } from '../../typing/keyboard';
import type { FingerId } from '../../typing/types';

interface HandGuideProps {
  fingers: FingerId[];
}

const LEFT = [
  { id: 'lp' as const, x: 28 },
  { id: 'lr' as const, x: 48 },
  { id: 'lm' as const, x: 68 },
  { id: 'li' as const, x: 88 },
];

const RIGHT = [
  { id: 'ri' as const, x: 132 },
  { id: 'rm' as const, x: 152 },
  { id: 'rr' as const, x: 172 },
  { id: 'rp' as const, x: 192 },
];

export function HandGuide({ fingers }: HandGuideProps) {
  const active = new Set(fingers);
  const letter = [...fingers].reverse().find((finger) => finger !== 'th') ?? fingers[0];

  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 220 150" className="w-full max-w-[168px]">
        <ellipse cx="62" cy="108" rx="42" ry="28" className="fill-slate-200 dark:fill-slate-800" />
        <ellipse cx="158" cy="108" rx="42" ry="28" className="fill-slate-200 dark:fill-slate-800" />
        <ellipse cx="96" cy="126" rx="14" ry="10" fill={active.has('th') ? FINGER_COLOR.th : '#cbd5e1'} />
        <ellipse cx="124" cy="126" rx="14" ry="10" fill={active.has('th') ? FINGER_COLOR.th : '#cbd5e1'} />
        {LEFT.map((finger) => (
          <Finger key={finger.id} x={finger.x} id={finger.id} on={active.has(finger.id)} />
        ))}
        {RIGHT.map((finger) => (
          <Finger key={finger.id} x={finger.x} id={finger.id} on={active.has(finger.id)} />
        ))}
      </svg>
      <div className="text-center text-[11px] text-slate-500 dark:text-slate-400">
        {letter ? FINGER_LABEL[letter] : '双手放在基准键'}
      </div>
    </div>
  );
}

function Finger({ x, id, on }: { x: number; id: FingerId; on: boolean }) {
  const height = id === 'lm' || id === 'rm' ? 58 : id === 'li' || id === 'ri' ? 52 : 46;
  return (
    <rect
      x={x - 8}
      y={78 - height}
      width="16"
      height={height}
      rx="8"
      fill={on ? FINGER_COLOR[id] : '#e2e8f0'}
      stroke={on ? FINGER_COLOR[id] : '#cbd5e1'}
    />
  );
}
