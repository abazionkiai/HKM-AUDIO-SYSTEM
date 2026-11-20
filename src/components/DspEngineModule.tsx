import React, { useMemo, useState } from 'react';
import { Copy, Check, Lock, Unlock, RotateCcw, ShieldAlert } from 'lucide-react';
import type {
  DriverBackend,
  DspConfig,
  EqBand,
  HardwareDevice,
  InputChannel,
  PlatformTarget,
  ServicePreset,
  SignalTelemetry,
  SpeakerZone,
} from '../types/audio.ts';
import type { LoadedPluginRecord } from '../plugins/pluginManager.ts';
import {
  calculateRoundTripLatencyMs,
  computeFilterCurveDb,
  generateCamillaDspYaml,
  validateDspConfig,
} from '../utils/camillaDsp.ts';
import { DEFAULT_DSP_CONFIG } from '../data/hardwareCatalog.ts';
import {
  ArcGauge,
  ConsolePushButton,
  RotaryKnob,
  SegmentedLedMeter,
} from './StudioControls.tsx';

interface DspEngineModuleProps {
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  device: HardwareDevice;
  platform: PlatformTarget;
  driver: DriverBackend;
  sampleRate: number;
  bufferSize: number;
  zones: SpeakerZone[];
  activeDspPlugins: LoadedPluginRecord[];
  telemetry?: SignalTelemetry;
  channels?: InputChannel[];
  onUpdateChannel?: (id: string, patch: Partial<InputChannel>) => void;
  presets?: ServicePreset[];
  activePresetId?: string;
  onSelectPreset?: (preset: ServicePreset) => void;
  emergencyMuted?: boolean;
  onToggleEmergencyMute?: () => void;
}

