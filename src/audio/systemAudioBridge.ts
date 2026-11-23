import { isDesktopApp } from '../utils/appApi.ts';
import {
  NATIVE_DESKTOP_AUDIO_ID,
  isLoopbackInputLabel,
  normalizeDeviceLabel,
} from '../utils/audioNaming.ts';

export type SystemAudioCaptureMethod =
  | 'display-media'
  | 'specialized-interface'
  | 'native-wasapi';

export type DesktopBridgeLoopbackRisk =
  | 'idle'
  | 'safe-tab-isolated'
  | 'safe-separate-output'
  | 'safe-process-excluded'
  | 'unsafe-shared-bus';

export interface SpecializedDesktopInterface {
  deviceId: string;
  label: string;
  groupId: string;
  kind: 'virtual-cable' | 'stereo-mix' | 'voicemeeter' | 'blackhole' | 'native-wasapi' | 'custom';
}

export interface SystemAudioBridgeState {
  active: boolean;
  method: SystemAudioCaptureMethod;
  displaySurface: string | null;
  inputLabel: string | null;
  specializedDeviceId: string | null;
  loopbackRisk: DesktopBridgeLoopbackRisk;
  selfLoopbackBlocked: boolean;
  streamLoopbackBlocked: boolean;
  safetyReason: string | null;
  sampleRate: number | null;
}

export const INITIAL_DESKTOP_BRIDGE_STATE: SystemAudioBridgeState = {
  active: false,
  method: isDesktopApp() ? 'native-wasapi' : 'display-media',
  displaySurface: null,
  inputLabel: null,
  specializedDeviceId: null,
  loopbackRisk: 'idle',
  selfLoopbackBlocked: false,
  streamLoopbackBlocked: false,
  safetyReason: null,
  sampleRate: null,
};

export interface AcquireSystemAudioOptions {
  method: SystemAudioCaptureMethod;
  specializedDeviceId?: string | null;
  specializedLabel?: string | null;
}

export interface AcquiredSystemAudioStream {
  stream: MediaStream;
  method: SystemAudioCaptureMethod;
  displaySurface: string | null;
  suppressLocalAudioPlayback: boolean;
  label: string;
  sampleRate: number | null;
  specializedDeviceId: string | null;
}

export interface LoopbackSafetyEvaluationInput {
  active: boolean;
  method: SystemAudioCaptureMethod;
  displaySurface: string | null;
  suppressLocalAudioPlayback?: boolean;
  specializedDeviceId?: string | null;
  specializedInputLabel?: string | null;
  specializedInputGroupId?: string | null;
  preferredOutputDeviceId?: string;
  preferredOutputLabel?: string;
  preferredOutputGroupId?: string;
  defaultOutputDeviceId?: string;
  defaultOutputGroupId?: string;
  defaultOutputLabel?: string;
  preferredStreamOutputDeviceId?: string;
  preferredStreamOutputLabel?: string;
  preferredStreamOutputGroupId?: string;
  tauriSourceIsolationActive?: boolean;
  tauriRawOutputActive?: boolean;
}

export interface LoopbackSafetyResult {
  loopbackRisk: DesktopBridgeLoopbackRisk;
  selfLoopbackBlocked: boolean;
  streamLoopbackBlocked: boolean;
  safetyReason: string | null;
}

function classifySpecializedInterfaceKind(
  label: string,
  deviceId: string
): SpecializedDesktopInterface['kind'] {
  if (deviceId === NATIVE_DESKTOP_AUDIO_ID) return 'native-wasapi';
  const l = label.toLowerCase();
  if (/voicemeeter/i.test(l)) return 'voicemeeter';
  if (/blackhole|soundflower/i.test(l)) return 'blackhole';
  if (/cable|vb-audio/i.test(l)) return 'virtual-cable';
  if (/stereo\s*mix|what\s*u\s*hear|wave\s*out\s*mix/i.test(l)) return 'stereo-mix';
  return 'custom';
}

/**
 * Discovers OS-level specialized desktop loopback bridges (e.g., VB-Audio Virtual Cable,
 * VoiceMeeter, BlackHole, Stereo Mix, or Windows Tauri WASAPI Process-Exclusion) without
 * polluting regular physical microphone slots.
 */
