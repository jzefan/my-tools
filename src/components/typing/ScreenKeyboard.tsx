import { KEY_ROWS, targetForChar } from '../../typing/keyboard';
interface ScreenKeyboardProps { expected: string | null; assist: boolean; pressed?: string }
export function ScreenKeyboard({ expected, assist, pressed = '' }: ScreenKeyboardProps) {
  const target = assist ? targetForChar(expected) : { ids: [], shift: false };
  const active = new Set(target.ids);
  const down = new Set(targetForChar(pressed === 'Enter' ? '\n' : pressed).ids);
  return <div className="tg-keyboard" aria-hidden="true">{KEY_ROWS.map((row, rowIndex) => <div key={rowIndex} className="tg-key-row">{row.map(key => <div key={key.id} style={{ flex: key.w }} className={`tg-key ${active.has(key.id) ? 'is-next' : ''} ${pressed && down.has(key.id) ? 'is-pressed' : ''}`}><span>{target.shift && key.shiftLabel ? key.shiftLabel : key.label}</span>{(key.id === 'f' || key.id === 'j') && <i/>}</div>)}</div>)}</div>;
}
