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
  ObsStatus,
  PlatformTarget,
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
import { liveAudioEngine, type SpectrumSnapshot } from './audio/liveAudioEngine.ts';
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
  const [activeModule, setActiveModule] = useState<ModuleId>('console');

  // Venue & Platform State (Windows-first + macOS/Linux)
  const [venueName] = useState('Grace Community Fellowship');
  const [roomName] = useState('Main Sanctuary');
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
    connected: true,
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
    bitrateKbps: 6000,
    droppedFrames: 0,
    cpuUsagePct: 11,
    audioMonitorMode: 'Monitor Off',
    syncWarning: false,
  });
  const [versions, setVersions] = useState<ConfigurationVersion[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([
    {
      id: 'evt-boot',
      timestamp: new Date().toISOString(),
      actor: 'System Watchdog',
      action: 'Audio Platform Ready',
      detail: 'Windows ASIO/WASAPI, CamillaDSP schema, and dynamic plugin host initialized.',
      authority: 'system',
    },
  ]);

  // Live Audio Engine State
  const [audioSource, setAudioSource] = useState<AudioSourceSimulation>('preacher-mud');
  const [engineRunning, setEngineRunning] = useState(false);
  const [monitorAudible, setMonitorAudible] = useState(false);
  const [emergencyMuted, setEmergencyMuted] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<SignalTelemetry>(INITIAL_TELEMETRY);
  const [spectrum, setSpectrum] = useState<SpectrumSnapshot>(INITIAL_SPECTRUM);

  // Diagnostics Findings Queue
  const [findings, setFindings] = useState<DiagnosticFinding[]>([
    {
      id: 'init-mud-advisory',
      timestamp: new Date().toISOString(),
      severity: 'advisory',
      category: 'acoustics',
      title: 'Sanctuary 63–80 Hz Low-Frequency Mode & 220 Hz Speech Mud',
      evidence: 'REW Sweep +6.4 dB @ 63 Hz · RT60 1.29s @ 1 kHz',
      confidence: 88,
      explanation:
        'Measured sanctuary sweep indicates axial low-frequency buildup around 63–80 Hz and vocal chest resonance near 220 Hz. Engage a 110 Hz high-pass filter for speech and verify subwoofer polarity before applying deeper EQ.',
      physicalChecks: [
        'Confirm preacher microphone is within 10–15 cm of speaker mouth.',
        'Check subwoofer crossover alignment (90 Hz LR24) and polarity.',
      ],
      proposedPatch: {
        description: 'Set Preacher HPF 110 Hz & -4.0 dB cut @ 220 Hz',
        hpfEnabled: true,
        hpfHz: 110,
        eqBandUpdate: {
          index: 1,
          enabled: true,
          label: 'Mud Cut',
          frequency: 220,
          gainDb: -4.0,
          q: 2.2,
        },
      },
      status: 'pending',
    },
  ]);

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

  // Load persisted state from Express backend on boot
  useEffect(() => {
    fetch('/api/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
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
      })
      .catch(() => {
        // Offline / local-first fallback already active
      });
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
      setTelemetry((t) => ({ ...t, isRunning: false }));
      logAudit('Stopped Audio Engine', 'Audio DSP processing placed into standby.', 'operator');
    } else {
      try {
        await liveAudioEngine.start(audioSource, dsp);
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
        await liveAudioEngine.start(nextSrc, dsp);
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

  const handleSelectDevice = (dev: HardwareDevice) => {
    setActiveDevice(dev);
    setSampleRate(dev.defaultSampleRate);
    setBufferSize(dev.defaultBufferSize);
    setChannels(buildChannelsForDevice(dev));
    if (dev.capabilities.supportedDrivers.length > 0 && !dev.capabilities.supportedDrivers.includes(driver)) {
      setDriver(dev.capabilities.supportedDrivers[0]);
    }
    logAudit('Switched Hardware Adapter', `${dev.manufacturer} ${dev.model} (${dev.tierLabel})`, 'operator');
  };

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
              onUpdateChannel={(id, patch) =>
                setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
              }
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
              channels={channels}
              onUpdateChannel={(id, patch) =>
                setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
              }
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
              onUpdateChannel={(id, patch) =>
                setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
              }
              telemetry={telemetry}
              onLogAction={(detail) => logAudit('Microphone Intelligence', detail, 'operator')}
            />
          ) : activeModule === 'instruments' ? (
            <InstrumentIntelligenceModule
              device={activeDevice}
              dsp={dsp}
              onUpdateDsp={handleUpdateDsp}
              channels={channels}
              onUpdateChannel={(id, patch) =>
                setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
              }
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
              onUpdateChannel={(id, patch) =>
                setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
              }
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
              auditEvents={auditEvents}
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