export async function enumerateSpecializedDesktopInterfaces(): Promise<SpecializedDesktopInterface[]> {
  const results: SpecializedDesktopInterface[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  if (isDesktopApp()) {
    seenIds.add(NATIVE_DESKTOP_AUDIO_ID);
    seenNames.add('native-wasapi');
    results.push({
      deviceId: NATIVE_DESKTOP_AUDIO_ID,
      label: 'Windows WASAPI Process-Exclusion Loopback (All Apps)',
      groupId: 'hkm-native-desktop',
      kind: 'native-wasapi',
    });
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return results;
  }

  try {
    const raw = await navigator.mediaDevices.enumerateDevices();
    for (const dev of raw) {
      if (dev.kind !== 'audioinput') continue;
      if (!dev.deviceId || dev.deviceId === 'default' || dev.deviceId === 'communications') continue;
      const clean = normalizeDeviceLabel(dev.label);
      if (!clean) continue;

      const isSpecialized =
        isLoopbackInputLabel(clean) ||
        /\b(vb-?audio|virtual\s*cable|cable\s*output|voicemeeter|blackhole|soundflower|loopback|dante\s*via|wave\s*link)\b/i.test(
          clean
        );
      if (!isSpecialized) continue;

      if (seenIds.has(dev.deviceId)) continue;
      const key = `${clean.toLowerCase()}::${dev.groupId || ''}`;
      if (seenNames.has(key)) continue;

      seenIds.add(dev.deviceId);
      seenNames.add(key);
      results.push({
        deviceId: dev.deviceId,
        label: clean,
        groupId: dev.groupId || '',
        kind: classifySpecializedInterfaceKind(clean, dev.deviceId),
      });
    }
  } catch (err) {
    console.warn('enumerateSpecializedDesktopInterfaces failed:', err);
  }

  return results;
}

/**
 * Acquires a clean System Audio Input stream using either:
 *  1) Web Audio `getDisplayMedia` with self-browser exclusion & local playback suppression, OR
 *  2) A dedicated specialized virtual audio input interface (e.g. VB-Cable, BlackHole, Stereo Mix).
 */
export async function acquireSystemAudioStream(
  options: AcquireSystemAudioOptions
): Promise<AcquiredSystemAudioStream> {
  if (options.method === 'specialized-interface') {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Web Audio getUserMedia is unavailable in this environment.');
    }
    if (!options.specializedDeviceId || options.specializedDeviceId === NATIVE_DESKTOP_AUDIO_ID) {
      throw new Error('Select a valid specialized desktop loopback interface before starting.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: options.specializedDeviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48000 },
      },
    });

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Selected specialized interface opened without an audio track.');
    }

    const settings = audioTrack.getSettings?.() ?? {};
    const label = normalizeDeviceLabel(audioTrack.label || options.specializedLabel || 'Virtual Audio Bridge');
    return {
      stream,
      method: 'specialized-interface',
      displaySurface: 'virtual-interface',
      suppressLocalAudioPlayback: false,
      label: `Desktop Bridge: ${label}`,
      sampleRate: typeof settings.sampleRate === 'number' ? settings.sampleRate : null,
      specializedDeviceId: options.specializedDeviceId,
    };
  }

  // Primary browser method: Web Audio / Chromium getDisplayMedia desktop & tab audio capture
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(
      'System Audio Capture (getDisplayMedia) is unavailable in this browser context. Use Chrome/Edge/Desktop App or select a Virtual Audio Interface.'
    );
  }

  const constraints: DisplayMediaStreamOptions = {
    video: { width: 1, height: 1, frameRate: 1 },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
    },
    // Anti-loopback flags for Chromium / Edge / Firefox:
    // - selfBrowserSurface: 'exclude' stops HKM from offering/capturing its own console tab
    // - suppressLocalAudioPlayback: true mutes dry tab playback so only HKM DSP plays (zero echo/loop)
    // - systemAudio: 'include' exposes "Share system audio" when capturing a screen
    ...({
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      suppressLocalAudioPlayback: true,
    } as Record<string, unknown>),
  };

  const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(
      'No system or tab audio track was shared. Re-click Start and enable "Share system audio" or "Also share tab audio" in the picker.'
    );
  }

  // Video track is only requested because getDisplayMedia requires video alongside audio
  stream.getVideoTracks().forEach((vt) => {
    vt.enabled = false;
  });

  const audioTrack = audioTracks[0];
  const videoTrack = stream.getVideoTracks()[0];
  const audioSettings = (audioTrack.getSettings?.() ?? {}) as Record<string, unknown>;
  const videoSettings = (videoTrack?.getSettings?.() ?? {}) as Record<string, unknown>;

  const displaySurface =
    typeof videoSettings.displaySurface === 'string'
      ? videoSettings.displaySurface
      : typeof audioSettings.displaySurface === 'string'
        ? audioSettings.displaySurface
        : null;

  const suppressLocalAudioPlayback =
    typeof audioSettings.suppressLocalAudioPlayback === 'boolean'
      ? audioSettings.suppressLocalAudioPlayback
      : displaySurface === 'browser';

  const cleanLabel = normalizeDeviceLabel(audioTrack.label);
  const labelPrefix =
    displaySurface === 'browser'
      ? 'Desktop Bridge (Tab Isolated)'
      : 'Desktop Bridge (System Audio)';

  return {
    stream,
    method: 'display-media',
    displaySurface,
    suppressLocalAudioPlayback,
    label: cleanLabel ? `${labelPrefix}: ${cleanLabel}` : labelPrefix,
    sampleRate: typeof audioSettings.sampleRate === 'number' ? audioSettings.sampleRate : null,
    specializedDeviceId: null,
  };
}

