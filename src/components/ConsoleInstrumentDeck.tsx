import React, { useEffect, useMemo, useState } from 'react';
import { Zap, ShieldAlert, ArrowRight, RotateCcw } from 'lucide-react';
import type {
  DspConfig,
  InputChannel,
  ServicePreset,
  SignalTelemetry,
  SpeakerZone,
  HardwareDevice,
} from '../types/audio.ts';
import { ConsolePushButton, RotaryKnob } from './StudioControls.tsx';
import { StereoGraphicEqModule } from './StereoGraphicEqModule.tsx';
import { ActiveCrossoverModule } from './ActiveCrossoverModule.tsx';
import { PrecisionVerticalFader } from './PrecisionVerticalFader.tsx';

export type ConsoleProcessingPhase =
  | 'phase-1-stage'
  | 'phase-2-filters'
  | 'phase-3-peq'
  | 'phase-4-dynamics'
  | 'phase-5-geq'
  | 'phase-6-xover'
  | 'phase-7-matrix';

interface ConsoleInstrumentDeckProps {
  device: HardwareDevice;
  channels: InputChannel[];
  onUpdateChannel: (id: string, patch: Partial<InputChannel>) => void;
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  telemetry: SignalTelemetry;
  presets: ServicePreset[];
  activePreset?: ServicePreset;
  onSelectPreset?: (preset: ServicePreset) => void;
  emergencyMuted?: boolean;
  onToggleEmergencyMute?: () => void;
  zones?: SpeakerZone[];
  initialPhase?: ConsoleProcessingPhase;
}

const PEQ_BAND_STYLES = [
  {
    name: 'BAND 1 · LOW',
    accent: 'red' as const,
    card: 'border-rose-500/40 bg-gradient-to-b from-[#1A0D12] to-[#0D070A]',
    badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    dot: '#FB7185',
    minHz: 30,
    maxHz: 350,
  },
  {
    name: 'BAND 2 · LO-MID',
    accent: 'amber' as const,
    card: 'border-amber-500/40 bg-gradient-to-b from-[#191208] to-[#0D0904]',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    dot: '#FBBF24',
    minHz: 120,
    maxHz: 1500,
  },
  {
    name: 'BAND 3 · HI-MID',
    accent: 'emerald' as const,
    card: 'border-emerald-500/40 bg-gradient-to-b from-[#091812] to-[#050D0A]',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    dot: '#34D399',
    minHz: 800,
    maxHz: 6000,
  },
  {
    name: 'BAND 4 · HIGH',
    accent: 'sky' as const,
    card: 'border-sky-500/40 bg-gradient-to-b from-[#0A1522] to-[#050A11]',
    badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    dot: '#38BDF8',
    minHz: 3500,
    maxHz: 18000,
  },
];

