import { isDesktopApp } from './appApi.ts';

/** Returns a real OS-wide CPU reading on Windows desktop, or null if unavailable. */
export async function getSystemCpuPercent(): Promise<number | null> {
  if (!isDesktopApp()) return null;

  try {
    const value = await window.__TAURI__?.core?.invoke<number | null>('system_cpu_usage');
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : null;
  } catch {
    return null;
  }
}
