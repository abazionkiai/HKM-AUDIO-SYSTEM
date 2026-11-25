import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuditAuthority,
  DetectedHardwareEndpoint,
  DriverBackend,
  HardwareDevice,
  PlatformTarget,
} from '../types/audio.ts';
import {
  buildEndpointSignature,
  clearCachedHardwareEndpoints,
  loadCachedHardwareEndpoints,
  saveDetectedHardwareEndpoints,
} from '../utils/hardwareCacheDb.ts';
import { scanBrowserMediaDevices } from '../utils/hardwareRecognition.ts';
import {
  enumerateAudioInputs,
  enumerateAudioOutputs,
  liveAudioEngine,
  subscribeHardwareChanges,
} from '../audio/liveAudioEngine.ts';
import {
  enumerateSpecializedDesktopInterfaces,
  type SpecializedDesktopInterface,
} from '../audio/systemAudioBridge.ts';
import { appFetch, isDesktopApp } from '../utils/appApi.ts';
import {
  NATIVE_DESKTOP_AUDIO_ID,
  getApoStatus,
  getDesktopAudioStatus,
  installSystemApo,
  listDesktopAudioSessions,
  setApoDrySuppression,
  uninstallSystemApo,
  type ApoSystemStatus,
  type DesktopAudioSession,
  type DesktopAudioStatus,
} from '../utils/nativeDesktopAudio.ts';

interface UseHardwareManagerProps {
  activeDevice: HardwareDevice;
  platform: PlatformTarget;
  devices: HardwareDevice[];
  onRegisterDevices: (devices: HardwareDevice[]) => void;
  onSelectDevice: (device: HardwareDevice, overrideDriver?: DriverBackend) => Promise<void>;
  logAudit: (action: string, detail: string, authority?: AuditAuthority) => void;
  hydrated?: boolean;
  onSyncLiveInputsToChannels?: (liveInputs: MediaDeviceInfo[], isStartupSync: boolean) => void;
}

function buildDeviceListSignature(devs: MediaDeviceInfo[]): string {
  return devs
    .map((d) => `${d.deviceId || ''}::${d.label || ''}`)
    .sort()
    .join('|');
}

function migrateLegacyOutputStorage(): { outputId: string; streamOutputId: string } {
  try {
    const cleanedFlag = window.localStorage.getItem('church_audio_v0228_io_clean');
    const rawOut = window.localStorage.getItem('church_audio_output_device_id') || '';
    const cleanOut = rawOut.split('::')[0];
    if (rawOut !== cleanOut) {
      window.localStorage.setItem('church_audio_output_device_id', cleanOut);
    }

    let streamOut = window.localStorage.getItem('church_audio_stream_output_device_id') || '';
    if (!cleanedFlag) {
      // One-time cleanup: clear prior auto-hijacked VB-Audio stream output to eliminate default loopback
      window.localStorage.removeItem('church_audio_stream_output_device_id');
      window.localStorage.setItem('church_audio_v0228_io_clean', '1');
      streamOut = '';
    } else if (streamOut.includes('::')) {
      streamOut = streamOut.split('::')[0];
      window.localStorage.setItem('church_audio_stream_output_device_id', streamOut);
    }
    return { outputId: cleanOut, streamOutputId: streamOut };
  } catch {
    return { outputId: '', streamOutputId: '' };
  }
}

