import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuditAuthority,
  DetectedHardwareEndpoint,
  DriverBackend,
  HardwareDevice,
  PlatformTarget,
} from '../types/audio.ts';
import { HARDWARE_CATALOG } from '../data/hardwareCatalog.ts';
import {
  buildEndpointSignature,
  clearCachedHardwareEndpoints,
  loadCachedHardwareEndpoints,
  saveDetectedHardwareEndpoints,
} from '../utils/hardwareCacheDb.ts';
import { scanBrowserMediaDevices } from '../utils/hardwareRecognition.ts';
import {
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
  engineRunning: boolean;
  audioSource: string;
}

export function useHardwareManager({
  activeDevice,
  platform,
  devices,
  onRegisterDevices,
  onSelectDevice,
  logAudit,
  engineRunning,
  audioSource,
}: UseHardwareManagerProps) {
  const [detectedEndpoints, setDetectedEndpoints] = useState<DetectedHardwareEndpoint[]>([]);
  const [scanningHardware, setScanningHardware] = useState(false);
  const [hotPlugEndpoint, setHotPlugEndpoint] = useState<DetectedHardwareEndpoint | null>(null);
  const [preferredBrowserInputId, setPreferredBrowserInputId] = useState<string | undefined>(undefined);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [preferredOutputDeviceId, setPreferredOutputDeviceId] = useState<string>(() => {
    try {
      return window.localStorage.getItem('church_audio_output_device_id') || '';
    } catch {
      return '';
    }
  });

  const activeOnBusSignaturesRef = useRef<Set<string>>(new Set());
  const cachedSynthDevicesRef = useRef<HardwareDevice[]>([]);

  // Enumerate available physical output audio sinks
  const handleSelectOutputDevice = useCallback(async (deviceId: string) => {
    setPreferredOutputDeviceId(deviceId);
    try {
      window.localStorage.setItem('church_audio_output_device_id', deviceId);
    } catch {
      // ignore storage error
    }
    await liveAudioEngine.setOutputDevice(deviceId);
    logAudit('Audio Output Changed', deviceId ? `Target device: ${deviceId}` : 'Default system output', 'operator');
  }, [logAudit]);

  useEffect(() => {
    let active = true;
    const refreshOutputs = () => {
      enumerateAudioOutputs().then((devs) => {
        if (active) setOutputDevices(devs);
      });
    };
    refreshOutputs();
    const unsub = subscribeHardwareChanges(refreshOutputs);
    return () => {
      active = false;
      unsub();
    };
  }, []);

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
        setPreferredBrowserInputId(ep.browserDeviceId);
        if (/speaker|headphone|earphone|line out|cable in/i.test(ep.name)) {
          void handleSelectOutputDevice(ep.browserDeviceId);
        }
      }
      setHotPlugEndpoint(null);
      await onSelectDevice(targetDevice, ep.recommendedDriver);
    },
    [devices, handleSelectOutputDevice, onRegisterDevices, onSelectDevice]
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
    preferredBrowserInputId,
    outputDevices,
    preferredOutputDeviceId,
    handleSelectOutputDevice,
    runHardwareScan,
    handleClearHardwareCache,
    handleBindDetectedEndpoint,
    setPreferredBrowserInputId,
    dismissHotPlug: () => setHotPlugEndpoint(null),
    cachedSynthDevicesRef,
  };
}
