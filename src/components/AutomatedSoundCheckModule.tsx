import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Play,
  RotateCcw,
  Sliders,
  AlertTriangle,
} from 'lucide-react';
import type {
  AcousticMeasurement,
  BroadcastDspConfig,
  DspConfig,
  HardwareDevice,
  InputChannel,
  ObsStatus,
  SignalTelemetry,
} from '../types/audio.ts';
import {
  ArcGauge,
  ConsolePushButton,
  RotaryKnob,
  SegmentedLedMeter,
} from './StudioControls.tsx';

interface AutomatedSoundCheckModuleProps {
  device: HardwareDevice;
  channels: InputChannel[];
  onUpdateChannel: (id: string, patch: Partial<InputChannel>) => void;
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  broadcastDsp: BroadcastDspConfig;
  telemetry: SignalTelemetry;
  obsStatus: ObsStatus;
  measurement: AcousticMeasurement;
  onStartEngine: () => void;
  onLogAction: (detail: string) => void;
}

interface PhaseResult {
  id: string;
  label: string;
  status: 'idle' | 'running' | 'pass' | 'warn';
  detail: string;
}

export const AutomatedSoundCheckModule: React.FC<AutomatedSoundCheckModuleProps> = ({
  device,
  channels,
  onUpdateChannel,
  dsp,
  onUpdateDsp,
  broadcastDsp,
  telemetry,
  obsStatus,
  measurement,
  onStartEngine,
  onLogAction,
}) => {
  const [sequencerState, setSequencerState] = useState<'idle' | 'running' | 'complete'>('idle');
  const [activePhaseIdx, setActivePhaseIdx] = useState<number>(-1);
  const [targetNominalDbfs, setTargetNominalDbfs] = useState<number>(-18);
  const [phases, setPhases] = useState<PhaseResult[]>([
    { id: 'clock', label: '1. Hardware Clock & Driver Lock', status: 'idle', detail: 'Pending scan' },
    { id: 'gain', label: '2. Channel Gain Staging & Noise Floor', status: 'idle', detail: 'Pending scan' },
    { id: 'feedback', label: '3. Ring-Out & Feedback Margin Check', status: 'idle', detail: 'Pending scan' },
    { id: 'broadcast', label: '4. Broadcast LUFS & Limiter Ceiling', status: 'idle', detail: 'Pending scan' },
  ]);

  useEffect(() => {
    if (sequencerState !== 'running') return;
    const timer = window.setInterval(() => {
      setActivePhaseIdx((prev) => {
        const next = prev + 1;
        if (next >= 4) {
          setSequencerState('complete');
          onLogAction('Completed 4-phase Automated Sound Check sweep');
          return 3;
        }
        setPhases((curr) =>
          curr.map((p, idx) => {
            if (idx > next) return p;
            if (idx === 0) {
              return {
                ...p,
                status: telemetry.isRunning ? 'pass' : 'warn',
                detail: telemetry.isRunning
                  ? `${(telemetry.sampleRate / 1000).toFixed(1)} kHz locked · ${device.model}`
                  : 'DSP Engine in Standby — Engage Engine for live clock check',
              };
            }
            if (idx === 1) {
              const hot = telemetry.isRunning
                ? channels.filter((c, cIdx) => {
                    const chPeak = telemetry.channelLevels?.[cIdx]?.peakDb ?? -96;
                    return !c.mute && chPeak > -3;
                  }).length
                : 0;
              return {
                ...p,
                status: !telemetry.isRunning || hot > 0 ? 'warn' : 'pass',
                detail: !telemetry.isRunning
                  ? 'Engine Standby — no active input capture'
                  : hot > 0
                    ? `${hot} channel(s) approaching clip (> -3 dBFS)`
                    : `${telemetry.capturedChannels || 1} live input(s) within safe headroom`,
              };
            }
            if (idx === 2) {
              return {
                ...p,
                status: telemetry.feedbackRisk.detected ? 'warn' : 'pass',
                detail: telemetry.feedbackRisk.detected
                  ? `Ring detected @ ${telemetry.feedbackRisk.frequencyHz} Hz (+${telemetry.feedbackRisk.prominenceDb.toFixed(1)} dB)`
                  : `No resonant feedback peaks · RT60 ${measurement.rt60AvgSec.toFixed(2)}s`,
              };
            }
            return {
              ...p,
              status: obsStatus.connected && dsp.limiter.enabled ? 'pass' : 'warn',
              detail: `Stream Target ${broadcastDsp.targetLufs} LUFS · Limiter ${dsp.limiter.ceilingDb} dBFS`,
            };
          })
        );
        return next;
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [sequencerState, telemetry, device.model, channels, measurement.rt60AvgSec, obsStatus.connected, dsp.limiter, broadcastDsp.targetLufs, onLogAction]);

  const handleRunSequence = () => {
    if (!telemetry.isRunning) {
      onStartEngine();
    }
    setPhases((curr) =>
      curr.map((p) => ({ ...p, status: 'running', detail: 'Analyzing telemetry...' }))
    );
    setActivePhaseIdx(-1);
    setSequencerState('running');
  };

  const handleAutoTrimChannels = () => {
    if (!telemetry.isRunning) {
      onLogAction('Auto-trim skipped: start audio engine first to measure live channel RMS');
      return;
    }
    let trimmed = 0;
    channels.forEach((ch, idx) => {
      if (ch.authority === 'observational' || ch.mute) return;
      const measuredRms = telemetry.channelLevels?.[idx]?.rmsDb;
      if (typeof measuredRms !== 'number' || measuredRms <= -72) return;
      const delta = targetNominalDbfs - measuredRms;
      const nextFader = Math.max(-24, Math.min(6, Number((ch.faderDb + delta * 0.45).toFixed(1))));
      onUpdateChannel(ch.id, { faderDb: nextFader });
      trimmed++;
    });
    onLogAction(`Auto-trimmed ${trimmed} live console channel(s) toward ${targetNominalDbfs} dBFS nominal`);
  };

  const headroomDb = telemetry.isRunning ? Math.max(0, -telemetry.postPeakDb) : 0;

  return (
    <div className="space-y-4">
      {/* Studio Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.6)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-amber-400">09</span>
              <h1 className="font-display text-lg font-semibold text-white tracking-tight">
                AUTOMATED SOUND CHECK &amp; GAIN STAGING BENCH
              </h1>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              4-Phase Telemetry Audit · Per-Channel Headroom Scanner · Nominal {targetNominalDbfs} dBFS Trim
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAutoTrimChannels}
            className="px-3 py-1.5 rounded border border-slate-700 bg-[#121824] hover:border-sky-500/50 text-sky-300 text-xs font-mono font-semibold flex items-center gap-1.5"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>AUTO-TRIM FADERS ({targetNominalDbfs} dBFS)</span>
          </button>
          <button
            type="button"
            onClick={handleRunSequence}
            disabled={sequencerState === 'running'}
            className="px-3.5 py-1.5 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-mono font-semibold flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{sequencerState === 'running' ? 'SCANNING...' : 'RUN AUTO SOUND CHECK'}</span>
          </button>
        </div>
      </div>

      {/* Top Row: Sequencer Phases + Target Knobs & Live Meter */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        <div className="xl:col-span-7 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold text-white uppercase flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span>Automated Verification Sequence</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setSequencerState('idle');
                setActivePhaseIdx(-1);
                setPhases((p) => p.map((x) => ({ ...x, status: 'idle', detail: 'Pending scan' })));
              }}
              className="text-[10px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>RESET</span>
            </button>
          </div>

          <div className="space-y-2">
            {phases.map((p, idx) => (
              <div
                key={p.id}
                className={`p-3 rounded border flex items-center justify-between gap-3 ${
                  idx === activePhaseIdx && sequencerState === 'running'
                    ? 'border-sky-400 bg-sky-500/10'
                    : p.status === 'pass'
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : p.status === 'warn'
                        ? 'border-amber-500/40 bg-amber-500/10'
                        : 'border-slate-800 bg-[#070A10]'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-white">{p.label}</div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">{p.detail}</div>
                </div>
                <span
                  className={`font-mono text-[10px] font-bold uppercase shrink-0 flex items-center gap-1 ${
                    p.status === 'pass'
                      ? 'text-emerald-400'
                      : p.status === 'warn'
                        ? 'text-amber-400'
                        : p.status === 'running'
                          ? 'text-sky-400'
                          : 'text-slate-500'
                  }`}
                >
                  {p.status === 'pass' && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {p.status === 'warn' && <AlertTriangle className="w-3.5 h-3.5" />}
                  <span>{p.status.toUpperCase()}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Calibration Knobs & Metering */}
        <div className="xl:col-span-5 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
          <div className="font-mono text-xs font-semibold text-white uppercase border-b border-slate-800 pb-2">
            Reference Target &amp; Safety Calibration
          </div>

          <div className="grid grid-cols-3 gap-2 items-center">
            <ArcGauge
              label="Peak Headroom"
              value={headroomDb}
              max={24}
              displayValue={telemetry.isRunning ? `${headroomDb.toFixed(1)}dB` : '--'}
              sublabel={`${telemetry.clippingEvents} Clips`}
              tone={!telemetry.isRunning ? 'sky' : headroomDb < 4 ? 'red' : 'emerald'}
            />
            <div className="flex items-center justify-around py-2 bg-[#070A10] border border-slate-800 rounded">
              <div className="flex flex-col items-center gap-1">
                <SegmentedLedMeter
                  levelDb={telemetry.isRunning ? telemetry.preRmsDb : -96}
                  peakDb={telemetry.isRunning ? telemetry.prePeakDb : -96}
                  height={88}
                  segments={12}
                />
                <span className="font-mono text-[9px] text-slate-400">PRE</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <SegmentedLedMeter
                  levelDb={telemetry.isRunning ? telemetry.postRmsDb : -96}
                  peakDb={telemetry.isRunning ? telemetry.postPeakDb : -96}
                  height={88}
                  segments={12}
                />
                <span className="font-mono text-[9px] text-sky-400">POST</span>
              </div>
            </div>
            <ArcGauge
              label="Noise Floor"
              value={telemetry.isRunning ? Math.max(0, 96 + telemetry.noiseFloorDb) : 0}
              max={96}
              displayValue={telemetry.isRunning ? `${telemetry.noiseFloorDb.toFixed(0)}` : '--'}
              sublabel={telemetry.isRunning ? 'dBFS Floor' : 'Standby'}
              tone="sky"
            />
          </div>

          <div className="grid grid-cols-3 gap-2 py-2 bg-[#070A10] border border-slate-800 rounded place-items-center">
            <RotaryKnob
              label="NOMINAL"
              value={targetNominalDbfs}
              min={-24}
              max={-10}
              step={1}
              defaultValue={-18}
              unit="dB"
              size={48}
              accent="sky"
              onChange={setTargetNominalDbfs}
            />
            <RotaryKnob
              label="HPF FLOOR"
              value={dsp.hpfHz}
              min={30}
              max={180}
              step={5}
              defaultValue={95}
              unit="Hz"
              size={48}
              accent="amber"
              onChange={(v) => onUpdateDsp({ hpfEnabled: true, hpfHz: v })}
            />
            <RotaryKnob
              label="CEILING"
              value={dsp.limiter.ceilingDb}
              min={-6}
              max={0}
              step={0.2}
              defaultValue={-0.8}
              unit="dB"
              size={48}
              accent="emerald"
              onChange={(v) =>
                onUpdateDsp({ limiter: { ...dsp.limiter, enabled: true, ceilingDb: v } })
              }
            />
          </div>
        </div>
      </div>

      {/* Per-Channel Gain-Staging Audit Matrix */}
      <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 overflow-x-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
          <span className="font-mono text-xs font-semibold text-white uppercase">
            Per-Channel Headroom, Noise Floor &amp; Clip Audit
          </span>
          <span className="font-mono text-[10px] text-slate-400">
            {device.capabilities.perChannelFaderControl
              ? 'Hardware-Linked Auto-Trim Capable'
              : 'Software DSP Trim (Verify Analog Mixer Preamps Manually)'}
          </span>
        </div>

        <table className="w-full text-left text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase">
              <th className="py-2 pr-3">Channel</th>
              <th className="py-2 pr-3">Authority</th>
              <th className="py-2 pr-3 text-right">Preamp</th>
              <th className="py-2 pr-3 text-right">Fader</th>
              <th className="py-2 pr-3 text-right">RMS</th>
              <th className="py-2 pr-3 text-right">Noise Floor</th>
              <th className="py-2 pr-3 text-center">+48V</th>
              <th className="py-2 text-right">Audit Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 tabular-nums">
            {channels.map((ch, idx) => {
              const liveCh = telemetry.isRunning ? telemetry.channelLevels?.[idx] : undefined;
              const liveRms = liveCh && !ch.mute ? liveCh.rmsDb : -96;
              const livePeak = liveCh && !ch.mute ? liveCh.peakDb : -96;
              const liveFloor = liveCh ? liveCh.noiseFloorDb : -96;
              const hot = telemetry.isRunning && Boolean(liveCh) && !ch.mute && livePeak > -3;
              const noisy = telemetry.isRunning && Boolean(liveCh) && !ch.mute && liveFloor > -45;
              return (
                <tr key={ch.id} className="hover:bg-slate-800/30">
                  <td className="py-2 pr-3 text-slate-100 font-semibold">
                    CH {String(ch.index).padStart(2, '0')} · {ch.name}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">
                    {ch.authority === 'hardware-linked' ? 'HW-LINK' : 'SW-DSP'}
                  </td>
                  <td className="py-2 pr-3 text-right text-sky-300">{ch.gainDb} dB</td>
                  <td className="py-2 pr-3 text-right text-slate-200">{ch.faderDb.toFixed(1)} dB</td>
                  <td className="py-2 pr-3 text-right text-slate-300">
                    {!telemetry.isRunning || !liveCh ? '--' : ch.mute ? 'MUTE' : `${liveRms.toFixed(1)} dBFS`}
                  </td>
                  <td className={`py-2 pr-3 text-right ${noisy ? 'text-amber-400' : 'text-slate-400'}`}>
                    {telemetry.isRunning && liveCh ? `${liveFloor.toFixed(1)} dB` : '--'}
                  </td>
                  <td className="py-2 pr-3 text-center">
                    <ConsolePushButton
                      label={ch.phantom48v ? '+48V' : 'OFF'}
                      active={ch.phantom48v}
                      tone="amber"
                      disabled={!device.capabilities.phantomPowerControl}
                      onClick={() => onUpdateChannel(ch.id, { phantom48v: !ch.phantom48v })}
                    />
                  </td>
                  <td className="py-2 text-right font-semibold">
                    {!telemetry.isRunning ? (
                      <span className="text-slate-500">STANDBY</span>
                    ) : !liveCh ? (
                      <span className="text-slate-500">NO STREAM</span>
                    ) : ch.mute ? (
                      <span className="text-slate-400">MUTED</span>
                    ) : hot ? (
                      <span className="text-red-400">HOT PEAK</span>
                    ) : noisy ? (
                      <span className="text-amber-400">HIGH FLOOR</span>
                    ) : (
                      <span className="text-emerald-400">NOMINAL PASS</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
