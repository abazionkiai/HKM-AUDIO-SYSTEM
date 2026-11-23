import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AcousticMeasurement,
  AuditAuthority,
  AuditEvent,
  BassDiConfig,
  BroadcastDspConfig,
  ConfigurationVersion,
  ConsoleThemeId,
  DiagnosticFinding,
  DriverBackend,
  HardwareDevice,
  InputChannel,
  NavDockPosition,
  NetworkInterfaceInfo,
  ObsStatus,
  PlatformTarget,
  RemoteAccessConfig,
  RemoteClientSession,
  ServicePreset,
  SpeakerZone,
  AutomationSnapshot,
  DspConfig,
} from '../types/audio.ts';
import {
  DEFAULT_BASS_DI_CONFIG,
  DEFAULT_DSP_CONFIG,
  DEFAULT_SPEAKER_ZONES,
  HARDWARE_CATALOG,
  INITIAL_ACOUSTIC_MEASUREMENT,
  SERVICE_PRESETS,
  buildChannelsForDevice,
} from '../data/hardwareCatalog.ts';
import {
  BUILTIN_PLUGINS,
  validatePluginManifest,
  type LoadedPluginRecord,
} from '../plugins/pluginManager.ts';
import { appFetch, isDesktopApp } from '../utils/appApi.ts';
import { saveLastActiveHardwareId } from '../utils/hardwareCacheDb.ts';
import { liveAudioEngine } from '../audio/liveAudioEngine.ts';
import {
  sanitizeAndAutoNameChannels,
  deriveAutoChannelNameAndRole,
  reconcileLiveInputsToChannels,
  isLoopbackInputLabel,
  isNativeDesktopInputId,
} from '../utils/audioNaming.ts';
import QRCode from 'qrcode';

interface UseConsoleSessionProps {
  remoteCompanionToken: string | null;
  onEmergencyMuteChanged?: (muted: boolean) => void;
  onMidiMappingsLoaded?: (mappings: any[]) => void;
  onKeyboardShortcutsLoaded?: (shortcuts: any[]) => void;
}

