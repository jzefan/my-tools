/**
 * Safe confirmation dialog wrapper that works seamlessly with Tauri 2 dialog plugin
 * (which polyfills window.confirm as an async function returning a Promise) and fallback environments.
 */
export async function confirmDialog(message: string): Promise<boolean> {
  try {
    const res: unknown = window.confirm(message);
    if (res instanceof Promise || (typeof res === 'object' && res !== null && typeof (res as any).then === 'function')) {
      return await (res as Promise<boolean>);
    }
    return Boolean(res);
  } catch (err) {
    console.error('Confirmation dialog failed:', err);
    return false;
  }
}

/**
 * Safe alert dialog wrapper that works seamlessly with Tauri 2 dialog plugin
 */
export async function alertDialog(message: string): Promise<void> {
  try {
    const res: unknown = window.alert(message);
    if (res instanceof Promise || (typeof res === 'object' && res !== null && typeof (res as any).then === 'function')) {
      await (res as Promise<void>);
    }
  } catch (err) {
    console.error('Alert dialog failed:', err);
  }
}
