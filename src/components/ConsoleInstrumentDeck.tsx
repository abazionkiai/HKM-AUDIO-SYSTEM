import React, { useEffect, useMemo, useState } from 'react';
import {
  Sliders,
  Volume2,
  VolumeX,
  Activity,
  Layers,
  Sparkles,
  Zap,
  Flame,
  Radio,
  Clock,
  Shield,
  ShieldAlert,
  ArrowRight,
  Headphones,
  Check,
  RotateCcw,
  AudioWaveform,
} from 'lucide-react';
import type {
  DspConfig,
  InputChannel,
  ServicePreset,
  SignalTelemetry,
  SpeakerZone,
  HardwareDevice,
} from '../types/audio.ts';
import { ConsolePushButton, RotaryKnob, SegmentedLedMeter } from './StudioControls.tsx';
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
  const [faderBank, setFaderBank] = useState<'bank-1' | 'bank-2' | 'master'>('bank-1');

  const selectedChannel =
    channels.find((c) => c.id === selectedChannelId) ?? channels[0] ?? {
      id: 'ch-1',
      name: 'Channel 1',
      sourceType: 'live-mic',
      faderDb: 0,
      gainDb: 24,
      pan: 0,
      mute: false,
      solo: false,
      hpfHz: 80,
      eqLowDb: 0,
      eqMidFreqHz: 2500,
      eqMidDb: 0,
      eqHighDb: 0,
      compThresholdDb: -18,
      compRatio: 3,
      polarityInverted: false,
      phantom48v: false,
      padDb: false,
    };

  // Channels to display in bottom motorized fader bay (8 channels per bank)
  const bankChannels = useMemo(() => {
    if (faderBank === 'bank-2') return channels.slice(8, 16);
    return channels.slice(0, 8);
  }, [channels, faderBank]);

  // Real-time PEQ Curve Geometry for Phase 3
  const peqCurve = useMemo(() => {
    const width = 640;
    const height = 150;
    const minF = 20;
    const maxF = 20000;
    const points: string[] = [];

    const freqToX = (f: number) => {
      const minLog = Math.log10(minF);
      const maxLog = Math.log10(maxF);
      const fLog = Math.log10(Math.max(minF, Math.min(maxF, f)));
      return ((fLog - minLog) / (maxLog - minLog)) * width;
    };

    const numPoints = 80;
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

      const clampedDb = Math.max(-18, Math.min(18, gainDb));
      const y = height * 0.5 - (clampedDb / 18) * (height * 0.42);
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }

    return `M ${points.join(' L ')}`;
  }, [dsp.bypassed, dsp.eqBands, dsp.hpfEnabled, dsp.hpfHz]);

  return (
    <div className="h-full w-full overflow-hidden flex flex-col bg-[#06080E] text-slate-100 font-sans select-none border border-slate-800/80 rounded-lg shadow-2xl">
      {/* =========================================================================
          TOP DECK: METER BRIDGE & REAL-WORLD PHASE-TO-PHASE SIGNAL FLOW NAVIGATOR
          ========================================================================= */}
      <div className="h-14 shrink-0 bg-gradient-to-b from-[#0D121C] via-[#090D15] to-[#07090F] border-b border-slate-800/90 px-3 flex items-center justify-between gap-3 shadow-md">
        {/* Left: Console Engine Status & Master Stereo Output Meters */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-7 rounded-xs bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
            <div>
              <div className="font-mono text-[10px] font-bold text-emerald-400 tracking-wider flex items-center gap-1.5">
                <span>HKM CONSOLE INSTRUMENT</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <div className="font-mono text-[9px] text-slate-400">
                {device.model} · 48.0 kHz LOCKED · CamillaDSP v2.0
              </div>
            </div>
          </div>

          {/* Master Output VU Meter Pair */}
          <div className="hidden sm:flex items-center gap-1.5 bg-[#04060A] px-2.5 py-1 rounded border border-slate-800 font-mono text-[9px]">
            <span className="text-slate-400">MAIN L/R:</span>
            <div className="flex flex-col gap-1 w-20">
              <div className="h-1.5 w-full bg-slate-900 rounded-xs overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-75"
                  style={{
                    width: `${Math.max(0, Math.min(100, ((telemetry.postRmsDb + 60) / 60) * 100))}%`,
                  }}
                />
              </div>
              <div className="h-1.5 w-full bg-slate-900 rounded-xs overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-75"
                  style={{
                    width: `${Math.max(0, Math.min(100, ((telemetry.postRmsDb + 60) / 60) * 100))}%`,
                  }}
                />
              </div>
            </div>
            <span
              className={`font-bold tabular-nums ${
                telemetry.postPeakDb > -3 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {telemetry.isRunning ? `${telemetry.postPeakDb.toFixed(1)} dB` : 'OFF'}
            </span>
          </div>
        </div>

        {/* Center: REAL-WORLD SIGNAL FLOW PHASE BUTTONS (Strict Left-to-Right Physical Routing) */}
        <div className="flex items-center gap-1 overflow-x-auto py-1 scrollbar-none font-mono text-[10px]">
          {/* Phase 1: Stage Preamp */}
          <button
            type="button"
            onClick={() => setSelectedPhase('phase-1-stage')}
            className={`px-2.5 py-1.5 rounded border flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              selectedPhase === 'phase-1-stage'
                ? 'bg-sky-500/20 border-sky-400 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                : 'bg-[#090D15] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            <span className="font-bold">① PREAMP</span>
            <span className="text-[9px] text-sky-300/80">+{selectedChannel.gainDb}dB</span>
          </button>
          <ArrowRight className="w-2.5 h-2.5 text-slate-600 shrink-0" />

          {/* Phase 2: HPF & Noise Gate */}
          <button
            type="button"
            onClick={() => setSelectedPhase('phase-2-filters')}
            className={`px-2.5 py-1.5 rounded border flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              selectedPhase === 'phase-2-filters'
                ? 'bg-sky-500/20 border-sky-400 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                : 'bg-[#090D15] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${dsp.hpfEnabled ? 'bg-sky-400' : 'bg-slate-600'}`}
            />
            <span className="font-bold">② HPF &amp; GATE</span>
            <span className="text-[9px] text-sky-300/80">
              {dsp.hpfEnabled ? `${dsp.hpfHz}Hz` : 'OFF'}
            </span>
          </button>
          <ArrowRight className="w-2.5 h-2.5 text-slate-600 shrink-0" />

          {/* Phase 3: Parametric EQ */}
          <button
            type="button"
            onClick={() => setSelectedPhase('phase-3-peq')}
            className={`px-2.5 py-1.5 rounded border flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              selectedPhase === 'phase-3-peq'
                ? 'bg-sky-500/20 border-sky-400 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                : 'bg-[#090D15] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            <span className="font-bold">③ 4-BAND PEQ</span>
            <span className="text-[9px] text-sky-300/80">RTA LIVE</span>
          </button>
          <ArrowRight className="w-2.5 h-2.5 text-slate-600 shrink-0" />

          {/* Phase 4: Dynamics Compressor */}
          <button
            type="button"
            onClick={() => setSelectedPhase('phase-4-dynamics')}
            className={`px-2.5 py-1.5 rounded border flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              selectedPhase === 'phase-4-dynamics'
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                : 'bg-[#090D15] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${dsp.compressor.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`}
            />
            <span className="font-bold">④ VCA COMP</span>
            <span className="text-[9px] text-emerald-300/80">
              {dsp.compressor.enabled ? `${dsp.compressor.ratio.toFixed(1)}:1` : 'OFF'}
            </span>
          </button>
          <ArrowRight className="w-2.5 h-2.5 text-slate-600 shrink-0" />

          {/* Phase 5: Stereo 31-Band GEQ */}
          <button
            type="button"
            onClick={() => setSelectedPhase('phase-5-geq')}
            className={`px-2.5 py-1.5 rounded border flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              selectedPhase === 'phase-5-geq'
                ? 'bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-200 shadow-[0_0_10px_rgba(217,70,239,0.4)]'
                : 'bg-[#090D15] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400" />
            <span className="font-bold">⑤ 31-BAND GEQ</span>
            <span className="text-[9px] text-fuchsia-300/80">±12dB DUAL</span>
          </button>
          <ArrowRight className="w-2.5 h-2.5 text-slate-600 shrink-0" />

          {/* Phase 6: Active Crossover */}
          <button
            type="button"
            onClick={() => setSelectedPhase('phase-6-xover')}
            className={`px-2.5 py-1.5 rounded border flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              selectedPhase === 'phase-6-xover'
                ? 'bg-violet-500/20 border-violet-400 text-violet-200 shadow-[0_0_10px_rgba(167,139,250,0.4)]'
                : 'bg-[#090D15] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            <span className="font-bold">⑥ 3-WAY XOVER</span>
            <span className="text-[9px] text-violet-300/80">LR-24</span>
          </button>
          <ArrowRight className="w-2.5 h-2.5 text-slate-600 shrink-0" />

          {/* Phase 7: Output Matrix */}
          <button
            type="button"
            onClick={() => setSelectedPhase('phase-7-matrix')}
            className={`px-2.5 py-1.5 rounded border flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
              selectedPhase === 'phase-7-matrix'
                ? 'bg-amber-500/20 border-amber-400 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.4)]'
                : 'bg-[#090D15] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="font-bold">⑦ MATRIX &amp; PA</span>
            <span className="text-[9px] text-amber-300/80">LIMIT ON</span>
          </button>
        </div>

        {/* Right: Master Control Deck (Scene Recall, Total Bypass, Safe Mute) */}
        <div className="flex items-center gap-2 shrink-0">
          {presets.length > 0 && (
            <select
              value={activePreset?.id ?? ''}
              onChange={(e) => {
                const found = presets.find((p) => p.id === e.target.value);
                if (found && onSelectPreset) onSelectPreset(found);
              }}
              className="bg-[#0B0F17] border border-slate-700 text-slate-200 text-[10px] font-mono px-2 py-1 rounded cursor-pointer"
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
          MIDDLE DECK: FOCUSED HARDWARE PROCESSING INSTRUMENT (100% Zero-Scroll Viewport)
          ========================================================================= */}
      <div className="flex-1 min-h-0 overflow-hidden p-2.5 flex flex-col bg-[#05070D]">
        {/* PHASE 1: STAGE PREAMP & DC/HUM ELIMINATOR */}
        {selectedPhase === 'phase-1-stage' && (
          <div className="h-full flex flex-col justify-between p-4 rounded-xl border border-sky-500/35 bg-gradient-to-b from-[#0A101C] via-[#070B14] to-[#04070D] shadow-xl">
            <div className="flex items-center justify-between border-b border-sky-500/20 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                <h3 className="font-display text-sm font-bold text-white tracking-wide uppercase">
                  PHASE 1: Stage Preamp &amp; Ground Hum Traps — {selectedChannel.name}
                </h3>
              </div>
              <span className="font-mono text-xs text-sky-400 font-semibold">
                Input: {device.manufacturer} {device.model}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 items-center justify-items-center py-4">
              <RotaryKnob
                label="Preamp Gain"
                value={selectedChannel.gainDb}
                min={0}
                max={60}
                step={1}
                defaultValue={24}
                unit="dB"
                size={72}
                accent="sky"
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
                size={72}
                accent="sky"
                onChange={(v) => onUpdateDsp({ inputTrimDb: v })}
              />

              {/* +48V Phantom & -20dB Pad switches */}
              <div className="flex flex-col gap-2 w-36 font-mono text-xs">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateChannel(selectedChannel.id, {
                      phantom48v: !selectedChannel.phantom48v,
                    })
                  }
                  className={`py-2 rounded font-bold border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    selectedChannel.phantom48v
                      ? 'bg-red-600 text-white border-red-400 shadow-[0_0_12px_rgba(239,68,68,0.7)]'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  +48V PHANTOM
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateChannel(selectedChannel.id, {
                      padDb: !selectedChannel.padDb,
                    })
                  }
                  className={`py-2 rounded font-bold border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    selectedChannel.padDb
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  -20 dB PAD
                </button>
              </div>

              {/* Mains Hum Notch Filter Selector */}
              <div className="flex flex-col gap-2 w-44 font-mono text-xs">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">
                  Mains Hum Notch Trap:
                </span>
                <div className="grid grid-cols-3 gap-1">
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
                      className={`py-1.5 rounded font-bold text-[10px] border transition cursor-pointer ${
                        dsp.cleanStandby?.mainsHumNotch === mode
                          ? 'bg-sky-500 text-slate-950 border-sky-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
                <span className="text-[9px] text-slate-500 leading-tight">
                  Traps fundamental &amp; 2nd/3rd harmonics with zero phase distortion.
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg border border-slate-800 bg-[#060910] flex items-center justify-between font-mono text-xs text-slate-400">
              <span>Subsonic DC Protection: 18 Hz Butterworth Active</span>
              <span className="text-emerald-400">PFL Headroom: +18 dBFS</span>
            </div>
          </div>
        )}

        {/* PHASE 2: HPF/LPF FILTERS & ZERO-HUM STANDBY GATE */}
        {selectedPhase === 'phase-2-filters' && (
          <div className="h-full flex flex-col justify-between p-4 rounded-xl border border-sky-500/35 bg-gradient-to-b from-[#0A101C] via-[#070B14] to-[#04070D] shadow-xl">
            <div className="flex items-center justify-between border-b border-sky-500/20 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                <h3 className="font-display text-sm font-bold text-white tracking-wide uppercase">
                  PHASE 2: Clean Bandpass Filters &amp; Zero-Hum Gate — {selectedChannel.name}
                </h3>
              </div>
              <span className="font-mono text-xs text-emerald-400">
                Standby Silence: {telemetry.noiseFloorDb.toFixed(1)} dBFS
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center justify-items-center py-4">
              <RotaryKnob
                label="High-Pass (HPF)"
                value={dsp.hpfHz}
                min={20}
                max={300}
                step={5}
                defaultValue={80}
                unit="Hz"
                size={70}
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
                size={70}
                accent="sky"
                onChange={(v) => onUpdateDsp({ lpfHz: v, lpfEnabled: true })}
              />

              <RotaryKnob
                label="Noise Gate Thresh"
                value={dsp.gate.thresholdDb}
                min={-60}
                max={-12}
                step={1}
                defaultValue={-42}
                unit="dB"
                size={70}
                accent="emerald"
                onChange={(v) =>
                  onUpdateDsp({ gate: { ...dsp.gate, thresholdDb: v, enabled: true } })
                }
              />

              <RotaryKnob
                label="Gate Reduction"
                value={dsp.gate.rangeDb}
                min={6}
                max={48}
                step={2}
                defaultValue={24}
                unit="dB"
                size={70}
                accent="emerald"
                onChange={(v) => onUpdateDsp({ gate: { ...dsp.gate, rangeDb: v, enabled: true } })}
              />
            </div>

            <div className="p-2.5 rounded-lg border border-slate-800 bg-[#060910] flex items-center justify-between font-mono text-xs">
              <span className="text-slate-400">
                18 dB/Octave Steep Slope removes floor vibration &amp; vocal pop plosives.
              </span>
              <button
                type="button"
                onClick={() => onUpdateDsp({ hpfEnabled: !dsp.hpfEnabled })}
                className={`px-3 py-1 rounded text-[11px] font-bold border transition cursor-pointer ${
                  dsp.hpfEnabled
                    ? 'bg-sky-500 text-slate-950 border-sky-400'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {dsp.hpfEnabled ? 'HPF ENGAGED' : 'HPF BYPASSED'}
              </button>
            </div>
          </div>
        )}

        {/* PHASE 3: 4-BAND SURGICAL PARAMETRIC EQ WITH REAL-TIME RTA */}
        {selectedPhase === 'phase-3-peq' && (
          <div className="h-full flex flex-col justify-between p-3.5 rounded-xl border border-sky-500/35 bg-[#090D15] shadow-xl">
            <div className="flex items-center justify-between border-b border-sky-500/20 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                <h3 className="font-display text-sm font-bold text-white tracking-wide uppercase">
                  PHASE 3: 4-Band Parametric EQ &amp; Live FFT RTA — {selectedChannel.name}
                </h3>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-slate-400">Range: ±18 dB</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateDsp({
                      eqBands: dsp.eqBands.map((b) => ({ ...b, gainDb: 0 })),
                    })
                  }
                  className="px-2 py-0.5 rounded border border-slate-700 bg-slate-900 text-[10px] text-slate-300 hover:text-white cursor-pointer"
                >
                  FLAT RESET
                </button>
              </div>
            </div>

            {/* RTA Curve SVG Area */}
            <div className="relative w-full h-28 my-1 bg-[#05070D] rounded border border-slate-800/90 overflow-hidden">
              {/* Reference Grid lines */}
              <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none opacity-20 font-mono text-[9px] text-slate-400">
                <div className="flex justify-between">
                  <span>+18 dB</span>
                  <span>1 kHz</span>
                  <span>10 kHz</span>
                </div>
                <div className="w-full border-b border-dashed border-slate-600" />
                <div className="flex justify-between">
                  <span>-18 dB</span>
                  <span>20 Hz</span>
                  <span>20 kHz</span>
                </div>
              </div>

              <svg viewBox="0 0 640 150" className="w-full h-full overflow-hidden">
                <path
                  d={peqCurve}
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth="2.5"
                  className="filter drop-shadow-[0_0_8px_rgba(56,189,248,0.7)]"
                />
              </svg>
            </div>

            {/* 4 PEQ Band Knobs Controls */}
            <div className="grid grid-cols-4 gap-2 py-1 items-center justify-items-center">
              {dsp.eqBands.slice(0, 4).map((band, idx) => (
                <div
                  key={band.id}
                  className="w-full bg-[#070A10] p-2 rounded-lg border border-slate-800 flex flex-col items-center gap-1.5"
                >
                  <span className="font-mono text-[10px] font-bold text-sky-300">
                    BAND {idx + 1}: {band.frequency} Hz
                  </span>
                  <div className="flex items-center gap-2">
                    <RotaryKnob
                      label="Gain"
                      value={band.gainDb}
                      min={-15}
                      max={15}
                      step={0.5}
                      defaultValue={0}
                      unit="dB"
                      size={44}
                      accent="sky"
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
                      min={idx === 0 ? 30 : idx === 1 ? 120 : idx === 2 ? 800 : 3500}
                      max={idx === 0 ? 350 : idx === 1 ? 1500 : idx === 2 ? 6000 : 18000}
                      step={10}
                      defaultValue={band.frequency}
                      unit="Hz"
                      size={44}
                      accent="sky"
                      onChange={(v) => {
                        const updated = dsp.eqBands.map((b) =>
                          b.id === band.id ? { ...b, frequency: v, enabled: true } : b
                        );
                        onUpdateDsp({ eqBands: updated });
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PHASE 4: VCA DYNAMICS COMPRESSOR & DE-ESSER */}
        {selectedPhase === 'phase-4-dynamics' && (
          <div className="h-full flex flex-col justify-between p-4 rounded-xl border border-emerald-500/35 bg-gradient-to-b from-[#091512] via-[#070E0D] to-[#040807] shadow-xl">
            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <h3 className="font-display text-sm font-bold text-white tracking-wide uppercase">
                  PHASE 4: VCA Channel Dynamics Compressor &amp; De-Esser — {selectedChannel.name}
                </h3>
              </div>
              <span className="font-mono text-xs text-amber-400 font-bold">
                GR: -{telemetry.gainReductionDb.toFixed(1)} dB
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-center justify-items-center py-3">
              <RotaryKnob
                label="Threshold"
                value={dsp.compressor.thresholdDb}
                min={-48}
                max={0}
                step={1}
                defaultValue={-18}
                unit="dB"
                size={66}
                accent="emerald"
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
                size={66}
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
                size={66}
                accent="emerald"
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
                size={66}
                accent="emerald"
                onChange={(v) =>
                  onUpdateDsp({
                    compressor: { ...dsp.compressor, releaseMs: v, enabled: true },
                  })
                }
              />

              <RotaryKnob
                label="Makeup Gain"
                value={dsp.compressor.makeupDb}
                min={0}
                max={18}
                step={0.5}
                defaultValue={0}
                unit="dB"
                size={66}
                accent="emerald"
                onChange={(v) =>
                  onUpdateDsp({
                    compressor: { ...dsp.compressor, makeupDb: v, enabled: true },
                  })
                }
              />
            </div>

            <div className="p-2.5 rounded-lg border border-slate-800 bg-[#060807] flex items-center justify-between font-mono text-xs">
              <span className="text-slate-400">
                Smooth RMS peak-leveler with transparent auto-release.
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
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
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
          <div className="h-full overflow-hidden flex flex-col">
            <StereoGraphicEqModule dsp={dsp} onUpdateDsp={onUpdateDsp} />
          </div>
        )}

        {/* PHASE 6: ACTIVE 3-WAY LINKWITZ-RILEY CROSSOVER */}
        {selectedPhase === 'phase-6-xover' && (
          <div className="h-full overflow-hidden flex flex-col">
            <ActiveCrossoverModule dsp={dsp} onUpdateDsp={onUpdateDsp} />
          </div>
        )}

        {/* PHASE 7: OUTPUT MATRIX & BRICKWALL PEAK LIMITER */}
        {selectedPhase === 'phase-7-matrix' && (
          <div className="h-full flex flex-col justify-between p-4 rounded-xl border border-amber-500/35 bg-gradient-to-b from-[#141009] via-[#0D0B07] to-[#070604] shadow-xl">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <h3 className="font-display text-sm font-bold text-white tracking-wide uppercase">
                  PHASE 7: Output Bus Matrix Routing &amp; Speaker Peak Limiter
                </h3>
              </div>
              <span className="font-mono text-xs text-amber-300 font-bold">
                Max Ceiling: {dsp.limiter.ceilingDb.toFixed(1)} dBFS
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center justify-items-center py-2">
              <RotaryKnob
                label="Brickwall Ceiling"
                value={dsp.limiter.ceilingDb}
                min={-12}
                max={0}
                step={0.5}
                defaultValue={-0.5}
                unit="dBFS"
                size={66}
                accent="amber"
                onChange={(v) =>
                  onUpdateDsp({
                    limiter: { ...dsp.limiter, ceilingDb: v, enabled: true },
                  })
                }
              />

              <RotaryKnob
                label="Master Delay"
                value={dsp.masterDelayMs}
                min={0}
                max={200}
                step={1}
                defaultValue={0}
                unit="ms"
                size={66}
                accent="amber"
                onChange={(v) => onUpdateDsp({ masterDelayMs: v })}
              />

              <div className="w-full space-y-1.5 font-mono text-[10px]">
                <span className="text-slate-400 uppercase font-semibold">Active Matrix Outputs:</span>
                <div className="space-y-1">
                  <div className="flex justify-between bg-black/40 px-2 py-1 rounded border border-slate-800">
                    <span>Main Sanctuary PA L/R:</span>
                    <span className="text-emerald-400 font-bold">ACTIVE · 0.0 ms</span>
                  </div>
                  <div className="flex justify-between bg-black/40 px-2 py-1 rounded border border-slate-800">
                    <span>Aux 1 Dedicated Sub Array:</span>
                    <span className="text-fuchsia-400 font-bold">ACTIVE · 4.5 ms</span>
                  </div>
                  <div className="flex justify-between bg-black/40 px-2 py-1 rounded border border-slate-800">
                    <span>Matrix 2 Balcony Delays:</span>
                    <span className="text-sky-400 font-bold">ACTIVE · 24.2 ms</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-lg border border-slate-800 bg-[#070604] flex items-center justify-between font-mono text-xs">
              <span className="text-slate-400">
                0 ms Lookahead True-Peak Limiter eliminates horn clipping and thermal voice coil burnout.
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
                    ? 'bg-amber-500 text-slate-950 border-amber-400'
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
          BOTTOM TIER: MOTORIZED 8-CHANNEL HARDWARE FADER BAY (~240px Fixed Dock)
          ========================================================================= */}
      <div className="h-60 shrink-0 bg-[#080B13] border-t border-slate-800/90 flex flex-col p-2.5 shadow-2xl">
        {/* Bank Switcher Header */}
        <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80 mb-2 font-mono text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-semibold uppercase">FADER BANK:</span>
            <button
              type="button"
              onClick={() => setFaderBank('bank-1')}
              className={`px-3 py-1 rounded text-[10px] font-bold border transition cursor-pointer ${
                faderBank === 'bank-1'
                  ? 'bg-sky-500 text-slate-950 border-sky-400'
                  : 'bg-[#0B101A] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              CH 1–8: WORSHIP BAND
            </button>
            <button
              type="button"
              onClick={() => setFaderBank('bank-2')}
              className={`px-3 py-1 rounded text-[10px] font-bold border transition cursor-pointer ${
                faderBank === 'bank-2'
                  ? 'bg-sky-500 text-slate-950 border-sky-400'
                  : 'bg-[#0B101A] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              CH 9–16: MEDIA &amp; VOCALS
            </button>
          </div>

          <div className="text-slate-400 flex items-center gap-2">
            <span>SELECTED:</span>
            <span className="text-sky-300 font-bold bg-[#0D1422] px-2 py-0.5 rounded border border-sky-500/40">
              {selectedChannel.name}
            </span>
          </div>
        </div>

        {/* 8 Channel Strips Sitting Side-by-Side (Zero Horizontal/Vertical Scroll) */}
        <div className="flex-1 grid grid-cols-4 sm:grid-cols-8 gap-2 min-h-0">
          {bankChannels.map((ch, idx) => {
            const isSelected = ch.id === selectedChannel.id;
            return (
              <div
                key={ch.id}
                onClick={() => setSelectedChannelId(ch.id)}
                className={`flex flex-col justify-between p-1.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-sky-400 bg-sky-950/25 shadow-[0_0_12px_rgba(56,189,248,0.25)]'
                    : 'border-slate-800/80 bg-[#0B0F19] hover:border-slate-700'
                }`}
              >
                {/* OLED Scribble Strip */}
                <div className="text-center font-mono text-[9px] leading-tight pb-1 border-b border-slate-800">
                  <div className="text-slate-500">
                    {faderBank === 'bank-2' ? idx + 9 : idx + 1}
                  </div>
                  <div className="text-slate-200 font-bold truncate" title={ch.name}>
                    {ch.name}
                  </div>
                </div>

                {/* Vertical Precision Fader */}
                <div className="flex-1 flex items-center justify-center py-1">
                  <PrecisionVerticalFader
                    value={ch.faderDb}
                    min={-48}
                    max={10}
                    step={0.5}
                    label={ch.name}
                    accent={ch.mute ? 'amber' : 'sky'}
                    onChange={(next) => onUpdateChannel(ch.id, { faderDb: next })}
                  />
                </div>

                {/* Solo & Mute Buttons */}
                <div className="grid grid-cols-2 gap-1 pt-1 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateChannel(ch.id, { solo: !ch.solo });
                    }}
                    className={`py-1 text-[9px] font-mono font-bold rounded transition cursor-pointer ${
                      ch.solo
                        ? 'bg-amber-400 text-slate-950 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
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
                    className={`py-1 text-[9px] font-mono font-bold rounded transition cursor-pointer ${
                      ch.mute
                        ? 'bg-red-600 text-white shadow-[0_0_8px_rgba(239,68,68,0.8)]'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
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
