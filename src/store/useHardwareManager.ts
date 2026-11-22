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
import { appFetch } from '../utils/appApi.ts';

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

  const [{ outputId: initOutId, streamOutputId: initStreamId }] = useState(() =>
    migrateLegacyOutputStorage()
  );
  const [preferredOutputDeviceId, setPreferredOutputDeviceId] = useState<string>(initOutId);
  const [preferredStreamOutputDeviceId, setPreferredStreamOutputDeviceId] =
    useState<string>(initStreamId);

  const activeOnBusSignaturesRef = useRef<Set<string>>(new Set());
  const cachedSynthDevicesRef = useRef<HardwareDevice[]>([]);
  const startupSyncedRef = useRef<boolean>(false);
  const lastInputSigRef = useRef<string>('');
  const lastOutputSigRef = useRef<string>('');
  const onSyncLiveInputsRef = useRef(onSyncLiveInputsToChannels);
  onSyncLiveInputsRef.current = onSyncLiveInputsToChannels;

  // Apply persisted standalone stereo output device selection without enabling loopback
  useEffect(() => {
    if (preferredOutputDeviceId) {
      void liveAudioEngine.setOutputDevice(preferredOutputDeviceId);
    }
  }, [preferredOutputDeviceId]);

  const handleSelectOutputDevice = useCallback(
    async (deviceId: string) => {
      const cleanId = (deviceId || '').split('::')[0];
      setPreferredOutputDeviceId(cleanId);
      try {
        window.localStorage.setItem('church_audio_output_device_id', cleanId);
      } catch {
        // ignore storage error
      }
      await liveAudioEngine.setOutputDevice(cleanId);
      logAudit(
        'Audio Output Changed',
        cleanId ? `Standalone Stereo PA Output: ${cleanId}` : 'System Default Stereo Output',
        'operator'
      );
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

  const enumerateCleanPorts = useCallback(async (requestPermission = false) => {
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
    const [inputs, outputs] = await Promise.all([
      enumerateAudioInputs(),
      enumerateAudioOutputs(),
    ]);
    return { inputs, outputs };
  }, []);

  const refreshAudioDevices = useCallback(
    async (
      requestPermission = true,
      mode: 'slot-new' | 'reset-from-ch1' = 'slot-new'
    ) => {
      const { inputs, outputs } = await enumerateCleanPorts(requestPermission);
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
      let { inputs, outputs } = await enumerateCleanPorts(false);
      if (cancelled) return;

      // Unlock labels silently once on desktop startup if labels are still masked
      const needsPermissionUnlock = inputs.length === 0 || inputs.some((d) => !d.label);
      if (needsPermissionUnlock) {
        const unlocked = await enumerateCleanPorts(true);
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

  // 2. Post-startup hot-plug auto-scanner (devicechange event + 4s lightweight watcher)
  useEffect(() => {
    if (!hydrated) return;
    let active = true;

    const checkHotPlugChanges = async () => {
      const { inputs, outputs } = await enumerateCleanPorts(false);
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
      void checkHotPlugChanges();
    });
    const pollTimer = window.setInterval(() => {
      void checkHotPlugChanges();
    }, 4000);

    return () => {
      active = false;
      unsub();
      window.clearInterval(pollTimer);
    };
  }, [enumerateCleanPorts, hydrated]);

  // Proactive USB, Internal, and LAN Audio endpoint hardware scanner
  const runHardwareScan = useCallback(
    async (requestPermission = false, announceHotPlug = true) => {
      setScanningHardware(true);
      try {
        const cachedBeforeScan = await loadCachedHardwareEndpoints();
        if (requestPermission && navigator.mediaDevices?.getUserMedia) {
          try {
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            tempStream.getTracks().forEach((t) => t.stop());
          } catch {
            // Proceed even if permission prompt dismissed
          }
        }

        const [serverRes, browserEndpoints] = await Promise.all([
          appFetch('/api/hardware/scan')
            .then((r) => (r.ok ? r.json() : { endpoints: [] }))
            .catch(() => ({ endpoints: [] })),
          scanBrowserMediaDevices(platform),
        ]);

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
          activeDevice.id
        );
        setDetectedEndpoints(persistedMerged);

        const allSynthDevices = persistedMerged
          .map((ep) => ep.synthesizedDevice)
          .filter((d): d is HardwareDevice => Boolean(d));

        if (allSynthDevices.length > 0) {
          cachedSynthDevicesRef.current = allSynthDevices;
          onRegisterDevices(allSynthDevices);
        }

        if (announceHotPlug) {
          const newlyAdded = liveEndpoints.find((ep) => {
            const sig = buildEndpointSignature(ep);
            return (
              !activeOnBusSignaturesRef.current.has(sig) &&
              ep.matchedDeviceId !== activeDevice.id &&
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
            logAudit(
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
        setScanningHardware(false);
      }
    },
    [activeDevice.id, logAudit, onRegisterDevices, platform]
  );

  const handleClearHardwareCache = useCallback(async () => {
    await clearCachedHardwareEndpoints();
    activeOnBusSignaturesRef.current.clear();
    await runHardwareScan(false, false);
    logAudit(
      'Cleared IndexedDB Hardware Cache',
      'Reset locally remembered hardware signatures and re-scanned active endpoints.',
      'operator'
    );
  }, [logAudit, runHardwareScan]);

  const handleBindDetectedEndpoint = useCallback(
    async (ep: DetectedHardwareEndpoint) => {
      let targetDevice = devices.find((d) => d.id === ep.matchedDeviceId);
      if (!targetDevice && ep.synthesizedDevice) {
        targetDevice = ep.synthesizedDevice;
        onRegisterDevices([targetDevice]);
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
      await onSelectDevice(targetDevice, ep.recommendedDriver);
    },
    [devices, handleSelectOutputDevice, onRegisterDevices, onSelectDevice, refreshAudioDevices]
  );

  // Initial IndexedDB hydration
  useEffect(() => {
    let mounted = true;
    void loadCachedHardwareEndpoints().then((cached) => {
      if (!mounted) return;
      if (cached.synthesizedDevices.length > 0) {
        cachedSynthDevicesRef.current = cached.synthesizedDevices;
        onRegisterDevices(cached.synthesizedDevices);
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
  }, [onRegisterDevices, runHardwareScan]);

  return {
    detectedEndpoints,
    scanningHardware,
    hotPlugEndpoint,
    inputDevices,
    outputDevices,
    preferredOutputDeviceId,
    preferredStreamOutputDeviceId,
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