export function useConsoleSession({
  remoteCompanionToken,
  onEmergencyMuteChanged,
  onMidiMappingsLoaded,
  onKeyboardShortcutsLoaded,
}: UseConsoleSessionProps) {
  // Venue & Platform State
  const [venueName, setVenueName] = useState('Grace Community Fellowship');
  const [roomName, setRoomName] = useState('Main Sanctuary');
  const [platform, setPlatform] = useState<PlatformTarget>('windows');
  const [driver, setDriver] = useState<DriverBackend>('ASIO');

  // Hardware Devices
  const [devices, setDevices] = useState<HardwareDevice[]>(HARDWARE_CATALOG);
  const [activeDevice, setActiveDevice] = useState<HardwareDevice>(HARDWARE_CATALOG[0]);
  const [sampleRate, setSampleRate] = useState<number>(HARDWARE_CATALOG[0].defaultSampleRate);
  const [bufferSize, setBufferSize] = useState<number>(HARDWARE_CATALOG[0].defaultBufferSize);

  // Channels, Master DSP & Safety
  const [channels, setChannels] = useState<InputChannel[]>(() =>
    buildChannelsForDevice(HARDWARE_CATALOG[0])
  );
  const [dsp, setDsp] = useState<DspConfig>(DEFAULT_DSP_CONFIG);
  const [undoStack, setUndoStack] = useState<DspConfig[]>([]);
  const [emergencyMuted, setEmergencyMuted] = useState(false);

  // Presets & Processing Zones
  const [presets, setPresets] = useState<ServicePreset[]>(SERVICE_PRESETS);
  const [activePreset, setActivePreset] = useState<ServicePreset>(SERVICE_PRESETS[0]);
  const [broadcastDsp, setBroadcastDsp] = useState<BroadcastDspConfig>(
    SERVICE_PRESETS[0].broadcastDsp
  );
  const [zones, setZones] = useState<SpeakerZone[]>(DEFAULT_SPEAKER_ZONES);
  const [measurement, setMeasurement] = useState<AcousticMeasurement>(
    INITIAL_ACOUSTIC_MEASUREMENT
  );
  const [bassDi, setBassDi] = useState<BassDiConfig>(DEFAULT_BASS_DI_CONFIG);

  // OBS Status, Versions, Findings, Audits
  const [obsStatus, setObsStatus] = useState<ObsStatus>({
    connected: false,
    websocketUrl: 'ws://127.0.0.1:4455',
    activeScene: 'Sanctuary Wide + Preacher',
    scenes: [
      'Pre-Service Countdown',
      'Worship Full Band',
      'Sanctuary Wide + Preacher',
      'Pulpit Close-Up',
    ],
    streaming: false,
    recording: false,
    bitrateKbps: 0,
    droppedFrames: 0,
    cpuUsagePct: 0,
    audioMonitorMode: 'Monitor Off',
    syncWarning: false,
  });
  const [versions, setVersions] = useState<ConfigurationVersion[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [findings, setFindings] = useState<DiagnosticFinding[]>([]);

  // Dynamic Plugins
  const [plugins, setPlugins] = useState<LoadedPluginRecord[]>(() =>
    BUILTIN_PLUGINS.map((p) => ({
      ...p,
      loadedAt: new Date().toISOString(),
      status: p.enabled ? 'active' : 'disabled',
    }))
  );

  // Automation Snapshots
  const [automationSnapshots, setAutomationSnapshots] = useState<AutomationSnapshot[]>([]);

  // UI Theme & Dock Position
  const [consoleTheme, setConsoleTheme] = useState<ConsoleThemeId>(() => {
    try {
      const saved = window.localStorage.getItem('church_audio_console_theme') as ConsoleThemeId | null;
      return saved || 'midnight-studio';
    } catch {
      return 'midnight-studio';
    }
  });

  const [navDockPosition, setNavDockPosition] = useState<NavDockPosition>(() => {
    try {
      const saved = window.localStorage.getItem('church_audio_nav_dock_v2') as NavDockPosition | null;
      return saved === 'left' || saved === 'right' || saved === 'top' || saved === 'bottom'
        ? saved
        : 'top';
    } catch {
      return 'top';
    }
  });

  // Remote Companion
  const [remoteAccess, setRemoteAccess] = useState<RemoteAccessConfig>({
    sessionToken: '',
    pinEnabled: false,
    pinCode: '2026',
    allowGainAdjustment: true,
    allowMuteControl: true,
    allowMasterTrim: true,
    lanHostOverride: '',
    createdAt: '',
  });
  const [remoteClients, setRemoteClients] = useState<RemoteClientSession[]>([]);
  const [lanInterfaces, setLanInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const desktopWsRef = useRef<WebSocket | null>(null);
  const hydratedRef = useRef<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);
  const channelsRef = useRef<InputChannel[]>(channels);
  channelsRef.current = channels;
  const activeDeviceRef = useRef<HardwareDevice>(activeDevice);
  activeDeviceRef.current = activeDevice;
  const sampleRateRef = useRef<number>(sampleRate);
  sampleRateRef.current = sampleRate;
  const bufferSizeRef = useRef<number>(bufferSize);
  bufferSizeRef.current = bufferSize;
  const driverRef = useRef<DriverBackend>(driver);
  driverRef.current = driver;
  const dspRef = useRef<DspConfig>(dsp);
  dspRef.current = dsp;
  const broadcastDspRef = useRef<BroadcastDspConfig>(broadcastDsp);
  broadcastDspRef.current = broadcastDsp;
  const zonesRef = useRef<SpeakerZone[]>(zones);
  zonesRef.current = zones;
  const platformRef = useRef<PlatformTarget>(platform);
  platformRef.current = platform;
  const activePresetRef = useRef<ServicePreset>(activePreset);
  activePresetRef.current = activePreset;
  const versionsRef = useRef<ConfigurationVersion[]>(versions);
  versionsRef.current = versions;
  const suppressSyncCountRef = useRef<number>(0);
  const cachedSynthDevicesRef = useRef<HardwareDevice[]>([]);

  useEffect(() => {
    try {
      window.localStorage.setItem('church_audio_nav_dock_v2', navDockPosition);
    } catch {
      // ignore
    }
  }, [navDockPosition]);

  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-console-theme', consoleTheme);
    try {
      window.localStorage.setItem('church_audio_console_theme', consoleTheme);
    } catch {
      // ignore
    }
  }, [consoleTheme]);

  const logAudit = useCallback(
    (action: string, detail: string, authority: AuditAuthority = 'operator') => {
      const evt: AuditEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        actor: 'Sound Engineer',
        action,
        detail,
        authority,
      };
      setAuditEvents((prev) => [evt, ...prev].slice(0, 80));
      appFetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evt),
      }).catch(() => {});
    },
    []
  );

  const onEmergencyMuteChangedRef = useRef(onEmergencyMuteChanged);
  onEmergencyMuteChangedRef.current = onEmergencyMuteChanged;
  const onKeyboardShortcutsLoadedRef = useRef(onKeyboardShortcutsLoaded);
  onKeyboardShortcutsLoadedRef.current = onKeyboardShortcutsLoaded;
  const onMidiMappingsLoadedRef = useRef(onMidiMappingsLoaded);
  onMidiMappingsLoadedRef.current = onMidiMappingsLoaded;

  // Hydrate full console state from SQLite backend (ONCE on initial mount)
  useEffect(() => {
    if (remoteCompanionToken || hydratedRef.current) return;
    let active = true;

    Promise.allSettled([
      appFetch('/api/state').then((r) => (r.ok ? r.json() : null)),
      isDesktopApp()
        ? Promise.resolve(null)
        : appFetch('/api/remote/session').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([stateRes, remoteRes]) => {
        if (!active) return;
        const data = stateRes.status === 'fulfilled' ? stateRes.value : null;
        if (data) {
          suppressSyncCountRef.current += 1;
          if (data.venue && typeof data.venue === 'object') {
            if (typeof data.venue.venueName === 'string') setVenueName(data.venue.venueName);
            if (typeof data.venue.roomName === 'string') setRoomName(data.venue.roomName);
            if (data.venue.targetPlatform) setPlatform(data.venue.targetPlatform);
            if (data.venue.driver) setDriver(data.venue.driver);
            if (typeof data.venue.sampleRate === 'number') setSampleRate(data.venue.sampleRate);
            if (typeof data.venue.bufferSize === 'number') setBufferSize(data.venue.bufferSize);
            if (typeof data.venue.activeDeviceId === 'string') {
              const foundDev =
                HARDWARE_CATALOG.find((d) => d.id === data.venue.activeDeviceId) ??
                cachedSynthDevicesRef.current.find((d) => d.id === data.venue.activeDeviceId);
              if (foundDev) setActiveDevice(foundDev);
            }
          }
          if (Array.isArray(data.channels) && data.channels.length > 0) {
            // Cleanse any legacy mock names or template artifacts from previous versions
            const cleaned = sanitizeAndAutoNameChannels(data.channels);
            setChannels(cleaned);
          }
          if (data.dsp && typeof data.dsp === 'object') setDsp(data.dsp);
          if (typeof data.activePresetId === 'string') {
            const matchedPreset = SERVICE_PRESETS.find((p) => p.id === data.activePresetId);
            if (matchedPreset) setActivePreset(matchedPreset);
          }
          if (data.broadcastDsp && typeof data.broadcastDsp === 'object') {
            setBroadcastDsp(data.broadcastDsp);
          }
          if (Array.isArray(data.zones) && data.zones.length > 0) {
            const migratedZones: SpeakerZone[] = [];
            let mergedFrontAdded = false;
            for (const rawZone of data.zones as SpeakerZone[]) {
              const cleanOutId = rawZone.hardwareOutputId
                ? rawZone.hardwareOutputId.split('::')[0]
                : undefined;
              const cleanOutLabel =
                !rawZone.hardwareOutput || /^(Out \d|Aux \d)/i.test(rawZone.hardwareOutput)
                  ? 'System Default Output'
                  : rawZone.hardwareOutput;

              if (rawZone.id === 'zone-main-l' || rawZone.id === 'zone-main-r') {
                if (!mergedFrontAdded) {
                  mergedFrontAdded = true;
                  migratedZones.push({
                    ...rawZone,
                    id: 'zone-front-main',
                    name: 'Front Speakers (Main PA)',
                    role: 'main-lr',
                    x: 50,
                    y: 20,
                    rotationDeg: 180,
                    dispersionDeg: 100,
                    hardwareOutputId: cleanOutId,
                    hardwareOutput: cleanOutLabel,
                  });
                }
                continue;
              }
              migratedZones.push({
                ...rawZone,
                hardwareOutputId: cleanOutId,
                hardwareOutput: cleanOutLabel,
              });
            }
            setZones(migratedZones.length > 0 ? migratedZones : DEFAULT_SPEAKER_ZONES);
          }
          if (data.obsStatus && typeof data.obsStatus === 'object') setObsStatus(data.obsStatus);
          if (data.measurement && typeof data.measurement === 'object') {
            setMeasurement(data.measurement);
          }
          if (data.bassDi && typeof data.bassDi === 'object') setBassDi(data.bassDi);
          if (typeof data.emergencyMuted === 'boolean') {
            setEmergencyMuted(data.emergencyMuted);
            liveAudioEngine.setEmergencyMute(data.emergencyMuted);
            onEmergencyMuteChangedRef.current?.(data.emergencyMuted);
          }
          if (Array.isArray(data.findings)) setFindings(data.findings);
          if (data.remoteAccess && typeof data.remoteAccess === 'object') {
            setRemoteAccess(data.remoteAccess);
          }
          if (Array.isArray(data.versions)) setVersions(data.versions);
          if (Array.isArray(data.auditEvents) && data.auditEvents.length > 0) {
            setAuditEvents(data.auditEvents);
          }
          if (Array.isArray(data.midiMappings) && data.midiMappings.length > 0) {
            onMidiMappingsLoadedRef.current?.(data.midiMappings);
          }
          if (Array.isArray(data.automationSnapshots)) {
            setAutomationSnapshots(data.automationSnapshots);
          }
          if (Array.isArray(data.keyboardShortcuts) && data.keyboardShortcuts.length > 0) {
            onKeyboardShortcutsLoadedRef.current?.(data.keyboardShortcuts);
          }
        }

        const remoteData = remoteRes.status === 'fulfilled' ? remoteRes.value : null;
        if (remoteData) {
          if (remoteData.remoteAccess) setRemoteAccess(remoteData.remoteAccess);
          if (Array.isArray(remoteData.clients)) setRemoteClients(remoteData.clients);
          if (Array.isArray(remoteData.interfaces)) setLanInterfaces(remoteData.interfaces);
        }
      })
      .finally(() => {
        if (active) {
          hydratedRef.current = true;
          setHydrated(true);
        }
      });

    return () => {
      active = false;
    };
  }, [remoteCompanionToken]);

  // Persistent Desktop WebSocket link
  useEffect(() => {
    if (isDesktopApp() || remoteCompanionToken) return;
    let closedByEffect = false;
    let reconnectTimer: number | null = null;

    const connectWs = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws?role=desktop`);
      desktopWsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.type === 'state:full' && msg.state) {
            if (msg.state.remoteAccess) setRemoteAccess(msg.state.remoteAccess);
            return;
          }
          if (msg.type === 'remote:clients' && Array.isArray(msg.clients)) {
            setRemoteClients(msg.clients);
            return;
          }
          if (msg.type === 'remote:config' && msg.remoteAccess) {
            setRemoteAccess(msg.remoteAccess);
            return;
          }
          if (
            msg.type === 'channel:patch' &&
            msg.sourceRole !== 'desktop' &&
            msg.channelId &&
            msg.patch
          ) {
            suppressSyncCountRef.current += 1;
            setChannels((prev) =>
              prev.map((ch) => (ch.id === msg.channelId ? { ...ch, ...msg.patch } : ch))
            );
            return;
          }
          if (msg.type === 'master:patch' && msg.sourceRole !== 'desktop') {
            suppressSyncCountRef.current += 1;
            if (typeof msg.inputTrimDb === 'number') {
              setDsp((prev) =>
                prev.inputTrimDb === msg.inputTrimDb
                  ? prev
                  : { ...prev, inputTrimDb: msg.inputTrimDb }
              );
            }
            if (typeof msg.emergencyMuted === 'boolean') {
              setEmergencyMuted(msg.emergencyMuted);
              liveAudioEngine.setEmergencyMute(msg.emergencyMuted);
              onEmergencyMuteChangedRef.current?.(msg.emergencyMuted);
            }
          }
        } catch {
          // ignore malformed ws message
        }
      };

      ws.onclose = () => {
        if (desktopWsRef.current === ws) desktopWsRef.current = null;
        if (!closedByEffect) {
          reconnectTimer = window.setTimeout(connectWs, 2000);
        }
      };
    };

    connectWs();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (desktopWsRef.current) {
        desktopWsRef.current.close();
        desktopWsRef.current = null;
      }
    };
  }, [remoteCompanionToken]);

  // Debounced sync to SQLite backend
  useEffect(() => {
    if (remoteCompanionToken || !hydratedRef.current) return;
    if (suppressSyncCountRef.current > 0) {
      suppressSyncCountRef.current -= 1;
      return;
    }

    const timer = window.setTimeout(() => {
      appFetch('/api/state/sync', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue: {
            organization: venueName,
            venueName,
            roomName,
            targetPlatform: platform,
            driver,
            sampleRate,
            bufferSize,
            activeDeviceId: activeDevice.id,
          },
          channels,
          dsp,
          activePresetId: activePreset.id,
          broadcastDsp,
          zones,
          obsStatus,
          measurement,
          bassDi,
          emergencyMuted,
          findings,
        }),
      }).catch(() => {});
    }, 220);

    return () => window.clearTimeout(timer);
  }, [
    activeDevice.id,
    activePreset.id,
    bassDi,
    broadcastDsp,
    bufferSize,
    channels,
    driver,
    dsp,
    emergencyMuted,
    findings,
    measurement,
    obsStatus,
    platform,
    remoteCompanionToken,
    roomName,
    sampleRate,
    venueName,
    zones,
  ]);

  // Pairing QR code
  const pairingUrl = `${remoteAccess.lanHostOverride || window.location.origin}/?mode=remote&token=${encodeURIComponent(remoteAccess.sessionToken)}`;

  useEffect(() => {
    if (!remoteAccess.sessionToken) return;
    let active = true;
    QRCode.toDataURL(pairingUrl, {
      width: 240,
      margin: 1.5,
      color: { dark: '#0284C7', light: '#0B0F17' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [pairingUrl, remoteAccess.sessionToken]);

  const handleSelectPlatform = useCallback((p: PlatformTarget) => {
    setPlatform(p);
    const supportedDrivers: DriverBackend[] =
      p === 'windows'
        ? ['ASIO', 'WASAPI Exclusive', 'WASAPI Shared']
        : p === 'macos'
          ? ['CoreAudio']
          : ['ALSA', 'PipeWire'];
    if (!supportedDrivers.includes(driverRef.current)) {
      setDriver(supportedDrivers[0]);
    }
  }, []);

  const handleSelectDriver = useCallback((d: DriverBackend) => {
    setDriver(d);
  }, []);

  const handleSelectSampleRate = useCallback((sr: number) => {
    setSampleRate(sr);
  }, []);

  const handleSelectBufferSize = useCallback((bs: number) => {
    setBufferSize(bs);
  }, []);

  const handleRegisterDevices = useCallback((newDevices: HardwareDevice[]) => {
    setDevices((prev) => {
      const existingIds = new Set(prev.map((d) => d.id));
      const additions = newDevices.filter((d) => !existingIds.has(d.id));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }, []);

  const handleSelectDevice = useCallback(
    async (dev: HardwareDevice, overrideDriver?: DriverBackend) => {
      const prevDevId = activeDeviceRef.current.id;
      const curDriver = driverRef.current;
      if (prevDevId !== dev.id) {
        appFetch(`/api/hardware/profiles/${encodeURIComponent(prevDevId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channels: channelsRef.current,
            sampleRate: sampleRateRef.current,
            bufferSize: bufferSizeRef.current,
            driver: curDriver,
          }),
        }).catch(() => {});
      }

      setActiveDevice(dev);
      let nextSr = dev.defaultSampleRate;
      let nextBs = dev.defaultBufferSize;
      let nextDriver = overrideDriver ?? curDriver;
      if (
        dev.capabilities.supportedDrivers.length > 0 &&
        !dev.capabilities.supportedDrivers.includes(nextDriver)
      ) {
        nextDriver = dev.capabilities.supportedDrivers[0];
      }

      try {
        const res = await appFetch(`/api/hardware/profiles/${encodeURIComponent(dev.id)}`);
        const data = res.ok ? await res.json() : null;
        if (data?.profile && Array.isArray(data.profile.channels) && data.profile.channels.length > 0) {
          setChannels(data.profile.channels);
          if (typeof data.profile.sampleRate === 'number') nextSr = data.profile.sampleRate;
          if (typeof data.profile.bufferSize === 'number') nextBs = data.profile.bufferSize;
          if (typeof data.profile.driver === 'string') nextDriver = data.profile.driver as DriverBackend;
        } else {
          setChannels(buildChannelsForDevice(dev));
        }
      } catch {
        setChannels(buildChannelsForDevice(dev));
      }

      setSampleRate(nextSr);
      setBufferSize(nextBs);
      setDriver(nextDriver);
      void saveLastActiveHardwareId(dev.id);
      logAudit('Switched Hardware Adapter', `${dev.manufacturer} ${dev.model} (${dev.tierLabel})`, 'operator');
    },
    [logAudit]
  );

  const handleSelectPreset = useCallback(
    (preset: ServicePreset) => {
      setUndoStack((u) => [dspRef.current, ...u].slice(0, 15));
      setActivePreset(preset);
      setDsp(preset.dsp);
      setBroadcastDsp(preset.broadcastDsp);
      logAudit('Loaded Service Preset', `${preset.name} (v${preset.version})`, 'operator');
    },
    [logAudit]
  );

  const handleSavePreset = useCallback(
    (name: string, description: string) => {
      const newPreset: ServicePreset = {
        id: `custom-${Date.now()}`,
        name,
        category: 'Contemporary Worship',
        description,
        version: '1.0',
        updatedAt: new Date().toISOString(),
        dsp: dspRef.current,
        broadcastDsp: broadcastDspRef.current,
      };
      setPresets((prev) => [newPreset, ...prev]);
      setActivePreset(newPreset);
      appFetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPreset),
      }).catch(() => {});
      logAudit('Created Service Preset', `${name} based on current live mix`, 'operator');
    },
    [logAudit]
  );

  const handleUpdatePreset = useCallback((id: string, patch: Partial<ServicePreset>) => {
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setActivePreset((prev) => (prev.id === id ? { ...prev, ...patch } : prev));
  }, []);

  const handleSaveVersion = useCallback(
    (summary: string) => {
      const snapshot: ConfigurationVersion = {
        id: `ver-${Date.now()}`,
        version: `v${versionsRef.current.length + 1}.0`,
        presetName: activePresetRef.current.name,
        timestamp: new Date().toISOString(),
        author: 'Sound Engineer',
        summary,
        deviceId: activeDeviceRef.current.id,
        platform: platformRef.current,
        dsp: dspRef.current,
        broadcastDsp: broadcastDspRef.current,
        zones: zonesRef.current,
      };
      setVersions((prev) => [snapshot, ...prev]);
      appFetch('/api/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      }).catch(() => {});
      logAudit('Saved Configuration Snapshot', `${snapshot.version}: ${summary}`, 'operator');
    },
    [logAudit]
  );

  const handleRollbackVersion = useCallback(
    (ver: ConfigurationVersion) => {
      setUndoStack((u) => [dspRef.current, ...u].slice(0, 15));
      setDsp(ver.dsp);
      setBroadcastDsp(ver.broadcastDsp);
      setZones(ver.zones);
      logAudit('Rolled Back Configuration', `Restored ${ver.presetName} (${ver.version})`, 'operator');
    },
    [logAudit]
  );

  const handleToggleEmergencyMute = useCallback(() => {
    setEmergencyMuted((prev) => {
      const next = !prev;
      liveAudioEngine.setEmergencyMute(next);
      onEmergencyMuteChangedRef.current?.(next);
      if (desktopWsRef.current?.readyState === WebSocket.OPEN) {
        desktopWsRef.current.send(
          JSON.stringify({ type: 'master:patch', emergencyMuted: next })
        );
      }
      logAudit(
        next ? 'Engaged Global Emergency Mute' : 'Released Global Emergency Mute',
        next ? 'All live PA & monitor outputs muted immediately.' : 'Master PA & monitor outputs restored.',
        'operator'
      );
      return next;
    });
  }, [logAudit]);

  const handleToggleTotalBypass = useCallback(() => {
    setDsp((prev) => {
      const next = !prev.bypassed;
      setUndoStack((u) => [prev, ...u].slice(0, 15));
      logAudit(
        next ? 'Engaged Total Signal Bypass' : 'Restored DSP Signal Processing',
        next
          ? 'All software EQ, HPF, compression, and limiting bypassed for clean dry pass-through.'
          : 'Re-engaged full CamillaDSP signal processing chain.',
        'operator'
      );
      return { ...prev, bypassed: next };
    });
  }, [logAudit]);

  const handleUpdateDsp = useCallback((patch: Partial<DspConfig>) => {
    setDsp((prev) => {
      setUndoStack((u) => [prev, ...u].slice(0, 15));
      return { ...prev, ...patch };
    });
    if (
      typeof patch.inputTrimDb === 'number' &&
      desktopWsRef.current?.readyState === WebSocket.OPEN
    ) {
      desktopWsRef.current.send(
        JSON.stringify({ type: 'master:patch', inputTrimDb: patch.inputTrimDb })
      );
    }
  }, []);

  const handleResetDsp = useCallback(() => {
    setDsp((prev) => {
      setUndoStack((u) => [prev, ...u].slice(0, 15));
      return DEFAULT_DSP_CONFIG;
    });
    logAudit('Reset DSP Configuration', 'Restored master DSP parameters to default factory baseline.', 'operator');
  }, [logAudit]);

  const handleUndoLastDsp = useCallback(() => {
    setUndoStack((prevStack) => {
      if (prevStack.length === 0) return prevStack;
      const [previous, ...rest] = prevStack;
      setDsp(previous);
      logAudit('Restored Previous DSP State', 'Rolled back last DSP parameter change.', 'operator');
      return rest;
    });
  }, [logAudit]);

  const handleUpdateChannel = useCallback((id: string, patch: Partial<InputChannel>) => {
    setChannels((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx < 0) return prev;
      const target = prev[idx];

      let resolvedPatch = { ...patch };
      if (resolvedPatch.hardwareInputLabel && !resolvedPatch.name) {
        const auto = deriveAutoChannelNameAndRole(resolvedPatch.hardwareInputLabel, target.index);
        resolvedPatch.name = auto.name;
        resolvedPatch.role = auto.role;
      }

      if (
        resolvedPatch.hardwareInputId &&
        !isNativeDesktopInputId(resolvedPatch.hardwareInputId) &&
        isLoopbackInputLabel(resolvedPatch.hardwareInputLabel)
      ) {
        resolvedPatch.hardwareInputId = undefined;
        resolvedPatch.hardwareInputLabel = undefined;
      }

      const isExplicitUnassign =
        'hardwareInputId' in resolvedPatch && !resolvedPatch.hardwareInputId;
      if (isExplicitUnassign) {
        resolvedPatch = {
          ...resolvedPatch,
          name: `Input ${target.index}`,
          role: 'Open Slot',
          gainDb: 0,
          faderDb: -48,
          mute: false,
          solo: false,
          phantom48v: false,
          padDb: false,
          polarityInverted: false,
          levelDb: -96,
          peakDb: -96,
          hardwareInputId: undefined,
          hardwareInputLabel: undefined,
          stereoLinked: false,
        };
      } else if (!target.hardwareInputId && resolvedPatch.hardwareInputId) {
        if (patch.faderDb === undefined && target.faderDb <= -47.5) {
          resolvedPatch.faderDb = 0;
        }
        if (patch.gainDb === undefined && target.gainDb === 0) {
          resolvedPatch.gainDb = 24;
        }
        if (patch.mute === undefined) {
          resolvedPatch.mute = false;
        }
      }

      // Enforce 1-to-1 physical input uniqueness: move input away from any other slot if reassigned
      const claimedDeviceId = resolvedPatch.hardwareInputId;
      return prev.map((c, i) => {
        if (i === idx) {
          return { ...c, ...resolvedPatch, stereoLinked: false };
        }
        if (claimedDeviceId && c.hardwareInputId === claimedDeviceId) {
          return {
            ...c,
            name: `Input ${c.index}`,
            role: 'Open Slot',
            gainDb: 0,
            faderDb: -48,
            mute: false,
            solo: false,
            phantom48v: false,
            padDb: false,
            polarityInverted: false,
            levelDb: -96,
            peakDb: -96,
            hardwareInputId: undefined,
            hardwareInputLabel: undefined,
            stereoLinked: false,
          };
        }
        return c;
      });
    });
    if (desktopWsRef.current?.readyState === WebSocket.OPEN) {
      desktopWsRef.current.send(
        JSON.stringify({ type: 'channel:patch', channelId: id, patch })
      );
    }
  }, []);

  const handleBatchMute = useCallback((category: 'band' | 'vocals' | 'all', muted: boolean) => {
    setChannels((prev) =>
      prev.map((c) => {
        if (category === 'band' && (c.dcaGroup === 'DCA 2 · Band' || c.dcaGroup === 'DCA 3 · Choir')) {
          return { ...c, mute: muted };
        }
        if (category === 'vocals' && (c.dcaGroup === 'DCA 1 · Vox' || c.dcaGroup === 'DCA 4 · Speech')) {
          return { ...c, mute: muted };
        }
        if (category === 'all') {
          return { ...c, mute: muted };
        }
        return c;
      })
    );
  }, []);

  const handleClearAllSolos = useCallback(() => {
    setChannels((prev) => prev.map((c) => (c.solo ? { ...c, solo: false } : c)));
  }, []);

  const handleApplyAutomationFrame = useCallback(
    (frame: {
      channelPatches?: Record<string, { faderDb?: number; mute?: boolean }>;
      masterTrimDb?: number;
      emergencyMuted?: boolean;
    }) => {
      if (frame.channelPatches && Object.keys(frame.channelPatches).length > 0) {
        const patches = frame.channelPatches;
        setChannels((prev) => {
          let changed = false;
          const next = prev.map((ch) => {
            const patch = patches[ch.id];
            if (!patch) return ch;
            const nextFader = patch.faderDb !== undefined ? patch.faderDb : ch.faderDb;
            const nextMute = patch.mute !== undefined ? patch.mute : ch.mute;
            if (nextFader === ch.faderDb && nextMute === ch.mute) return ch;
            changed = true;
            return { ...ch, faderDb: nextFader, mute: nextMute };
          });
          return changed ? next : prev;
        });
      }
      if (frame.masterTrimDb !== undefined) {
        const nextTrim = frame.masterTrimDb;
        setDsp((prev) =>
          prev.inputTrimDb === nextTrim ? prev : { ...prev, inputTrimDb: nextTrim }
        );
      }
      if (frame.emergencyMuted !== undefined) {
        const nextMute = frame.emergencyMuted;
        setEmergencyMuted((prev) => {
          if (prev === nextMute) return prev;
          liveAudioEngine.setEmergencyMute(nextMute);
          onEmergencyMuteChangedRef.current?.(nextMute);
          return nextMute;
        });
      }
    },
    []
  );

  const handleAddChannel = useCallback(
    (name?: string, role = 'Dynamic Input') => {
      setChannels((prev) => {
        const nextIdx = prev.reduce((m, c) => Math.max(m, c.index), 0) + 1;
        const created: InputChannel = {
          id: `ch-dyn-${Date.now()}-${nextIdx}`,
          index: nextIdx,
          name: name?.trim() || `Input ${nextIdx}`,
          role,
          authority: 'software-dsp',
          levelDb: -60,
          peakDb: -60,
          gainDb: 18,
          faderDb: 0,
          mute: false,
          solo: false,
          phantom48v: false,
          padDb: false,
          polarityInverted: false,
          hpfHz: 80,
          pan: 0,
          noiseFloorDb: -62,
          gateThresholdDb: -48,
          compThresholdDb: -18,
          compRatio: 3,
          eqLowDb: 0,
          eqMidDb: 0,
          eqMidFreqHz: 1800,
          eqHighDb: 0,
          auxSends: { stageMon1Db: -60, stageMon2Db: -60, streamBusDb: 0, subsDb: -60 },
          dcaGroup: 'None',
          stereoLinked: false,
        };
        logAudit('Added Input Channel', `CH ${nextIdx} (${created.name})`, 'operator');
        return [...prev, created];
      });
    },
    [logAudit]
  );

  const handleReconcileLiveInputs = useCallback(
    (liveInputs: MediaDeviceInfo[], isStartupSync: boolean) => {
      const result = reconcileLiveInputsToChannels(channelsRef.current, liveInputs, {
        isStartupSync,
        minSlots: 8,
      });
      if (!result.changed) return;

      channelsRef.current = result.channels;
      setChannels(result.channels);

      if (result.newlyAssigned.length > 0) {
        if (isStartupSync) {
          const summary = result.newlyAssigned
            .map((a) => `CH${a.channelIndex}: ${a.label}`)
            .join(', ');
          logAudit(
            `Auto-Slotted ${result.newlyAssigned.length} Startup Input(s)`,
            summary,
            'system'
          );
        } else {
          for (const added of result.newlyAssigned) {
            logAudit(
              'Auto-Slotted New Live Input',
              `CH${added.channelIndex} ← ${added.label}`,
              'system'
            );
          }
        }
      }
    },
    [logAudit]
  );

  const handleRemoveChannel = useCallback(
    (id: string) => {
      setChannels((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.id !== id)));
    },
    []
  );

  const handleAddEqBand = useCallback(() => {
    setDsp((prev) => {
      if (prev.eqBands.length >= 16) return prev;
      const nextNum = prev.eqBands.length + 1;
      const newBand = {
        id: `eq-dyn-${Date.now()}-${nextNum}`,
        label: `Band ${nextNum}`,
        enabled: true,
        type: 'peaking' as const,
        frequency: 1000,
        gainDb: 0,
        q: 1.8,
      };
      return { ...prev, eqBands: [...prev.eqBands, newBand] };
    });
  }, []);

  const handleRemoveEqBand = useCallback((bandId: string) => {
    setDsp((prev) => {
      if (prev.eqBands.length <= 4) return prev;
      return { ...prev, eqBands: prev.eqBands.filter((b) => b.id !== bandId) };
    });
  }, []);

  const handleAddZone = useCallback(
    (name?: string, role: SpeakerZone['role'] = 'overflow') => {
      setZones((prev) => {
        const idx = prev.length + 1;
        const created: SpeakerZone = {
          id: `zone-dyn-${Date.now()}-${idx}`,
          name: name?.trim() || `Aux / Matrix Bus ${idx}`,
          role,
          x: 50,
          y: 70,
          rotationDeg: 0,
          dispersionDeg: 90,
          distanceMeters: 6,
          delayMs: 0,
          levelDb: 0,
          mute: false,
          polarityInverted: false,
          crossoverHz: 90,
          crossoverSlope: 'LR24',
          limiterDb: -1.0,
          hardwareOutput: `Out ${idx * 2 - 1}-${idx * 2}`,
        };
        logAudit('Added Output Bus/Zone', created.name, 'operator');
        return [...prev, created];
      });
    },
    [logAudit]
  );

  const handleRemoveZone = useCallback((zoneId: string) => {
    setZones((prev) => (prev.length <= 1 ? prev : prev.filter((z) => z.id !== zoneId)));
  }, []);

  const handleUpdateZone = useCallback((id: string, patch: Partial<SpeakerZone>) => {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  }, []);

  const handleSaveAutomation = useCallback(
    (snapshot: AutomationSnapshot) => {
      setAutomationSnapshots((prev) => [
        snapshot,
        ...prev.filter((s) => s.id !== snapshot.id),
      ].slice(0, 40));
      appFetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      }).catch(() => {});
      logAudit(
        'Saved Automation Snapshot',
        `${snapshot.segment}: ${snapshot.name} (${(snapshot.durationMs / 1000).toFixed(1)}s, ${snapshot.events.length} events)`,
        'operator'
      );
    },
    [logAudit]
  );

  const handleUpdateAutomation = useCallback(
    (id: string, patch: Partial<AutomationSnapshot>) => {
      setAutomationSnapshots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
      );
      appFetch(`/api/automations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch(() => {});
    },
    []
  );

  const handleDeleteAutomation = useCallback(
    (id: string) => {
      setAutomationSnapshots((prev) => prev.filter((s) => s.id !== id));
      appFetch(`/api/automations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => {});
      logAudit('Deleted Automation Snapshot', `Removed snapshot ${id}`, 'operator');
    },
    [logAudit]
  );

  const handleLoadCustomPlugin = (jsonText: string): { ok: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(jsonText);
      const check = validatePluginManifest(parsed);
      if (!check.valid || !check.manifest) {
        return { ok: false, error: check.error };
      }
      const m = check.manifest;
      const record: LoadedPluginRecord = {
        ...m,
        loadedAt: new Date().toISOString(),
        status: m.enabled ? 'active' : 'disabled',
      };
      setPlugins((prev) => [record, ...prev.filter((p) => p.id !== m.id)]);

      if (m.kind === 'hardware-driver' && m.hardwareSpec && m.enabled) {
        const newDev: HardwareDevice = {
          id: m.id,
          ...m.hardwareSpec,
          supportedPlatforms: m.supportedPlatforms,
        };
        setDevices((prev) => [newDev, ...prev.filter((d) => d.id !== newDev.id)]);
      }
      logAudit('Loaded Dynamic Plugin', `${m.name} v${m.version} (${m.kind})`, 'operator');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON syntax.' };
    }
  };

  const handleTogglePlugin = (id: string) => {
    setPlugins((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const nextStatus = p.status === 'active' ? 'disabled' : 'active';
        if (p.kind === 'hardware-driver' && p.hardwareSpec) {
          if (nextStatus === 'active') {
            const dev: HardwareDevice = {
              id: p.id,
              ...p.hardwareSpec,
              supportedPlatforms: p.supportedPlatforms,
            };
            setDevices((dPrev) => [dev, ...dPrev.filter((d) => d.id !== dev.id)]);
          } else {
            setDevices((dPrev) => dPrev.filter((d) => d.id !== p.id));
          }
        }
        return { ...p, status: nextStatus };
      })
    );
  };

  const handleUnloadPlugin = (id: string) => {
    setPlugins((prev) => prev.filter((p) => p.id !== id));
    setDevices((prev) => prev.filter((d) => d.id !== id));
    logAudit('Unloaded Plugin', `Removed plugin ${id}`, 'operator');
  };

  const handleUpdateRemoteAccess = useCallback((patch: Partial<RemoteAccessConfig>) => {
    setRemoteAccess((prev) => ({ ...prev, ...patch }));
    appFetch('/api/remote/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.remoteAccess) setRemoteAccess(data.remoteAccess);
      })
      .catch(() => {});
  }, []);

  const handleRotateRemoteToken = useCallback(() => {
    appFetch('/api/remote/rotate-token', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.remoteAccess) {
          setRemoteAccess(data.remoteAccess);
          setRemoteClients([]);
        }
      })
      .catch(() => {});
  }, []);

  const handleDisconnectRemoteClient = useCallback((clientId: string) => {
    appFetch(`/api/remote/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.clients)) setRemoteClients(data.clients);
      })
      .catch(() => {});
  }, []);

  return {
    venueName,
    setVenueName,
    roomName,
    setRoomName,
    platform,
    driver,
    devices,
    setDevices,
    activeDevice,
    setActiveDevice,
    sampleRate,
    bufferSize,
    channels,
    setChannels,
    dsp,
    setDsp,
    undoStack,
    setUndoStack,
    emergencyMuted,
    setEmergencyMuted,
    presets,
    setPresets,
    activePreset,
    broadcastDsp,
    setBroadcastDsp,
    zones,
    setZones,
    measurement,
    setMeasurement,
    bassDi,
    setBassDi,
    obsStatus,
    setObsStatus,
    versions,
    auditEvents,
    findings,
    setFindings,
    plugins,
    automationSnapshots,
    consoleTheme,
    setConsoleTheme,
    navDockPosition,
    setNavDockPosition,
    remoteAccess,
    remoteClients,
    lanInterfaces,
    pairingUrl,
    qrDataUrl,
    logAudit,
    desktopWsRef,
    handleSelectPlatform,
    handleSelectDriver,
    handleSelectSampleRate,
    handleSelectBufferSize,
    handleRegisterDevices,
    handleSelectDevice,
    handleSelectPreset,
    handleSavePreset,
    handleUpdatePreset,
    handleSaveVersion,
    handleRollbackVersion,
    handleToggleEmergencyMute,
    handleToggleTotalBypass,
    handleUpdateDsp,
    handleResetDsp,
    handleUndoLastDsp,
    handleUpdateChannel,
    handleReconcileLiveInputs,
    handleAddChannel,
    hydrated,
    handleRemoveChannel,
    handleAddEqBand,
    handleRemoveEqBand,
    handleAddZone,
    handleUpdateZone,
    handleRemoveZone,
    handleBatchMute,
    handleClearAllSolos,
    handleApplyAutomationFrame,
    handleSaveAutomation,
    handleUpdateAutomation,
    handleDeleteAutomation,
    handleLoadCustomPlugin,
    handleTogglePlugin,
    handleUnloadPlugin,
    handleUpdateRemoteAccess,
    handleRotateRemoteToken,
    handleDisconnectRemoteClient,
  };
}
