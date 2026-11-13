import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../services/api';

let ownsFullscreen = false;
let pending: Promise<void> | null = null;
export function enterTypingFullscreen(): Promise<void> {
  if (pending) return pending;
  const enter = async () => {
    try {
      if (isTauriEnvironment()) {
        const win = getCurrentWindow();
        if (!await win.isFullscreen()) { await win.setFullscreen(true); ownsFullscreen = true; }
      } else if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        ownsFullscreen = true;
      }
    } catch { /* A browser may require a fresh user gesture. The viewport stays immersive. */ }
  };
  pending = enter().finally(() => { pending = null; });
  return pending;
}
export async function leaveTypingFullscreen() {
  await pending;
  if (!ownsFullscreen) return;
  ownsFullscreen = false;
  try {
    if (isTauriEnvironment()) await getCurrentWindow().setFullscreen(false);
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch { /* The user may have already left fullscreen via the OS. */ }
}
export async function toggleTypingFullscreen() {
  const full = isTauriEnvironment() ? await getCurrentWindow().isFullscreen() : !!document.fullscreenElement;
  if (full) {
    if (isTauriEnvironment()) await getCurrentWindow().setFullscreen(false);
    else await document.exitFullscreen();
    ownsFullscreen = false;
  } else await enterTypingFullscreen();
}
