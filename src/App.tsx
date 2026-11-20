import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_BASS_DI_CONFIG,
  DEFAULT_DSP_CONFIG,
  DEFAULT_SPEAKER_ZONES,
  HARDWARE_CATALOG,
  INITIAL_ACOUSTIC_MEASUREMENT,
  SERVICE_PRESETS,
  buildChannelsForDevice,
} from './data/hardwareCatalog.ts';
import type {
  AcousticMeasurement,
  AudioSourceSimulation,
  AuditEvent,
  AutomationSnapshot,
  BassDiConfig,
  BroadcastDspConfig,
  ConfigurationVersion,
  ConsoleThemeId,
  DetectedHardwareEndpoint,
  DiagnosticFinding,
  DriverBackend,
  DspConfig,
  HardwareDevice,
  InputChannel,
  KeyboardShortcutBinding,
  MidiDeviceInfo,
  MidiMapping,
  MidiPacket,
  ModuleId,
  NavDockPosition,
  NetworkInterfaceInfo,
  ObsStatus,
  PlatformTarget,
  RemoteAccessConfig,
  RemoteClientSession,
  ServicePreset,
  ShortcutActionId,
  SignalTelemetry,
  SpeakerZone,
  TapTempoState,
} from './types/audio.ts';
import {
  BUILTIN_PLUGINS,
  applyDspPluginToConfig,
  validatePluginManifest,
  type LoadedPluginRecord,
} from './plugins/pluginManager.ts';
import {
  liveAudioEngine,
  subscribeHardwareChanges,
  type SpectrumSnapshot,
} from './audio/liveAudioEngine.ts';
import { scanBrowserMediaDevices } from './utils/hardwareRecognition.ts';
import {
  buildEndpointSignature,
  clearCachedHardwareEndpoints,
  loadCachedHardwareEndpoints,
  saveDetectedHardwareEndpoints,
  saveLastActiveHardwareId,
} from './utils/hardwareCacheDb.ts';
import { TopBar } from './components/TopBar.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { LiveConsoleModule } from './components/LiveConsoleModule.tsx';
import { DspEngineModule } from './components/DspEngineModule.tsx';
import { FeedbackAnalyzerModule } from './components/FeedbackAnalyzerModule.tsx';
import { AcousticAnalyzerModule } from './components/AcousticAnalyzerModule.tsx';
import { SpeakerZonesModule } from './components/SpeakerZonesModule.tsx';
import { MicrophoneIntelligenceModule } from './components/MicrophoneIntelligenceModule.tsx';
import { InstrumentIntelligenceModule } from './components/InstrumentIntelligenceModule.tsx';
import { LivestreamObsModule } from './components/LivestreamObsModule.tsx';
import { AutomatedSoundCheckModule } from './components/AutomatedSoundCheckModule.tsx';
import { PresetsServiceModule } from './components/PresetsServiceModule.tsx';
import { AiEngineerModule } from './components/AiEngineerModule.tsx';
import { MidiMappingModule } from './components/MidiMappingModule.tsx';
import { HardwareDiagnosticsModule } from './components/HardwareDiagnosticsModule.tsx';
import { VirtualDiBassModule } from './components/VirtualDiBassModule.tsx';
import { RemoteCompanionView } from './components/RemoteCompanionView.tsx';
import { KeyboardShortcutManager } from './components/KeyboardShortcutManager.tsx';
import { DEFAULT_MIDI_MAPPINGS, midiEngine, scaleMidiValue } from './midi/midiEngine.ts';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  isEditableEventTarget,
  normalizeKeyEvent,
} from './utils/keyboardShortcuts.ts';

const INITIAL_TELEMETRY: SignalTelemetry = {
  source: 'preacher-mud',
  isRunning: false,
  sampleRate: 48000,
  preRmsDb: -96,
  postRmsDb: -96,
  prePeakDb: -96,
  postPeakDb: -96,
  estimatedLufs: -70,
  gainReductionDb: 0,
  noiseFloorDb: -80,
  feedbackRisk: { detected: false, frequencyHz: null, prominenceDb: 0, persistenceSec: 0, confidence: 0 },
  humRisk: { detected: false, fundamentalHz: null, harmonic100Db: -96, harmonic150Db: -96, confidence: 0 },
  mudRisk: { detected: false, bandEnergyDb: -96, centerHz: 220 },
  clippingEvents: 0,
};

const INITIAL_SPECTRUM: SpectrumSnapshot = {
  frequencies: new Float32Array(2048),
  preDb: new Float32Array(2048).fill(-96),
  postDb: new Float32Array(2048).fill(-96),
};

