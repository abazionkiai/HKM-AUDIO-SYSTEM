import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuditAuthority,
  AudioSourceSimulation,
  DiagnosticFinding,
  DspConfig,
  HardwareDevice,
  InputChannel,
  SignalTelemetry,
  SpeakerZone,
} from '../types/audio.ts';
import {
  liveAudioEngine,
  type SpectrumSnapshot,
} from '../audio/liveAudioEngine.ts';
import {
  applyDspPluginToConfig,
  type LoadedPluginRecord,
} from '../plugins/pluginManager.ts';

export const INITIAL_TELEMETRY: SignalTelemetry = {
  source: 'live-mic',
  isRunning: false,
  sampleRate: 48000,
  activeInputLabel: null,
  capturedChannels: 0,
  preRmsDb: -96,
  postRmsDb: -96,
  postLRmsDb: -96,
  postRRmsDb: -96,
  prePeakDb: -96,
  postPeakDb: -96,
  postLPeakDb: -96,
  postRPeakDb: -96,
  estimatedLufs: -70,
  gainReductionDb: 0,
  noiseFloorDb: -96,
  channelLevels: [],
  feedbackRisk: { detected: false, frequencyHz: null, prominenceDb: 0, persistenceSec: 0, confidence: 0 },
  humRisk: { detected: false, fundamentalHz: null, harmonic100Db: -96, harmonic150Db: -96, confidence: 0 },
  mudRisk: { detected: false, bandEnergyDb: -96, centerHz: 220 },
  clippingEvents: 0,
};

export const INITIAL_SPECTRUM: SpectrumSnapshot = {
  frequencies: new Float32Array(2048),
  preDb: new Float32Array(2048).fill(-96),
  postDb: new Float32Array(2048).fill(-96),
};

interface UseAudioEngineProps {
  dsp: DspConfig;
  channels: InputChannel[];
  zones?: SpeakerZone[];
  activeDevice: HardwareDevice;
  bufferSize: number;
  sampleRate: number;
  plugins: LoadedPluginRecord[];
  preferredBrowserInputId?: string;
  onSendWsTelemetry?: (telemetry: SignalTelemetry) => void;
  logAudit: (action: string, detail: string, authority?: AuditAuthority) => void;
  onAddFinding?: (finding: DiagnosticFinding) => void;
}

