import { isDesktopApp } from './appApi.ts';

export const NATIVE_DESKTOP_AUDIO_ID = 'native-desktop-audio';
export const NATIVE_APP_AUDIO_PREFIX = 'native-app-audio:';

export function isNativeDesktopInputId(deviceId?: string): boolean {
  if (!deviceId) return false;
  return deviceId === NATIVE_DESKTOP_AUDIO_ID || deviceId.startsWith(NATIVE_APP_AUDIO_PREFIX);
}

export function parseNativeAppPid(deviceId?: string): number | null {
  if (!deviceId || !deviceId.startsWith(NATIVE_APP_AUDIO_PREFIX)) return null;
  const parsed = Number.parseInt(deviceId.slice(NATIVE_APP_AUDIO_PREFIX.length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface DesktopAudioStatus {
  supported: boolean;
  osBuild: number;
  apoActive: boolean;
  activeStreams: string[];
  reason: string | null;
}

export interface DesktopAudioSession {
  pid: number;
  name: string;
  exePath: string;
  state: 'active' | 'inactive' | string;
}

export interface RawOutputEndpointInfo {
  id: string;
  name: string;
  isDefault: boolean;
  rawSupported: boolean;
  apoRegistered: boolean;
}

export interface ApoSystemStatus {
  dllBundled: boolean;
  dllPath: string | null;
  apoRegisteredAny: boolean;
  apoLoadedInAudiodg: boolean;
  drySuppressionActive: boolean;
  rawOutputActive: boolean;
  selectedEndpointId: string | null;
  endpoints: RawOutputEndpointInfo[];
  note: string;
}

export interface DesktopSourceIsolationStatus {
  enabled: boolean;
  mutedSessions: number;
  skippedSessions: number;
  message: string | null;
}

interface TauriRuntimeCore {
  invoke<T>(command: string, args?: unknown): Promise<T>;
  Channel?: new <T = unknown>(onmessage?: (msg: T) => void) => {
    id: number;
    onmessage: (msg: T) => void;
    toJSON?: () => string;
  };
  transformCallback?: <T = unknown>(cb?: (response: T) => void, once?: boolean) => number;
}

function getTauriCore(): TauriRuntimeCore | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__TAURI__?.core as unknown as TauriRuntimeCore | undefined;
}

export async function getDesktopAudioStatus(): Promise<DesktopAudioStatus> {
  const core = getTauriCore();
  if (!core?.invoke) {
    return {
      supported: false,
      osBuild: 0,
      apoActive: false,
      activeStreams: [],
      reason: 'Desktop Tauri runtime is not active.',
    };
  }
  try {
    return await core.invoke<DesktopAudioStatus>('desktop_audio_status');
  } catch (err) {
    return {
      supported: false,
      osBuild: 0,
      apoActive: false,
      activeStreams: [],
      reason: String(err),
    };
  }
}

export async function listDesktopAudioSessions(): Promise<DesktopAudioSession[]> {
  const core = getTauriCore();
  if (!core?.invoke) return [];
  try {
    return await core.invoke<DesktopAudioSession[]>('list_desktop_audio_sessions');
  } catch {
    return [];
  }
}

export async function startNativeDesktopCapture(
  streamKey: string,
  targetPid: number | null,
  onChunk: (buf: ArrayBuffer) => void
): Promise<boolean> {
  const core = getTauriCore();
  if (!core?.invoke) return false;

  // Prefer global Tauri Channel constructor or @tauri-apps/api fallback
  let channelObj: unknown = null;
  if (typeof core.Channel === 'function') {
    const ch = new core.Channel<ArrayBuffer>();
    ch.onmessage = (buf) => {
      if (buf instanceof ArrayBuffer) {
        onChunk(buf);
      } else if (ArrayBuffer.isView(buf)) {
        const view = buf as ArrayBufferView;
        const copy = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
        onChunk(copy.buffer);
      }
    };
    channelObj = ch;
  } else {
    const { Channel } = await import('@tauri-apps/api/core');
    const ch = new Channel<ArrayBuffer>();
    ch.onmessage = (buf) => {
      if (buf instanceof ArrayBuffer) {
        onChunk(buf);
      }
    };
    channelObj = ch;
  }

  await core.invoke('start_desktop_audio_capture', {
    streamKey,
    targetPid,
    audioChannel: channelObj,
  });
  return true;
}

export async function stopNativeDesktopCapture(streamKey: string): Promise<void> {
  const core = getTauriCore();
  if (!core?.invoke) return;
  try {
    await core.invoke('stop_desktop_audio_capture', { streamKey });
  } catch {
    // ignore cleanup errors
  }
}

export async function stopAllNativeDesktopCaptures(): Promise<void> {
  const core = getTauriCore();
  if (!core?.invoke) return;
  try {
    await core.invoke('stop_all_desktop_audio_captures');
  } catch {
    // ignore
  }
}

export async function setDesktopAudioSourceIsolation(
  enabled: boolean
): Promise<DesktopSourceIsolationStatus | null> {
  const core = getTauriCore();
  if (!core?.invoke) return null;
  return core.invoke<DesktopSourceIsolationStatus>('set_desktop_audio_source_isolation', { enabled });
}

export async function getApoStatus(): Promise<ApoSystemStatus | null> {
  if (!isDesktopApp()) return null;
  const core = getTauriCore();
  if (!core?.invoke) return null;
  try {
    return await core.invoke<ApoSystemStatus>('get_apo_status');
  } catch {
    return null;
  }
}

export async function setApoDrySuppression(
  enabled: boolean,
  endpointId?: string
): Promise<boolean> {
  const core = getTauriCore();
  if (!core?.invoke) return false;
  try {
    return await core.invoke<boolean>('set_apo_dry_suppression', {
      enabled,
      endpointId: endpointId || null,
    });
  } catch {
    return false;
  }
}

export async function installSystemApo(endpointId: string): Promise<string> {
  const core = getTauriCore();
  if (!core?.invoke) {
    throw new Error('Requires Windows desktop app.');
  }
  return core.invoke<string>('install_system_apo', { endpointId });
}

export async function uninstallSystemApo(endpointId: string): Promise<string> {
  const core = getTauriCore();
  if (!core?.invoke) {
    throw new Error('Requires Windows desktop app.');
  }
  return core.invoke<string>('uninstall_system_apo', { endpointId });
}

export async function startRawOutput(endpointId?: string): Promise<boolean> {
  const core = getTauriCore();
  if (!core?.invoke) return false;
  await core.invoke('start_raw_output', { endpointId: endpointId || null });
  return true;
}

export async function pushRawOutputPcm(buffer: ArrayBuffer): Promise<void> {
  const core = getTauriCore();
  if (!core?.invoke) return;
  try {
    await core.invoke('push_raw_output_pcm', buffer);
  } catch {
    // ignore transient drop if render thread stopping
  }
}

export async function stopRawOutput(): Promise<void> {
  const core = getTauriCore();
  if (!core?.invoke) return;
  try {
    await core.invoke('stop_raw_output');
  } catch {
    // ignore
  }
}

export async function openWindowsSoundSettings(
  page: 'apps-volume' | 'sound' = 'apps-volume'
): Promise<boolean> {
  const core = getTauriCore();
  if (!core?.invoke) return false;
  try {
    await core.invoke('open_windows_sound_settings', { page });
    return true;
  } catch {
    return false;
  }
}