export const ConsoleInstrumentDeck: React.FC<ConsoleInstrumentDeckProps> = ({
  device,
  channels,
  onUpdateChannel,
  dsp,
  onUpdateDsp,
  telemetry,
  presets,
  activePreset,
  onSelectPreset,
  emergencyMuted = false,
  onToggleEmergencyMute,
  zones = [],
  initialPhase,
}) => {
  const [selectedPhase, setSelectedPhase] = useState<ConsoleProcessingPhase>(initialPhase ?? 'phase-3-peq');

  useEffect(() => {
    if (initialPhase) {
      setSelectedPhase(initialPhase);
    }
  }, [initialPhase]);

  const [selectedChannelId, setSelectedChannelId] = useState<string>(channels[0]?.id ?? 'ch-1');
  const [faderBank, setFaderBank] = useState<'bank-1' | 'bank-2'>('bank-1');

  const selectedChannel: InputChannel =
    channels.find((c) => c.id === selectedChannelId) ??
    channels[0] ?? {
      id: 'ch-1',
      index: 1,
      name: 'Channel 1',
      role: 'Vocals',
      authority: 'local',
      levelDb: -24,
      peakDb: -18,
      gainDb: 24,
      faderDb: 0,
      mute: false,
      solo: false,
      phantom48v: false,
      padDb: false,
      polarityInverted: false,
      hpfHz: 80,
      pan: 0,
      noiseFloorDb: -58,
      gateThresholdDb: -42,
      compThresholdDb: -18,
      compRatio: 3,
      eqLowDb: 0,
      eqMidDb: 0,
      eqMidFreqHz: 2500,
      eqHighDb: 0,
      auxSends: { stageMon1Db: -6, stageMon2Db: -6, streamBusDb: 0, subsDb: -6 },
      dcaGroup: 'All',
      stereoLinked: false,
    };

  const bankChannels = useMemo(() => {
    if (faderBank === 'bank-2') return channels.slice(8, 16);
    return channels.slice(0, 8);
  }, [channels, faderBank]);

  // Real-time PEQ Curve Geometry for Phase 3
  const peqGeometry = useMemo(() => {
    const width = 640;
    const height = 130;
    const minF = 20;
    const maxF = 20000;
    const points: string[] = [];

    const freqToX = (f: number) => {
      const minLog = Math.log10(minF);
      const maxLog = Math.log10(maxF);
      const fLog = Math.log10(Math.max(minF, Math.min(maxF, f)));
      return ((fLog - minLog) / (maxLog - minLog)) * width;
    };

    const gainToY = (db: number) => {
      const clampedDb = Math.max(-18, Math.min(18, db));
      return height * 0.5 - (clampedDb / 18) * (height * 0.4);
    };

    const numPoints = 84;
    for (let i = 0; i <= numPoints; i++) {
      const freq = minF * Math.pow(maxF / minF, i / numPoints);
      const x = freqToX(freq);

      let gainDb = 0;
      if (!dsp.bypassed) {
        for (const band of dsp.eqBands) {
          if (!band.enabled) continue;
          const f0 = band.frequency;
          const q = Math.max(0.2, band.q);
          const g = band.gainDb;
          const octDiff = Math.abs(Math.log2(freq / f0));
          const bandFactor = Math.exp(-Math.pow(octDiff * q, 2) * 2.2);
          gainDb += g * bandFactor;
        }
        if (dsp.hpfEnabled && freq < dsp.hpfHz) {
          const ratio = dsp.hpfHz / freq;
          gainDb -= 12 * Math.log2(Math.max(1, ratio));
        }
      }

      points.push(`${x.toFixed(1)},${gainToY(gainDb).toFixed(1)}`);
    }

    const path = `M ${points.join(' L ')}`;
    const area = `${path} L ${width},${height * 0.5} L 0,${height * 0.5} Z`;
    const nodes = dsp.eqBands.slice(0, 4).map((b, idx) => ({
      id: b.id,
      x: freqToX(b.frequency),
      y: gainToY(b.enabled ? b.gainDb : 0),
      enabled: b.enabled,
      color: PEQ_BAND_STYLES[idx]?.dot ?? '#38BDF8',
    }));

    return { path, area, nodes, midY: height * 0.5 };
  }, [dsp.bypassed, dsp.eqBands, dsp.hpfEnabled, dsp.hpfHz]);

  const phaseTabs: {
    id: ConsoleProcessingPhase;
    step: string;
    label: string;
    readout: string;
    activeClass: string;
    ledClass: string;
    topBarClass: string;
    enabled: boolean;
  }[] = [
    {
      id: 'phase-1-stage',
      step: '1',
      label: 'PREAMP',
      readout: `+${selectedChannel.gainDb}dB`,
      activeClass: 'bg-amber-950/60 border-amber-400/80 text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.25)]',
      ledClass: 'bg-amber-400',
      topBarClass: 'bg-amber-400',
      enabled: true,
    },
    {
      id: 'phase-2-filters',
      step: '2',
      label: 'HPF & GATE',
      readout: dsp.hpfEnabled ? `${dsp.hpfHz}Hz` : 'BYP',
      activeClass: 'bg-cyan-950/60 border-cyan-400/80 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.25)]',
      ledClass: dsp.hpfEnabled ? 'bg-cyan-400' : 'bg-slate-600',
      topBarClass: 'bg-cyan-400',
      enabled: dsp.hpfEnabled,
    },
    {
      id: 'phase-3-peq',
      step: '3',
      label: '4-BAND PEQ',
      readout: 'RTA LIVE',
      activeClass: 'bg-sky-950/60 border-sky-400/80 text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.25)]',
      ledClass: 'bg-sky-400',
      topBarClass: 'bg-sky-400',
      enabled: true,
    },
    {
      id: 'phase-4-dynamics',
      step: '4',
      label: 'VCA COMP',
      readout: dsp.compressor.enabled ? `${dsp.compressor.ratio.toFixed(1)}:1` : 'OFF',
      activeClass: 'bg-emerald-950/60 border-emerald-400/80 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.25)]',
      ledClass: dsp.compressor.enabled ? 'bg-emerald-400' : 'bg-slate-600',
      topBarClass: 'bg-emerald-400',
      enabled: dsp.compressor.enabled,
    },
    {
      id: 'phase-5-geq',
      step: '5',
      label: '31-BAND GEQ',
      readout: `±${dsp.graphicEq31?.rangeDb ?? 12}dB`,
      activeClass: 'bg-fuchsia-950/60 border-fuchsia-400/80 text-fuchsia-100 shadow-[0_0_12px_rgba(217,70,239,0.25)]',
      ledClass: dsp.graphicEq31?.enabled !== false ? 'bg-fuchsia-400' : 'bg-slate-600',
      topBarClass: 'bg-fuchsia-400',
      enabled: dsp.graphicEq31?.enabled !== false,
    },
    {
      id: 'phase-6-xover',
      step: '6',
      label: '3-WAY XOVER',
      readout: `${dsp.crossover?.subToMidHz ?? 80}Hz`,
      activeClass: 'bg-violet-950/60 border-violet-400/80 text-violet-100 shadow-[0_0_12px_rgba(167,139,250,0.25)]',
      ledClass: dsp.crossover?.enabled !== false ? 'bg-violet-400' : 'bg-slate-600',
      topBarClass: 'bg-violet-400',
      enabled: dsp.crossover?.enabled !== false,
    },
    {
      id: 'phase-7-matrix',
      step: '7',
      label: 'MATRIX & PA',
      readout: dsp.limiter.enabled ? `${dsp.limiter.ceilingDb.toFixed(1)}dB` : 'OPEN',
      activeClass: 'bg-orange-950/60 border-orange-400/80 text-orange-100 shadow-[0_0_12px_rgba(251,146,60,0.25)]',
      ledClass: dsp.limiter.enabled ? 'bg-orange-400' : 'bg-slate-600',
      topBarClass: 'bg-orange-400',
      enabled: dsp.limiter.enabled,
    },
  ];

  const meterPct = Math.max(0, Math.min(100, ((telemetry.postRmsDb + 60) / 60) * 100));
  const grSegments = 12;
  const activeGrCount = Math.min(grSegments, Math.round((Math.abs(telemetry.gainReductionDb) / 18) * grSegments));

  return (
    <div className="h-full w-full overflow-hidden flex flex-col bg-[#080B12] text-slate-100 font-sans select-none border border-slate-700/80 rounded-lg shadow-2xl">
      {/* =========================================================================
          TOP DECK ROW 1: MASTER CONSOLE STATUS, METER BRIDGE & SCENE RECALL
          ========================================================================= */}
      <div className="h-9 shrink-0 bg-gradient-to-b from-[#141B28] to-[#0D121C] border-b border-slate-700/70 px-3 flex items-center justify-between gap-3">
        {/* Left: Console Identity & Hardware Lock */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-2 h-5 rounded-xs bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.75)] shrink-0" />
          <div className="flex items-center gap-2 min-w-0 font-mono">
            <span className="text-[11px] font-bold text-emerald-400 tracking-wider whitespace-nowrap">
              HKM CONSOLE INSTRUMENT
            </span>
            <span className="text-slate-600 hidden md:inline">|</span>
            <span className="text-[10px] text-slate-400 truncate hidden md:inline">
              {device.manufacturer} {device.model} · 48.0 kHz LOCKED · CamillaDSP v2.0
            </span>
          </div>
        </div>

        {/* Center: Master Output Stereo VU Meter */}
        <div className="hidden sm:flex items-center gap-2 bg-[#05070C] px-2.5 py-1 rounded border border-slate-700/80 font-mono text-[9px] shrink-0">
          <span className="text-slate-400 font-semibold">MAIN L/R</span>
          <div className="flex flex-col gap-0.5 w-20">
            <div className="h-1.5 w-full bg-slate-900 rounded-xs overflow-hidden">
              <div
                className={`h-full transition-all duration-75 ${
                  telemetry.postPeakDb > -3 ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
                style={{ width: `${meterPct}%` }}
              />
            </div>
            <div className="h-1.5 w-full bg-slate-900 rounded-xs overflow-hidden">
              <div
                className={`h-full transition-all duration-75 ${
                  telemetry.postPeakDb > -3 ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
                style={{ width: `${Math.max(0, meterPct - 2)}%` }}
              />
            </div>
          </div>
          <span
            className={`font-bold tabular-nums w-14 text-right ${
              telemetry.postPeakDb > -3 ? 'text-amber-400' : 'text-emerald-400'
            }`}
          >
            {telemetry.isRunning ? `${telemetry.postPeakDb.toFixed(1)} dB` : 'STANDBY'}
          </span>
        </div>

        {/* Right: Scene Recall, DSP Master Switch, Safe Mute */}
        <div className="flex items-center gap-1.5 shrink-0">
          {presets.length > 0 && (
            <select
              value={activePreset?.id ?? ''}
              onChange={(e) => {
                const found = presets.find((p) => p.id === e.target.value);
                if (found && onSelectPreset) onSelectPreset(found);
              }}
              className="bg-[#060910] border border-slate-700 text-slate-200 text-[10px] font-mono px-2 py-1 rounded cursor-pointer max-w-[175px]"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          <ConsolePushButton
            label={dsp.bypassed ? 'BYPASSED' : 'DSP ON'}
            active={!dsp.bypassed}
            tone={dsp.bypassed ? 'amber' : 'emerald'}
            onClick={() => onUpdateDsp({ bypassed: !dsp.bypassed })}
          />

          {onToggleEmergencyMute && (
            <ConsolePushButton
              label={emergencyMuted ? 'MUTED' : 'SAFE MUTE'}
              active={emergencyMuted}
              tone="red"
              onClick={onToggleEmergencyMute}
            />
          )}
        </div>
      </div>

      {/* =========================================================================
          TOP DECK ROW 2: REAL-WORLD SIGNAL-FLOW PHASE TABS (ZERO OVERLAP GRID)
          ========================================================================= */}
      <div className="shrink-0 bg-[#0A0E17] border-b border-slate-700/80 px-2.5 py-1.5 grid grid-cols-7 gap-1.5">
        {phaseTabs.map((tab, idx) => {
          const active = selectedPhase === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedPhase(tab.id)}
              className={`relative rounded border px-2 py-1 flex items-center justify-between gap-1 font-mono text-[10px] transition-all cursor-pointer min-w-0 overflow-hidden ${
                active
                  ? tab.activeClass
                  : 'bg-[#101624] border-slate-800 text-slate-400 hover:bg-[#161E30] hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {/* Top Illuminated Hardware Accent Bar */}
              {active && (
                <span className={`absolute inset-x-0 top-0 h-[2px] ${tab.topBarClass}`} />
              )}
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tab.ledClass}`} />
                <span className="text-[9px] text-slate-500 font-bold shrink-0">{tab.step}.</span>
                <span className="font-bold truncate">{tab.label}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[9px] opacity-80 hidden xl:inline tabular-nums">
                  {tab.readout}
                </span>
                {idx < phaseTabs.length - 1 && (
                  <ArrowRight className="w-2.5 h-2.5 text-slate-600 hidden lg:inline" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* =========================================================================
          MIDDLE DECK: FOCUSED HARDWARE PROCESSING INSTRUMENT (ZERO SCROLL)
          ========================================================================= */}
      <div className="flex-1 min-h-0 overflow-hidden p-2 bg-[#06080E] flex flex-col">
        {/* PHASE 1: STAGE PREAMP & GROUND HUM TRAPS */}
        {selectedPhase === 'phase-1-stage' && (
          <div className="h-full min-h-0 flex flex-col justify-between p-3 rounded-lg border border-amber-500/40 bg-gradient-to-b from-[#16110A] via-[#0D0B07] to-[#080705] shadow-inner">
            <div className="flex items-center justify-between border-b border-amber-500/25 pb-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
                <h3 className="font-mono text-xs font-bold text-amber-100 tracking-wider uppercase">
                  PHASE 1 · STAGE PREAMP &amp; GROUND HUM TRAPS — {selectedChannel.name}
                </h3>
              </div>
              <span className="font-mono text-[11px] text-amber-400 font-semibold">
                Input: {device.manufacturer} {device.model}
              </span>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-3 gap-3 py-2 items-center">
              {/* Group A: Analog Gain & Trim */}
              <div className="h-full rounded-lg border border-amber-500/25 bg-[#0C0906] p-3 flex items-center justify-around">
                <RotaryKnob
                  label="Preamp Gain"
                  value={selectedChannel.gainDb}
                  min={0}
                  max={60}
                  step={1}
                  defaultValue={24}
                  unit="dB"
                  size={64}
                  accent="amber"
                  onChange={(v) => onUpdateChannel(selectedChannel.id, { gainDb: v })}
                />
                <RotaryKnob
                  label="Master Trim"
                  value={dsp.inputTrimDb}
                  min={-18}
                  max={18}
                  step={0.5}
                  defaultValue={0}
                  unit="dB"
                  size={64}
                  accent="amber"
                  onChange={(v) => onUpdateDsp({ inputTrimDb: v })}
                />
              </div>

              {/* Group B: Phantom, Pad & Polarity Switches */}
              <div className="h-full rounded-lg border border-slate-700/70 bg-[#0D1017] p-3 flex flex-col justify-center gap-2 font-mono text-xs">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                  Stage Conditioning
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateChannel(selectedChannel.id, {
                        phantom48v: !selectedChannel.phantom48v,
                      })
                    }
                    className={`py-2 rounded font-bold border transition cursor-pointer flex items-center justify-center gap-1 text-[11px] ${
                      selectedChannel.phantom48v
                        ? 'bg-red-600 text-white border-red-400 shadow-[0_0_12px_rgba(239,68,68,0.7)]'
                        : 'bg-[#141925] border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    +48V
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateChannel(selectedChannel.id, {
                        padDb: !selectedChannel.padDb,
                      })
                    }
                    className={`py-2 rounded font-bold border transition cursor-pointer text-[11px] ${
                      selectedChannel.padDb
                        ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.6)]'
                        : 'bg-[#141925] border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    -20 dB PAD
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateChannel(selectedChannel.id, {
                      polarityInverted: !selectedChannel.polarityInverted,
                    })
                  }
                  className={`py-1.5 rounded font-bold border transition cursor-pointer text-[11px] ${
                    selectedChannel.polarityInverted
                      ? 'bg-sky-500 text-slate-950 border-sky-300'
                      : 'bg-[#141925] border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  POLARITY {selectedChannel.polarityInverted ? 'Ø INVERTED' : 'NORMAL (0°)'}
                </button>
              </div>

              {/* Group C: Mains Hum Notch Trap */}
              <div className="h-full rounded-lg border border-emerald-500/25 bg-[#08100E] p-3 flex flex-col justify-center gap-2 font-mono text-xs">
                <span className="text-[10px] text-emerald-300 uppercase font-bold tracking-wider">
                  Mains Hum Notch Trap
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['off', '50hz', '60hz'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() =>
                        onUpdateDsp({
                          cleanStandby: {
                            ...dsp.cleanStandby,
                            mainsHumNotch: mode,
                            dcBlockerEnabled: true,
                            adaptiveStandbyGate: true,
                            standbyGateThresholdDb: -56,
                          },
                        })
                      }
                      className={`py-2 rounded font-bold text-[11px] border transition cursor-pointer ${
                        dsp.cleanStandby?.mainsHumNotch === mode
                          ? 'bg-emerald-500 text-slate-950 border-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                          : 'bg-[#101816] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-slate-400 leading-tight">
                  Eliminates 50/60 Hz AC ground hum &amp; harmonics with zero phase smear.
                </span>
              </div>
            </div>

            <div className="px-3 py-1.5 rounded border border-slate-800 bg-[#050609] flex items-center justify-between font-mono text-[11px] text-slate-400 shrink-0">
              <span>Subsonic DC Protection: 18 Hz Butterworth Active</span>
              <span className="text-emerald-400 font-semibold">PFL Headroom: +18 dBFS</span>
            </div>
          </div>
        )}

        {/* PHASE 2: HPF/LPF FILTERS & ZERO-HUM STANDBY GATE */}
        {selectedPhase === 'phase-2-filters' && (
          <div className="h-full min-h-0 flex flex-col justify-between p-3 rounded-lg border border-cyan-500/40 bg-gradient-to-b from-[#0A171C] via-[#071014] to-[#04090C] shadow-inner">
            <div className="flex items-center justify-between border-b border-cyan-500/25 pb-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                <h3 className="font-mono text-xs font-bold text-cyan-100 tracking-wider uppercase">
                  PHASE 2 · BANDPASS FILTERS &amp; NOISE GATE — {selectedChannel.name}
                </h3>
              </div>
              <span className="font-mono text-[11px] text-emerald-400 font-semibold">
                Floor: {telemetry.noiseFloorDb.toFixed(1)} dBFS
              </span>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-2 gap-3 py-2 items-center">
              {/* Group A: Steep Surgical Filters */}
              <div className="h-full rounded-lg border border-cyan-500/30 bg-[#061116] p-3 flex flex-col justify-between">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-cyan-300 font-bold uppercase tracking-wider">
                    18 dB/Oct Butterworth Filters
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateDsp({ hpfEnabled: !dsp.hpfEnabled })}
                    className={`px-2 py-0.5 rounded font-bold border cursor-pointer ${
                      dsp.hpfEnabled
                        ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    {dsp.hpfEnabled ? 'HPF IN' : 'HPF OUT'}
                  </button>
                </div>
                <div className="flex items-center justify-around">
                  <RotaryKnob
                    label="High-Pass (HPF)"
                    value={dsp.hpfHz}
                    min={20}
                    max={300}
                    step={5}
                    defaultValue={80}
                    unit="Hz"
                    size={64}
                    accent="sky"
                    onChange={(v) => onUpdateDsp({ hpfHz: v, hpfEnabled: true })}
                  />
                  <RotaryKnob
                    label="Low-Pass (LPF)"
                    value={dsp.lpfHz}
                    min={4000}
                    max={20000}
                    step={250}
                    defaultValue={18000}
                    unit="Hz"
                    size={64}
                    accent="sky"
                    onChange={(v) => onUpdateDsp({ lpfHz: v, lpfEnabled: true })}
                  />
                </div>
              </div>

              {/* Group B: Expander / Standby Gate */}
              <div className="h-full rounded-lg border border-emerald-500/30 bg-[#071410] p-3 flex flex-col justify-between">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-emerald-300 font-bold uppercase tracking-wider">
                    Expander / Standby Gate
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateDsp({ gate: { ...dsp.gate, enabled: !dsp.gate.enabled } })
                    }
                    className={`px-2 py-0.5 rounded font-bold border cursor-pointer ${
                      dsp.gate.enabled
                        ? 'bg-emerald-500 text-slate-950 border-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    {dsp.gate.enabled ? 'GATE ACTIVE' : 'BYPASSED'}
                  </button>
                </div>
                <div className="flex items-center justify-around">
                  <RotaryKnob
                    label="Gate Thresh"
                    value={dsp.gate.thresholdDb}
                    min={-60}
                    max={-12}
                    step={1}
                    defaultValue={-42}
                    unit="dB"
                    size={64}
                    accent="emerald"
                    onChange={(v) =>
                      onUpdateDsp({ gate: { ...dsp.gate, thresholdDb: v, enabled: true } })
                    }
                  />
                  <RotaryKnob
                    label="Gate Depth"
                    value={dsp.gate.rangeDb}
                    min={6}
                    max={48}
                    step={2}
                    defaultValue={24}
                    unit="dB"
                    size={64}
                    accent="amber"
                    onChange={(v) =>
                      onUpdateDsp({ gate: { ...dsp.gate, rangeDb: v, enabled: true } })
                    }
                  />
                </div>
              </div>
            </div>

            <div className="px-3 py-1.5 rounded border border-slate-800 bg-[#05080A] flex items-center justify-between font-mono text-[11px] text-slate-400 shrink-0">
              <span>Removes stage floor rumble, mic handling thumps &amp; idle room hiss.</span>
              <span className="text-cyan-400 font-semibold">
                HPF: {dsp.hpfHz} Hz · LPF: {(dsp.lpfHz / 1000).toFixed(1)} kHz
              </span>
            </div>
          </div>
        )}

        {/* PHASE 3: 4-BAND PARAMETRIC EQ & LIVE FFT RTA */}
        {selectedPhase === 'phase-3-peq' && (
          <div className="h-full min-h-0 flex flex-col justify-between gap-2 p-2.5 rounded-lg border border-sky-500/35 bg-[#0A0F1A] shadow-inner">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
                <h3 className="font-mono text-xs font-bold text-white tracking-wider uppercase">
                  PHASE 3 · 4-BAND PARAMETRIC EQ &amp; LIVE RTA — {selectedChannel.name}
                </h3>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="text-slate-400">Range: ±18 dB</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateDsp({
                      eqBands: dsp.eqBands.map((b) => ({ ...b, gainDb: 0 })),
                    })
                  }
                  className="px-2 py-0.5 rounded border border-slate-600 bg-[#141C2B] text-slate-200 hover:bg-slate-700 cursor-pointer flex items-center gap-1 font-bold"
                >
                  <RotateCcw className="w-3 h-3 text-sky-400" />
                  FLAT RESET
                </button>
              </div>
            </div>

            {/* Adaptive OLED RTA & EQ Transfer Curve Screen */}
            <div className="relative flex-1 min-h-[90px] w-full bg-[#030509] rounded border border-slate-800 overflow-hidden shadow-[inset_0_2px_12px_rgba(0,0,0,0.9)]">
              <div className="absolute inset-0 flex flex-col justify-between px-2.5 py-1.5 pointer-events-none opacity-30 font-mono text-[9px] text-slate-400">
                <div className="flex justify-between">
                  <span>+18 dB</span>
                  <span>100 Hz</span>
                  <span>1 kHz</span>
                  <span>10 kHz</span>
                </div>
                <div className="w-full border-b border-dashed border-slate-600" />
                <div className="flex justify-between">
                  <span>-18 dB</span>
                  <span>20 Hz</span>
                  <span>500 Hz</span>
                  <span>20 kHz</span>
                </div>
              </div>

              <svg
                viewBox="0 0 640 130"
                preserveAspectRatio="none"
                className="w-full h-full overflow-hidden"
              >
                <defs>
                  <linearGradient id="peqAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <line
                  x1="0"
                  y1={peqGeometry.midY}
                  x2="640"
                  y2={peqGeometry.midY}
                  stroke="#334155"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <path d={peqGeometry.area} fill="url(#peqAreaGrad)" />
                <path
                  d={peqGeometry.path}
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth="2.5"
                  className="drop-shadow-[0_0_8px_rgba(56,189,248,0.7)]"
                />
                {peqGeometry.nodes.map((node) => (
                  <circle
                    key={node.id}
                    cx={node.x}
                    cy={node.y}
                    r={node.enabled ? 5 : 3.5}
                    fill={node.enabled ? node.color : '#475569'}
                    stroke="#030509"
                    strokeWidth="1.5"
                  />
                ))}
              </svg>
            </div>

            {/* 4 Color-Coded Hardware Parametric Band Modules */}
            <div className="shrink-0 grid grid-cols-4 gap-2">
              {dsp.eqBands.slice(0, 4).map((band, idx) => {
                const style = PEQ_BAND_STYLES[idx] ?? PEQ_BAND_STYLES[3];
                return (
                  <div
                    key={band.id}
                    className={`rounded-lg border px-2.5 py-2 flex flex-col justify-between gap-1.5 ${style.card}`}
                  >
                    <div className="flex items-center justify-between gap-1 font-mono text-[10px]">
                      <span className={`px-1.5 py-0.5 rounded border font-bold truncate ${style.badge}`}>
                        {style.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = dsp.eqBands.map((b) =>
                            b.id === band.id ? { ...b, enabled: !b.enabled } : b
                          );
                          onUpdateDsp({ eqBands: updated });
                        }}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border cursor-pointer shrink-0 ${
                          band.enabled
                            ? 'bg-emerald-500 text-slate-950 border-emerald-300'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {band.enabled ? 'IN' : 'OUT'}
                      </button>
                    </div>

                    <div className="flex items-center justify-around gap-1">
                      <RotaryKnob
                        label="Gain"
                        value={band.gainDb}
                        min={-15}
                        max={15}
                        step={0.5}
                        defaultValue={0}
                        unit="dB"
                        size={42}
                        accent={style.accent}
                        onChange={(v) => {
                          const updated = dsp.eqBands.map((b) =>
                            b.id === band.id ? { ...b, gainDb: v, enabled: true } : b
                          );
                          onUpdateDsp({ eqBands: updated });
                        }}
                      />
                      <RotaryKnob
                        label="Freq"
                        value={band.frequency}
                        min={style.minHz}
                        max={style.maxHz}
                        step={10}
                        defaultValue={band.frequency}
                        unit="Hz"
                        size={42}
                        accent={style.accent}
                        onChange={(v) => {
                          const updated = dsp.eqBands.map((b) =>
                            b.id === band.id ? { ...b, frequency: v, enabled: true } : b
                          );
                          onUpdateDsp({ eqBands: updated });
                        }}
                      />
                      <RotaryKnob
                        label="Q"
                        value={band.q}
                        min={0.4}
                        max={8}
                        step={0.1}
                        defaultValue={1.4}
                        size={42}
                        accent={style.accent}
                        onChange={(v) => {
                          const updated = dsp.eqBands.map((b) =>
                            b.id === band.id ? { ...b, q: v, enabled: true } : b
                          );
                          onUpdateDsp({ eqBands: updated });
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PHASE 4: VCA DYNAMICS COMPRESSOR & GAIN REDUCTION LADDER */}
        {selectedPhase === 'phase-4-dynamics' && (
          <div className="h-full min-h-0 flex flex-col justify-between p-3 rounded-lg border border-emerald-500/40 bg-gradient-to-b from-[#091813] via-[#06100D] to-[#040907] shadow-inner">
            <div className="flex items-center justify-between border-b border-emerald-500/25 pb-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                <h3 className="font-mono text-xs font-bold text-emerald-100 tracking-wider uppercase">
                  PHASE 4 · VCA DYNAMICS COMPRESSOR &amp; DE-ESSER — {selectedChannel.name}
                </h3>
              </div>
              <span className="font-mono text-xs text-amber-400 font-bold">
                GR: -{Math.abs(telemetry.gainReductionDb).toFixed(1)} dB
              </span>
            </div>

            <div className="flex-1 min-h-0 flex items-center gap-3 py-2">
              {/* 12-Segment Gain Reduction LED Meter */}
              <div className="h-full w-20 shrink-0 rounded-lg border border-slate-700/80 bg-[#05080B] p-2 flex flex-col items-center justify-between font-mono">
                <span className="text-[9px] font-bold text-amber-400">GR (dB)</span>
                <div className="flex-1 w-5 flex flex-col justify-between py-1 gap-0.5">
                  {Array.from({ length: grSegments }).map((_, idx) => {
                    const lit = idx < activeGrCount;
                    return (
                      <div
                        key={idx}
                        className={`flex-1 w-full rounded-xs transition-colors ${
                          lit
                            ? idx > 8
                              ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]'
                              : 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]'
                            : 'bg-slate-800/80'
                        }`}
                      />
                    );
                  })}
                </div>
                <span className="text-[10px] text-slate-300 font-bold tabular-nums">
                  -{Math.abs(telemetry.gainReductionDb).toFixed(1)}
                </span>
              </div>

              {/* 5 Grouped Compressor Controls */}
              <div className="flex-1 h-full rounded-lg border border-emerald-500/25 bg-[#060E0B] grid grid-cols-5 gap-2 items-center justify-items-center p-2">
                <RotaryKnob
                  label="Threshold"
                  value={dsp.compressor.thresholdDb}
                  min={-48}
                  max={0}
                  step={1}
                  defaultValue={-18}
                  unit="dB"
                  size={60}
                  accent="amber"
                  onChange={(v) =>
                    onUpdateDsp({
                      compressor: { ...dsp.compressor, thresholdDb: v, enabled: true },
                    })
                  }
                />
                <RotaryKnob
                  label="Ratio"
                  value={dsp.compressor.ratio}
                  min={1}
                  max={16}
                  step={0.5}
                  defaultValue={3}
                  unit=":1"
                  size={60}
                  accent="emerald"
                  onChange={(v) =>
                    onUpdateDsp({
                      compressor: { ...dsp.compressor, ratio: v, enabled: true },
                    })
                  }
                />
                <RotaryKnob
                  label="Attack"
                  value={dsp.compressor.attackMs}
                  min={1}
                  max={100}
                  step={1}
                  defaultValue={15}
                  unit="ms"
                  size={60}
                  accent="sky"
                  onChange={(v) =>
                    onUpdateDsp({
                      compressor: { ...dsp.compressor, attackMs: v, enabled: true },
                    })
                  }
                />
                <RotaryKnob
                  label="Release"
                  value={dsp.compressor.releaseMs}
                  min={20}
                  max={800}
                  step={10}
                  defaultValue={120}
                  unit="ms"
                  size={60}
                  accent="sky"
                  onChange={(v) =>
                    onUpdateDsp({
                      compressor: { ...dsp.compressor, releaseMs: v, enabled: true },
                    })
                  }
                />
                <RotaryKnob
                  label="Makeup"
                  value={dsp.compressor.makeupDb}
                  min={0}
                  max={18}
                  step={0.5}
                  defaultValue={0}
                  unit="dB"
                  size={60}
                  accent="emerald"
                  onChange={(v) =>
                    onUpdateDsp({
                      compressor: { ...dsp.compressor, makeupDb: v, enabled: true },
                    })
                  }
                />
              </div>
            </div>

            <div className="px-3 py-1.5 rounded border border-slate-800 bg-[#050807] flex items-center justify-between font-mono text-[11px] shrink-0">
              <span className="text-slate-400">
                Smooth RMS VCA peak-leveler with transparent auto-release.
              </span>
              <button
                type="button"
                onClick={() =>
                  onUpdateDsp({
                    compressor: { ...dsp.compressor, enabled: !dsp.compressor.enabled },
                  })
                }
                className={`px-3 py-1 rounded text-[11px] font-bold border transition cursor-pointer ${
                  dsp.compressor.enabled
                    ? 'bg-emerald-500 text-slate-950 border-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {dsp.compressor.enabled ? 'COMPRESSOR ACTIVE' : 'BYPASSED'}
              </button>
            </div>
          </div>
        )}

        {/* PHASE 5: PRO STEREO 31-BAND GRAPHIC EQUALIZER */}
        {selectedPhase === 'phase-5-geq' && (
          <div className="h-full min-h-0 overflow-hidden flex flex-col">
            <StereoGraphicEqModule dsp={dsp} onUpdateDsp={onUpdateDsp} compactConsoleMode />
          </div>
        )}

        {/* PHASE 6: ACTIVE 3-WAY LINKWITZ-RILEY CROSSOVER */}
        {selectedPhase === 'phase-6-xover' && (
          <div className="h-full min-h-0 overflow-hidden flex flex-col">
            <ActiveCrossoverModule dsp={dsp} onUpdateDsp={onUpdateDsp} compactConsoleMode />
          </div>
        )}

        {/* PHASE 7: OUTPUT MATRIX & BRICKWALL PEAK LIMITER */}
        {selectedPhase === 'phase-7-matrix' && (
          <div className="h-full min-h-0 flex flex-col justify-between p-3 rounded-lg border border-orange-500/40 bg-gradient-to-b from-[#1A100A] via-[#100B07] to-[#080604] shadow-inner">
            <div className="flex items-center justify-between border-b border-orange-500/25 pb-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)]" />
                <h3 className="font-mono text-xs font-bold text-orange-100 tracking-wider uppercase">
                  PHASE 7 · OUTPUT BUS MATRIX &amp; SPEAKER PEAK LIMITER
                </h3>
              </div>
              <span className="font-mono text-xs text-orange-300 font-bold">
                Ceiling: {dsp.limiter.ceilingDb.toFixed(1)} dBFS
              </span>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-3 gap-3 py-2 items-center">
              <div className="h-full rounded-lg border border-red-500/30 bg-[#120909] p-3 flex items-center justify-center">
                <RotaryKnob
                  label="Brickwall Ceiling"
                  value={dsp.limiter.ceilingDb}
                  min={-12}
                  max={0}
                  step={0.5}
                  defaultValue={-0.5}
                  unit="dBFS"
                  size={64}
                  accent="red"
                  onChange={(v) =>
                    onUpdateDsp({
                      limiter: { ...dsp.limiter, ceilingDb: v, enabled: true },
                    })
                  }
                />
              </div>

              <div className="h-full rounded-lg border border-amber-500/30 bg-[#120E08] p-3 flex items-center justify-center">
                <RotaryKnob
                  label="Master Delay"
                  value={dsp.masterDelayMs}
                  min={0}
                  max={200}
                  step={1}
                  defaultValue={0}
                  unit="ms"
                  size={64}
                  accent="amber"
                  onChange={(v) => onUpdateDsp({ masterDelayMs: v })}
                />
              </div>

              <div className="h-full rounded-lg border border-slate-700/80 bg-[#0A0C12] p-3 flex flex-col justify-center gap-1.5 font-mono text-[10px]">
                <span className="text-slate-400 uppercase font-bold">
                  Active Matrix Outputs ({zones.length || 3} Zones)
                </span>
                <div className="flex justify-between bg-[#05070B] px-2.5 py-1.5 rounded border border-slate-800">
                  <span>Main Sanctuary PA L/R</span>
                  <span className="text-emerald-400 font-bold">ACTIVE · 0.0 ms</span>
                </div>
                <div className="flex justify-between bg-[#05070B] px-2.5 py-1.5 rounded border border-slate-800">
                  <span>Aux 1 Dedicated Sub Array</span>
                  <span className="text-fuchsia-400 font-bold">ACTIVE · 4.5 ms</span>
                </div>
                <div className="flex justify-between bg-[#05070B] px-2.5 py-1.5 rounded border border-slate-800">
                  <span>Matrix 2 Balcony Delays</span>
                  <span className="text-sky-400 font-bold">ACTIVE · 24.2 ms</span>
                </div>
              </div>
            </div>

            <div className="px-3 py-1.5 rounded border border-slate-800 bg-[#070504] flex items-center justify-between font-mono text-[11px] shrink-0">
              <span className="text-slate-400">
                0 ms Lookahead True-Peak Limiter prevents horn clipping &amp; speaker thermal overload.
              </span>
              <button
                type="button"
                onClick={() =>
                  onUpdateDsp({
                    limiter: { ...dsp.limiter, enabled: !dsp.limiter.enabled },
                  })
                }
                className={`px-3 py-1 rounded text-[11px] font-bold border transition cursor-pointer ${
                  dsp.limiter.enabled
                    ? 'bg-orange-500 text-slate-950 border-orange-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {dsp.limiter.enabled ? 'LIMITER ENGAGED' : 'BYPASSED'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          BOTTOM TIER: MOTORIZED 8-CHANNEL HARDWARE FADER BAY (100% VISIBLE DOCK)
          ========================================================================= */}
      <div className="h-[196px] shrink-0 bg-gradient-to-b from-[#111726] to-[#080B13] border-t-2 border-slate-700/80 flex flex-col px-2.5 py-1.5 shadow-2xl">
        {/* Bank Switcher Header */}
        <div className="h-7 shrink-0 flex items-center justify-between pb-1 border-b border-slate-800 font-mono text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-bold uppercase tracking-wider mr-1">
              FADER BANK:
            </span>
            <button
              type="button"
              onClick={() => setFaderBank('bank-1')}
              className={`px-2.5 py-0.5 rounded text-[10px] font-bold border transition cursor-pointer ${
                faderBank === 'bank-1'
                  ? 'bg-sky-500 text-slate-950 border-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.4)]'
                  : 'bg-[#0A0F1A] border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              CH 1–8 · WORSHIP BAND
            </button>
            <button
              type="button"
              onClick={() => setFaderBank('bank-2')}
              className={`px-2.5 py-0.5 rounded text-[10px] font-bold border transition cursor-pointer ${
                faderBank === 'bank-2'
                  ? 'bg-sky-500 text-slate-950 border-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.4)]'
                  : 'bg-[#0A0F1A] border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              CH 9–16 · MEDIA &amp; VOCALS
            </button>
          </div>

          <div className="text-slate-400 flex items-center gap-1.5">
            <span className="text-[9px] uppercase">Selected Strip:</span>
            <span className="text-sky-300 font-bold bg-[#05080F] px-2 py-0.5 rounded border border-sky-500/40">
              {selectedChannel.name}
            </span>
          </div>
        </div>

        {/* 8 Channel Strips Side-by-Side (Guaranteed Complete Visibility) */}
        <div className="flex-1 min-h-0 grid grid-cols-8 gap-1.5 pt-1.5">
          {bankChannels.map((ch, idx) => {
            const isSelected = ch.id === selectedChannel.id;
            const chNum = faderBank === 'bank-2' ? idx + 9 : idx + 1;
            const meterNorm = Math.max(0, Math.min(100, ((ch.levelDb + 60) / 60) * 100));
            return (
              <div
                key={ch.id}
                onClick={() => setSelectedChannelId(ch.id)}
                className={`h-full min-h-0 flex flex-col justify-between p-1.5 rounded-md border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-sky-400 bg-gradient-to-b from-sky-950/50 to-[#09111E] shadow-[0_0_12px_rgba(56,189,248,0.25)]'
                    : 'border-slate-800 bg-gradient-to-b from-[#0E1420] to-[#080B12] hover:border-slate-600'
                }`}
              >
                {/* Recessed OLED Scribble Strip */}
                <div
                  className={`shrink-0 rounded px-1.5 py-0.5 border font-mono text-[9px] leading-tight flex items-center justify-between gap-1 ${
                    isSelected
                      ? 'bg-[#040A14] border-sky-400/60 text-sky-200'
                      : 'bg-[#04060B] border-slate-800 text-slate-300'
                  }`}
                >
                  <span className="text-slate-500 font-bold shrink-0">CH{chNum}</span>
                  <span className="font-bold truncate" title={ch.name}>
                    {ch.name}
                  </span>
                </div>

                {/* Vertical Fader + Mini RMS Signal Meter */}
                <div className="flex-1 min-h-0 flex items-center justify-center gap-2 py-0.5">
                  <PrecisionVerticalFader
                    value={ch.faderDb}
                    min={-48}
                    max={10}
                    step={0.5}
                    compact
                    trackHeightClass="h-20"
                    accent={ch.mute ? 'amber' : isSelected ? 'sky' : 'cyan'}
                    onChange={(next) => onUpdateChannel(ch.id, { faderDb: next })}
                  />
                  {/* Channel Level LED Bar */}
                  <div className="h-20 w-1.5 rounded-full bg-[#04060A] border border-slate-800 overflow-hidden flex flex-col justify-end">
                    <div
                      className={`w-full transition-all duration-100 ${
                        ch.mute
                          ? 'bg-slate-700'
                          : meterNorm > 85
                            ? 'bg-amber-400'
                            : 'bg-emerald-400'
                      }`}
                      style={{ height: `${ch.mute ? 4 : meterNorm}%` }}
                    />
                  </div>
                </div>

                {/* Tactile Illuminated SOLO & MUTE Keys */}
                <div className="shrink-0 grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateChannel(ch.id, { solo: !ch.solo });
                    }}
                    className={`py-0.5 text-[9px] font-mono font-bold rounded border transition cursor-pointer ${
                      ch.solo
                        ? 'bg-amber-400 text-slate-950 border-amber-200 shadow-[0_0_8px_rgba(251,191,36,0.75)]'
                        : 'bg-[#121824] border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    SOLO
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateChannel(ch.id, { mute: !ch.mute });
                    }}
                    className={`py-0.5 text-[9px] font-mono font-bold rounded border transition cursor-pointer ${
                      ch.mute
                        ? 'bg-red-600 text-white border-red-400 shadow-[0_0_8px_rgba(239,68,68,0.75)]'
                        : 'bg-[#121824] border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    MUTE
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