export const DspEngineModule: React.FC<DspEngineModuleProps> = ({
  dsp,
  onUpdateDsp,
  device,
  platform,
  driver,
  sampleRate,
  bufferSize,
  zones,
  activeDspPlugins,
  telemetry,
  channels = [],
  onUpdateChannel,
  presets = [],
  activePresetId,
  onSelectPreset,
  emergencyMuted = false,
  onToggleEmergencyMute,
}) => {
  const [selectedBandId, setSelectedBandId] = useState<string>(dsp.eqBands[0]?.id ?? 'eq-1');
  const [selectedChannelId, setSelectedChannelId] = useState<string>(channels[0]?.id ?? 'ch-1');
  const [panelLocked, setPanelLocked] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slotA, setSlotA] = useState<DspConfig | null>(null);
  const [slotB, setSlotB] = useState<DspConfig | null>(null);
  const [activeCompareSlot, setActiveCompareSlot] = useState<'A' | 'B'>('A');

  const selectedBand =
    dsp.eqBands.find((b) => b.id === selectedBandId) ?? dsp.eqBands[0];
  const inputRackChannels = channels.slice(0, 8);

  const validation = useMemo(
    () => validateDspConfig(dsp, sampleRate, zones),
    [dsp, sampleRate, zones]
  );

  const latencyMs = useMemo(
    () => calculateRoundTripLatencyMs(bufferSize, sampleRate, driver),
    [bufferSize, sampleRate, driver]
  );

  const camillaYaml = useMemo(
    () => generateCamillaDspYaml(dsp, device, platform, driver, sampleRate, bufferSize, zones),
    [dsp, device, platform, driver, sampleRate, bufferSize, zones]
  );

  const curvePoints = useMemo(() => {
    const width = 260;
    const height = 84;
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= 70; i++) {
      const f = Math.pow(10, minLog + (i / 70) * (maxLog - minLog));
      const db = computeFilterCurveDb(dsp, f, sampleRate);
      const x = ((Math.log10(f) - minLog) / (maxLog - minLog)) * width;
      const y = 10 + ((15 - Math.max(-24, Math.min(15, db))) / 39) * (height - 20);
      points.push({ x, y });
    }
    return points;
  }, [dsp, sampleRate]);

  const pathD = useMemo(
    () =>
      curvePoints
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' '),
    [curvePoints]
  );

  const updateBand = (id: string, patch: Partial<EqBand>) => {
    if (panelLocked) return;
    onUpdateDsp({
      eqBands: dsp.eqBands.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });
  };

  const handleCopyYaml = () => {
    navigator.clipboard.writeText(camillaYaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const cpuPct = telemetry?.isRunning
    ? Math.min(84, Math.round(24 + 4096 / Math.max(64, bufferSize)))
    : 18;
  const headroomTempEq = telemetry?.isRunning
    ? Math.round(48 + Math.max(0, 20 + telemetry.postPeakDb))
    : 50;

  return (
    <div className="space-y-3">
      {/* Top Beveled Hardware DSP Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] px-4 py-2.5 flex flex-col xl:flex-row xl:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.65)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-emerald-400">02</span>
              <h1 className="font-display text-lg font-semibold text-white tracking-tight">
                AUDIO DSP ENGINE
              </h1>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              Live Church Sound System · {device.manufacturer} {device.model} · {(sampleRate / 1000).toFixed(1)} kHz
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => setPanelLocked((l) => !l)}
            className={`px-2.5 py-1 rounded border flex items-center gap-1.5 font-semibold ${
              panelLocked
                ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                : 'border-slate-700 bg-[#090D14] text-slate-300'
            }`}
          >
            {panelLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            <span>{panelLocked ? 'LOCKED' : 'UNLOCKED'}</span>
          </button>

          <div className="flex items-center rounded border border-slate-800 bg-[#090D14] overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setSlotA(structuredClone(dsp));
                setActiveCompareSlot('A');
              }}
              className="px-2 py-1 text-slate-300 hover:bg-slate-800 border-r border-slate-800"
            >
              {slotA ? 'A*' : 'STORE A'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSlotB(structuredClone(dsp));
                setActiveCompareSlot('B');
              }}
              className="px-2 py-1 text-slate-300 hover:bg-slate-800 border-r border-slate-800"
            >
              {slotB ? 'B*' : 'STORE B'}
            </button>
            <button
              type="button"
              disabled={!slotA || !slotB}
              onClick={() => {
                if (panelLocked) return;
                const nextSlot = activeCompareSlot === 'A' ? 'B' : 'A';
                const target = nextSlot === 'A' ? slotA : slotB;
                if (target) {
                  setActiveCompareSlot(nextSlot);
                  onUpdateDsp(structuredClone(target));
                }
              }}
              className="px-2 py-1 text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-40 font-semibold"
            >
              {slotA && slotB ? `CMP ${activeCompareSlot}` : 'A ↔ B'}
            </button>
          </div>

          <ConsolePushButton
            label={dsp.bypassed ? 'BYPASSED' : 'ACTIVE'}
            active={!dsp.bypassed}
            tone={dsp.bypassed ? 'amber' : 'emerald'}
            onClick={() => !panelLocked && onUpdateDsp({ bypassed: !dsp.bypassed })}
          />

          <button
            type="button"
            onClick={() => setShowYaml(!showYaml)}
            className="px-2.5 py-1 rounded border border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 font-semibold"
          >
            {showYaml ? 'HIDE YAML' : 'YAML'}
          </button>
        </div>
      </div>

      {/* 3-Zone Hardware Console Workbench */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-stretch">
        {/* LEFT RAIL (2 cols): INPUTS (8 Channels with LED meters & mini gain knobs) */}
        <div className="xl:col-span-2 rounded-lg border border-slate-800 bg-[#0D1119] p-2.5 flex flex-col justify-between gap-2">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-300 border-b border-slate-800 pb-1.5">
            Inputs ({inputRackChannels.length} CH)
          </div>

          <div className="space-y-1.5 flex-1">
            {inputRackChannels.map((ch) => {
              const isSel = ch.id === selectedChannelId;
              const isHot = ch.faderDb > 4 || ch.gainDb > 36;
              const levelDb = ch.mute
                ? -56
                : telemetry?.isRunning
                  ? Math.max(-50, Math.min(-1, telemetry.postRmsDb + ch.faderDb * 0.5))
                  : Math.max(-44, -22 + ch.faderDb);

              return (
                <div
                  key={ch.id}
                  onClick={() => setSelectedChannelId(ch.id)}
                  className={`p-1.5 rounded border cursor-pointer flex items-center justify-between gap-1.5 transition-colors ${
                    isSel
                      ? 'border-sky-400 bg-[#141F2D]'
                      : 'border-slate-800 bg-[#080C13] hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[10px] text-slate-500 w-3">{ch.index}</span>
                    <SegmentedLedMeter
                      levelDb={levelDb}
                      peakDb={levelDb + 4}
                      muted={ch.mute}
                      height={34}
                      segments={8}
                    />
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-white truncate">
                        {ch.name}
                      </div>
                      <div className="font-mono text-[9px] text-slate-400 flex items-center gap-1">
                        <span>{ch.gainDb}dB</span>
                        {isHot && <span className="text-amber-400 font-bold">LIMIT</span>}
                      </div>
                    </div>
                  </div>

                  <RotaryKnob
                    label=""
                    value={ch.gainDb}
                    min={0}
                    max={60}
                    step={1}
                    defaultValue={24}
                    size={28}
                    accent={isHot ? 'amber' : 'emerald'}
                    onChange={(next) =>
                      !panelLocked && onUpdateChannel?.(ch.id, { gainDb: next })
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER (7 cols): CENTRAL DSP PROCESSING CHAIN + MAIN OUTPUTS BRIDGE */}
        <div className="xl:col-span-7 rounded-lg border border-slate-800 bg-[#0B1018] p-3 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-white">
              Central DSP Processing Chain
            </span>
            <span className="font-mono text-[10px] text-emerald-400">
              {validation.valid ? 'SIGNAL PATH CONTINUOUS · GREEN TRACE ACTIVE' : validation.errors[0]}
            </span>
          </div>

          {/* 7 Vertical Connected DSP Columns */}
          <div className="relative overflow-x-auto pb-1">
            {/* Neon Green Signal Bus Trace Line across processing blocks */}
            <div
              className={`hidden md:block absolute left-8 right-8 top-1/2 h-0.5 pointer-events-none ${
                dsp.bypassed ? 'bg-amber-500/35' : 'bg-emerald-400/45 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
              }`}
            />

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 min-w-[680px] relative z-10">
              {/* 1. INPUT CONDITIONING */}
              <div className="rounded border border-slate-800 bg-[#101622]/95 p-2 flex flex-col items-center justify-between gap-2 min-h-[340px]">
                <div className="text-center font-mono text-[9px] font-semibold text-slate-300 uppercase">
                  Input Trim
                </div>
                <ArcGauge
                  label="Trim"
                  value={dsp.inputTrimDb + 12}
                  max={24}
                  displayValue={`${dsp.inputTrimDb > 0 ? `+${dsp.inputTrimDb.toFixed(1)}` : dsp.inputTrimDb.toFixed(1)}`}
                  sublabel="dB"
                  tone="emerald"
                />
                <RotaryKnob
                  label="GAIN"
                  value={dsp.inputTrimDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  defaultValue={0}
                  unit="dB"
                  size={44}
                  accent="emerald"
                  onChange={(next) => !panelLocked && onUpdateDsp({ inputTrimDb: next })}
                />
                <ConsolePushButton
                  label={dsp.polarityInverted ? '180° Ø' : '0° NORM'}
                  active={dsp.polarityInverted}
                  tone="amber"
                  onClick={() =>
                    !panelLocked && onUpdateDsp({ polarityInverted: !dsp.polarityInverted })
                  }
                />
                <ConsolePushButton
                  label={dsp.bypassed ? 'BYPASS' : 'ACTIVE'}
                  active={!dsp.bypassed}
                  tone="emerald"
                  onClick={() => !panelLocked && onUpdateDsp({ bypassed: !dsp.bypassed })}
                />
              </div>

              {/* 2. HPF / LPF CROSSHAIR FILTER */}
              <div className="rounded border border-slate-800 bg-[#101622]/95 p-2 flex flex-col items-center justify-between gap-2 min-h-[340px]">
                <div className="text-center font-mono text-[9px] font-semibold text-slate-300 uppercase">
                  HPF / LPF
                </div>
                <div className="w-full rounded bg-[#070A10] border border-slate-800 p-1">
                  <svg viewBox="0 0 90 54" className="w-full h-12">
                    <line x1={0} y1={27} x2={90} y2={27} stroke="rgba(148,163,184,0.2)" />
                    <line x1={45} y1={0} x2={45} y2={54} stroke="rgba(148,163,184,0.2)" />
                    <path
                      d={`M 6 48 Q ${dsp.hpfEnabled ? 24 : 8} 14 45 14 T ${dsp.lpfEnabled ? 82 : 88} 42`}
                      fill="none"
                      stroke="#10B981"
                      strokeWidth={2}
                    />
                  </svg>
                </div>
                <RotaryKnob
                  label="HPF"
                  value={dsp.hpfHz}
                  min={20}
                  max={300}
                  step={5}
                  defaultValue={95}
                  unit="Hz"
                  size={40}
                  accent="emerald"
                  onChange={(next) => !panelLocked && onUpdateDsp({ hpfHz: next, hpfEnabled: true })}
                />
                <RotaryKnob
                  label="LPF"
                  value={dsp.lpfHz}
                  min={2000}
                  max={20000}
                  step={250}
                  defaultValue={18000}
                  size={40}
                  accent="sky"
                  formatValue={(v) => `${(v / 1000).toFixed(1)}k`}
                  onChange={(next) => !panelLocked && onUpdateDsp({ lpfHz: next, lpfEnabled: true })}
                />
                <ConsolePushButton
                  label={dsp.hpfEnabled ? 'ACTIVE' : 'BYPASS'}
                  active={dsp.hpfEnabled}
                  tone="emerald"
                  onClick={() => !panelLocked && onUpdateDsp({ hpfEnabled: !dsp.hpfEnabled })}
                />
              </div>

              {/* 3. EQUALIZATION (6-BAND PEQ WITH VERTICAL FADERS) */}
              <div className="col-span-2 rounded border border-emerald-500/40 bg-[#101622]/95 p-2 flex flex-col justify-between gap-2 min-h-[340px]">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] font-semibold text-white uppercase">
                    6-Band Parametric EQ
                  </span>
                  <ConsolePushButton
                    label={dsp.bypassed ? 'BYPASS' : 'ACTIVE'}
                    active={!dsp.bypassed}
                    tone="emerald"
                    onClick={() => !panelLocked && onUpdateDsp({ bypassed: !dsp.bypassed })}
                  />
                </div>

                {/* Live Glowing EQ Curve */}
                <div className="rounded bg-[#070A10] border border-slate-800 p-1">
                  <svg viewBox="0 0 260 84" className="w-full h-16">
                    <line x1={0} y1={42} x2={260} y2={42} stroke="rgba(148,163,184,0.22)" strokeDasharray="3 2" />
                    <path d={pathD} fill="none" stroke={dsp.bypassed ? '#F59E0B' : '#38BDF8'} strokeWidth={2} />
                  </svg>
                </div>

                {/* Vertical Band Gain Sliders */}
                <div className="grid grid-cols-6 gap-1 flex-1 items-center bg-[#070A10] border border-slate-800 rounded p-1.5">
                  {dsp.eqBands.map((band, idx) => {
                    const isSel = band.id === selectedBandId;
                    return (
                      <div
                        key={band.id}
                        onClick={() => setSelectedBandId(band.id)}
                        className={`flex flex-col items-center gap-1 cursor-pointer rounded py-1 ${
                          isSel ? 'bg-sky-500/15' : ''
                        }`}
                      >
                        <span className="font-mono text-[8px] text-slate-400">
                          {band.frequency >= 1000 ? `${(band.frequency / 1000).toFixed(1)}k` : band.frequency}
                        </span>
                        <input
                          type="range"
                          min={-15}
                          max={9}
                          step={0.5}
                          value={band.gainDb}
                          aria-label={`Band ${idx + 1} gain`}
                          onChange={(e) =>
                            updateBand(band.id, { gainDb: Number(e.target.value), enabled: true })
                          }
                          className="h-20 w-3 accent-sky-400 cursor-pointer"
                          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                        />
                        <span className="font-mono text-[8px] text-sky-300">
                          {band.gainDb > 0 ? `+${band.gainDb}` : band.gainDb}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Selected Band Frequency & Q */}
                {selectedBand && (
                  <div className="flex items-center justify-between gap-2 font-mono text-[9px] bg-[#080C13] border border-slate-800 rounded px-2 py-1">
                    <span className="text-sky-300 truncate">{selectedBand.label}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={25}
                        max={18000}
                        step={25}
                        value={selectedBand.frequency}
                        onChange={(e) =>
                          updateBand(selectedBand.id, { frequency: Number(e.target.value) || 1000 })
                        }
                        className="w-14 px-1 py-0.5 rounded bg-[#070A10] border border-slate-700 text-slate-200 text-[9px]"
                      />
                      <span className="text-slate-400">Q={selectedBand.q.toFixed(1)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. COMPRESSION DYNAMICS */}
              <div className="rounded border border-slate-800 bg-[#101622]/95 p-2 flex flex-col items-center justify-between gap-2 min-h-[340px]">
                <div className="text-center font-mono text-[9px] font-semibold text-slate-300 uppercase">
                  Dynamics
                </div>
                <div className="w-full rounded bg-[#070A10] border border-slate-800 p-1">
                  <svg viewBox="0 0 90 54" className="w-full h-12">
                    <line x1={0} y1={50} x2={90} y2={4} stroke="rgba(148,163,184,0.2)" strokeDasharray="2 2" />
                    <path d="M 6 48 L 46 24 L 84 14" fill="none" stroke="#38BDF8" strokeWidth={2} />
                  </svg>
                </div>
                <RotaryKnob
                  label="THRESH"
                  value={dsp.compressor.thresholdDb}
                  min={-40}
                  max={0}
                  step={1}
                  defaultValue={-18}
                  unit="dB"
                  size={38}
                  accent="sky"
                  onChange={(next) =>
                    !panelLocked &&
                    onUpdateDsp({ compressor: { ...dsp.compressor, thresholdDb: next } })
                  }
                />
                <RotaryKnob
                  label="RATIO"
                  value={dsp.compressor.ratio}
                  min={1}
                  max={12}
                  step={0.2}
                  defaultValue={3}
                  size={38}
                  accent="amber"
                  formatValue={(v) => `${v.toFixed(1)}:1`}
                  onChange={(next) =>
                    !panelLocked &&
                    onUpdateDsp({ compressor: { ...dsp.compressor, ratio: next } })
                  }
                />
                <div className="font-mono text-[9px] text-slate-400 text-center">
                  ATK {dsp.compressor.attackMs}ms · +{dsp.compressor.makeupDb}dB
                </div>
                <ConsolePushButton
                  label={dsp.compressor.enabled ? 'ACTIVE' : 'BYPASS'}
                  active={dsp.compressor.enabled}
                  tone="emerald"
                  onClick={() =>
                    !panelLocked &&
                    onUpdateDsp({
                      compressor: { ...dsp.compressor, enabled: !dsp.compressor.enabled },
                    })
                  }
                />
              </div>

              {/* 5. GATE & DE-ESSER */}
              <div className="rounded border border-slate-800 bg-[#101622]/95 p-2 flex flex-col items-center justify-between gap-2 min-h-[340px]">
                <div className="text-center font-mono text-[9px] font-semibold text-slate-300 uppercase">
                  Gate &amp; De-Ess
                </div>
                <RotaryKnob
                  label="GATE"
                  value={dsp.gate.thresholdDb}
                  min={-65}
                  max={-20}
                  step={1}
                  defaultValue={-50}
                  unit="dB"
                  size={40}
                  accent="sky"
                  onChange={(next) =>
                    !panelLocked && onUpdateDsp({ gate: { ...dsp.gate, thresholdDb: next } })
                  }
                />
                <RotaryKnob
                  label="SIBIL"
                  value={dsp.deEsser.frequencyHz}
                  min={4000}
                  max={9500}
                  step={100}
                  defaultValue={6200}
                  size={40}
                  accent="amber"
                  formatValue={(v) => `${(v / 1000).toFixed(1)}k`}
                  onChange={(next) =>
                    !panelLocked && onUpdateDsp({ deEsser: { ...dsp.deEsser, frequencyHz: next } })
                  }
                />
                <div className="space-y-1 w-full">
                  <ConsolePushButton
                    label={dsp.gate.enabled ? 'GATE ON' : 'BYPASS'}
                    active={dsp.gate.enabled}
                    tone="sky"
                    onClick={() =>
                      !panelLocked &&
                      onUpdateDsp({ gate: { ...dsp.gate, enabled: !dsp.gate.enabled } })
                    }
                  />
                  <ConsolePushButton
                    label={dsp.deEsser.enabled ? 'DE-ESS' : 'BYPASS'}
                    active={dsp.deEsser.enabled}
                    tone="emerald"
                    onClick={() =>
                      !panelLocked &&
                      onUpdateDsp({
                        deEsser: { ...dsp.deEsser, enabled: !dsp.deEsser.enabled },
                      })
                    }
                  />
                </div>
              </div>

              {/* 6. STEREO WIDTH, DELAY & LIMITER */}
              <div className="rounded border border-slate-800 bg-[#101622]/95 p-2 flex flex-col items-center justify-between gap-2 min-h-[340px]">
                <div className="text-center font-mono text-[9px] font-semibold text-slate-300 uppercase">
                  Width &amp; Limiter
                </div>
                <RotaryKnob
                  label="WIDTH"
                  value={dsp.stereoWidth * 100}
                  min={0}
                  max={150}
                  step={5}
                  defaultValue={100}
                  unit="%"
                  size={40}
                  accent="emerald"
                  onChange={(next) =>
                    !panelLocked &&
                    onUpdateDsp({ stereoWidth: Number((next / 100).toFixed(2)) })
                  }
                />
                <RotaryKnob
                  label="DELAY"
                  value={dsp.masterDelayMs}
                  min={0}
                  max={120}
                  step={0.5}
                  defaultValue={0}
                  unit="ms"
                  size={40}
                  accent="sky"
                  onChange={(next) => !panelLocked && onUpdateDsp({ masterDelayMs: next })}
                />
                <RotaryKnob
                  label="CEIL"
                  value={dsp.limiter.ceilingDb}
                  min={-6}
                  max={0}
                  step={0.2}
                  defaultValue={-0.8}
                  unit="dB"
                  size={40}
                  accent="amber"
                  onChange={(next) =>
                    !panelLocked &&
                    onUpdateDsp({ limiter: { ...dsp.limiter, ceilingDb: next } })
                  }
                />
                <ConsolePushButton
                  label={dsp.limiter.enabled ? 'LIM ON' : 'BYPASS'}
                  active={dsp.limiter.enabled}
                  tone="amber"
                  onClick={() =>
                    !panelLocked &&
                    onUpdateDsp({ limiter: { ...dsp.limiter, enabled: !dsp.limiter.enabled } })
                  }
                />
              </div>
            </div>
          </div>

          {/* MAIN OUTPUTS HORIZONTAL SEGMENTED LED METER BRIDGE */}
          <div className="rounded border border-slate-800 bg-[#070A10] p-2.5 space-y-2">
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-slate-300 font-semibold">MAIN OUTPUTS (L / R)</span>
              <span className="text-emerald-400 tabular-nums">
                {telemetry?.isRunning
                  ? `RMS ${telemetry.postRmsDb.toFixed(1)} dBFS · PEAK ${telemetry.postPeakDb.toFixed(1)} dBFS`
                  : 'OUTPUT STANDBY'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['MAIN L', 'MAIN R'] as const).map((label, idx) => {
                const lvl = telemetry?.isRunning
                  ? Math.min(100, Math.max(4, Math.round(((telemetry.postRmsDb + 56) / 56) * 100) - idx * 2))
                  : 12;
                const activeCount = Math.round((lvl / 100) * 20);
                return (
                  <div key={label} className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-slate-400 w-12">{label}</span>
                    <div className="flex-1 flex gap-0.5">
                      {Array.from({ length: 20 }, (_, i) => {
                        const lit = !emergencyMuted && i < activeCount;
                        const color =
                          i >= 17
                            ? lit ? 'bg-red-500' : 'bg-red-950/30'
                            : i >= 13
                              ? lit ? 'bg-amber-400' : 'bg-amber-950/30'
                              : lit ? 'bg-emerald-400' : 'bg-emerald-950/30';
                        return <div key={i} className={`flex-1 h-3 rounded-[1px] ${color}`} />;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT RAIL (3 cols): LATENCY, CPU/DSP UTILIZATION, TEMP/HEADROOM, CLOCK, PRESET RECALL */}
        <div className="xl:col-span-3 flex flex-col gap-2.5">
          {/* LATENCY */}
          <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3 flex items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] text-slate-400 uppercase">Latency</div>
              <div className="font-mono text-2xl font-bold text-white tabular-nums">{latencyMs} ms</div>
              <div className="font-mono text-[9px] text-emerald-400">ROUND TRIP · STATUS GOOD</div>
            </div>
            <svg viewBox="0 0 80 36" className="w-20 h-9">
              <path
                d="M 2 18 L 14 18 L 22 6 L 30 30 L 38 10 L 46 26 L 56 18 L 78 18"
                fill="none"
                stroke="#10B981"
                strokeWidth={1.8}
              />
            </svg>
          </div>

          {/* CPU / DSP UTILIZATION */}
          <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3 space-y-1.5">
            <div className="flex justify-between font-mono text-[10px]">
              <span className="text-slate-400 uppercase">CPU / DSP Utilization</span>
              <span className="text-emerald-400 font-semibold">{cpuPct}% · GOOD</span>
            </div>
            <div className="h-2.5 rounded-xs bg-[#070A10] border border-slate-800 overflow-hidden p-px">
              <div className="h-full bg-emerald-400 rounded-[1px]" style={{ width: `${cpuPct}%` }} />
            </div>
          </div>

          {/* SYSTEM HEADROOM & CLOCK */}
          <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3 grid grid-cols-2 gap-2 items-center">
            <ArcGauge
              label="Thermal / Load"
              value={headroomTempEq}
              max={100}
              displayValue={`${headroomTempEq}°C`}
              sublabel="DSP Core Nominal"
              tone={headroomTempEq > 72 ? 'amber' : 'emerald'}
            />
            <div className="space-y-2 font-mono text-[10px] bg-[#080C13] border border-slate-800 rounded p-2">
              <div>
                <div className="text-slate-500">CLOCK STATUS</div>
                <div className="text-emerald-400 font-semibold">LOCKED · 1.0 ppm</div>
              </div>
              <div>
                <div className="text-slate-500">ENGINE</div>
                <div className="text-slate-200">CamillaDSP v2.0</div>
              </div>
              <div>
                <div className="text-slate-500">PLUGINS</div>
                <div className="text-sky-300">{activeDspPlugins.length} Active</div>
              </div>
            </div>
          </div>

          {/* PRESET RECALL QUICK LIST */}
          <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3 space-y-2 flex-1">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-300 border-b border-slate-800 pb-1.5">
              Preset Recall
            </div>
            <div className="space-y-1">
              {presets.map((p) => {
                const active = p.id === activePresetId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={panelLocked}
                    onClick={() => onSelectPreset?.(p)}
                    className={`w-full px-2.5 py-1.5 rounded border font-mono text-[11px] text-left flex items-center justify-between transition-colors ${
                      active
                        ? 'border-sky-400 bg-sky-500/20 text-white font-semibold'
                        : 'border-slate-800 bg-[#080C13] text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    {active && <span className="text-[9px] text-sky-300">LOADED</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom System Action Dock */}
      <div className="rounded-lg border border-slate-800 bg-[#0D1119] px-4 py-2 flex flex-wrap items-center justify-between gap-3 font-mono text-[11px]">
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-emerald-400">● ACTIVE</span>
          <span className="text-amber-400">● {dsp.bypassed ? 'BYPASSED' : 'DYNAMICS'}</span>
          <span className="text-sky-400">● {panelLocked ? 'LOCKED' : 'LIVE EDIT'}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPanelLocked((l) => !l)}
            className="px-3 py-1 rounded border border-slate-700 bg-[#121824] text-slate-200 hover:border-slate-500"
          >
            {panelLocked ? 'UNLOCK' : 'LOCK'}
          </button>
          <button
            type="button"
            onClick={onToggleEmergencyMute}
            className={`px-3 py-1 rounded border font-semibold flex items-center gap-1 ${
              emergencyMuted
                ? 'border-red-400 bg-red-600 text-white'
                : 'border-red-500/50 bg-red-950/40 text-red-300 hover:bg-red-600/25'
            }`}
          >
            <ShieldAlert className="w-3 h-3" />
            <span>{emergencyMuted ? 'UNMUTE ALL' : 'MUTE ALL'}</span>
          </button>
          <button
            type="button"
            onClick={() => !panelLocked && onUpdateDsp(DEFAULT_DSP_CONFIG)}
            className="px-3 py-1 rounded border border-slate-700 bg-[#121824] text-slate-200 hover:border-slate-500 flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span>RESET ALL</span>
          </button>
        </div>

        <div className="text-[10px] text-emerald-400">
          {telemetry?.isRunning ? 'SIGNAL OK · 48 kHz' : 'STANDBY'}
        </div>
      </div>

      {/* Optional CamillaDSP YAML Export */}
      {showYaml && (
        <div className="p-4 rounded-lg border border-slate-800 bg-[#0D1119] space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-mono font-semibold text-white">
              CamillaDSP v2.0 Pipeline Configuration ({platform.toUpperCase()} · {driver})
            </div>
            <button
              type="button"
              onClick={handleCopyYaml}
              className="px-2.5 py-1 rounded border border-slate-700 text-xs font-mono text-slate-300 hover:bg-slate-800 flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy YAML'}</span>
            </button>
          </div>
          <pre className="p-3 rounded bg-[#070A10] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-80 leading-relaxed">
            {camillaYaml}
          </pre>
        </div>
      )}
    </div>
  );
};
