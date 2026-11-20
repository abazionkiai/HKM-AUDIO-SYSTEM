import React, { useEffect, useRef } from 'react';
import { CheckCircle2, RotateCcw, ShieldAlert, Zap } from 'lucide-react';
import type {
  BassDiConfig,
  DspConfig,
  HardwareDevice,
  SignalTelemetry,
} from '../types/audio.ts';
import { DEFAULT_BASS_DI_CONFIG } from '../data/hardwareCatalog.ts';
import type { SpectrumSnapshot } from '../audio/liveAudioEngine.ts';
import {
  ArcGauge,
  ConsolePushButton,
  RotaryKnob,
  SegmentedLedMeter,
} from './StudioControls.tsx';

interface VirtualDiBassModuleProps {
  device: HardwareDevice;
  bassDi: BassDiConfig;
  onUpdateBassDi: (patch: Partial<BassDiConfig>) => void;
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  telemetry: SignalTelemetry;
  spectrum: SpectrumSnapshot;
  onLogAction: (detail: string) => void;
}

const VOICINGS: BassDiConfig['highBandDrive']['cabinetVoicing'][] = [
  'DI Clean',
  'Ampeg SVT 8x10',
  'B-15 Vintage Tube',
  'Modern Punch',
];

export const VirtualDiBassModule: React.FC<VirtualDiBassModuleProps> = ({
  device,
  bassDi,
  onUpdateBassDi,
  dsp,
  onUpdateDsp,
  telemetry,
  spectrum,
  onLogAction,
}) => {
  const scopeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render Live Sub-Bass & Hum Harmonic Oscilloscope / Low-End FFT (20 Hz - 1 kHz)
  useEffect(() => {
    const canvas = scopeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#070A10';
    ctx.fillRect(0, 0, w, h);

    // Log grid from 25 Hz to 1000 Hz
    const minLog = Math.log10(25);
    const maxLog = Math.log10(1000);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    [30, 41, 50, 60, 80, 100, 150, 210, 400, 800].forEach((f) => {
      const x = ((Math.log10(f) - minLog) / (maxLog - minLog)) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h - 18);
      ctx.stroke();
      ctx.fillStyle = f === 50 || f === 60 ? '#F59E0B' : '#64748B';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${f}`, x, h - 5);
    });

    // Draw crossover split marker
    const xoverX =
      ((Math.log10(Math.max(25, Math.min(1000, bassDi.crossoverHz))) - minLog) /
        (maxLog - minLog)) *
      w;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xoverX, 0);
    ctx.lineTo(xoverX, h - 18);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#38BDF8';
    ctx.textAlign = 'left';
    ctx.fillText(`XOVER ${bassDi.crossoverHz} Hz`, Math.min(w - 92, xoverX + 4), 14);

    // Draw subsonic HPF shade
    const hpfX =
      ((Math.log10(Math.max(25, Math.min(1000, bassDi.subsonicHpfHz))) - minLog) /
        (maxLog - minLog)) *
      w;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
    ctx.fillRect(0, 0, hpfX, h - 18);

    // Plot low-frequency spectrum trace
    if (telemetry.isRunning) {
      ctx.beginPath();
      const samples = 180;
      for (let i = 0; i <= samples; i++) {
        const f = Math.pow(10, minLog + (i / samples) * (maxLog - minLog));
        const binIdx = Math.min(
          spectrum.postDb.length - 1,
          Math.max(1, Math.round((f * 4096) / telemetry.sampleRate))
        );
        const db = Math.max(-84, Math.min(0, spectrum.postDb[binIdx] ?? -84));
        const x = (i / samples) * w;
        const y = ((0 - db) / 84) * (h - 20);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // Static nominal bass contour preview when engine is idle
      ctx.beginPath();
      for (let i = 0; i <= 140; i++) {
        const f = Math.pow(10, minLog + (i / 140) * (maxLog - minLog));
        let db = -24;
        if (f < bassDi.subsonicHpfHz) db -= (bassDi.subsonicHpfHz - f) * 0.9;
        if (Math.abs(f - 50) < 4 && bassDi.humNotch50Hz) db -= 18;
        if (Math.abs(f - 60) < 4 && bassDi.humNotch60Hz) db -= 18;
        if (f > bassDi.crossoverHz) db += bassDi.highBandDrive.presenceDb * 0.8;
        const x = (i / 140) * w;
        const y = ((0 - Math.max(-72, Math.min(-4, db))) / 84) * (h - 20);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#94A3B8';
      ctx.textAlign = 'right';
      ctx.fillText('FILTER CURVE PREVIEW (ENGINE STANDBY)', w - 8, 14);
    }
  }, [bassDi, spectrum, telemetry]);

  const handleApplyToMainDsp = () => {
    const nextBands = dsp.eqBands.map((b, idx) => {
      if (idx === 0) {
        return {
          ...b,
          enabled: true,
          label: 'Bass Sub Punch',
          frequency: 72,
          gainDb: bassDi.bypassed ? 0 : 1.5,
          q: 1.2,
        };
      }
      if (idx === 1) {
        return {
          ...b,
          enabled: bassDi.humNotch50Hz || bassDi.humNotch60Hz,
          label: bassDi.humNotch50Hz ? '50 Hz Hum Guard' : '60 Hz Hum Guard',
          frequency: bassDi.humNotch50Hz ? 100 : 120,
          gainDb: -4.5,
          q: 4.5,
        };
      }
      if (idx === 4) {
        return {
          ...b,
          enabled: bassDi.highBandDrive.enabled,
          label: 'Bass Finger/Pick Presence',
          frequency: 950,
          gainDb: bassDi.highBandDrive.presenceDb,
          q: 1.3,
        };
      }
      return b;
    });

    onUpdateDsp({
      bypassed: false,
      hpfEnabled: true,
      hpfHz: bassDi.subsonicHpfHz,
      polarityInverted: bassDi.polarityInverted,
      eqBands: nextBands,
      compressor: {
        ...dsp.compressor,
        enabled: bassDi.lowBandComp.enabled,
        thresholdDb: bassDi.lowBandComp.thresholdDb,
        ratio: bassDi.lowBandComp.ratio,
      },
    });
    onLogAction(
      `Applied Virtual DI Bass chain (${bassDi.subsonicHpfHz} Hz HPF, ${bassDi.highBandDrive.cabinetVoicing}, ${bassDi.blendPct}% blend) to live DSP`
    );
  };

  const preLevel = telemetry.isRunning ? telemetry.preRmsDb : -96;
  const postLevel = telemetry.isRunning
    ? Math.max(-64, Math.min(-0.2, telemetry.postRmsDb + bassDi.outputLevelDb * 0.4))
    : -96;

  return (
    <div className="space-y-4">
      {/* Studio Rack Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-emerald-400">13</span>
              <h1 className="font-display text-lg font-semibold text-white tracking-tight">
                VIRTUAL DI &amp; DUAL-BAND BASS PROCESSOR
              </h1>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              Active DI Input Stage · 50/60 Hz Mains Hum Suppressor · Bi-Amp Low Comp + Harmonic Tube Drive ({device.model})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ConsolePushButton
            label={bassDi.bypassed ? 'DI BYPASSED' : 'DI ENGAGED'}
            active={!bassDi.bypassed}
            tone={bassDi.bypassed ? 'amber' : 'emerald'}
            onClick={() => onUpdateBassDi({ bypassed: !bassDi.bypassed })}
          />
          <button
            type="button"
            onClick={() => onUpdateBassDi(DEFAULT_BASS_DI_CONFIG)}
            className="px-2.5 py-1.5 rounded border border-slate-700 bg-[#121722] text-[10px] font-mono font-semibold text-slate-300 hover:border-slate-500 flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span>DEFAULT</span>
          </button>
          <button
            type="button"
            onClick={handleApplyToMainDsp}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-semibold flex items-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>PUSH TO LIVE CONSOLE DSP</span>
          </button>
        </div>
      </div>

      {/* Main Bass DI Rack */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Left Input & Hum Guard Rack */}
        <div className="xl:col-span-4 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold text-white uppercase">
              1. Active DI Input &amp; Hum Guard
            </span>
            <span className="font-mono text-[10px] text-amber-400">
              {telemetry.humRisk.detected ? 'HUM DETECTED' : 'CLEAN DI'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <ConsolePushButton
              label={bassDi.inputPadDb ? '-15 dB PAD' : '0 dB LINE'}
              active={bassDi.inputPadDb}
              tone="amber"
              onClick={() => onUpdateBassDi({ inputPadDb: !bassDi.inputPadDb })}
            />
            <ConsolePushButton
              label={bassDi.groundLift ? 'GND LIFT' : 'GROUNDED'}
              active={bassDi.groundLift}
              tone="emerald"
              onClick={() => onUpdateBassDi({ groundLift: !bassDi.groundLift })}
            />
            <ConsolePushButton
              label={bassDi.polarityInverted ? 'Ø 180° INV' : '0° PHASE'}
              active={bassDi.polarityInverted}
              tone="amber"
              onClick={() => onUpdateBassDi({ polarityInverted: !bassDi.polarityInverted })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 py-2 bg-[#070A10] border border-slate-800 rounded place-items-center">
            <RotaryKnob
              label="DI TRIM"
              value={bassDi.inputTrimDb}
              min={-12}
              max={18}
              step={0.5}
              defaultValue={2.0}
              unit="dB"
              size={50}
              accent="sky"
              onChange={(v) => onUpdateBassDi({ inputTrimDb: v })}
            />
            <RotaryKnob
              label="SUBSONIC HPF"
              value={bassDi.subsonicHpfHz}
              min={25}
              max={80}
              step={1}
              defaultValue={38}
              unit="Hz"
              size={50}
              accent="amber"
              onChange={(v) => onUpdateBassDi({ subsonicHpfHz: v })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <ConsolePushButton
              label="50 Hz + 100/150 NOTCH"
              active={bassDi.humNotch50Hz}
              tone="sky"
              onClick={() => onUpdateBassDi({ humNotch50Hz: !bassDi.humNotch50Hz })}
            />
            <ConsolePushButton
              label="60 Hz + 120/180 NOTCH"
              active={bassDi.humNotch60Hz}
              tone="sky"
              onClick={() => onUpdateBassDi({ humNotch60Hz: !bassDi.humNotch60Hz })}
            />
          </div>

          <div className="p-2.5 rounded border border-slate-800 bg-[#090D14] text-[10px] font-mono text-slate-400 flex items-start gap-2">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span>
              4-string E1 = 41.2 Hz, 5-string B0 = 30.9 Hz. Keep Subsonic HPF at 32–40 Hz to remove rumble without thinning fundamental weight.
            </span>
          </div>
        </div>

        {/* Center Bi-Amp Dual-Band Processor */}
        <div className="xl:col-span-5 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold text-white uppercase">
              2. Dual-Band Sub Comp &amp; Tube Drive
            </span>
            <span className="font-mono text-[10px] text-sky-400">
              Split @ {bassDi.crossoverHz} Hz
            </span>
          </div>

          {/* Low-End Spectrum Scope */}
          <div className="rounded bg-[#070A10] border border-slate-800 p-2">
            <canvas ref={scopeCanvasRef} width={520} height={150} className="w-full h-36 rounded-xs" />
          </div>

          {/* Dual-Band Controls */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 py-2 bg-[#070A10] border border-slate-800 rounded place-items-center">
            <RotaryKnob
              label="XOVER"
              value={bassDi.crossoverHz}
              min={120}
              max={350}
              step={5}
              defaultValue={210}
              unit="Hz"
              size={44}
              accent="sky"
              onChange={(v) => onUpdateBassDi({ crossoverHz: v })}
            />
            <RotaryKnob
              label="LOW THR"
              value={bassDi.lowBandComp.thresholdDb}
              min={-36}
              max={-4}
              step={1}
              defaultValue={-18}
              unit="dB"
              size={44}
              accent="emerald"
              onChange={(v) =>
                onUpdateBassDi({ lowBandComp: { ...bassDi.lowBandComp, thresholdDb: v } })
              }
            />
            <RotaryKnob
              label="LOW RAT"
              value={bassDi.lowBandComp.ratio}
              min={1.5}
              max={10}
              step={0.5}
              defaultValue={4.5}
              size={44}
              accent="emerald"
              formatValue={(v) => `${v.toFixed(1)}:1`}
              onChange={(v) =>
                onUpdateBassDi({ lowBandComp: { ...bassDi.lowBandComp, ratio: v } })
              }
            />
            <RotaryKnob
              label="HI DRIVE"
              value={bassDi.highBandDrive.drivePct}
              min={0}
              max={100}
              step={2}
              defaultValue={24}
              unit="%"
              size={44}
              accent="amber"
              onChange={(v) =>
                onUpdateBassDi({ highBandDrive: { ...bassDi.highBandDrive, drivePct: v } })
              }
            />
            <RotaryKnob
              label="PRESENCE"
              value={bassDi.highBandDrive.presenceDb}
              min={-4}
              max={8}
              step={0.5}
              defaultValue={2.5}
              unit="dB"
              size={44}
              accent="sky"
              onChange={(v) =>
                onUpdateBassDi({ highBandDrive: { ...bassDi.highBandDrive, presenceDb: v } })
              }
            />
            <RotaryKnob
              label="BLEND"
              value={bassDi.blendPct}
              min={0}
              max={100}
              step={2}
              defaultValue={62}
              unit="%"
              size={44}
              accent="emerald"
              onChange={(v) => onUpdateBassDi({ blendPct: v })}
            />
          </div>

          {/* Cabinet Voicing Selector */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {VOICINGS.map((v) => (
              <ConsolePushButton
                key={v}
                label={v}
                active={bassDi.highBandDrive.cabinetVoicing === v}
                tone="sky"
                onClick={() =>
                  onUpdateBassDi({ highBandDrive: { ...bassDi.highBandDrive, cabinetVoicing: v } })
                }
              />
            ))}
          </div>
        </div>

        {/* Right Output Stage & Telemetry */}
        <div className="xl:col-span-3 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold text-white uppercase">
              3. Output &amp; Metering
            </span>
            <span className="font-mono text-[10px] text-emerald-400">
              A={bassDi.tunerRefHz} Hz
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 items-center">
            <ArcGauge
              label="Sub Comp GR"
              value={telemetry.isRunning ? telemetry.gainReductionDb : 0}
              max={18}
              displayValue={telemetry.isRunning ? `-${telemetry.gainReductionDb.toFixed(1)}` : '--'}
              sublabel={telemetry.isRunning ? 'dB Low Tightening' : 'Standby'}
              tone="emerald"
            />
            <div className="flex items-center justify-around py-2 bg-[#070A10] border border-slate-800 rounded">
              <div className="flex flex-col items-center gap-1">
                <SegmentedLedMeter
                  levelDb={preLevel}
                  peakDb={preLevel + 4}
                  height={92}
                  segments={14}
                />
                <span className="font-mono text-[9px] text-slate-400">RAW DI</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <SegmentedLedMeter
                  levelDb={postLevel}
                  peakDb={postLevel + 3}
                  muted={bassDi.bypassed}
                  height={92}
                  segments={14}
                />
                <span className="font-mono text-[9px] text-emerald-400">PROC</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 py-2 bg-[#070A10] border border-slate-800 rounded place-items-center">
            <RotaryKnob
              label="OUTPUT"
              value={bassDi.outputLevelDb}
              min={-24}
              max={6}
              step={0.5}
              defaultValue={0}
              unit="dB"
              size={50}
              accent="emerald"
              onChange={(v) => onUpdateBassDi({ outputLevelDb: v })}
            />
            <RotaryKnob
              label="REF PITCH"
              value={bassDi.tunerRefHz}
              min={432}
              max={444}
              step={1}
              defaultValue={440}
              unit="Hz"
              size={50}
              accent="sky"
              onChange={(v) => onUpdateBassDi({ tunerRefHz: v })}
            />
          </div>

          <div className="p-2.5 rounded border border-emerald-500/30 bg-emerald-500/5 text-[11px] font-mono text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              {bassDi.highBandDrive.cabinetVoicing} · {bassDi.lowBandComp.enabled ? 'Low Comp Active' : 'Low Uncompressed'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
