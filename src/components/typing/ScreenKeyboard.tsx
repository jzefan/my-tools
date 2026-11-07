import { FINGER_COLOR, KEY_ROWS, targetForChar } from '../../typing/keyboard';

interface ScreenKeyboardProps {
  expected: string | null;
  assist: boolean;
}

export function ScreenKeyboard({ expected, assist }: ScreenKeyboardProps) {
  const target = assist ? targetForChar(expected) : { ids: [], shift: false, finger: null };
  const active = new Set(target.ids);

  return (
    <div className="shrink-0 px-3 pb-2 pt-1 select-none" aria-hidden>
      <div className="mx-auto flex max-w-5xl flex-col gap-1">
        {KEY_ROWS.map((row, rowIndex) => (
          <div key={rowIndex} className="flex justify-center gap-1">
            {row.map((key) => {
              const on = active.has(key.id);
              const color = key.finger ? FINGER_COLOR[key.finger] : '#64748b';
              const home = key.id === 'f' || key.id === 'j';
              return (
                <div
                  key={key.id}
                  style={{
                    flex: key.w,
                    background: on ? color : undefined,
                    color: on ? '#fff' : undefined,
                    boxShadow: on ? `inset 0 -2px 0 rgba(0,0,0,0.18)` : undefined,
                  }}
                  className={`relative flex h-8 min-w-0 items-center justify-center rounded-md border text-[11px] font-medium ${
                    on
                      ? 'border-transparent'
                      : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  <span className="truncate px-1">
                    {target.shift && key.shiftLabel ? key.shiftLabel : key.label}
                  </span>
                  {home && (
                    <span
                      className={`absolute bottom-1 h-0.5 w-3 rounded-full ${on ? 'bg-white/80' : 'bg-slate-300 dark:bg-slate-600'}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