function outputMatchesVirtualFamily(inputLabel: string, outputLabel: string): boolean {
  const inL = inputLabel.toLowerCase();
  const outL = outputLabel.toLowerCase();
  if (!inL || !outL) return false;
  if (inL.includes('cable') && outL.includes('cable')) return true;
  if (inL.includes('voicemeeter') && outL.includes('voicemeeter')) {
    if (inL.includes('aux') && outL.includes('aux')) return true;
    if (inL.includes('vaio3') && outL.includes('vaio3')) return true;
    if (!inL.includes('aux') && !outL.includes('aux')) return true;
  }
  if (inL.includes('blackhole') && outL.includes('blackhole')) return true;
  if (inL.includes('soundflower') && outL.includes('soundflower')) return true;
  if (/stereo\s*mix|what\s*u\s*hear|wave\s*out\s*mix/i.test(inL)) {
    // Stereo Mix / What U Hear captures the motherboard analog render mix directly
    if (/realtek|speaker|high definition|default/i.test(outL)) return true;
  }
  return false;
}

/**
 * Computes whether routing console monitor (`MON`) or dedicated stream bus (`streamOutputGain`)
 * creates a closed digital self-loopback into the Desktop Audio capture stream — EVEN WHEN ALL MICS ARE OFF.
 */
