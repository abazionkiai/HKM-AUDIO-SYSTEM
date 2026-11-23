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
  selectedChannelId?: string;
  onSelectChannel?: (id: string) => void;
  locked?: boolean;
  onAddChannel?: (name?: string, role?: string) => void;
  onAddEqBand?: () => void;
  onRemoveEqBand?: (bandId: string) => void;
  inputDevices?: MediaDeviceInfo[];
  outputDevices?: MediaDeviceInfo[];
  preferredOutputDeviceId?: string;
  preferredStreamOutputDeviceId?: string;
  onSelectOutputDevice?: (deviceId: string) => void;
  onSelectStreamOutputDevice?: (deviceId: string) => void;
  onUpdateZone?: (id: string, patch: Partial<SpeakerZone>) => void;
  onScanAudioDevices?: (requestPermission?: boolean) => Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>;
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
  selectedChannelId: controlledChannelId,
  onSelectChannel: onControlledSelectChannel,
  locked = false,
  onAddChannel,
  onAddEqBand,
}) => {
  const [selectedPhase, setSelectedPhase] = useState<ConsoleProcessingPhase>(initialPhase ?? 'phase-3-peq');

  useEffect(() => {
    if (initialPhase) {
      setSelectedPhase(initialPhase);
    }
  }, [initialPhase]);

  const [localChannelId, setLocalChannelId] = useState<string>(channels[0]?.id ?? 'ch-1');
  const activeChannelId = controlledChannelId ?? localChannelId;
  const setSelectedChannelId = (id: string) => {
    setLocalChannelId(id);
    onControlledSelectChannel?.(id);
  };
  const [bankIdx, setBankIdx] = useState<number>(0);
  const [peqPageOffset, setPeqPageOffset] = useState<number>(0);

  const selectedChannel: InputChannel =
    channels.find((c) => c.id === activeChannelId) ??
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

  const selectedAssigned = Boolean(selectedChannel.hardwareInputId);

  const totalBanks = Math.max(1, Math.ceil(channels.length / 8));
  const safeBankIdx = Math.min(bankIdx, totalBanks - 1);
  const bankChannels = useMemo(() => {
    const start = safeBankIdx * 8;
    return channels.slice(start, start + 8);
  }, [channels, safeBankIdx]);

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
      readout: selectedAssigned ? `+${selectedChannel.gainDb}dB` : 'OPEN',
      activeClass: 'bg-amber-500/25 border-2 border-amber-400 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.5)] font-extrabold',
      ledClass: selectedAssigned ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]' : 'bg-slate-600',
      topBarClass: 'bg-amber-400',
      enabled: selectedAssigned,
    },
    {
      id: 'phase-2-filters',
      step: '2',
      label: 'HPF & GATE',
      readout: dsp.hpfEnabled ? `${dsp.hpfHz}Hz` : 'BYP',
      activeClass: 'bg-cyan-500/25 border-2 border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.5)] font-extrabold',
      ledClass: dsp.hpfEnabled ? 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]' : 'bg-slate-600',
      topBarClass: 'bg-cyan-400',
      enabled: dsp.hpfEnabled,
    },
    {
      id: 'phase-3-peq',
      step: '3',
      label: '4-BAND PEQ',
      readout: 'RTA LIVE',
      activeClass: 'bg-sky-500/25 border-2 border-sky-400 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.5)] font-extrabold',
      ledClass: 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]',
      topBarClass: 'bg-sky-400',
      enabled: true,
    },
    {
      id: 'phase-4-dynamics',
      step: '4',
      label: 'VCA COMP',
      readout: dsp.compressor.enabled ? `${dsp.compressor.ratio.toFixed(1)}:1` : 'OFF',
      activeClass: 'bg-emerald-500/25 border-2 border-emerald-400 text-emerald-200 shadow-[0_0_12px_rgba(52,211,153,0.5)] font-extrabold',
      ledClass: dsp.compressor.enabled ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-slate-600',
      topBarClass: 'bg-emerald-400',
      enabled: dsp.compressor.enabled,
    },
    {
      id: 'phase-5-geq',
      step: '5',
      label: '31-BAND GEQ',
      readout: `±${dsp.graphicEq31?.rangeDb ?? 12}dB`,
      activeClass: 'bg-fuchsia-500/25 border-2 border-fuchsia-400 text-fuchsia-200 shadow-[0_0_12px_rgba(232,121,249,0.5)] font-extrabold',
      ledClass: dsp.graphicEq31?.enabled !== false ? 'bg-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.8)]' : 'bg-slate-600',
      topBarClass: 'bg-fuchsia-400',
      enabled: dsp.graphicEq31?.enabled !== false,
    },
    {
      id: 'phase-6-xover',
      step: '6',
      label: '3-WAY XOVER',
      readout: `${dsp.crossover?.subToMidHz ?? 80}Hz`,
      activeClass: 'bg-violet-500/25 border-2 border-violet-400 text-violet-200 shadow-[0_0_12px_rgba(167,139,250,0.5)] font-extrabold',
      ledClass: dsp.crossover?.enabled !== false ? 'bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.8)]' : 'bg-slate-600',
      topBarClass: 'bg-violet-400',
      enabled: dsp.crossover?.enabled !== false,
    },
    {
      id: 'phase-7-matrix',
      step: '7',
      label: 'MATRIX & PA',
      readout: dsp.limiter.enabled ? `${dsp.limiter.ceilingDb.toFixed(1)}dB` : 'OPEN',
      activeClass: 'bg-orange-500/25 border-2 border-orange-400 text-orange-200 shadow-[0_0_12px_rgba(251,146,60,0.5)] font-extrabold',
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
      <div className="h-8 shrink-0 bg-gradient-to-b from-[#141B28] to-[#0D121C] border-b border-slate-700/70 px-3 flex items-center justify-between gap-3">
        {/* Left: Console Identity & Hardware Lock */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-2 h-5 rounded-xs bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.75)] shrink-0" />
          <div className="flex items-center gap-2 min-w-0 font-mono">
            <span className="text-[11px] font-bold text-emerald-400 tracking-wider whitespace-nowrap">
              HKM CONSOLE INSTRUMENT
            </span>
            <span className="text-slate-600 hidden md:inline">|</span>
            <span className="text-[10px] text-slate-400 truncate hidden md:inline">
              {telemetry?.isRunning
                ? `LIVE AUDIO ENGINE · ${(telemetry.sampleRate / 1000).toFixed(1)} kHz · ACTIVE`
                : 'LIVE AUDIO ENGINE · READY'}
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
      <div className="shrink-0 bg-[#070B13] border-b border-slate-700/80 px-2.5 py-1.5 grid grid-cols-7 gap-1.5">
        {phaseTabs.map((tab, idx) => {
          const active = selectedPhase === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedPhase(tab.id)}
              className={`relative rounded-md border-2 px-2.5 py-1.5 flex items-center justify-between gap-1.5 font-mono text-[10px] transition-all cursor-pointer min-w-0 overflow-hidden ${
                active
                  ? tab.activeClass
                  : 'bg-[#0E1422] border-slate-700/90 text-slate-300 hover:bg-[#151D30] hover:text-white hover:border-slate-500 shadow-sm'
              }`}
            >
              {/* Top Illuminated Hardware Accent Bar */}
              {active && (
                <span className={`absolute inset-x-0 top-0 h-[3px] ${tab.topBarClass}`} />
              )}
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${tab.ledClass}`} />
                <span className={`text-[10px] font-extrabold shrink-0 ${active ? 'text-white' : 'text-slate-400'}`}>{tab.step}.</span>
                <span className="font-bold truncate tracking-wide">{tab.label}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-[9px] font-semibold hidden xl:inline tabular-nums ${active ? 'opacity-100 text-white' : 'opacity-75 text-slate-400'}`}>
                  {tab.readout}
                </span>
                {idx < phaseTabs.length - 1 && (
                  <ArrowRight className={`w-3 h-3 hidden lg:inline ${active ? 'text-white' : 'text-slate-500'}`} />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* =========================================================================
          MIDDLE DECK: FOCUSED HARDWARE PROCESSING RACK (ZERO SCROLL)
          ========================================================================= */}
      <div className={`flex-1 min-h-0 overflow-hidden flex flex-row ${locked ? 'opacity-90' : ''}`}>
        {/* Focused Hardware Processing Deck */}
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden p-1.5 bg-[#0A0E13] flex flex-col">
        {/* PHASE 1: STAGE PREAMP & GROUND HUM TRAPS */}
        {selectedPhase === 'phase-1-stage' && (
          <div className="h-full min-h-0 flex flex-col justify-between p-3 rounded-lg border border-amber-500/40 bg-gradient-to-b from-[#16110A] via-[#0D0B07] to-[#080705] shadow-inner">
            <div className="flex items-center justify-between border-b border-amber-500/25 pb-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    selectedAssigned
                      ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]'
                      : 'bg-slate-600'
                  }`}
                />
                <h3 className="font-mono text-xs font-bold text-amber-100 tracking-wider uppercase">
                  PHASE 1 · STAGE PREAMP &amp; GROUND HUM TRAPS — {selectedAssigned ? selectedChannel.name : `Open Slot CH${selectedChannel.index}`}
                </h3>
              </div>
              <span
                className={`font-mono text-[11px] font-semibold ${
                  selectedAssigned ? 'text-amber-400' : 'text-slate-400'
                }`}
              >
                {selectedAssigned
                  ? `Input: ${selectedChannel.hardwareInputLabel || selectedChannel.name}`
                  : 'Open Slot — No Input Assigned'}
              </span>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-3 gap-3 py-2 items-center">
              {/* Group A: Analog Gain & Trim */}
              <div className="h-full rounded-lg border border-amber-500/25 bg-[#0C0906] p-3 flex items-center justify-around">
                <RotaryKnob
                  label="Preamp Gain"
                  value={selectedAssigned ? selectedChannel.gainDb : 0}
                  min={0}
                  max={60}
                  step={1}
                  defaultValue={24}
                  unit="dB"
                  size={64}
                  accent={selectedAssigned ? 'amber' : 'slate'}
                  disabled={locked || !selectedAssigned}
                  formatValue={!selectedAssigned ? () => '--' : undefined}
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
                  disabled={locked}
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
                    disabled={locked || !selectedAssigned}
                    onClick={() =>
                      onUpdateChannel(selectedChannel.id, {
                        phantom48v: !selectedChannel.phantom48v,
                      })
                    }
                    className={`py-2 rounded font-bold border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1 text-[11px] ${
                      selectedAssigned && selectedChannel.phantom48v
                        ? 'bg-red-600 text-white border-red-400 shadow-[0_0_12px_rgba(239,68,68,0.7)]'
                        : 'bg-[#141925] border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    +48V
                  </button>
                  <button
                    type="button"
                    disabled={locked || !selectedAssigned}
                    onClick={() =>
                      onUpdateChannel(selectedChannel.id, {
                        padDb: !selectedChannel.padDb,
                      })
                    }
                    className={`py-2 rounded font-bold border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-[11px] ${
                      selectedAssigned && selectedChannel.padDb
                        ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.6)]'
                        : 'bg-[#141925] border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    -20 dB PAD
                  </button>
                </div>
                <button
                  type="button"
                  disabled={locked || !selectedAssigned}
                  onClick={() =>
                    onUpdateChannel(selectedChannel.id, {
                      polarityInverted: !selectedChannel.polarityInverted,
                    })
                  }
                  className={`py-1.5 rounded font-bold border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-[11px] ${
                    selectedAssigned && selectedChannel.polarityInverted
                      ? 'bg-sky-500 text-slate-950 border-sky-300'
                      : 'bg-[#141925] border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  POLARITY {selectedAssigned && selectedChannel.polarityInverted ? 'Ø INVERTED' : 'NORMAL (0°)'}
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
                <span className="text-slate-400">
                  Bands: {dsp.eqBands.length} · ±18 dB
                </span>
                {dsp.eqBands.length > 4 && (
                  <button
                    type="button"
                    onClick={() =>
                      setPeqPageOffset((p) => (p + 4 >= dsp.eqBands.length ? 0 : p + 4))
                    }
                    className="px-2 py-0.5 rounded border border-sky-500/50 bg-sky-500/15 text-sky-200 hover:bg-sky-500/30 cursor-pointer font-bold"
                  >
                    BANDS {peqPageOffset + 1}–{Math.min(dsp.eqBands.length, peqPageOffset + 4)} ▸
                  </button>
                )}
                {onAddEqBand && (
                  <button
                    type="button"
                    onClick={() => {
                      onAddEqBand();
                      if (dsp.eqBands.length >= 4) {
                        setPeqPageOffset(Math.floor(dsp.eqBands.length / 4) * 4);
                      }
                    }}
                    className="px-2 py-0.5 rounded border border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/30 cursor-pointer font-bold"
                  >
                    + BAND
                  </button>
                )}
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
            <div className="relative flex-1 min-h-[56px] w-full bg-[#030509] rounded border border-slate-800 overflow-hidden shadow-[inset_0_2px_12px_rgba(0,0,0,0.9)]">
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

            {/* 4 Color-Coded Hardware Parametric Band Modules (Paged across Unlimited Bands) */}
            <div className="shrink-0 grid grid-cols-4 gap-2">
              {dsp.eqBands.slice(peqPageOffset, peqPageOffset + 4).map((band, idx) => {
                const style = PEQ_BAND_STYLES[idx % 4] ?? PEQ_BAND_STYLES[3];
                return (
                  <div
                    key={band.id}
                    className={`rounded-lg border px-2 py-1.5 flex flex-col justify-between gap-1 ${style.card}`}
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
                        size={36}
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
                        size={36}
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
                        size={36}
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
      </div>

      {/* =========================================================================
          BOTTOM TIER: MOTORIZED 8-CHANNEL HARDWARE FADER BAY (100% VISIBLE DOCK)
          ========================================================================= */}
      <div className="h-[285px] shrink-0 bg-gradient-to-b from-[#111726] to-[#080B13] border-t-2 border-slate-700/80 flex flex-col px-2.5 py-1.5 shadow-2xl">
        {/* Bank Switcher Header */}
        <div className="h-6 shrink-0 flex items-center justify-between pb-1 border-b border-slate-800 font-mono text-[10px]">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-slate-400 font-bold uppercase tracking-wider mr-1 shrink-0">
              FADER BANK:
            </span>
            {Array.from({ length: totalBanks }).map((_, i) => {
              const startCh = i * 8 + 1;
              const endCh = Math.min(channels.length, (i + 1) * 8);
              const label = `CH ${startCh}–${endCh}`;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setBankIdx(i)}
                  className={`px-2.5 py-0.5 rounded text-[10px] font-bold border transition cursor-pointer whitespace-nowrap ${
                    safeBankIdx === i
                      ? 'bg-sky-500 text-slate-950 border-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.4)]'
                      : 'bg-[#0A0F1A] border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              );
            })}
            {onAddChannel && (
              <button
                type="button"
                onClick={() => {
                  onAddChannel();
                  setBankIdx(Math.floor(channels.length / 8));
                }}
                className="px-2 py-0.5 rounded text-[10px] font-bold border border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/30 cursor-pointer whitespace-nowrap"
                title="Add unlimited input channel strip"
              >
                + CH
              </button>
            )}
          </div>

          <div className="text-slate-400 flex items-center gap-1.5">
            <span className="text-[9px] uppercase">Selected Strip:</span>
            <span
              className={`font-bold bg-[#05080F] px-2 py-0.5 rounded border ${
                selectedAssigned
                  ? 'text-sky-300 border-sky-500/40'
                  : 'text-slate-400 border-slate-700'
              }`}
            >
              {selectedAssigned ? selectedChannel.name : `Open Slot (CH${selectedChannel.index})`}
            </span>
          </div>
        </div>

        {/* 8 Channel Strips Side-by-Side (Professional Proportions & Zero Squeeze) */}
        <div className="flex-1 min-h-0 flex items-stretch gap-1.5 pt-1.5 overflow-x-auto">
          {bankChannels.map((ch, idx) => {
            const isAssigned = Boolean(ch.hardwareInputId);
            const stripDisabled = Boolean(locked || !isAssigned);
            const isSelected = ch.id === selectedChannel.id;
            const chNum = safeBankIdx * 8 + idx + 1;
            const globalChIdx = safeBankIdx * 8 + idx;
            const chTelemetry = telemetry?.channelLevels?.[globalChIdx];
            const liveLevelDb = isAssigned ? chTelemetry?.rmsDb ?? ch.levelDb : -96;
            const livePeakDb = isAssigned ? chTelemetry?.peakDb ?? ch.peakDb : -96;
            const hasSignal = isAssigned && telemetry?.isRunning && !ch.mute && liveLevelDb > -54;
            const isHot = hasSignal && livePeakDb > -3;

            const isMainPaAssigned = ch.mainPaAssign ?? true;
            const isStreamAssigned = ch.streamAssign ?? true;
            const isSubAssigned = ch.subAssign ?? false;

            return (
              <div
                key={ch.id}
                onClick={() => setSelectedChannelId(ch.id)}
                className={`flex-1 min-w-[104px] max-w-[160px] h-full min-h-0 flex flex-col justify-between p-1.5 rounded-md border-2 transition-all cursor-pointer ${
                  !isAssigned
                    ? isSelected
                      ? 'border-dashed border-slate-500 bg-[#0A0E15] opacity-85'
                      : 'border-dashed border-slate-800/80 bg-[#080B11]/75 opacity-60 hover:opacity-85'
                    : isSelected
                      ? 'border-sky-400 bg-gradient-to-b from-sky-950/60 to-[#09111E] shadow-[0_0_12px_rgba(56,189,248,0.35)]'
                      : 'border-slate-700/80 bg-gradient-to-b from-[#0E1420] to-[#080B12] hover:border-slate-500'
                }`}
              >
                {/* OLED Scribble Strip Header (No Text Collision) */}
                <div
                  className={`shrink-0 rounded px-1.5 py-1 border font-mono text-[9px] leading-tight flex items-center justify-between gap-1 overflow-hidden ${
                    !isAssigned
                      ? 'bg-[#04060A] border-slate-800/80 text-slate-500'
                      : isSelected
                        ? 'bg-[#040A14] border-sky-400 text-sky-200 shadow-[0_0_8px_rgba(56,189,248,0.25)]'
                        : 'bg-[#04060B] border-slate-700/80 text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      title={
                        !isAssigned
                          ? 'Open Slot — Unassigned'
                          : hasSignal
                            ? `Signal Live: ${liveLevelDb.toFixed(1)} dBFS`
                            : 'No Signal / Idle'
                      }
                      className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                        !isAssigned
                          ? 'bg-[#1B232E]'
                          : ch.mute
                            ? 'bg-rose-500'
                            : isHot
                              ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]'
                              : hasSignal
                                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]'
                                : 'bg-slate-600'
                      }`}
                    />
                    <span className={`font-bold shrink-0 ${!isAssigned ? 'text-slate-600' : 'text-slate-400'}`}>
                      CH{chNum}
                    </span>
                  </div>
                  <span
                    className={`font-bold flex-1 min-w-0 truncate text-right ${
                      !isAssigned ? 'text-slate-500' : 'text-slate-100'
                    }`}
                    title={ch.name}
                  >
                    {ch.name}
                  </span>
                </div>

                {/* Subtitle: Live Hardware Input Role & Current dB Readout */}
                <div className="shrink-0 px-1 py-0.5 flex items-center justify-between text-[8px] font-mono">
                  <span
                    className={`truncate font-medium max-w-[65px] ${
                      !isAssigned ? 'text-slate-500 italic' : 'text-sky-400'
                    }`}
                    title={!isAssigned ? 'Open Slot' : ch.role || 'Live Input'}
                  >
                    {!isAssigned ? 'Open Slot' : ch.role || 'Live Input'}
                  </span>
                  {!isAssigned ? (
                    <span className="font-bold tabular-nums text-slate-600">--</span>
                  ) : (
                    <span
                      className={`font-bold tabular-nums ${
                        ch.faderDb > 0 ? 'text-sky-300' : ch.faderDb < 0 ? 'text-amber-400' : 'text-slate-300'
                      }`}
                    >
                      {ch.faderDb > 0 ? `+${ch.faderDb.toFixed(1)}` : ch.faderDb === 0 ? '0.0' : ch.faderDb.toFixed(1)}
                    </span>
                  )}
                </div>

                {/* Vertical Throw Fader + Studio Decibel Scale + 10-Segment LED Meter */}
                <div className="flex-1 min-h-0 flex items-center justify-between gap-1 py-1 px-0.5">
                  {/* Calibrated Decibel Ticks */}
                  <div className="h-32 flex flex-col justify-between items-end font-mono text-[7px] text-slate-500 tabular-nums shrink-0 select-none pr-0.5">
                    <span className={isAssigned ? 'text-rose-400 font-semibold' : 'text-slate-600'}>+10</span>
                    <span>+5</span>
                    <span className={isAssigned ? 'text-slate-300 font-bold' : 'text-slate-600'}>0</span>
                    <span>-5</span>
                    <span>-10</span>
                    <span>-20</span>
                    <span>-30</span>
                    <span>-40</span>
                    <span className="text-slate-600">-∞</span>
                  </div>

                  {/* Precision Console Fader Throw (128px Studio Travel) */}
                  <div className="flex-1 flex justify-center">
                    <PrecisionVerticalFader
                      value={isAssigned ? ch.faderDb : -48}
                      min={-48}
                      max={10}
                      step={0.5}
                      compact
                      disabled={stripDisabled}
                      trackHeightClass="h-32"
                      accent={!isAssigned ? 'slate' : ch.mute ? 'amber' : isSelected ? 'sky' : 'cyan'}
                      onChange={(next) => onUpdateChannel(ch.id, { faderDb: next })}
                    />
                  </div>

                  {/* 10-Segment Console Peak PPM Tower */}
                  <div className="h-32 w-2.5 rounded bg-[#030508] border border-slate-700/80 p-[1px] flex flex-col justify-between overflow-hidden shrink-0">
                    {[
                      { threshold: -0.5, color: 'bg-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.9)]' },
                      { threshold: -3, color: 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.9)]' },
                      { threshold: -6, color: 'bg-yellow-400' },
                      { threshold: -12, color: 'bg-emerald-300' },
                      { threshold: -18, color: 'bg-emerald-400' },
                      { threshold: -24, color: 'bg-emerald-500' },
                      { threshold: -30, color: 'bg-emerald-500' },
                      { threshold: -36, color: 'bg-emerald-600' },
                      { threshold: -42, color: 'bg-emerald-700' },
                      { threshold: -48, color: 'bg-emerald-800' },
                    ].map((seg, sIdx) => {
                      if (!isAssigned) {
                        return <div key={sIdx} className="w-full h-2 rounded-[1px] bg-[#0E131A]" />;
                      }
                      const lit = telemetry?.isRunning && !ch.mute && livePeakDb >= seg.threshold;
                      return (
                        <div
                          key={sIdx}
                          className={`w-full h-2 rounded-[1px] transition-all duration-75 ${
                            lit ? seg.color : 'bg-slate-800/30'
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Bus ASSIGN Keys (MAIN, STRM, SUB) */}
                <div className="shrink-0 grid grid-cols-3 gap-1 mb-1 font-mono text-[8px] font-bold">
                  <button
                    type="button"
                    disabled={stripDisabled}
                    title={!isAssigned ? 'Open Slot — Unassigned' : 'Assign to Main PA Mix'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateChannel(ch.id, { mainPaAssign: !isMainPaAssigned });
                    }}
                    className={`py-1 rounded border-2 transition text-center ${
                      !isAssigned
                        ? 'bg-[#070A10] border-slate-800/80 text-slate-600 opacity-45 cursor-not-allowed'
                        : isMainPaAssigned
                          ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-extrabold shadow-[0_0_6px_rgba(56,189,248,0.4)] cursor-pointer'
                          : 'bg-[#0A0F1A] border-slate-700/80 text-slate-500 hover:text-slate-300 cursor-pointer'
                    }`}
                  >
                    MAIN
                  </button>
                  <button
                    type="button"
                    disabled={stripDisabled}
                    title={!isAssigned ? 'Open Slot — Unassigned' : 'Assign to Live Stream / OBS Mix'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateChannel(ch.id, { streamAssign: !isStreamAssigned });
                    }}
                    className={`py-1 rounded border-2 transition text-center ${
                      !isAssigned
                        ? 'bg-[#070A10] border-slate-800/80 text-slate-600 opacity-45 cursor-not-allowed'
                        : isStreamAssigned
                          ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200 font-extrabold shadow-[0_0_6px_rgba(52,211,153,0.4)] cursor-pointer'
                          : 'bg-[#0A0F1A] border-slate-700/80 text-slate-500 hover:text-slate-300 cursor-pointer'
                    }`}
                  >
                    STRM
                  </button>
                  <button
                    type="button"
                    disabled={stripDisabled}
                    title={!isAssigned ? 'Open Slot — Unassigned' : 'Assign to Subwoofer Bus'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateChannel(ch.id, { subAssign: !isSubAssigned });
                    }}
                    className={`py-1 rounded border-2 transition text-center ${
                      !isAssigned
                        ? 'bg-[#070A10] border-slate-800/80 text-slate-600 opacity-45 cursor-not-allowed'
                        : isSubAssigned
                          ? 'bg-fuchsia-500/25 border-fuchsia-400 text-fuchsia-200 font-extrabold shadow-[0_0_6px_rgba(232,121,249,0.4)] cursor-pointer'
                          : 'bg-[#0A0F1A] border-slate-700/80 text-slate-500 hover:text-slate-300 cursor-pointer'
                    }`}
                  >
                    SUB
                  </button>
                </div>

                {/* Tactile Illuminated SOLO & MUTE Keys (or Dormant OPEN SLOT badge) */}
                <div className="shrink-0 grid grid-cols-2 gap-1">
                  {!isAssigned ? (
                    <button
                      type="button"
                      disabled
                      className="col-span-2 h-7 text-[9px] font-mono font-bold rounded border border-slate-800 bg-[#0A0E14] text-slate-600 cursor-not-allowed flex items-center justify-center"
                    >
                      OPEN SLOT
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateChannel(ch.id, { solo: !ch.solo });
                        }}
                        className={`h-7 text-[10px] font-mono font-bold rounded border-2 transition cursor-pointer disabled:opacity-45 flex items-center justify-center ${
                          ch.solo
                            ? 'bg-amber-400 text-slate-950 border-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.9)]'
                            : 'bg-[#121824] border-slate-600 text-slate-300 hover:text-white hover:border-slate-400'
                        }`}
                      >
                        SOLO
                      </button>

                      <button
                        type="button"
                        disabled={locked}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateChannel(ch.id, { mute: !ch.mute });
                        }}
                        className={`h-7 text-[10px] font-mono font-bold rounded border-2 transition cursor-pointer disabled:opacity-45 flex items-center justify-center ${
                          ch.mute
                            ? 'bg-rose-600 text-white border-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.9)]'
                            : 'bg-[#121824] border-slate-600 text-slate-300 hover:text-white hover:border-slate-400'
                        }`}
                      >
                        MUTE
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