export function useHardwareManager({
  activeDevice,
  platform,
  devices,
  onRegisterDevices,
  onSelectDevice,
  logAudit,
  hydrated = false,
  onSyncLiveInputsToChannels,
}: UseHardwareManagerProps) {
  const [detectedEndpoints, setDetectedEndpoints] = useState<DetectedHardwareEndpoint[]>([]);
  const [scanningHardware, setScanningHardware] = useState(false);
  const [hotPlugEndpoint, setHotPlugEndpoint] = useState<DetectedHardwareEndpoint | null>(null);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [specializedDesktopInputs, setSpecializedDesktopInputs] = useState<SpecializedDesktopInterface[]>([]);
  const [outputRouteError, setOutputRouteError] = useState<string | null>(null);

  const [{ outputId: initOutId, streamOutputId: initStreamId }] = useState(() =>
    migrateLegacyOutputStorage()
  );
  const [preferredOutputDeviceId, setPreferredOutputDeviceId] = useState<string>(initOutId);
  const [preferredStreamOutputDeviceId, setPreferredStreamOutputDeviceId] =
    useState<string>(initStreamId);
  const [desktopAudioStatus, setDesktopAudioStatus] = useState<DesktopAudioStatus | null>(null);
  const [desktopAudioSessions, setDesktopAudioSessions] = useState<DesktopAudioSession[]>([]);
  const [apoStatus, setApoStatus] = useState<ApoSystemStatus | null>(null);
  const [singleSpeakerMode, setSingleSpeakerMode] = useState<boolean>(false);
  const [apoBusy, setApoBusy] = useState<boolean>(false);
  const [apoMessage, setApoMessage] = useState<{
    tone: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const desktopSupportedRef = useRef<boolean | null>(null);
  const activeOnBusSignaturesRef = useRef<Set<string>>(new Set());
  const cachedSynthDevicesRef = useRef<HardwareDevice[]>([]);
  const startupSyncedRef = useRef<boolean>(false);
  const scanInFlightRef = useRef<boolean>(false);
  const lastInputSigRef = useRef<string>('');
  const lastOutputSigRef = useRef<string>('');
  const lastSpecializedSigRef = useRef<string>('');
  const onSyncLiveInputsRef = useRef(onSyncLiveInputsToChannels);
  onSyncLiveInputsRef.current = onSyncLiveInputsToChannels;
  const latestRef = useRef({
    activeDevice,
    platform,
    devices,
    onRegisterDevices,
    onSelectDevice,
    logAudit,
  });
  latestRef.current = {
    activeDevice,
    platform,
    devices,
    onRegisterDevices,
    onSelectDevice,
    logAudit,
  };

  // Apply persisted standalone stereo output device selection without enabling loopback
  useEffect(() => {
    if (preferredOutputDeviceId) {
      void liveAudioEngine.setOutputDevice(preferredOutputDeviceId).then((applied) => {
        setOutputRouteError(
          applied
            ? null
            : 'The selected output is not active. Audio is still routed to the previous output.'
        );
      });
    }
  }, [preferredOutputDeviceId]);

  useEffect(() => {
    liveAudioEngine.setOnOutputFallback((staleId, reason) => {
      setPreferredOutputDeviceId('');
      setOutputRouteError(null);
      try {
        window.localStorage.setItem('church_audio_output_device_id', '');
      } catch {
        // ignore storage error
      }
      latestRef.current.logAudit('Recovered Audio Output Routing', `${reason} (Cleared stale ID: ${staleId})`, 'system');
    });
    return () => liveAudioEngine.setOnOutputFallback(null);
  }, []);

  const handleSelectOutputDevice = useCallback(
    async (deviceId: string) => {
      const cleanId = (deviceId || '').split('::')[0];
      setPreferredOutputDeviceId(cleanId);
      try {
        window.localStorage.setItem('church_audio_output_device_id', cleanId);
      } catch {
        // ignore storage error
      }
      const applied = await liveAudioEngine.setOutputDevice(cleanId);
      setOutputRouteError(
        applied
          ? null
          : 'The selected output is not active. Audio is still routed to the previous output.'
      );
      logAudit(
        applied ? 'Audio Output Changed' : 'Audio Output Change Failed',
        applied
          ? cleanId
            ? `Standalone Stereo PA Output: ${cleanId}`
            : 'System Default Stereo Output'
          : `Could not apply output device ${cleanId || '(system default)'}.`,
        'operator'
      );
      return applied;
    },
    [logAudit]
  );

  const handleSelectStreamOutputDevice = useCallback(
    async (deviceId: string) => {
      const cleanId = (deviceId || '').split('::')[0];
      setPreferredStreamOutputDeviceId(cleanId);
      try {
        if (cleanId) {
          window.localStorage.setItem('church_audio_stream_output_device_id', cleanId);
        } else {
          window.localStorage.removeItem('church_audio_stream_output_device_id');
        }
      } catch {
        // ignore storage error
      }
      await liveAudioEngine.setStreamOutputDevice(cleanId);
      logAudit(
        'Dedicated Stream Output Changed',
        cleanId ? `Dedicated stream sink enabled: ${cleanId}` : 'Dedicated stream sink disabled',
        'operator'
      );
    },
    [logAudit]
  );

  const refreshDesktopAudioInfo = useCallback(async () => {
    if (!isDesktopApp()) return null;
    const [status, sessions, apo] = await Promise.all([
      getDesktopAudioStatus(),
      listDesktopAudioSessions(),
      getApoStatus(),
    ]);
    desktopSupportedRef.current = status.supported;
    setDesktopAudioStatus(status);
    setDesktopAudioSessions(sessions);
    setApoStatus(apo);
    return { status, sessions, apo };
  }, []);

  const handleToggleSingleSpeakerMode = useCallback(
    async (enabled: boolean, endpointId?: string) => {
      if (!isDesktopApp()) return;
      if (!enabled) {
        setSingleSpeakerMode(false);
        await setApoDrySuppression(false, endpointId);
        await liveAudioEngine.setRawOutputEnabled(false);
        await refreshDesktopAudioInfo();
        setApoMessage({
          tone: 'info',
          text: 'Single-Speaker APO suppression disabled; reverted to standard Engine 1 WASAPI loopback.',
        });
        logAudit(
          'Disabled Single-Speaker APO Mode',
          'APO reverted to 100% passthrough; Engine 1 process loopback active.',
          'operator'
        );
        return;
      }

      const freshApo = await getApoStatus();
      setApoStatus(freshApo);
      if (!freshApo?.apoLoadedInAudiodg) {
        setSingleSpeakerMode(false);
        await setApoDrySuppression(false);
        await liveAudioEngine.setRawOutputEnabled(false);
        setApoMessage({
          tone: 'info',
          text: freshApo?.apoRegisteredAny
            ? 'APO hook is registered, but audiodg.exe has not loaded hkm_audio_apo.dll yet (Windows 11 Protected Audio requires Authenticode/EV trust). Engine 1 remains active seamlessly.'
            : 'Install the APO onto a speaker first (or continue using zero-driver Engine 1 WASAPI loopback).',
        });
        return;
      }

      const targetId = endpointId || freshApo.selectedEndpointId || undefined;
      await setApoDrySuppression(true, targetId);
      const rawOk = await liveAudioEngine.setRawOutputEnabled(true, targetId);
      setSingleSpeakerMode(rawOk);
      if (!rawOk) {
        await setApoDrySuppression(false);
      }
      await refreshDesktopAudioInfo();
      setApoMessage({
        tone: rawOk ? 'success' : 'error',
        text: rawOk
          ? 'Single-Speaker Zero-Doubling active (MFX APO dry suppression + WASAPI RAW output).'
          : 'Could not open WASAPI RAW output stream on selected speaker; staying on Engine 1 loopback.',
      });
      logAudit(
        rawOk ? 'Enabled Single-Speaker APO Mode' : 'Single-Speaker RAW Output Unavailable',
        rawOk
          ? 'APO dry suppression + WASAPI RAW output enabled.'
          : 'Fell back cleanly to Engine 1 process-exclusion loopback.',
        'operator'
      );
    },
    [logAudit, refreshDesktopAudioInfo]
  );

  const handleInstallApo = useCallback(
    async (endpointId: string) => {
      if (!isDesktopApp()) return;
      setApoBusy(true);
      setApoMessage(null);
      try {
        const msg = await installSystemApo(endpointId);
        await refreshDesktopAudioInfo();
        setApoMessage({ tone: 'success', text: msg });
        logAudit('Installed Desktop APO Hook', msg, 'operator');
      } catch (err) {
        setApoMessage({ tone: 'error', text: String(err) });
      } finally {
        setApoBusy(false);
      }
    },
    [logAudit, refreshDesktopAudioInfo]
  );

  const handleUninstallApo = useCallback(
    async (endpointId: string) => {
      if (!isDesktopApp()) return;
      setApoBusy(true);
      setApoMessage(null);
      try {
        setSingleSpeakerMode(false);
        await liveAudioEngine.setRawOutputEnabled(false);
        const msg = await uninstallSystemApo(endpointId);
        await refreshDesktopAudioInfo();
        setApoMessage({ tone: 'info', text: msg });
        logAudit('Uninstalled Desktop APO Hook', msg, 'operator');
      } catch (err) {
        setApoMessage({ tone: 'error', text: String(err) });
      } finally {
        setApoBusy(false);
      }
    },
    [logAudit, refreshDesktopAudioInfo]
  );

  const enumerateCleanPorts = useCallback(
    async (requestPermission = false, refreshNativeInfo = false) => {
      if (
        requestPermission &&
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices?.getUserMedia
      ) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          tempStream.getTracks().forEach((t) => t.stop());
        } catch {
          // Proceed even if permission prompt dismissed or no microphone exists
        }
      }
      const [inputs, outputs, specialized] = await Promise.all([
        enumerateAudioInputs(),
        enumerateAudioOutputs(),
        enumerateSpecializedDesktopInterfaces(),
      ]);

      liveAudioEngine.updateOutputDeviceMetadata(outputs);
      const specSig = specialized.map((s) => `${s.deviceId}::${s.label}`).join('|');
      if (specSig !== lastSpecializedSigRef.current) {
        lastSpecializedSigRef.current = specSig;
        setSpecializedDesktopInputs(specialized);
      }

      if (isDesktopApp() && refreshNativeInfo) {
        void refreshDesktopAudioInfo();
      }

      return { inputs, outputs };
    },
    [refreshDesktopAudioInfo]
  );

  const refreshAudioDevices = useCallback(
    async (
      requestPermission = true,
      mode: 'slot-new' | 'reset-from-ch1' = 'slot-new'
    ) => {
      const { inputs, outputs } = await enumerateCleanPorts(requestPermission, true);
      lastInputSigRef.current = buildDeviceListSignature(inputs);
      lastOutputSigRef.current = buildDeviceListSignature(outputs);
      setInputDevices(inputs);
      setOutputDevices(outputs);
      onSyncLiveInputsRef.current?.(inputs, mode === 'reset-from-ch1');
      return { inputs, outputs };
    },
    [enumerateCleanPorts]
  );

  // 1. Wait for persisted session hydration, then occupy CH1..CHN 1-to-1 with all startup live inputs
  useEffect(() => {
    if (!hydrated || startupSyncedRef.current) return;
    startupSyncedRef.current = true;
    let cancelled = false;

    const runStartupDiscovery = async () => {
      let { inputs, outputs } = await enumerateCleanPorts(false, true);
      if (cancelled) return;

      // Unlock labels silently once on desktop startup if labels are still masked
      const needsPermissionUnlock = inputs.length === 0 || inputs.some((d) => !d.label);
      if (needsPermissionUnlock) {
        const unlocked = await enumerateCleanPorts(true, false);
        if (cancelled) return;
        inputs = unlocked.inputs;
        outputs = unlocked.outputs;
      }

      lastInputSigRef.current = buildDeviceListSignature(inputs);
      lastOutputSigRef.current = buildDeviceListSignature(outputs);
      setInputDevices(inputs);
      setOutputDevices(outputs);
      onSyncLiveInputsRef.current?.(inputs, true);
    };

    void runStartupDiscovery();
    return () => {
      cancelled = true;
    };
  }, [enumerateCleanPorts, hydrated]);

  // 2. Post-startup hot-plug auto-scanner (instant devicechange event + 30s visible-only fallback)
  useEffect(() => {
    if (!hydrated) return;
    let active = true;

    const checkHotPlugChanges = async (refreshNative: boolean) => {
      const { inputs, outputs } = await enumerateCleanPorts(false, refreshNative);
      if (!active) return;

      const inSig = buildDeviceListSignature(inputs);
      const outSig = buildDeviceListSignature(outputs);

      if (inSig !== lastInputSigRef.current || outSig !== lastOutputSigRef.current) {
        lastInputSigRef.current = inSig;
        lastOutputSigRef.current = outSig;
        setInputDevices(inputs);
        setOutputDevices(outputs);
        if (startupSyncedRef.current) {
          onSyncLiveInputsRef.current?.(inputs, false);
        }
      }
    };

    const unsub = subscribeHardwareChanges(() => {
      void checkHotPlugChanges(true);
    });
    const pollTimer = window.setInterval(() => {
      if (document.hidden) return;
      void checkHotPlugChanges(false);
    }, 30000);

    return () => {
      active = false;
      unsub();
      window.clearInterval(pollTimer);
    };
  }, [enumerateCleanPorts, hydrated]);

  // Proactive USB, Internal, and LAN Audio endpoint hardware scanner
  const runHardwareScan = useCallback(
    async (requestPermission = false, announceHotPlug = true) => {
      if (scanInFlightRef.current) return;
      scanInFlightRef.current = true;
      setScanningHardware(true);
      try {
        const {
          activeDevice: curDev,
          logAudit: curLogAudit,
          onRegisterDevices: curRegisterDevices,
          platform: curPlatform,
        } = latestRef.current;

        const cachedBeforeScan = await loadCachedHardwareEndpoints();
        if (requestPermission && navigator.mediaDevices?.getUserMedia) {
          try {
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            tempStream.getTracks().forEach((t) => t.stop());
          } catch {
            // Proceed even if permission prompt dismissed
          }
        }

        const [serverRes, browserEndpoints, specialized] = await Promise.all([
          appFetch('/api/hardware/scan')
            .then((r) => (r.ok ? r.json() : { endpoints: [] }))
            .catch(() => ({ endpoints: [] })),
          scanBrowserMediaDevices(curPlatform),
          enumerateSpecializedDesktopInterfaces(),
        ]);

        const specSig = specialized.map((s) => `${s.deviceId}::${s.label}`).join('|');
        if (specSig !== lastSpecializedSigRef.current) {
          lastSpecializedSigRef.current = specSig;
          setSpecializedDesktopInputs(specialized);
        }

        const osEndpoints: DetectedHardwareEndpoint[] = Array.isArray(serverRes?.endpoints)
          ? serverRes.endpoints
          : [];

        const mergedMap = new Map<string, DetectedHardwareEndpoint>();
        for (const ep of cachedBeforeScan.endpoints) {
          mergedMap.set(buildEndpointSignature(ep), { ...ep, cachedFromIndexedDb: true });
        }
        for (const ep of browserEndpoints) {
          mergedMap.set(buildEndpointSignature(ep), { ...ep, cachedFromIndexedDb: false });
        }
        for (const ep of osEndpoints) {
          const sig = buildEndpointSignature(ep);
          const existing = mergedMap.get(sig);
          mergedMap.set(sig, {
            ...(existing || ep),
            ...ep,
            cachedFromIndexedDb: false,
          });
        }

        const liveEndpoints = Array.from(mergedMap.values());
        const persistedMerged = await saveDetectedHardwareEndpoints(
          liveEndpoints,
          curDev.id
        );
        setDetectedEndpoints(persistedMerged);

        const allSynthDevices = persistedMerged
          .map((ep) => ep.synthesizedDevice)
          .filter((d): d is HardwareDevice => Boolean(d));

        if (allSynthDevices.length > 0) {
          cachedSynthDevicesRef.current = allSynthDevices;
          curRegisterDevices(allSynthDevices);
        }

        if (announceHotPlug) {
          const newlyAdded = liveEndpoints.find((ep) => {
            const sig = buildEndpointSignature(ep);
            return (
              !activeOnBusSignaturesRef.current.has(sig) &&
              ep.matchedDeviceId !== curDev.id &&
              (ep.kind === 'usb-audio' ||
                ep.kind === 'network-console' ||
                ep.kind === 'thunderbolt')
            );
          });
          if (newlyAdded) {
            const wasCached = cachedBeforeScan.endpoints.some(
              (c) => buildEndpointSignature(c) === buildEndpointSignature(newlyAdded)
            );
            setHotPlugEndpoint(newlyAdded);
            curLogAudit(
              wasCached
                ? 'Recognized Remembered Hardware Plug-In'
                : 'Hardware Hot-Plug Detected',
              `${newlyAdded.name} → ${newlyAdded.matchedLabel} (${wasCached ? 'IndexedDB Instant Match' : newlyAdded.confidence})`,
              'system'
            );
          }
        }

        activeOnBusSignaturesRef.current = new Set(
          liveEndpoints.map((ep) => buildEndpointSignature(ep))
        );
      } finally {
        scanInFlightRef.current = false;
        setScanningHardware(false);
      }
    },
    []
  );

  const handleClearHardwareCache = useCallback(async () => {
    await clearCachedHardwareEndpoints();
    activeOnBusSignaturesRef.current.clear();
    await runHardwareScan(false, false);
    latestRef.current.logAudit(
      'Cleared IndexedDB Hardware Cache',
      'Reset locally remembered hardware signatures and re-scanned active endpoints.',
      'operator'
    );
  }, [runHardwareScan]);

  const handleBindDetectedEndpoint = useCallback(
    async (ep: DetectedHardwareEndpoint) => {
      const {
        devices: curDevices,
        onRegisterDevices: curRegisterDevices,
        onSelectDevice: curSelectDevice,
      } = latestRef.current;

      let targetDevice = curDevices.find((d) => d.id === ep.matchedDeviceId);
      if (!targetDevice && ep.synthesizedDevice) {
        targetDevice = ep.synthesizedDevice;
        curRegisterDevices([targetDevice]);
      }
      if (!targetDevice) return;

      if (ep.browserDeviceId) {
        if (/speaker|headphone|earphone|line out|cable in/i.test(ep.name)) {
          void handleSelectOutputDevice(ep.browserDeviceId);
        } else {
          void refreshAudioDevices(false, 'slot-new');
        }
      }
      setHotPlugEndpoint(null);
      await curSelectDevice(targetDevice, ep.recommendedDriver);
    },
    [handleSelectOutputDevice, refreshAudioDevices]
  );

  // Initial IndexedDB hydration (ONCE on mount)
  useEffect(() => {
    let mounted = true;
    void loadCachedHardwareEndpoints().then((cached) => {
      if (!mounted) return;
      if (cached.synthesizedDevices.length > 0) {
        cachedSynthDevicesRef.current = cached.synthesizedDevices;
        latestRef.current.onRegisterDevices(cached.synthesizedDevices);
      }
      if (cached.endpoints.length > 0) {
        setDetectedEndpoints(cached.endpoints);
      }
      void runHardwareScan(false, false);
    });

    const unsubHardware = subscribeHardwareChanges(() => {
      void runHardwareScan(false, true);
    });

    return () => {
      mounted = false;
      unsubHardware();
    };
  }, [runHardwareScan]);

  return {
    detectedEndpoints,
    scanningHardware,
    hotPlugEndpoint,
    inputDevices,
    outputDevices,
    specializedDesktopInputs,
    outputRouteError,
    preferredOutputDeviceId,
    preferredStreamOutputDeviceId,
    desktopAudioStatus,
    desktopAudioSessions,
    apoStatus,
    singleSpeakerMode,
    apoBusy,
    apoMessage,
    refreshDesktopAudioInfo,
    handleToggleSingleSpeakerMode,
    handleInstallApo,
    handleUninstallApo,
    refreshAudioDevices,
    handleSelectOutputDevice,
    handleSelectStreamOutputDevice,
    runHardwareScan,
    handleClearHardwareCache,
    handleBindDetectedEndpoint,
    dismissHotPlug: () => setHotPlugEndpoint(null),
    cachedSynthDevicesRef,
  };
}