export function evaluateDesktopLoopbackSafety(
  input: LoopbackSafetyEvaluationInput
): LoopbackSafetyResult {
  if (!input.active) {
    return {
      loopbackRisk: 'idle',
      selfLoopbackBlocked: false,
      streamLoopbackBlocked: false,
      safetyReason: null,
    };
  }

  const outId = (input.preferredOutputDeviceId || '').trim();
  const outLabel = normalizeDeviceLabel(input.preferredOutputLabel || '');
  const outGroup = (input.preferredOutputGroupId || '').trim();
  const defOutId = (input.defaultOutputDeviceId || '').trim();
  const defOutGroup = (input.defaultOutputGroupId || '').trim();
  const defOutLabel = normalizeDeviceLabel(input.defaultOutputLabel || '');

  const streamId = (input.preferredStreamOutputDeviceId || '').trim();
  const streamLabel = normalizeDeviceLabel(input.preferredStreamOutputLabel || '');
  const streamGroup = (input.preferredStreamOutputGroupId || '').trim();

  // Check whether HKM's Master PA output points to a physically distinct output from OS Default
  const isMonitorUsingDefaultEndpoint =
    !outId ||
    outId === 'default' ||
    outId === 'communications' ||
    (Boolean(defOutId) && outId === defOutId) ||
    (Boolean(outGroup && defOutGroup) && outGroup === defOutGroup) ||
    (Boolean(outLabel && defOutLabel) && outLabel.toLowerCase() === defOutLabel.toLowerCase());

  const isStreamUsingDefaultEndpoint =
    Boolean(streamId) &&
    (streamId === 'default' ||
      streamId === 'communications' ||
      (Boolean(defOutId) && streamId === defOutId) ||
      (Boolean(streamGroup && defOutGroup) && streamGroup === defOutGroup));

  if (input.method === 'native-wasapi') {
    // Windows 11 WASAPI Process-Exclusion skips HKM's entire process tree at kernel mixer level,
    // so HKM output never re-enters HKM capture. Only block if routed explicitly back into a loopback cable.
    const virtualLoop =
      Boolean(input.specializedInputLabel && outLabel) &&
      outputMatchesVirtualFamily(input.specializedInputLabel!, outLabel);

    if (virtualLoop) {
      return {
        loopbackRisk: 'unsafe-shared-bus',
        selfLoopbackBlocked: true,
        streamLoopbackBlocked: false,
        safetyReason: `Monitor output "${outLabel}" feeds back into the virtual capture bus. Choose physical speakers/headphones for MON.`,
      };
    }

    return {
      loopbackRisk: 'safe-process-excluded',
      selfLoopbackBlocked: false,
      streamLoopbackBlocked: false,
      safetyReason: input.tauriRawOutputActive
        ? 'MFX APO Single-Speaker Zero-Doubling active (process tree excluded from loopback).'
        : input.tauriSourceIsolationActive
          ? 'WASAPI Process-Exclusion + Source Isolation active (HKM excluded from capture).'
          : 'WASAPI Process-Exclusion active (HKM own audio excluded from loopback).',
    };
  }

  if (input.method === 'display-media') {
    // Browser single-tab share with selfBrowserSurface: 'exclude' & suppressLocalAudioPlayback
    // never captures HKM's own AudioContext output tab, so MON is 100% loopback-safe.
    if (input.displaySurface === 'browser') {
      return {
        loopbackRisk: 'safe-tab-isolated',
        selfLoopbackBlocked: false,
        streamLoopbackBlocked: false,
        safetyReason: input.suppressLocalAudioPlayback
          ? 'Browser Tab Audio isolated (dry tab playback suppressed · zero self-loopback).'
          : 'Browser Tab Audio isolated via selfBrowserSurface exclusion (zero self-loopback).',
      };
    }

    // Whole-system (`monitor`) or `window` capture in browser captures the OS default render mix,
    // INCLUDING HKM's own ctx.destination if HKM plays to the same OS default speaker!
    const streamFeedsCapturedDefault =
      isStreamUsingDefaultEndpoint || /stereo\s*mix|cable\s*in/i.test(streamLabel);

    if (isMonitorUsingDefaultEndpoint) {
      return {
        loopbackRisk: 'unsafe-shared-bus',
        selfLoopbackBlocked: true,
        streamLoopbackBlocked: streamFeedsCapturedDefault,
        safetyReason:
          'Self-Loopback Firewall active (mics off): System/Screen capture records the default OS speaker, which includes this browser tab. Route MON to Headphones / USB Out or share a single Browser Tab instead.',
      };
    }

    return {
      loopbackRisk: 'safe-separate-output',
      selfLoopbackBlocked: false,
      streamLoopbackBlocked: streamFeedsCapturedDefault,
      safetyReason: `Isolated output active (${outLabel || 'Secondary Interface'}) — physically separated from OS default speaker capture.`,
    };
  }

  // method === 'specialized-interface' (VB-Cable, VoiceMeeter, BlackHole, Stereo Mix)
  const inLabel = normalizeDeviceLabel(input.specializedInputLabel || '');
  const inGroup = (input.specializedInputGroupId || '').trim();
  const isStereoMix = /stereo\s*mix|what\s*u\s*hear|wave\s*out\s*mix/i.test(inLabel);

  const monMirrorsSpecialized =
    outputMatchesVirtualFamily(inLabel, outLabel || defOutLabel) ||
    (Boolean(inGroup && (outGroup || defOutGroup)) && inGroup === (outGroup || defOutGroup)) ||
    (isStereoMix && isMonitorUsingDefaultEndpoint);

  const streamMirrorsSpecialized =
    Boolean(streamId) &&
    (outputMatchesVirtualFamily(inLabel, streamLabel || defOutLabel) ||
      (Boolean(inGroup && streamGroup) && inGroup === streamGroup) ||
      (isStereoMix && isStreamUsingDefaultEndpoint));

  if (monMirrorsSpecialized) {
    return {
      loopbackRisk: 'unsafe-shared-bus',
      selfLoopbackBlocked: true,
      streamLoopbackBlocked: streamMirrorsSpecialized,
      safetyReason: `Self-Loopback Firewall active: Output "${outLabel || 'Default Speaker'}" feeds directly back into "${inLabel}". Select a separate physical headphone/speaker output for MON.`,
    };
  }

  return {
    loopbackRisk: 'safe-separate-output',
    selfLoopbackBlocked: false,
    streamLoopbackBlocked: streamMirrorsSpecialized,
    safetyReason: `Specialized bridge "${inLabel}" isolated from Master PA output "${outLabel || 'Physical Speakers'}".`,
  };
}
