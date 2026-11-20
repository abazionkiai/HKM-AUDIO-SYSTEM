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
import { StereoGraphicEqModule } from './StereoGraphicEqModule.tsx';
import { ActiveCrossoverModule } from './ActiveCrossoverModule.tsx';
import { CleanStandbyModule } from './CleanStandbyModule.tsx';

type DspViewTab = 'chain' | 'graphic-eq' | 'crossover' | 'clean-standby';

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
  audioCpuPct?: number;
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
  audioCpuPct,
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
  const [activeDspTab, setActiveDspTab] = useState<DspViewTab>('chain');

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

  const anyEqEnabled = dsp.eqBands.some((b) => b.enabled);

  const hpfLpfPathD = useMemo(() => {
    const w = 90;
    const h = 54;
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    const pts: string[] = [];
    for (let i = 0; i <= 36; i++) {
      const f = Math.pow(10, minLog + (i / 36) * (maxLog - minLog));
      let db = 0;
      if (!dsp.bypassed && dsp.hpfEnabled) {
        const r = dsp.hpfHz / f;
        db -= 10 * Math.log10(1 + Math.pow(r, 4));
      }
      if (!dsp.bypassed && dsp.lpfEnabled) {
        const r = f / dsp.lpfHz;
        db -= 10 * Math.log10(1 + Math.pow(r, 4));
      }
      const x = (i / 36) * w;
      const y = Math.max(4, Math.min(h - 4, 12 + (-Math.max(-24, Math.min(0, db)) / 24) * 36));
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  }, [dsp.bypassed, dsp.hpfEnabled, dsp.hpfHz, dsp.lpfEnabled, dsp.lpfHz]);

  const compTransfer = useMemo(() => {
    const minDb = -60;
    const maxDb = 0;
    const w = 90;
    const h = 54;
    const mapX = (db: number) => 4 + ((db - minDb) / (maxDb - minDb)) * (w - 8);
    const mapY = (db: number) => h - 4 - ((Math.max(minDb, Math.min(maxDb, db)) - minDb) / (maxDb - minDb)) * (h - 8);
    const pts: string[] = [];
    for (let i = 0; i <= 30; i++) {
      const inDb = minDb + (i / 30) * (maxDb - minDb);
      let outDb = inDb;
      if (!dsp.bypassed && dsp.compressor.enabled) {
        if (inDb > dsp.compressor.thresholdDb) {
          outDb =
            dsp.compressor.thresholdDb +
            (inDb - dsp.compressor.thresholdDb) / Math.max(1, dsp.compressor.ratio);
        }
        outDb += dsp.compressor.makeupDb;
      }
      pts.push(`${i === 0 ? 'M' : 'L'} ${mapX(inDb).toFixed(1)} ${mapY(outDb).toFixed(1)}`);
    }
    return {
      pathD: pts.join(' '),
      threshX: mapX(dsp.compressor.thresholdDb),
    };
  }, [dsp.bypassed, dsp.compressor]);

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
    ? typeof audioCpuPct === 'number'
      ? audioCpuPct
      : Math.min(84, Math.round(24 + 4096 / Math.max(64, bufferSize)))
    : 0;
  const outputDensityPct = telemetry?.isRunning
    ? Math.min(100, Math.max(0, Math.round(((telemetry.postPeakDb + 64) / 64) * 100)))
    : 0;

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
            {inputRackChannels.map((ch, idx) => {
              const isSel = ch.id === selectedChannelId;
              const isHot = ch.faderDb > 4 || ch.gainDb > 36;
              const chTelemetry = telemetry?.channelLevels?.[idx];
              const levelDb =
                ch.mute || !telemetry?.isRunning || !chTelemetry
                  ? -96
                  : Math.max(-64, Math.min(-0.2, chTelemetry.rmsDb + ch.faderDb * 0.5));
              const peakDb =
                ch.mute || !telemetry?.isRunning || !chTelemetry
                  ? -96
                  : Math.max(-64, Math.min(-0.1, chTelemetry.peakDb + ch.faderDb * 0.5));

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
                      peakDb={peakDb}
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
          <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-2 gap-2">
            <div className="flex items-center p-0.5 rounded bg-[#070A10] border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveDspTab('chain')}
                className={`px-2.5 py-1 text-[11px] font-mono font-semibold rounded transition-colors ${
                  activeDspTab === 'chain'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                1. PEQ &amp; DYNAMICS
              </button>
              <button
                type="button"
                onClick={() => setActiveDspTab('graphic-eq')}
                className={`px-2.5 py-1 text-[11px] font-mono font-semibold rounded transition-colors ${
                  activeDspTab === 'graphic-eq'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                2. 31-BAND GRAPHIC EQ
              </button>
              <button
                type="button"
                onClick={() => setActiveDspTab('crossover')}
                className={`px-2.5 py-1 text-[11px] font-mono font-semibold rounded transition-colors ${
                  activeDspTab === 'crossover'
                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                3. ACTIVE CROSSOVER
              </button>
              <button
                type="button"
                onClick={() => setActiveDspTab('clean-standby')}
                className={`px-2.5 py-1 text-[11px] font-mono font-semibold rounded transition-colors ${
                  activeDspTab === 'clean-standby'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                4. ZERO-HUM STANDBY
              </button>
            </div>

            <span className="font-mono text-[10px] text-emerald-400">
              {validation.valid ? 'SIGNAL PATH CONTINUOUS · GREEN TRACE ACTIVE' : validation.errors[0]}
            </span>
          </div>

          {activeDspTab === 'graphic-eq' && (
            <StereoGraphicEqModule dsp={dsp} onUpdateDsp={onUpdateDsp} panelLocked={panelLocked} />
          )}

          {activeDspTab === 'crossover' && (
            <ActiveCrossoverModule dsp={dsp} onUpdateDsp={onUpdateDsp} panelLocked={panelLocked} />
          )}

          {activeDspTab === 'clean-standby' && (
            <CleanStandbyModule dsp={dsp} onUpdateDsp={onUpdateDsp} telemetry={telemetry} panelLocked={panelLocked} />
          )}

          {activeDspTab === 'chain' && (
          /* 7 Vertical Connected DSP Columns */
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
                    <line x1={0} y1={12} x2={90} y2={12} stroke="rgba(148,163,184,0.18)" strokeDasharray="2 2" />
                    <line x1={45} y1={0} x2={45} y2={54} stroke="rgba(148,163,184,0.18)" />
                    <path
                      d={hpfLpfPathD}
                      fill="none"
                      stroke={dsp.bypassed ? '#F59E0B' : '#10B981'}
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
                <div className="grid grid-cols-2 gap-1 w-full">
                  <ConsolePushButton
                    label={dsp.hpfEnabled ? 'HPF ON' : 'HPF OFF'}
                    active={dsp.hpfEnabled}
                    tone="emerald"
                    onClick={() => !panelLocked && onUpdateDsp({ hpfEnabled: !dsp.hpfEnabled })}
                  />
                  <ConsolePushButton
                    label={dsp.lpfEnabled ? 'LPF ON' : 'LPF OFF'}
                    active={dsp.lpfEnabled}
                    tone="sky"
                    onClick={() => !panelLocked && onUpdateDsp({ lpfEnabled: !dsp.lpfEnabled })}
                  />
                </div>
              </div>

              {/* 3. EQUALIZATION (6-BAND PEQ WITH VERTICAL FADERS) */}
              <div className="col-span-2 rounded border border-emerald-500/40 bg-[#101622]/95 p-2 flex flex-col justify-between gap-2 min-h-[340px]">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] font-semibold text-white uppercase">
                    6-Band Parametric EQ
                  </span>
                  <ConsolePushButton
                    label={anyEqEnabled ? 'PEQ ON' : 'PEQ OFF'}
                    active={anyEqEnabled && !dsp.bypassed}
                    tone="emerald"
                    onClick={() =>
                      !panelLocked &&
                      onUpdateDsp({
                        eqBands: dsp.eqBands.map((b) => ({ ...b, enabled: !anyEqEnabled })),
                      })
                    }
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
                          isSel ? 'bg-sky-500/15 ring-1 ring-sky-500/40' : ''
                        } ${!band.enabled ? 'opacity-45' : ''}`}
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
                        <span className="font-mono text-[8px] text-sky-300 tabular-nums">
                          {band.gainDb > 0 ? `+${band.gainDb}` : band.gainDb}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Selected Band Frequency, Q, Type & Band Enable */}
                {selectedBand && (
                  <div className="flex flex-wrap items-center justify-between gap-1.5 font-mono text-[9px] bg-[#080C13] border border-slate-800 rounded px-2 py-1">
                    <button
                      type="button"
                      onClick={() => updateBand(selectedBand.id, { enabled: !selectedBand.enabled })}
                      className={`px-1.5 py-0.5 rounded border text-[8px] font-bold ${
                        selectedBand.enabled
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                          : 'border-slate-700 bg-[#070A10] text-slate-500'
                      }`}
                    >
                      {selectedBand.enabled ? 'ON' : 'OFF'}
                    </button>
                    <select
                      aria-label="Filter Shape"
                      value={selectedBand.type}
                      onChange={(e) =>
                        updateBand(selectedBand.id, {
                          type: e.target.value as EqBand['type'],
                          enabled: true,
                        })
                      }
                      className="px-1 py-0.5 rounded bg-[#070A10] border border-slate-700 text-sky-300 text-[9px]"
                    >
                      <option value="peaking">Bell</option>
                      <option value="lowshelf">LoShf</option>
                      <option value="highshelf">HiShf</option>
                    </select>
                    <label className="flex items-center gap-1 text-slate-400">
                      <span>Hz</span>
                      <input
                        type="number"
                        min={25}
                        max={18000}
                        step={25}
                        value={selectedBand.frequency}
                        onChange={(e) =>
                          updateBand(selectedBand.id, {
                            frequency: Math.max(25, Math.min(18000, Number(e.target.value) || 1000)),
                          })
                        }
                        className="w-13 px-1 py-0.5 rounded bg-[#070A10] border border-slate-700 text-slate-200 text-[9px] tabular-nums"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-slate-400">
                      <span>Q</span>
                      <input
                        type="number"
                        min={0.4}
                        max={16}
                        step={0.1}
                        value={selectedBand.q}
                        onChange={(e) =>
                          updateBand(selectedBand.id, {
                            q: Math.max(0.4, Math.min(16, Number(e.target.value) || 1.4)),
                          })
                        }
                        className="w-11 px-1 py-0.5 rounded bg-[#070A10] border border-slate-700 text-slate-200 text-[9px] tabular-nums"
                      />
                    </label>
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
                    <line x1={4} y1={50} x2={86} y2={4} stroke="rgba(148,163,184,0.2)" strokeDasharray="2 2" />
                    <line
                      x1={compTransfer.threshX}
                      y1={2}
                      x2={compTransfer.threshX}
                      y2={52}
                      stroke="rgba(245,158,11,0.35)"
                      strokeDasharray="2 2"
                    />
                    <path
                      d={compTransfer.pathD}
                      fill="none"
                      stroke={dsp.compressor.enabled && !dsp.bypassed ? '#38BDF8' : '#64748B'}
                      strokeWidth={2}
                    />
                    {telemetry?.isRunning && telemetry.gainReductionDb > 0.2 && (
                      <text
                        x={6}
                        y={12}
                        fill="#FBBF24"
                        fontSize="8"
                        fontFamily="JetBrains Mono"
                      >
                        -{telemetry.gainReductionDb.toFixed(1)}dB
                      </text>
                    )}
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
                <div className="grid grid-cols-3 gap-1 w-full font-mono text-[8px] text-slate-400">
                  <label className="flex flex-col items-center gap-0.5">
                    <span>ATK ms</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={dsp.compressor.attackMs}
                      onChange={(e) =>
                        !panelLocked &&
                        onUpdateDsp({
                          compressor: {
                            ...dsp.compressor,
                            attackMs: Math.max(1, Math.min(100, Number(e.target.value) || 8)),
                          },
                        })
                      }
                      className="w-full px-0.5 py-0.5 text-center rounded bg-[#070A10] border border-slate-700 text-slate-200 tabular-nums"
                    />
                  </label>
                  <label className="flex flex-col items-center gap-0.5">
                    <span>REL ms</span>
                    <input
                      type="number"
                      min={20}
                      max={800}
                      step={10}
                      value={dsp.compressor.releaseMs}
                      onChange={(e) =>
                        !panelLocked &&
                        onUpdateDsp({
                          compressor: {
                            ...dsp.compressor,
                            releaseMs: Math.max(20, Math.min(800, Number(e.target.value) || 120)),
                          },
                        })
                      }
                      className="w-full px-0.5 py-0.5 text-center rounded bg-[#070A10] border border-slate-700 text-slate-200 tabular-nums"
                    />
                  </label>
                  <label className="flex flex-col items-center gap-0.5">
                    <span>MAKEUP</span>
                    <input
                      type="number"
                      min={0}
                      max={18}
                      step={0.5}
                      value={dsp.compressor.makeupDb}
                      onChange={(e) =>
                        !panelLocked &&
                        onUpdateDsp({
                          compressor: {
                            ...dsp.compressor,
                            makeupDb: Math.max(0, Math.min(18, Number(e.target.value) || 0)),
                          },
                        })
                      }
                      className="w-full px-0.5 py-0.5 text-center rounded bg-[#070A10] border border-slate-700 text-emerald-300 tabular-nums"
                    />
                  </label>
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
                <div className="grid grid-cols-2 gap-1 w-full place-items-center">
                  <RotaryKnob
                    label="GATE"
                    value={dsp.gate.thresholdDb}
                    min={-65}
                    max={-20}
                    step={1}
                    defaultValue={-50}
                    unit="dB"
                    size={36}
                    accent="sky"
                    onChange={(next) =>
                      !panelLocked &&
                      onUpdateDsp({ gate: { ...dsp.gate, thresholdDb: next, enabled: true } })
                    }
                  />
                  <RotaryKnob
                    label="RANGE"
                    value={dsp.gate.rangeDb}
                    min={6}
                    max={48}
                    step={2}
                    defaultValue={24}
                    unit="dB"
                    size={36}
                    accent="emerald"
                    onChange={(next) =>
                      !panelLocked &&
                      onUpdateDsp({ gate: { ...dsp.gate, rangeDb: next, enabled: true } })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-1 w-full place-items-center">
                  <RotaryKnob
                    label="SIBIL"
                    value={dsp.deEsser.frequencyHz}
                    min={4000}
                    max={9500}
                    step={100}
                    defaultValue={6200}
                    size={36}
                    accent="amber"
                    formatValue={(v) => `${(v / 1000).toFixed(1)}k`}
                    onChange={(next) =>
                      !panelLocked &&
                      onUpdateDsp({ deEsser: { ...dsp.deEsser, frequencyHz: next, enabled: true } })
                    }
                  />
                  <RotaryKnob
                    label="DE-THR"
                    value={dsp.deEsser.thresholdDb}
                    min={-48}
                    max={-6}
                    step={1}
                    defaultValue={-26}
                    unit="dB"
                    size={36}
                    accent="amber"
                    onChange={(next) =>
                      !panelLocked &&
                      onUpdateDsp({ deEsser: { ...dsp.deEsser, thresholdDb: next, enabled: true } })
                    }
                  />
                </div>
                <div className="space-y-1 w-full">
                  <ConsolePushButton
                    label={dsp.gate.enabled ? 'GATE ON' : 'GATE OFF'}
                    active={dsp.gate.enabled}
                    tone="sky"
                    onClick={() =>
                      !panelLocked &&
                      onUpdateDsp({ gate: { ...dsp.gate, enabled: !dsp.gate.enabled } })
                    }
                  />
                  <ConsolePushButton
                    label={dsp.deEsser.enabled ? 'DE-ESS ON' : 'DE-ESS OFF'}
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
          )}

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
              {[
                { label: 'MAIN L', db: telemetry?.postLRmsDb ?? -96 },
                { label: 'MAIN R', db: telemetry?.postRRmsDb ?? -96 },
              ].map(({ label, db }) => {
                const lvl =
                  telemetry?.isRunning && db > -63.5
                    ? Math.min(100, Math.max(0, Math.round(((db + 64) / 64) * 100)))
                    : 0;
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
              <div
                className={`font-mono text-[9px] ${
                  latencyMs <= 10
                    ? 'text-emerald-400'
                    : latencyMs <= 18
                      ? 'text-sky-400'
                      : 'text-amber-400'
                }`}
              >
                ROUND TRIP · {latencyMs <= 10 ? 'STATUS GOOD' : latencyMs <= 18 ? 'MONITOR OK' : 'INCREASE CLOCK / LOWER BUF'}
              </div>
            </div>
            <svg viewBox="0 0 80 36" className="w-20 h-9">
              <path
                d="M 2 18 L 14 18 L 22 6 L 30 30 L 38 10 L 46 26 L 56 18 L 78 18"
                fill="none"
                stroke={latencyMs <= 10 ? '#10B981' : latencyMs <= 18 ? '#38BDF8' : '#F59E0B'}
                strokeWidth={1.8}
              />
            </svg>
          </div>

          {/* CPU / DSP UTILIZATION */}
          <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3 space-y-1.5">
            <div className="flex justify-between font-mono text-[10px] tabular-nums">
              <span className="text-slate-400 uppercase">CPU / DSP Utilization</span>
              <span
                className={
                  cpuPct >= 88
                    ? 'text-red-400 font-semibold'
                    : cpuPct >= 72
                      ? 'text-amber-400 font-semibold'
                      : 'text-emerald-400 font-semibold'
                }
              >
                {cpuPct}% · {telemetry?.isRunning ? 'ACTIVE' : 'STANDBY'}
              </span>
            </div>
            <div className="h-2.5 rounded-xs bg-[#070A10] border border-slate-800 overflow-hidden p-px">
              <div
                className={`h-full rounded-[1px] transition-[width] duration-150 ${
                  cpuPct >= 88 ? 'bg-red-500' : cpuPct >= 72 ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
                style={{ width: `${cpuPct}%` }}
              />
            </div>
          </div>

          {/* SYSTEM HEADROOM & CLOCK */}
          <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3 grid grid-cols-2 gap-2 items-center">
            <ArcGauge
              label="Output Density"
              value={outputDensityPct}
              max={100}
              displayValue={telemetry?.isRunning ? `${outputDensityPct}%` : '--'}
              sublabel={telemetry?.isRunning ? 'Post-DSP Peak' : 'Standby'}
              tone={outputDensityPct > 86 ? 'amber' : 'emerald'}
            />
            <div className="space-y-2 font-mono text-[10px] bg-[#080C13] border border-slate-800 rounded p-2">
              <div>
                <div className="text-slate-500">CLOCK STATUS</div>
                <div className={telemetry?.isRunning ? 'text-emerald-400 font-semibold' : 'text-slate-400 font-semibold'}>
                  {telemetry?.isRunning ? `LOCKED · ${(sampleRate / 1000).toFixed(1)}k` : 'STANDBY'}
                </div>
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
          {telemetry?.isRunning
            ? `SIGNAL OK · ${((telemetry.sampleRate || sampleRate) / 1000).toFixed(1)} kHz`
            : 'STANDBY'}
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