export default function App() {
  const [remoteCompanionToken, setRemoteCompanionToken] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'remote') {
        const tok = params.get('token');
        if (tok) return tok;
      }
    } catch {
      // ignore URL parse error
    }
    return null;
  });

  const [activeModule, setActiveModule] = useState<ModuleId>('console');

  // Venue & Platform State (Windows-first + macOS/Linux)
  const [venueName, setVenueName] = useState('Grace Community Fellowship');
  const [roomName, setRoomName] = useState('Main Sanctuary');
  const [platform, setPlatform] = useState<PlatformTarget>('windows');
  const [driver, setDriver] = useState<DriverBackend>('ASIO');

  // Hardware & Plugin Registry
  const [devices, setDevices] = useState<HardwareDevice[]>(HARDWARE_CATALOG);
  const [activeDevice, setActiveDevice] = useState<HardwareDevice>(HARDWARE_CATALOG[0]);
  const [sampleRate, setSampleRate] = useState<number>(HARDWARE_CATALOG[0].defaultSampleRate);
  const [bufferSize, setBufferSize] = useState<number>(HARDWARE_CATALOG[0].defaultBufferSize);
  const [channels, setChannels] = useState<InputChannel[]>(() =>
    buildChannelsForDevice(HARDWARE_CATALOG[0])
  );

  const [plugins, setPlugins] = useState<LoadedPluginRecord[]>(() =>
    BUILTIN_PLUGINS.map((p) => ({
      ...p,
      loadedAt: new Date().toISOString(),
      status: p.enabled ? 'active' : 'disabled',
    }))
  );

  // DSP, Presets & Zones
  const [presets, setPresets] = useState<ServicePreset[]>(SERVICE_PRESETS);
  const [activePreset, setActivePreset] = useState<ServicePreset>(SERVICE_PRESETS[0]);
  const [dsp, setDsp] = useState<DspConfig>(DEFAULT_DSP_CONFIG);
  const [undoStack, setUndoStack] = useState<DspConfig[]>([]);
  const [broadcastDsp, setBroadcastDsp] = useState<BroadcastDspConfig>(
    SERVICE_PRESETS[0].broadcastDsp
  );
  const [zones, setZones] = useState<SpeakerZone[]>(DEFAULT_SPEAKER_ZONES);
  const [measurement, setMeasurement] = useState<AcousticMeasurement>(
    INITIAL_ACOUSTIC_MEASUREMENT
  );
  const [bassDi, setBassDi] = useState<BassDiConfig>(DEFAULT_BASS_DI_CONFIG);

  // OBS & Versions & Audit
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

  // Live Audio Engine State
  const [audioSource, setAudioSource] = useState<AudioSourceSimulation>('preacher-mud');
  const [engineRunning, setEngineRunning] = useState(false);
  const [monitorAudible, setMonitorAudible] = useState(false);
  const [emergencyMuted, setEmergencyMuted] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<SignalTelemetry>(INITIAL_TELEMETRY);
  const [spectrum, setSpectrum] = useState<SpectrumSnapshot>(INITIAL_SPECTRUM);

  // Diagnostics Findings Queue (populated only by live analysis or explicit AI diagnostic runs)
  const [findings, setFindings] = useState<DiagnosticFinding[]>([]);

  // Remote FOH Companion & LAN Sync State
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

  const desktopWsRef = useRef<WebSocket | null>(null);
  const hydratedRef = useRef<boolean>(false);
  const suppressSyncCountRef = useRef<number>(0);
  const lastTelemetryWsSentRef = useRef<number>(0);

  // Auto-Detected Hardware & Hot-Plug State (backed by IndexedDB cache)
  const [detectedEndpoints, setDetectedEndpoints] = useState<DetectedHardwareEndpoint[]>([]);
  const [scanningHardware, setScanningHardware] = useState(false);
  const [hotPlugEndpoint, setHotPlugEndpoint] = useState<DetectedHardwareEndpoint | null>(null);
  const [preferredBrowserInputId, setPreferredBrowserInputId] = useState<string | undefined>(undefined);
  const activeOnBusSignaturesRef = useRef<Set<string>>(new Set());
  const cachedSynthDevicesRef = useRef<HardwareDevice[]>([]);

  const seenAutoIssuesRef = useRef<Set<string>>(new Set());

  // MIDI Mapping State
  const [midiDevices, setMidiDevices] = useState<MidiDeviceInfo[]>([]);
  const [midiConnected, setMidiConnected] = useState(false);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [midiMappings, setMidiMappings] = useState<MidiMapping[]>(DEFAULT_MIDI_MAPPINGS);
  const [midiLearningId, setMidiLearningId] = useState<string | null>(null);
  const [lastMidiPacket, setLastMidiPacket] = useState<MidiPacket | null>(null);
  const [automationSnapshots, setAutomationSnapshots] = useState<AutomationSnapshot[]>([]);
  const [audioCpuPct, setAudioCpuPct] = useState<number>(6);
  const [underrunRisk, setUnderrunRisk] = useState<'low' | 'elevated' | 'critical'>('low');
  const lastTickTsRef = useRef<number>(performance.now());
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

  const [keyboardShortcuts, setKeyboardShortcuts] = useState<KeyboardShortcutBinding[]>(() => {
    try {
      const raw = window.localStorage.getItem('church_audio_keyboard_shortcuts');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore invalid stored shortcuts
    }
    return DEFAULT_KEYBOARD_SHORTCUTS;
  });
  const [shortcutsGlobalEnabled, setShortcutsGlobalEnabled] = useState(true);
  const [capturingShortcutId, setCapturingShortcutId] = useState<string | null>(null);
  const [shortcutConflictNotice, setShortcutConflictNotice] = useState<string | null>(null);
  const [lastTriggeredShortcut, setLastTriggeredShortcut] = useState<{
    actionId: ShortcutActionId;
    label: string;
    combo: string;
    at: string;
  } | null>(null);
  const [shortcutToast, setShortcutToast] = useState<{
    label: string;
    combo: string;
  } | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [tapTempo, setTapTempo] = useState<TapTempoState>({
    bpm: 120,
    quarterMs: 500,
    dottedEighthMs: 375,
    tapCount: 0,
    lastTapAt: 0,
  });
  const tapTimestampsRef = useRef<number[]>([]);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem('church_audio_nav_dock_v2', navDockPosition);
    } catch {
      // ignore storage quota errors
    }
  }, [navDockPosition]);

  // Enforce dark studio console root theme & apply active color theme attribute
  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-console-theme', consoleTheme);
    try {
      window.localStorage.setItem('church_audio_console_theme', consoleTheme);
    } catch {
      // ignore storage quota errors
    }
  }, [consoleTheme]);

  // Hydrate full console state from backend SQLite store on boot
  useEffect(() => {
    if (remoteCompanionToken) return;
    let active = true;

    Promise.allSettled([
      fetch('/api/state').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/remote/session').then((r) => (r.ok ? r.json() : null)),
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
          if (Array.isArray(data.channels) && data.channels.length > 0) setChannels(data.channels);
          if (data.dsp && typeof data.dsp === 'object') setDsp(data.dsp);
          if (typeof data.activePresetId === 'string') {
            const matchedPreset = SERVICE_PRESETS.find((p) => p.id === data.activePresetId);
            if (matchedPreset) setActivePreset(matchedPreset);
          }
          if (data.broadcastDsp && typeof data.broadcastDsp === 'object') {
            setBroadcastDsp(data.broadcastDsp);
          }
          if (Array.isArray(data.zones) && data.zones.length > 0) setZones(data.zones);
          if (data.obsStatus && typeof data.obsStatus === 'object') setObsStatus(data.obsStatus);
          if (data.measurement && typeof data.measurement === 'object') {
            setMeasurement(data.measurement);
          }
          if (data.bassDi && typeof data.bassDi === 'object') setBassDi(data.bassDi);
          if (typeof data.emergencyMuted === 'boolean') {
            setEmergencyMuted(data.emergencyMuted);
            liveAudioEngine.setEmergencyMute(data.emergencyMuted);
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
            setMidiMappings(data.midiMappings);
          }
          if (Array.isArray(data.automationSnapshots)) {
            setAutomationSnapshots(data.automationSnapshots);
          }
          if (Array.isArray(data.keyboardShortcuts) && data.keyboardShortcuts.length > 0) {
            setKeyboardShortcuts(data.keyboardShortcuts);
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
        if (active) hydratedRef.current = true;
      });

    return () => {
      active = false;
    };
  }, [remoteCompanionToken]);

  // Persistent Desktop WebSocket Link for Real-Time Sync with Linked Mobile Companions
  useEffect(() => {
    if (remoteCompanionToken) return;
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

  // Debounced full-state synchronization to SQLite backend (PUT /api/state/sync)
  useEffect(() => {
    if (remoteCompanionToken || !hydratedRef.current) return;
    if (suppressSyncCountRef.current > 0) {
      suppressSyncCountRef.current -= 1;
      return;
    }

    const timer = window.setTimeout(() => {
      fetch('/api/state/sync', {
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
    remoteCompanionToken,
    venueName,
    roomName,
    platform,
    driver,
    sampleRate,
    bufferSize,
    activeDevice.id,
    channels,
    dsp,
    activePreset.id,
    broadcastDsp,
    zones,
    obsStatus,
    measurement,
    bassDi,
    emergencyMuted,
    findings,
  ]);

  const handleUpdateChannel = useCallback((id: string, patch: Partial<InputChannel>) => {
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    if (desktopWsRef.current?.readyState === WebSocket.OPEN) {
      desktopWsRef.current.send(
        JSON.stringify({ type: 'channel:patch', channelId: id, patch })
      );
    }
  }, []);

  const updateAndPersistShortcuts = useCallback((next: KeyboardShortcutBinding[]) => {
    setKeyboardShortcuts(next);
    try {
      window.localStorage.setItem('church_audio_keyboard_shortcuts', JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
    fetch('/api/shortcuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shortcuts: next }),
    }).catch(() => {});
  }, []);

  const logAudit = useCallback(
    (action: string, detail: string, authority: AuditEvent['authority'] = 'operator') => {
      const evt: AuditEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        actor: 'Sound Engineer',
        action,
        detail,
        authority,
      };
      setAuditEvents((prev) => [evt, ...prev].slice(0, 80));
      fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evt),
      }).catch(() => {});
    },
    []
  );

  const updateAndPersistMidiMappings = useCallback((next: MidiMapping[]) => {
    setMidiMappings(next);
    fetch('/api/midi-mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings: next }),
    }).catch(() => {});
  }, []);

  const handleRequestMidiAccess = async () => {
    setMidiError(null);
    const res = await midiEngine.requestAccess();
    if (!res.ok) {
      setMidiError(res.error || 'Unable to access Web MIDI hardware.');
      return;
    }
    setMidiDevices(res.devices);
    setMidiConnected(true);
    logAudit('Connected Web MIDI Host', `${res.devices.length} MIDI ports discovered`, 'operator');
  };

  // Subscribe to Web MIDI device hot-plug & incoming packets
  useEffect(() => {
    const unsubDevices = midiEngine.subscribeDevices((devs) => {
      setMidiDevices(devs);
    });
    const unsubPackets = midiEngine.subscribePackets((packet) => {
      setLastMidiPacket(packet);

      if (midiLearningId) {
        setMidiMappings((prev) => {
          const next = prev.map((m) =>
            m.id === midiLearningId
              ? {
                  ...m,
                  deviceName: packet.deviceName,
                  channel: packet.channel,
                  messageType: packet.messageType,
                  controller: packet.controller,
                  lastRawValue: packet.rawValue,
                  lastUpdatedAt: packet.timestamp,
                }
              : m
          );
          fetch('/api/midi-mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mappings: next }),
          }).catch(() => {});
          return next;
        });
        setMidiLearningId(null);
        return;
      }

      // Match active bindings and drive live parameters
      setMidiMappings((prev) =>
        prev.map((m) => {
          if (!m.enabled) return m;
          if (m.channel !== packet.channel || m.messageType !== packet.messageType || m.controller !== packet.controller) {
            return m;
          }

          const val = scaleMidiValue(packet.rawValue, m);
          const isPressed = packet.rawValue > 63;

          if (m.target === 'dsp.inputTrimDb') {
            setDsp((d) => ({ ...d, inputTrimDb: val }));
          } else if (m.target === 'dsp.hpfHz') {
            setDsp((d) => ({ ...d, hpfEnabled: true, hpfHz: Math.round(val) }));
          } else if (m.target.startsWith('dsp.eqBand')) {
            const bandNum = Number(m.target.charAt(10)) - 1;
            setDsp((d) => ({
              ...d,
              eqBands: d.eqBands.map((b, i) => (i === bandNum ? { ...b, enabled: true, gainDb: val } : b)),
            }));
          } else if (m.target === 'dsp.compressor.thresholdDb') {
            setDsp((d) => ({ ...d, compressor: { ...d.compressor, enabled: true, thresholdDb: Math.round(val) } }));
          } else if (m.target === 'dsp.limiter.ceilingDb') {
            setDsp((d) => ({ ...d, limiter: { ...d.limiter, enabled: true, ceilingDb: val } }));
          } else if (m.target === 'dsp.bypassed') {
            if (m.mode === 'toggle' && isPressed) {
              setDsp((d) => {
                const nextBypass = !d.bypassed;
                midiEngine.sendFeedback(m.channel, m.messageType, m.controller, nextBypass ? 127 : 0);
                return { ...d, bypassed: nextBypass };
              });
            } else if (m.mode === 'momentary') {
              setDsp((d) => ({ ...d, bypassed: isPressed }));
            }
          } else if (m.target === 'master.emergencyMute') {
            if ((m.mode === 'toggle' && isPressed) || m.mode === 'momentary') {
              setEmergencyMuted((prevMute) => {
                const nextMute = m.mode === 'toggle' ? !prevMute : isPressed;
                liveAudioEngine.setEmergencyMute(nextMute);
                midiEngine.sendFeedback(m.channel, m.messageType, m.controller, nextMute ? 127 : 0);
                return nextMute;
              });
            }
          } else if (m.target === 'channel.1.faderDb' || m.target === 'channel.2.faderDb') {
            const chIdx = m.target === 'channel.1.faderDb' ? 0 : 1;
            setChannels((chs) => chs.map((c, i) => (i === chIdx ? { ...c, faderDb: val } : c)));
          } else if (m.target === 'channel.1.mute' || m.target === 'channel.2.mute') {
            const chIdx = m.target === 'channel.1.mute' ? 0 : 1;
            if ((m.mode === 'toggle' && isPressed) || m.mode === 'momentary') {
              setChannels((chs) =>
                chs.map((c, i) => (i === chIdx ? { ...c, mute: m.mode === 'toggle' ? !c.mute : isPressed } : c))
              );
            }
          }

          return { ...m, lastRawValue: packet.rawValue, lastUpdatedAt: packet.timestamp };
        })
      );
    });

    return () => {
      unsubDevices();
      unsubPackets();
    };
  }, [midiLearningId, logAudit]);

  // Sync live DSP config into Web Audio Engine whenever DSP changes
  useEffect(() => {
    let effectiveDsp = dsp;
    plugins
      .filter((p) => p.kind === 'dsp-processor' && p.status === 'active' && !p.builtin)
      .forEach((p) => {
        effectiveDsp = applyDspPluginToConfig(effectiveDsp, p);
      });
    liveAudioEngine.applyDsp(effectiveDsp);
  }, [dsp, plugins]);

  // Real-time 20Hz Telemetry, FFT & Audio Engine CPU Load / Buffer Underrun Monitor
  useEffect(() => {
    if (!engineRunning) {
      setAudioCpuPct(5);
      setUnderrunRisk('low');
      return;
    }

    lastTickTsRef.current = performance.now();
    const timer = window.setInterval(() => {
      const tStart = performance.now();
      const intervalDelta = tStart - lastTickTsRef.current;
      lastTickTsRef.current = tStart;

      const snap = liveAudioEngine.sampleTelemetry();
      const execMs = performance.now() - tStart;

      setTelemetry(snap.telemetry);
      setSpectrum(snap.spectrum);

      const nowTs = performance.now();
      if (
        desktopWsRef.current?.readyState === WebSocket.OPEN &&
        nowTs - lastTelemetryWsSentRef.current >= 160
      ) {
        lastTelemetryWsSentRef.current = nowTs;
        desktopWsRef.current.send(
          JSON.stringify({ type: 'telemetry:frame', telemetry: snap.telemetry })
        );
      }

      // Compute realistic audio processing load % from buffer quantum deadline,
      // active DSP nodes, event-loop scheduling jitter, and sampling execution cost.
      const quantumMs = (bufferSize / Math.max(8000, sampleRate)) * 1000;
      const activeStages =
        (dsp.bypassed
          ? 0
          : dsp.eqBands.filter((b) => b.enabled).length +
            (dsp.hpfEnabled ? 1 : 0) +
            (dsp.lpfEnabled ? 1 : 0) +
            (dsp.compressor.enabled ? 2 : 0) +
            (dsp.gate.enabled ? 1 : 0) +
            (dsp.deEsser.enabled ? 1 : 0) +
            (dsp.limiter.enabled ? 1 : 0)) +
        plugins.filter((p) => p.kind === 'dsp-processor' && p.status === 'active').length;

      const bufferPressure = Math.min(58, (3.2 / Math.max(0.6, quantumMs)) * 22);
      const dspGraphCost = activeStages * 2.2;
      const jitterPenalty = Math.max(0, intervalDelta - 72) * 0.45 + execMs * 2.5;
      const rawLoad = Math.min(
        98,
        Math.max(8, Math.round(10 + bufferPressure + dspGraphCost + jitterPenalty))
      );

      setAudioCpuPct((prev) => Math.round(prev * 0.65 + rawLoad * 0.35));
      setUnderrunRisk(
        rawLoad >= 82 || snap.telemetry.clippingEvents > 2
          ? 'critical'
          : rawLoad >= 60 || intervalDelta > 95
            ? 'elevated'
            : 'low'
      );

      // Deterministic auto-diagnosis when feedback or hum persists
      if (
        snap.telemetry.feedbackRisk.detected &&
        snap.telemetry.feedbackRisk.frequencyHz &&
        !seenAutoIssuesRef.current.has(`fb-${snap.telemetry.feedbackRisk.frequencyHz}`)
      ) {
        const freq = snap.telemetry.feedbackRisk.frequencyHz;
        seenAutoIssuesRef.current.add(`fb-${freq}`);
        setFindings((prev) => [
          {
            id: `fb-${Date.now()}`,
            timestamp: new Date().toISOString(),
            severity: 'critical',
            category: 'feedback',
            title: `Sustained Narrow-Band Ringing Detected @ ${freq} Hz`,
            evidence: `+${snap.telemetry.feedbackRisk.prominenceDb.toFixed(1)} dB prominence for ${snap.telemetry.feedbackRisk.persistenceSec}s`,
            confidence: snap.telemetry.feedbackRisk.confidence,
            explanation: `A persistent narrow-band peak at ${freq} Hz has remained dominant above neighboring frequencies. Approve a surgical notch cut or reduce wedge/mic gain physically on ${activeDevice.model}.`,
            physicalChecks: [
              'Verify pulpit/handheld mic is not pointed directly toward stage monitors or main PA.',
              'Reduce channel preamp gain slightly if ringing returns after notching.',
            ],
            proposedPatch: {
              description: `Notch -9.5 dB (Q=7.5) @ ${freq} Hz`,
              eqBandUpdate: {
                index: 3,
                enabled: true,
                label: 'Feedback Notch',
                frequency: freq,
                gainDb: -9.5,
                q: 7.5,
              },
            },
            status: 'pending',
            beforeSnapshot: { rmsDb: snap.telemetry.postRmsDb, peakDb: snap.telemetry.postPeakDb },
          },
          ...prev,
        ]);
      }

      if (
        snap.telemetry.humRisk.detected &&
        !seenAutoIssuesRef.current.has('hum-50')
      ) {
        seenAutoIssuesRef.current.add('hum-50');
        setFindings((prev) => [
          {
            id: `hum-${Date.now()}`,
            timestamp: new Date().toISOString(),
            severity: 'warning',
            category: 'hum',
            title: '50 Hz Electrical Mains Hum & 100/150 Hz Harmonics',
            evidence: `100 Hz @ ${snap.telemetry.humRisk.harmonic100Db} dB · 150 Hz @ ${snap.telemetry.humRisk.harmonic150Db} dB`,
            confidence: snap.telemetry.humRisk.confidence,
            explanation:
              'Detected stationary mains fundamental and harmonic buzz typical of a ground loop or faulty unbalanced instrument cable. Test a DI Ground Lift and swap the instrument TS cable before cutting bass frequencies with EQ.',
            physicalChecks: [
              'Toggle Ground Lift switch on the Bass DI box (e.g. Radial J48).',
              'Swap unbalanced instrument TS cable and verify bass amp/mixer share the same AC circuit.',
            ],
            proposedPatch: {
              description: 'Set Subsonic HPF to 42 Hz (preserves bass E1 fundamental)',
              hpfEnabled: true,
              hpfHz: 42,
            },
            status: 'pending',
            beforeSnapshot: { rmsDb: snap.telemetry.postRmsDb, peakDb: snap.telemetry.postPeakDb },
          },
          ...prev,
        ]);
      }
    }, 60);

    return () => window.clearInterval(timer);
  }, [engineRunning, activeDevice.model, bufferSize, sampleRate, dsp, plugins]);

  const handleToggleEngine = async () => {
    setAudioError(null);
    if (engineRunning) {
      liveAudioEngine.stop();
      setEngineRunning(false);
      const stoppedTelemetry = { ...telemetry, isRunning: false };
      setTelemetry(stoppedTelemetry);
      if (desktopWsRef.current?.readyState === WebSocket.OPEN) {
        desktopWsRef.current.send(
          JSON.stringify({ type: 'telemetry:frame', telemetry: stoppedTelemetry })
        );
      }
      logAudit('Stopped Audio Engine', 'Audio DSP processing placed into standby.', 'operator');
    } else {
      try {
        await liveAudioEngine.start(audioSource, dsp, preferredBrowserInputId);
        setEngineRunning(true);
        logAudit('Started Audio Engine', `Source: ${audioSource} · Device: ${activeDevice.model}`, 'operator');
      } catch (err) {
        setAudioError(
          err instanceof Error
            ? `Audio device access failed: ${err.message}`
            : 'Unable to initialize Web Audio device.'
        );
      }
    }
  };

  const handleSourceChange = async (nextSrc: AudioSourceSimulation) => {
    setAudioSource(nextSrc);
    seenAutoIssuesRef.current.clear();
    setAudioError(null);
    if (engineRunning) {
      try {
        await liveAudioEngine.start(nextSrc, dsp, preferredBrowserInputId);
        logAudit('Switched Audio Source', `Input switched to ${nextSrc}`, 'operator');
      } catch (err) {
        setAudioError(err instanceof Error ? err.message : 'Failed to switch audio source.');
      }
    }
  };

  const handleToggleMonitor = () => {
    const next = !monitorAudible;
    setMonitorAudible(next);
    liveAudioEngine.setMonitorAudible(next);
  };

  const handleToggleEmergencyMute = () => {
    const next = !emergencyMuted;
    setEmergencyMuted(next);
    liveAudioEngine.setEmergencyMute(next);
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
  };

  const handleToggleTotalBypass = () => {
    const next = !dsp.bypassed;
    setDsp((prev) => {
      setUndoStack((u) => [prev, ...u].slice(0, 15));
      return { ...prev, bypassed: next };
    });
    logAudit(
      next ? 'Engaged Total Signal Bypass' : 'Restored DSP Signal Processing',
      next
        ? 'All software EQ, HPF, compression, and limiting bypassed for clean dry pass-through.'
        : 'Re-engaged full CamillaDSP signal processing chain.',
      'operator'
    );
  };

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

  const handleUpdateRemoteAccess = useCallback((patch: Partial<RemoteAccessConfig>) => {
    setRemoteAccess((prev) => ({ ...prev, ...patch }));
    fetch('/api/remote/session', {
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
    fetch('/api/remote/rotate-token', { method: 'POST' })
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
    fetch(`/api/remote/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.clients)) setRemoteClients(data.clients);
      })
      .catch(() => {});
  }, []);

  const handleExitRemoteCompanion = useCallback(() => {
    setRemoteCompanionToken(null);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('mode') || url.searchParams.has('token')) {
        url.searchParams.delete('mode');
        url.searchParams.delete('token');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // ignore URL mutation errors
    }
  }, []);

  const handleUndoLastDsp = () => {
    if (undoStack.length === 0) return;
    const [previous, ...rest] = undoStack;
    setUndoStack(rest);
    setDsp(previous);
    logAudit('Restored Previous DSP State', 'Rolled back last DSP parameter change.', 'operator');
  };

  const handleSelectPreset = (preset: ServicePreset) => {
    setUndoStack((u) => [dsp, ...u].slice(0, 15));
    setActivePreset(preset);
    setDsp(preset.dsp);
    setBroadcastDsp(preset.broadcastDsp);
    logAudit('Loaded Service Preset', `${preset.name} (v${preset.version})`, 'operator');
  };

  const handleSelectDevice = useCallback(
    async (dev: HardwareDevice, overrideDriver?: DriverBackend) => {
      // 1. Persist the current device's mix profile before switching away
      if (activeDevice.id !== dev.id) {
        fetch(`/api/hardware/profiles/${encodeURIComponent(activeDevice.id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channels,
            sampleRate,
            bufferSize,
            driver,
          }),
        }).catch(() => {});
      }

      setActiveDevice(dev);
      let nextSr = dev.defaultSampleRate;
      let nextBs = dev.defaultBufferSize;
      let nextDriver = overrideDriver ?? driver;
      if (
        dev.capabilities.supportedDrivers.length > 0 &&
        !dev.capabilities.supportedDrivers.includes(nextDriver)
      ) {
        nextDriver = dev.capabilities.supportedDrivers[0];
      }

      // 2. Recall per-device mix profile from SQLite if previously used
      try {
        const res = await fetch(`/api/hardware/profiles/${encodeURIComponent(dev.id)}`);
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
    [activeDevice.id, bufferSize, channels, driver, logAudit, sampleRate]
  );

  const runHardwareScan = useCallback(
    async (requestBrowserPermission = false, announceHotPlug = false) => {
      setScanningHardware(true);
      try {
        // Hydrate any previously remembered profiles from IndexedDB before full bus/network scan completes
        const cachedBeforeScan = await loadCachedHardwareEndpoints();
        if (cachedBeforeScan.endpoints.length > 0) {
          cachedSynthDevicesRef.current = cachedBeforeScan.synthesizedDevices;
          if (cachedBeforeScan.synthesizedDevices.length > 0) {
            setDevices((prev) => {
              const existingIds = new Set(prev.map((d) => d.id));
              const additions = cachedBeforeScan.synthesizedDevices.filter(
                (d) => !existingIds.has(d.id)
              );
              return additions.length > 0 ? [...prev, ...additions] : prev;
            });
          }
          setDetectedEndpoints((prev) =>
            prev.length === 0 ? cachedBeforeScan.endpoints : prev
          );
        }

        if (requestBrowserPermission && navigator.mediaDevices?.getUserMedia) {
          try {
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            tempStream.getTracks().forEach((t) => t.stop());
          } catch {
            // Proceed even if browser mic permission is denied; OS probe still works
          }
        }

        const [serverRes, browserEndpoints] = await Promise.all([
          fetch('/api/hardware/scan')
            .then((r) => (r.ok ? r.json() : { endpoints: [] }))
            .catch(() => ({ endpoints: [] })),
          scanBrowserMediaDevices(platform),
        ]);

        const serverEndpoints: DetectedHardwareEndpoint[] = Array.isArray(serverRes?.endpoints)
          ? serverRes.endpoints
          : [];

        const mergedMap = new Map<string, DetectedHardwareEndpoint>();
        for (const ep of [...serverEndpoints, ...browserEndpoints]) {
          const dedupKey = `${ep.matchedDeviceId}::${ep.name.toLowerCase()}`;
          const existing = mergedMap.get(dedupKey);
          if (!existing) {
            mergedMap.set(dedupKey, ep);
          } else {
            mergedMap.set(dedupKey, {
              ...existing,
              browserDeviceId: existing.browserDeviceId || ep.browserDeviceId,
              vendorId: existing.vendorId || ep.vendorId,
              productId: existing.productId || ep.productId,
              synthesizedDevice: existing.synthesizedDevice || ep.synthesizedDevice,
            });
          }
        }

        const liveEndpoints = Array.from(mergedMap.values());
        const persistedMerged = await saveDetectedHardwareEndpoints(
          liveEndpoints,
          activeDevice.id
        );
        setDetectedEndpoints(persistedMerged);

        // Register any newly synthesized Universal Profiles (live + remembered) in device catalog
        const allSynthDevices = persistedMerged
          .map((ep) => ep.synthesizedDevice)
          .filter((d): d is HardwareDevice => Boolean(d));
        if (allSynthDevices.length > 0) {
          cachedSynthDevicesRef.current = allSynthDevices;
          setDevices((prev) => {
            const existingIds = new Set(prev.map((d) => d.id));
            const additions = allSynthDevices.filter((d) => !existingIds.has(d.id));
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });
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
    [activeDevice.id, logAudit, platform]
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
        setDevices((prev) =>
          prev.some((d) => d.id === targetDevice!.id) ? prev : [...prev, targetDevice!]
        );
      }
      if (!targetDevice) return;

      if (ep.browserDeviceId) {
        setPreferredBrowserInputId(ep.browserDeviceId);
      }
      setHotPlugEndpoint(null);
      await handleSelectDevice(targetDevice, ep.recommendedDriver);

      if (engineRunning && audioSource === 'live-mic' && ep.browserDeviceId) {
        try {
          await liveAudioEngine.start('live-mic', dsp, ep.browserDeviceId);
        } catch {
          // ignore if live mic permission not yet granted
        }
      }
    },
    [audioSource, devices, dsp, engineRunning, handleSelectDevice]
  );

  // Instant IndexedDB cache hydration on boot followed by live USB/LAN scan & devicechange hot-plug watcher
  useEffect(() => {
    if (remoteCompanionToken) return;
    let mounted = true;

    void loadCachedHardwareEndpoints().then((cached) => {
      if (!mounted) return;
      if (cached.synthesizedDevices.length > 0) {
        cachedSynthDevicesRef.current = cached.synthesizedDevices;
        setDevices((prev) => {
          const existingIds = new Set(prev.map((d) => d.id));
          const additions = cached.synthesizedDevices.filter((d) => !existingIds.has(d.id));
          return additions.length > 0 ? [...prev, ...additions] : prev;
        });
      }
      if (cached.endpoints.length > 0) {
        setDetectedEndpoints(cached.endpoints);
      }
      if (cached.lastActiveDeviceId) {
        const cachedDev = cached.synthesizedDevices.find(
          (d) => d.id === cached.lastActiveDeviceId
        );
        if (cachedDev) {
          setActiveDevice((curr) => (curr.id === HARDWARE_CATALOG[0].id ? cachedDev : curr));
        }
      }
    });

    void runHardwareScan(false, false);
    const unsub = subscribeHardwareChanges(() => {
      void runHardwareScan(false, true);
    });
    return () => {
      mounted = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteCompanionToken]);

  const handleApproveFinding = (id: string) => {
    const target = findings.find((f) => f.id === id);
    if (!target || !target.proposedPatch) return;
    const patch = target.proposedPatch;

    const nextDsp: DspConfig = { ...dsp, bypassed: false };
    if (typeof patch.hpfEnabled === 'boolean') nextDsp.hpfEnabled = patch.hpfEnabled;
    if (typeof patch.hpfHz === 'number') nextDsp.hpfHz = patch.hpfHz;
    if (patch.eqBandUpdate) {
      const idx = patch.eqBandUpdate.index ?? 1;
      nextDsp.eqBands = nextDsp.eqBands.map((b, i) =>
        i === idx ? { ...b, ...patch.eqBandUpdate, enabled: true } : b
      );
    }

    handleUpdateDsp(nextDsp);
    setFindings((prev) =>
      prev.map((f) =>
        f.id === id
          ? {
              ...f,
              status: 'verified',
              afterSnapshot: telemetry.isRunning
                ? { rmsDb: telemetry.postRmsDb, peakDb: telemetry.postPeakDb }
                : undefined,
            }
          : f
      )
    );
    logAudit('Approved AI DSP Patch', `${target.title} → ${patch.description}`, 'ai-approved');
  };

  const handleSaveVersion = (summary: string) => {
    const snapshot: ConfigurationVersion = {
      id: `ver-${Date.now()}`,
      version: `v${versions.length + 1}.0`,
      presetName: activePreset.name,
      timestamp: new Date().toISOString(),
      author: 'Sound Engineer',
      summary,
      deviceId: activeDevice.id,
      platform,
      dsp,
      broadcastDsp,
      zones,
    };
    setVersions((prev) => [snapshot, ...prev]);
    fetch('/api/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    }).catch(() => {});
    logAudit('Saved Configuration Snapshot', `${snapshot.version}: ${summary}`, 'operator');
  };

  const handleRollbackVersion = (ver: ConfigurationVersion) => {
    setUndoStack((u) => [dsp, ...u].slice(0, 15));
    setDsp(ver.dsp);
    setBroadcastDsp(ver.broadcastDsp);
    setZones(ver.zones);
    logAudit('Rolled Back Configuration', `Restored ${ver.presetName} (${ver.version})`, 'operator');
  };

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
          return nextMute;
        });
      }
    },
    []
  );

  const handleSaveAutomation = useCallback(
    (snapshot: AutomationSnapshot) => {
      setAutomationSnapshots((prev) => [
        snapshot,
        ...prev.filter((s) => s.id !== snapshot.id),
      ].slice(0, 40));
      fetch('/api/automations', {
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
      fetch(`/api/automations/${encodeURIComponent(id)}`, {
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
      fetch(`/api/automations/${encodeURIComponent(id)}`, {
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

  const handleTapTempo = useCallback(() => {
    const now = performance.now();
    const prevTaps = tapTimestampsRef.current;
    const recent =
      prevTaps.length > 0 && now - prevTaps[prevTaps.length - 1] <= 2400
        ? [...prevTaps, now].slice(-6)
        : [now];
    tapTimestampsRef.current = recent;

    setTapTempo((prev) => {
      let nextBpm = prev.bpm;
      if (recent.length >= 2) {
        let sumDelta = 0;
        for (let i = 1; i < recent.length; i++) {
          sumDelta += recent[i] - recent[i - 1];
        }
        const avgDeltaMs = sumDelta / (recent.length - 1);
        nextBpm = Math.max(40, Math.min(240, Math.round(60000 / Math.max(200, avgDeltaMs))));
      }
      const quarterMs = Math.round(60000 / nextBpm);
      const dottedEighthMs = Math.round(45000 / nextBpm);
      return {
        bpm: nextBpm,
        quarterMs,
        dottedEighthMs,
        tapCount: recent.length,
        lastTapAt: Date.now(),
      };
    });
  }, []);

  const executeShortcutAction = useCallback(
    (actionId: ShortcutActionId, viaCombo = '') => {
      const binding = keyboardShortcuts.find((s) => s.actionId === actionId);
      const actionLabel = binding?.label ?? actionId;

      if (actionId === 'mute-all') {
        handleToggleEmergencyMute();
      } else if (actionId === 'total-bypass') {
        handleToggleTotalBypass();
      } else if (actionId === 'tap-tempo') {
        handleTapTempo();
      } else if (actionId === 'save-snapshot') {
        handleSaveVersion(`Quick Snapshot (${viaCombo || 'Shortcut'})`);
      } else if (actionId === 'undo-dsp') {
        handleUndoLastDsp();
      } else if (actionId === 'toggle-engine') {
        void handleToggleEngine();
      } else if (actionId === 'toggle-monitor') {
        handleToggleMonitor();
      } else if (actionId === 'mute-band') {
        setChannels((prev) => {
          const bandChannels = prev.filter(
            (c) => c.dcaGroup === 'DCA 2 · Band' || c.dcaGroup === 'DCA 3 · Choir'
          );
          const anyUnmuted = bandChannels.some((c) => !c.mute);
          const nextMute = anyUnmuted;
          logAudit(
            nextMute ? 'Muted Band & Choir Bus' : 'Unmuted Band & Choir Bus',
            `Toggled ${bandChannels.length} stage channels via keyboard shortcut`,
            'operator'
          );
          return prev.map((c) =>
            c.dcaGroup === 'DCA 2 · Band' || c.dcaGroup === 'DCA 3 · Choir'
              ? { ...c, mute: nextMute }
              : c
          );
        });
      } else if (actionId === 'clear-solos') {
        setChannels((prev) => prev.map((c) => (c.solo ? { ...c, solo: false } : c)));
        logAudit('Cleared All Solos', 'Released all PFL/AFL solo latches via shortcut', 'operator');
      } else if (actionId === 'jump-console') {
        setActiveModule('console');
      } else if (actionId === 'jump-dsp') {
        setActiveModule('dsp');
      } else if (actionId === 'jump-feedback') {
        setActiveModule('feedback');
      }

      setLastTriggeredShortcut({
        actionId,
        label: actionLabel,
        combo: viaCombo || binding?.keyCombo || 'KEY',
        at: new Date().toISOString(),
      });
      setShortcutToast({
        label: actionLabel,
        combo: viaCombo || binding?.keyCombo || 'KEY',
      });
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setShortcutToast(null);
      }, 2200);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyboardShortcuts, emergencyMuted, dsp, undoStack, engineRunning, monitorAudible, activePreset, activeDevice, platform, versions.length]
  );

  // Global window keydown listener for key capture & live console shortcut execution
  const shortcutRuntimeRef = useRef({
    capturingShortcutId,
    keyboardShortcuts,
    shortcutsGlobalEnabled,
    showShortcutsModal,
    executeShortcutAction,
    updateAndPersistShortcuts,
  });

  shortcutRuntimeRef.current = {
    capturingShortcutId,
    keyboardShortcuts,
    shortcutsGlobalEnabled,
    showShortcutsModal,
    executeShortcutAction,
    updateAndPersistShortcuts,
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const runtime = shortcutRuntimeRef.current;

      // 1. Key Capture / Binding Mode
      if (runtime.capturingShortcutId) {
        e.preventDefault();
        e.stopPropagation();

        if (e.code === 'Escape') {
          setCapturingShortcutId(null);
          return;
        }

        const combo = normalizeKeyEvent(e);
        if (!combo) return;

        const targetRow = runtime.keyboardShortcuts.find(
          (s) => s.id === runtime.capturingShortcutId
        );
        const conflictingRow = runtime.keyboardShortcuts.find(
          (s) => s.id !== runtime.capturingShortcutId && s.keyCombo === combo
        );

        const updated = runtime.keyboardShortcuts.map((s) => {
          if (s.id === runtime.capturingShortcutId) {
            return { ...s, keyCombo: combo, enabled: true };
          }
          if (conflictingRow && s.id === conflictingRow.id) {
            return { ...s, keyCombo: '', enabled: false };
          }
          return s;
        });

        runtime.updateAndPersistShortcuts(updated);
        setCapturingShortcutId(null);
        setShortcutConflictNotice(
          conflictingRow && targetRow
            ? `Reassigned "${combo}" from "${conflictingRow.label}" to "${targetRow.label}".`
            : null
        );
        return;
      }

      // 2. Allow Escape to dismiss shortcut manager modal
      if (runtime.showShortcutsModal && e.code === 'Escape') {
        e.preventDefault();
        setShowShortcutsModal(false);
        return;
      }

      // 3. Global Console Action Execution
      if (!runtime.shortcutsGlobalEnabled) return;
      if (isEditableEventTarget(e.target)) return;
      if (e.repeat) return;

      const combo = normalizeKeyEvent(e);
      if (!combo) return;

      const matched = runtime.keyboardShortcuts.find(
        (s) => s.enabled && s.keyCombo === combo
      );
      if (!matched) return;

      e.preventDefault();
      runtime.executeShortcutAction(matched.actionId, combo);
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  const pendingFindingsCount = findings.filter((f) => f.status === 'pending').length;
  const activeDspPlugins = useMemo(
    () => plugins.filter((p) => p.kind === 'dsp-processor' && p.status === 'active'),
    [plugins]
  );

  if (remoteCompanionToken) {
    return (
      <RemoteCompanionView
        token={remoteCompanionToken}
        onExitRemote={handleExitRemoteCompanion}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#080B10] text-slate-100 overflow-hidden">
      <TopBar
        venueName={venueName}
        roomName={roomName}
        activeDevice={activeDevice}
        platform={platform}
        driver={driver}
        sampleRate={sampleRate}
        bufferSize={bufferSize}
        activePreset={activePreset}
        engineRunning={engineRunning}
        onToggleEngine={handleToggleEngine}
        monitorAudible={monitorAudible}
        onToggleMonitor={handleToggleMonitor}
        emergencyMuted={emergencyMuted}
        onToggleEmergencyMute={handleToggleEmergencyMute}
        totalBypassed={dsp.bypassed}
        onToggleTotalBypass={handleToggleTotalBypass}
        consoleTheme={consoleTheme}
        onThemeChange={setConsoleTheme}
        audioSource={audioSource}
        onSourceChange={handleSourceChange}
        audioCpuPct={audioCpuPct}
        underrunRisk={underrunRisk}
        onOpenDiagnostics={() => setActiveModule('hardware')}
        tapTempo={tapTempo}
        onTapTempo={() => executeShortcutAction('tap-tempo', 'CLICK')}
        onOpenShortcuts={() => setShowShortcutsModal(true)}
        shortcutsArmed={shortcutsGlobalEnabled}
      />

      {(emergencyMuted || dsp.bypassed) && (
        <div
          className={`shrink-0 px-4 py-1.5 border-b font-mono text-xs flex flex-wrap items-center justify-between gap-2 ${
            emergencyMuted
              ? 'bg-red-950/80 border-red-500/60 text-red-200'
              : 'bg-amber-950/70 border-amber-500/50 text-amber-200'
          }`}
        >
          <span className="font-semibold">
            {emergencyMuted && dsp.bypassed
              ? 'SAFETY OVERRIDE: GLOBAL EMERGENCY MUTE & TOTAL SIGNAL BYPASS BOTH ENGAGED'
              : emergencyMuted
                ? 'GLOBAL EMERGENCY MUTE ACTIVE — LIVE PA & MONITOR OUTPUTS SILENCED'
                : 'TOTAL SIGNAL BYPASS ACTIVE — DRY UNPROCESSED PASS-THROUGH (EQ/HPF/DYNAMICS BYPASSED)'}
          </span>
          <div className="flex items-center gap-2">
            {dsp.bypassed && (
              <button
                type="button"
                onClick={handleToggleTotalBypass}
                className="px-2 py-0.5 rounded border border-amber-400/60 bg-amber-500/20 text-amber-100 hover:bg-amber-500/35 text-[11px] font-semibold"
              >
                RESTORE DSP
              </button>
            )}
            {emergencyMuted && (
              <button
                type="button"
                onClick={handleToggleEmergencyMute}
                className="px-2 py-0.5 rounded border border-red-400/60 bg-red-600 text-white hover:bg-red-500 text-[11px] font-semibold"
              >
                UNMUTE PA
              </button>
            )}
          </div>
        </div>
      )}

      {hotPlugEndpoint && (
        <div className="shrink-0 px-4 py-1.5 border-b border-sky-500/50 bg-sky-950/75 text-sky-100 font-mono text-xs flex flex-wrap items-center justify-between gap-2">
          <span>
            NEW AUDIO HARDWARE DETECTED: <strong>{hotPlugEndpoint.name}</strong> → Auto-matched{' '}
            <strong>{hotPlugEndpoint.matchedLabel}</strong> ({hotPlugEndpoint.recommendedDriver} ·{' '}
            {hotPlugEndpoint.estimatedInputChannels}×{hotPlugEndpoint.estimatedOutputChannels})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleBindDetectedEndpoint(hotPlugEndpoint)}
              className="px-2.5 py-0.5 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-[11px]"
            >
              AUTO-BIND &amp; RECALL
            </button>
            <button
              type="button"
              onClick={() => setHotPlugEndpoint(null)}
              className="px-2 py-0.5 rounded border border-sky-400/40 text-sky-200 hover:bg-sky-500/20 text-[11px]"
            >
              DISMISS
            </button>
          </div>
        </div>
      )}

      <div
        className={`flex-1 flex min-h-0 ${
          navDockPosition === 'top' || navDockPosition === 'bottom' ? 'flex-col' : 'flex-row'
        }`}
      >
        <div
          className={`flex min-h-0 min-w-0 shrink-0 ${
            navDockPosition === 'right' || navDockPosition === 'bottom' ? 'order-2' : 'order-1'
          }`}
        >
          <Sidebar
            activeModule={activeModule}
            onSelectModule={setActiveModule}
            telemetry={telemetry}
            pendingFindingsCount={pendingFindingsCount}
            dockPosition={navDockPosition}
            onChangeDockPosition={setNavDockPosition}
          />
        </div>

        <main
          className={`flex-1 min-h-0 min-w-0 overflow-y-auto p-4 lg:p-5 bg-[#080B10] ${
            navDockPosition === 'right' || navDockPosition === 'bottom' ? 'order-1' : 'order-2'
          }`}
        >
          {audioError && (
            <div className="mb-4 p-3 rounded-md border border-red-500/40 bg-red-500/10 text-xs text-red-300">
              {audioError}
            </div>
          )}

          {activeModule === 'console' ? (
            <LiveConsoleModule
              device={activeDevice}
              channels={channels}
              onUpdateChannel={handleUpdateChannel}
              dsp={dsp}
              onUpdateDsp={handleUpdateDsp}
              telemetry={telemetry}
              presets={presets}
              activePreset={activePreset}
              onSelectPreset={handleSelectPreset}
              emergencyMuted={emergencyMuted}
              onToggleEmergencyMute={handleToggleEmergencyMute}
              onUndo={handleUndoLastDsp}
              canUndo={undoStack.length > 0}
              onSaveVersion={handleSaveVersion}
              automationSnapshots={automationSnapshots}
              onSaveAutomation={handleSaveAutomation}
              onUpdateAutomation={handleUpdateAutomation}
              onDeleteAutomation={handleDeleteAutomation}
              onApplyAutomationFrame={handleApplyAutomationFrame}
              onLogAutomationEvent={(action, detail) => logAudit(action, detail, 'operator')}
            />
          ) : activeModule === 'dsp' ? (
            <DspEngineModule
              dsp={dsp}
              onUpdateDsp={handleUpdateDsp}
              device={activeDevice}
              platform={platform}
              driver={driver}
              sampleRate={sampleRate}
              bufferSize={bufferSize}
              zones={zones}
              activeDspPlugins={activeDspPlugins}
              telemetry={telemetry}
              audioCpuPct={audioCpuPct}
              channels={channels}
              onUpdateChannel={handleUpdateChannel}
              presets={presets}
              activePresetId={activePreset.id}
              onSelectPreset={handleSelectPreset}
              emergencyMuted={emergencyMuted}
              onToggleEmergencyMute={handleToggleEmergencyMute}
            />
          ) : activeModule === 'feedback' ? (
            <FeedbackAnalyzerModule
              telemetry={telemetry}
              spectrum={spectrum}
              dsp={dsp}
              onUpdateDsp={handleUpdateDsp}
              onLogVerification={(summary) =>
                logAudit('Verified DSP Correction', summary, 'operator')
              }
            />
          ) : activeModule === 'acoustics' ? (
            <AcousticAnalyzerModule
              measurement={measurement}
              onUpdateMeasurement={setMeasurement}
              onExportRoomModeCut={(freqHz) => {
                handleUpdateDsp({
                  bypassed: false,
                  eqBands: dsp.eqBands.map((b, idx) =>
                    idx === 0
                      ? { ...b, label: 'Room Mode Cut', enabled: true, frequency: freqHz, gainDb: -3.5, q: 4.5 }
                      : b
                  ),
                });
                logAudit('Exported Room Mode Cut', `Applied -3.5 dB modal cut @ ${freqHz} Hz from REW Analyzer`, 'operator');
              }}
            />
          ) : activeModule === 'speakers' ? (
            <SpeakerZonesModule
              zones={zones}
              onUpdateZone={(id, patch) =>
                setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)))
              }
              telemetry={telemetry}
              emergencyMuted={emergencyMuted}
              onToggleEmergencyMute={handleToggleEmergencyMute}
            />
          ) : activeModule === 'microphones' ? (
            <MicrophoneIntelligenceModule
              device={activeDevice}
              dsp={dsp}
              onUpdateDsp={handleUpdateDsp}
              channels={channels}
              onUpdateChannel={handleUpdateChannel}
              telemetry={telemetry}
              onLogAction={(detail) => logAudit('Microphone Intelligence', detail, 'operator')}
            />
          ) : activeModule === 'instruments' ? (
            <InstrumentIntelligenceModule
              device={activeDevice}
              dsp={dsp}
              onUpdateDsp={handleUpdateDsp}
              channels={channels}
              onUpdateChannel={handleUpdateChannel}
              telemetry={telemetry}
              onLogAction={(detail) => logAudit('Instrument & Music Intelligence', detail, 'operator')}
            />
          ) : activeModule === 'livestream' ? (
            <LivestreamObsModule
              broadcastDsp={broadcastDsp}
              onUpdateBroadcastDsp={(patch) =>
                setBroadcastDsp((prev) => ({ ...prev, ...patch }))
              }
              obsStatus={obsStatus}
              onUpdateObs={(patch) => setObsStatus((prev) => ({ ...prev, ...patch }))}
              telemetry={telemetry}
              device={activeDevice}
            />
          ) : activeModule === 'soundcheck' ? (
            <AutomatedSoundCheckModule
              device={activeDevice}
              channels={channels}
              onUpdateChannel={handleUpdateChannel}
              dsp={dsp}
              onUpdateDsp={handleUpdateDsp}
              broadcastDsp={broadcastDsp}
              telemetry={telemetry}
              obsStatus={obsStatus}
              measurement={measurement}
              onStartEngine={handleToggleEngine}
              onLogAction={(detail) => logAudit('Automated Sound Check', detail, 'operator')}
            />
          ) : activeModule === 'presets' ? (
            <PresetsServiceModule
              device={activeDevice}
              dsp={dsp}
              obsStatus={obsStatus}
              onUpdateObs={(patch) => setObsStatus((prev) => ({ ...prev, ...patch }))}
              presets={presets}
              activePreset={activePreset}
              onSelectPreset={handleSelectPreset}
              versions={versions}
              onSaveVersion={handleSaveVersion}
              onRollbackVersion={handleRollbackVersion}
              onImportPresetJson={(imported) => {
                setPresets((prev) => [imported, ...prev]);
                handleSelectPreset(imported);
              }}
            />
          ) : activeModule === 'virtual-di' ? (
            <VirtualDiBassModule
              device={activeDevice}
              bassDi={bassDi}
              onUpdateBassDi={(patch) => setBassDi((prev) => ({ ...prev, ...patch }))}
              dsp={dsp}
              onUpdateDsp={handleUpdateDsp}
              telemetry={telemetry}
              spectrum={spectrum}
              onLogAction={(detail) => logAudit('Virtual DI & Bass Processor', detail, 'operator')}
            />
          ) : activeModule === 'ai-engineer' ? (
            <AiEngineerModule
              device={activeDevice}
              platform={platform}
              driver={driver}
              dsp={dsp}
              telemetry={telemetry}
              findings={findings}
              onAddFinding={(f) => setFindings((prev) => [f, ...prev])}
              onApproveFinding={handleApproveFinding}
              onDismissFinding={(id) =>
                setFindings((prev) =>
                  prev.map((f) => (f.id === id ? { ...f, status: 'dismissed' } : f))
                )
              }
            />
          ) : activeModule === 'midi' ? (
            <MidiMappingModule
              platform={platform}
              midiDevices={midiDevices}
              midiConnected={midiConnected}
              midiError={midiError}
              onRequestMidiAccess={handleRequestMidiAccess}
              mappings={midiMappings}
              onUpdateMappings={updateAndPersistMidiMappings}
              learningId={midiLearningId}
              onSetLearningId={setMidiLearningId}
              lastPacket={lastMidiPacket}
              dsp={dsp}
              emergencyMuted={emergencyMuted}
              shortcuts={keyboardShortcuts}
              onUpdateShortcuts={updateAndPersistShortcuts}
              shortcutsGlobalEnabled={shortcutsGlobalEnabled}
              onToggleShortcutsGlobalEnabled={() => setShortcutsGlobalEnabled((v) => !v)}
              capturingShortcutId={capturingShortcutId}
              onSetCapturingShortcutId={setCapturingShortcutId}
              onTriggerShortcutAction={executeShortcutAction}
              lastTriggeredShortcut={lastTriggeredShortcut}
              shortcutConflictNotice={shortcutConflictNotice}
              tapTempo={tapTempo}
            />
          ) : (
            <HardwareDiagnosticsModule
              devices={devices}
              activeDevice={activeDevice}
              onSelectDevice={handleSelectDevice}
              platform={platform}
              onSelectPlatform={setPlatform}
              driver={driver}
              onSelectDriver={setDriver}
              sampleRate={sampleRate}
              onSelectSampleRate={setSampleRate}
              bufferSize={bufferSize}
              onSelectBufferSize={setBufferSize}
              plugins={plugins}
              onTogglePlugin={handleTogglePlugin}
              onLoadCustomPlugin={handleLoadCustomPlugin}
              onUnloadPlugin={handleUnloadPlugin}
              telemetry={telemetry}
              audioCpuPct={audioCpuPct}
              auditEvents={auditEvents}
              remoteAccess={remoteAccess}
              remoteClients={remoteClients}
              lanInterfaces={lanInterfaces}
              onUpdateRemoteAccess={handleUpdateRemoteAccess}
              onRotateRemoteToken={handleRotateRemoteToken}
              onDisconnectRemoteClient={handleDisconnectRemoteClient}
              onOpenRemoteCompanion={(tok) => setRemoteCompanionToken(tok)}
              detectedEndpoints={detectedEndpoints}
              scanningHardware={scanningHardware}
              onScanHardware={(reqPerm) => void runHardwareScan(Boolean(reqPerm), false)}
              onBindDetectedEndpoint={(ep) => void handleBindDetectedEndpoint(ep)}
              onClearHardwareCache={() => void handleClearHardwareCache()}
            />
          )}
        </main>
      </div>

      {/* Global Keyboard Shortcut Manager Modal */}
      {showShortcutsModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Global Keyboard Shortcut Manager"
        >
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700 bg-[#080B10] p-4 shadow-2xl">
            <KeyboardShortcutManager
              shortcuts={keyboardShortcuts}
              onUpdateShortcuts={updateAndPersistShortcuts}
              globalEnabled={shortcutsGlobalEnabled}
              onToggleGlobalEnabled={() => setShortcutsGlobalEnabled((v) => !v)}
              capturingId={capturingShortcutId}
              onSetCapturingId={setCapturingShortcutId}
              onTriggerAction={executeShortcutAction}
              lastTriggered={lastTriggeredShortcut}
              conflictNotice={shortcutConflictNotice}
              tapTempo={tapTempo}
              emergencyMuted={emergencyMuted}
              isModal
              onClose={() => setShowShortcutsModal(false)}
            />
          </div>
        </div>
      )}

      {/* Non-intrusive Keydown Trigger Feedback Toast */}
      {shortcutToast && !showShortcutsModal && (
        <div className="fixed bottom-4 right-4 z-40 pointer-events-none rounded-md border border-sky-400/50 bg-[#0D1119]/95 px-3 py-2 shadow-xl font-mono text-xs flex items-center gap-2.5">
          <span className="px-1.5 py-0.5 rounded-xs border border-sky-400/50 bg-sky-500/20 text-sky-300 font-bold">
            {shortcutToast.combo}
          </span>
          <span className="text-white font-semibold">{shortcutToast.label}</span>
        </div>
      )}
    </div>
  );
}
