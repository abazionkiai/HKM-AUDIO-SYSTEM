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
import { isDesktopApp } from '../utils/appApi.ts';
import { getSystemCpuPercent } from '../utils/systemMetrics.ts';

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
  needsSpectrumState?: boolean;
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
  needsSpectrumState = false,
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
  const [systemCpuPercent, setSystemCpuPercent] = useState<number | null>(null);
  const [schedulingRisk, setSchedulingRisk] = useState<'low' | 'elevated' | 'critical'>('low');

  const lastTickTsRef = useRef<number>(performance.now());
  const lastTelemetryWsSentRef = useRef<number>(0);
  const lastSilentSigRef = useRef<string | null>(null);
  const schedulingStreakRef = useRef<{ elevated: number; critical: number }>({ elevated: 0, critical: 0 });
  const seenAutoIssuesRef = useRef<Set<string>>(new Set());

  // Sample real Windows system CPU once per second, slower while hidden. This is
  // intentionally independent of engine state so standby resource use is visible.
  useEffect(() => {
    if (!isDesktopApp()) return;

    let cancelled = false;
    let timerId: number | null = null;

    const sample = async () => {
      const value = await getSystemCpuPercent();
      if (cancelled) return;
      const rounded = value === null ? null : Math.round(value);
      setSystemCpuPercent((prev) => (prev === rounded ? prev : rounded));
      timerId = window.setTimeout(sample, document.hidden ? 3000 : 1000);
    };

    const onVisibilityChange = () => {
      if (timerId !== null) window.clearTimeout(timerId);
      timerId = null;
      if (!document.hidden && !cancelled) {
        timerId = window.setTimeout(sample, 0);
      }
    };

    void sample();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

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
    if (engineRunning) {
      void liveAudioEngine.syncChannelHardwareInputs(channels).catch((err) => {
        setAudioError(err instanceof Error ? err.message : String(err));
      });
    }
  }, [channels, engineRunning]);

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

  // 5Hz visible / 2Hz hidden telemetry and FFT sampling.
  useEffect(() => {
    if (!engineRunning) {
      schedulingStreakRef.current = { elevated: 0, critical: 0 };
      lastSilentSigRef.current = null;
      setSchedulingRisk('low');
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;
    lastTickTsRef.current = performance.now();

    const runTick = () => {
      if (cancelled) return;
      const tStart = performance.now();
      const intervalDelta = tStart - lastTickTsRef.current;
      lastTickTsRef.current = tStart;

      const snap = liveAudioEngine.sampleTelemetry({ includeSpectrum: needsSpectrumState });
      const execMs = performance.now() - tStart;

      const isSilentNow =
        snap.telemetry.preRmsDb <= -95 &&
        snap.telemetry.postRmsDb <= -95 &&
        !snap.telemetry.feedbackRisk.detected &&
        !snap.telemetry.humRisk.detected &&
        !snap.telemetry.qualityGateEngaged;
      const silentSig = isSilentNow
        ? `${snap.telemetry.source}|${snap.telemetry.activeInputLabel ?? ''}|${snap.telemetry.capturedChannels}|${snap.telemetry.qualityScorePct ?? 100}|${snap.telemetry.clippingEvents}`
        : null;

      if (!silentSig || silentSig !== lastSilentSigRef.current) {
        lastSilentSigRef.current = silentSig;
        setTelemetry(snap.telemetry);
      }
      if (needsSpectrumState) {
        setSpectrum(snap.spectrum);
      }

      const nowTs = performance.now();
      if (nowTs - lastTelemetryWsSentRef.current >= 200) {
        lastTelemetryWsSentRef.current = nowTs;
        onSendWsTelemetry?.(snap.telemetry);
      }

      const quantumMs = (bufferSize / Math.max(8000, sampleRate)) * 1000;
      const expectedPeriod = document.hidden ? 500 : 200;

      // This flags delayed telemetry scheduling only; it is not an audio-thread
      // CPU reading or a confirmed WASAPI/Web Audio underrun.
      const isCriticalFrame =
        intervalDelta > expectedPeriod + 250 || execMs > quantumMs * 0.85;
      const isElevatedFrame =
        intervalDelta > expectedPeriod + 120 || execMs > quantumMs * 0.6;

      schedulingStreakRef.current.critical = isCriticalFrame
        ? Math.min(10, schedulingStreakRef.current.critical + 1)
        : Math.max(0, schedulingStreakRef.current.critical - 1);
      schedulingStreakRef.current.elevated = isElevatedFrame
        ? Math.min(10, schedulingStreakRef.current.elevated + 1)
        : Math.max(0, schedulingStreakRef.current.elevated - 1);

      const nextRisk: 'low' | 'elevated' | 'critical' =
        schedulingStreakRef.current.critical >= 4
          ? 'critical'
          : schedulingStreakRef.current.elevated >= 4
            ? 'elevated'
            : 'low';

      setSchedulingRisk((prev) => (prev === nextRisk ? prev : nextRisk));

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

      if (!cancelled) {
        timerId = window.setTimeout(runTick, document.hidden ? 500 : 200);
      }
    };

    const onVis = () => {
      if (!document.hidden && !cancelled) {
        if (timerId !== null) window.clearTimeout(timerId);
        lastTickTsRef.current = performance.now();
        timerId = window.setTimeout(runTick, 50);
      }
    };

    timerId = window.setTimeout(runTick, 200);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [
    engineRunning,
    needsSpectrumState,
    activeDevice.model,
    bufferSize,
    sampleRate,
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
        await liveAudioEngine.start(audioSource, dsp, channels);
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
  ]);

  const handleSourceChange = useCallback(async (nextSrc: AudioSourceSimulation) => {
    setAudioSource(nextSrc);
    seenAutoIssuesRef.current.clear();
    setAudioError(null);
    if (engineRunning) {
      try {
        await liveAudioEngine.start(nextSrc, dsp, channels);
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
  }, [channels, dsp, engineRunning, logAudit]);

  const handleToggleMonitor = useCallback(() => {
    setMonitorAudible((prev) => {
      const next = !prev;
      liveAudioEngine.setMonitorAudible(next);
      return next;
    });
  }, []);

  const setMonitorAudibleState = useCallback((audible: boolean) => {
    setMonitorAudible(audible);
    liveAudioEngine.setMonitorAudible(audible);
  }, []);

  const ensureEngineStarted = useCallback(
    async (channelsOverride?: InputChannel[]): Promise<boolean> => {
      const targetChannels = channelsOverride ?? channels;
      setAudioError(null);
      if (liveAudioEngine.getIsRunning()) {
        liveAudioEngine.applyChannels(targetChannels);
        try {
          await liveAudioEngine.syncChannelHardwareInputs(targetChannels);
          return true;
        } catch (err) {
          setAudioError(err instanceof Error ? err.message : String(err));
          return false;
        }
      }
      try {
        await liveAudioEngine.start(audioSource, dsp, targetChannels);
        liveAudioEngine.applyChannels(targetChannels);
        setEngineRunning(true);
        logAudit('Started Audio Engine', `Source: ${audioSource} · Device: ${activeDevice.model}`, 'operator');
        return true;
      } catch (err) {
        setEngineRunning(false);
        setAudioError(
          err instanceof Error
            ? `Audio device access failed: ${err.message}`
            : 'Unable to initialize Web Audio device.'
        );
        return false;
      }
    },
    [activeDevice.model, audioSource, channels, dsp, logAudit]
  );

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
    systemCpuPercent,
    schedulingRisk,
    handleToggleEngine,
    handleSourceChange,
    handleToggleMonitor,
    setMonitorAudibleState,
    ensureEngineStarted,
  };
}