export function useAudioEngine({
  dsp,
  channels,
  zones,
  activeDevice,
  bufferSize,
  sampleRate,
  plugins,
  preferredBrowserInputId,
  onSendWsTelemetry,
  logAudit,
  onAddFinding,
}: UseAudioEngineProps) {
  const [audioSource, setAudioSource] = useState<AudioSourceSimulation>('live-mic');
  const [engineRunning, setEngineRunning] = useState(false);
  const [monitorAudible, setMonitorAudible] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<SignalTelemetry>(INITIAL_TELEMETRY);
  const [spectrum, setSpectrum] = useState<SpectrumSnapshot>(INITIAL_SPECTRUM);
  const [audioCpuPct, setAudioCpuPct] = useState<number>(0);
  const [underrunRisk, setUnderrunRisk] = useState<'low' | 'elevated' | 'critical'>('low');

  const lastTickTsRef = useRef<number>(performance.now());
  const lastTelemetryWsSentRef = useRef<number>(0);
  const xrunStreakRef = useRef<{ elevated: number; critical: number }>({ elevated: 0, critical: 0 });
  const seenAutoIssuesRef = useRef<Set<string>>(new Set());

  // Sync effective DSP into Web Audio Engine whenever DSP or active plugins update
  useEffect(() => {
    let effectiveDsp = dsp;
    plugins
      .filter((p) => p.kind === 'dsp-processor' && p.status === 'active' && !p.builtin)
      .forEach((p) => {
        effectiveDsp = applyDspPluginToConfig(effectiveDsp, p);
      });
    liveAudioEngine.applyDsp(effectiveDsp);
  }, [dsp, plugins]);

  // Sync per-channel strip fader/gain/mute and dedicated stereo inputs into Web Audio Engine
  useEffect(() => {
    liveAudioEngine.applyChannels(channels);
    liveAudioEngine.syncChannelHardwareInputs(channels);
  }, [channels]);

  // Sync speaker zone routing to multi-channel physical soundcard rear jacks
  useEffect(() => {
    if (zones && zones.length > 0) {
      liveAudioEngine.applySpeakerZones(zones);
    }
  }, [zones]);

  // Handle source stream unexpected ending (e.g., user clicked "Stop sharing" in browser)
  useEffect(() => {
    liveAudioEngine.setOnSourceEnded(() => {
      setEngineRunning(false);
      setTelemetry({
        ...INITIAL_TELEMETRY,
        source: audioSource,
        sampleRate: liveAudioEngine.getSampleRate(),
      });
      setSpectrum(INITIAL_SPECTRUM);
      logAudit(
        'Audio Capture Ended',
        'System desktop loopback or microphone capture stream was stopped.',
        'system'
      );
    });
    return () => liveAudioEngine.setOnSourceEnded(null);
  }, [audioSource, logAudit]);

  // Real-time 20Hz Telemetry, FFT & Audio Engine CPU Load / Buffer Underrun Monitor
  useEffect(() => {
    if (!engineRunning) {
      xrunStreakRef.current = { elevated: 0, critical: 0 };
      setAudioCpuPct(0);
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
      if (nowTs - lastTelemetryWsSentRef.current >= 160) {
        lastTelemetryWsSentRef.current = nowTs;
        onSendWsTelemetry?.(snap.telemetry);
      }

      // Compute realistic audio processing load % from buffer quantum deadline,
      // active DSP nodes, event-loop timing pressure, and callback execution time.
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

      const bufferPressure = Math.max(0, (3.0 - quantumMs) * 2.5);
      const dspGraphCost = activeStages * 0.45;
      const timingCost = (execMs / Math.max(1, quantumMs)) * 15;
      const jitterPenalty = Math.min(25, Math.max(0, intervalDelta - 95) * 0.2);
      const rawLoad = Math.min(
        98,
        Math.max(4, Math.round(3 + bufferPressure + dspGraphCost + timingCost + jitterPenalty))
      );

      setAudioCpuPct((prev) => {
        const smoothed = Math.round((prev === 0 ? rawLoad : prev * 0.82 + rawLoad * 0.18));
        return smoothed === prev ? prev : smoothed;
      });

      // Buffer underrun (XRUN) detection
      const isCriticalFrame = rawLoad >= 85 || intervalDelta > 175 || execMs > quantumMs * 0.85;
      const isElevatedFrame = rawLoad >= 65 || intervalDelta > 120 || execMs > quantumMs * 0.6;

      xrunStreakRef.current.critical = isCriticalFrame
        ? Math.min(10, xrunStreakRef.current.critical + 1)
        : Math.max(0, xrunStreakRef.current.critical - 1);
      xrunStreakRef.current.elevated = isElevatedFrame
        ? Math.min(10, xrunStreakRef.current.elevated + 1)
        : Math.max(0, xrunStreakRef.current.elevated - 1);

      const nextRisk: 'low' | 'elevated' | 'critical' =
        xrunStreakRef.current.critical >= 4
          ? 'critical'
          : xrunStreakRef.current.elevated >= 4
            ? 'elevated'
            : 'low';

      setUnderrunRisk((prev) => (prev === nextRisk ? prev : nextRisk));

      // Deterministic auto-diagnosis when feedback or hum persists
      if (
        snap.telemetry.feedbackRisk.detected &&
        snap.telemetry.feedbackRisk.frequencyHz &&
        !seenAutoIssuesRef.current.has(`fb-${snap.telemetry.feedbackRisk.frequencyHz}`)
      ) {
        const freq = snap.telemetry.feedbackRisk.frequencyHz;
        seenAutoIssuesRef.current.add(`fb-${freq}`);
        onAddFinding?.({
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
        });
      }

      if (
        snap.telemetry.humRisk.detected &&
        !seenAutoIssuesRef.current.has('hum-50')
      ) {
        seenAutoIssuesRef.current.add('hum-50');
        onAddFinding?.({
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
        });
      }
    }, 60);

    return () => window.clearInterval(timer);
  }, [
    engineRunning,
    activeDevice.model,
    bufferSize,
    sampleRate,
    dsp,
    plugins,
    onSendWsTelemetry,
    onAddFinding,
  ]);

  const handleToggleEngine = useCallback(async () => {
    setAudioError(null);
    if (engineRunning) {
      liveAudioEngine.stop();
      setEngineRunning(false);
      const stoppedTelemetry: SignalTelemetry = {
        ...INITIAL_TELEMETRY,
        source: audioSource,
        sampleRate: liveAudioEngine.getSampleRate(),
      };
      setTelemetry(stoppedTelemetry);
      setSpectrum(INITIAL_SPECTRUM);
      onSendWsTelemetry?.(stoppedTelemetry);
      logAudit('Stopped Audio Engine', 'Audio DSP processing placed into standby.', 'operator');
    } else {
      try {
        await liveAudioEngine.start(audioSource, dsp, preferredBrowserInputId);
        liveAudioEngine.applyChannels(channels);
        setEngineRunning(true);
        logAudit('Started Audio Engine', `Source: ${audioSource} · Device: ${activeDevice.model}`, 'operator');
      } catch (err) {
        setEngineRunning(false);
        setAudioError(
          err instanceof Error
            ? `Audio device access failed: ${err.message}`
            : 'Unable to initialize Web Audio device.'
        );
      }
    }
  }, [
    activeDevice.model,
    audioSource,
    channels,
    dsp,
    engineRunning,
    logAudit,
    onSendWsTelemetry,
    preferredBrowserInputId,
  ]);

  const handleSourceChange = useCallback(async (nextSrc: AudioSourceSimulation) => {
    setAudioSource(nextSrc);
    seenAutoIssuesRef.current.clear();
    setAudioError(null);
    if (engineRunning) {
      try {
        await liveAudioEngine.start(nextSrc, dsp, preferredBrowserInputId);
        liveAudioEngine.applyChannels(channels);
        logAudit('Switched Audio Source', `Input switched to ${nextSrc}`, 'operator');
      } catch (err) {
        liveAudioEngine.stop();
        setEngineRunning(false);
        setTelemetry({
          ...INITIAL_TELEMETRY,
          source: nextSrc,
          sampleRate: liveAudioEngine.getSampleRate(),
        });
        setSpectrum(INITIAL_SPECTRUM);
        setAudioError(err instanceof Error ? err.message : 'Failed to switch audio source.');
      }
    }
  }, [channels, dsp, engineRunning, logAudit, preferredBrowserInputId]);

  const handleToggleMonitor = useCallback(() => {
    setMonitorAudible((prev) => {
      const next = !prev;
      liveAudioEngine.setMonitorAudible(next);
      return next;
    });
  }, []);

  return {
    audioSource,
    setAudioSource,
    engineRunning,
    setEngineRunning,
    monitorAudible,
    audioError,
    setAudioError,
    telemetry,
    setTelemetry,
    spectrum,
    setSpectrum,
    audioCpuPct,
    underrunRisk,
    handleToggleEngine,
    handleSourceChange,
    handleToggleMonitor,
  };
}
