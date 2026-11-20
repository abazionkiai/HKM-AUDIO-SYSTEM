import React, { useMemo } from 'react';
import { Layers, VolumeX, Volume2, Clock, RotateCw, Activity, ArrowRightLeft } from 'lucide-react';
import type { DspConfig, ActiveCrossoverConfig } from '../types/audio.ts';
import { ConsolePushButton, RotaryKnob } from './StudioControls.tsx';

interface ActiveCrossoverModuleProps {
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  panelLocked?: boolean;
}

export const ActiveCrossoverModule: React.FC<ActiveCrossoverModuleProps> = ({
  dsp,
  onUpdateDsp,
  panelLocked = false,
}) => {
  const xover: ActiveCrossoverConfig = useMemo(() => {
    if (dsp.crossover) return dsp.crossover;
    return {
      enabled: true,
      slope: 'LR24',
      subToMidHz: 80,
      midToHighHz: 2500,
      sub: { name: 'Subwoofer', enabled: true, gainDb: 0, mute: false, solo: false, delayMs: 4.5, polarityInverted: false },
      mid: { name: 'Mid / Main Vocals', enabled: true, gainDb: 0, mute: false, solo: false, delayMs: 0, polarityInverted: false },
      high: { name: 'High / Horns', enabled: true, gainDb: 0, mute: false, solo: false, delayMs: 0.8, polarityInverted: false },
    };
  }, [dsp.crossover]);

  const updateXover = (patch: Partial<ActiveCrossoverConfig>) => {
    if (panelLocked) return;
    onUpdateDsp({
      crossover: {
        ...xover,
        ...patch,
      },
    });
  };

  const updateBand = (
    band: 'sub' | 'mid' | 'high',
    patch: Partial<ActiveCrossoverConfig['sub']>
  ) => {
    if (panelLocked) return;
    updateXover({
      [band]: {
        ...xover[band],
        ...patch,
      },
    });
  };

  // Convert Hz to log-x pixel coordinates (20 Hz to 20 kHz across width 800)
  const freqToX = (freq: number, width = 800) => {
    const minFreq = 20;
    const maxFreq = 20000;
    const minLog = Math.log10(minFreq);
    const maxLog = Math.log10(maxFreq);
    const logVal = Math.log10(Math.max(minFreq, Math.min(maxFreq, freq)));
    return ((logVal - minLog) / (maxLog - minLog)) * width;
  };

  // Generate SVG crossover curves
  const curves = useMemo(() => {
    const width = 800;
    const height = 120;
    const subF = xover.subToMidHz || 80;
    const highF = xover.midToHighHz || 2500;

    const subPoints: string[] = [];
    const midPoints: string[] = [];
    const highPoints: string[] = [];

    const numPoints = 80;
    for (let i = 0; i <= numPoints; i++) {
      const freq = 20 * Math.pow(20000 / 20, i / numPoints);
      const x = freqToX(freq, width);

      // LR-24 Sub response (4th order lowpass = (1 / (1 + (f/fc)^2))^2)
      const subRatio = freq / subF;
      const subMag = 1 / (1 + Math.pow(subRatio, 4));
      const subDb = Math.max(-48, 10 * Math.log10(Math.max(1e-5, subMag)) + (xover.sub.gainDb || 0));
      const subY = height * 0.45 - (subDb / 24) * (height * 0.4);
      subPoints.push(`${x.toFixed(1)},${subY.toFixed(1)}`);

      // LR-24 High response (4th order highpass = ( (f/fc)^2 / (1 + (f/fc)^2) )^2 )
      const highRatio = freq / highF;
      const highMag = Math.pow(highRatio, 4) / (1 + Math.pow(highRatio, 4));
      const highDb = Math.max(-48, 10 * Math.log10(Math.max(1e-5, highMag)) + (xover.high.gainDb || 0));
      const highY = height * 0.45 - (highDb / 24) * (height * 0.4);
      highPoints.push(`${x.toFixed(1)},${highY.toFixed(1)}`);

      // Mid response (Band-pass = Sub HP * High LP)
      const midHpRatio = freq / subF;
      const midHpMag = Math.pow(midHpRatio, 4) / (1 + Math.pow(midHpRatio, 4));
      const midLpRatio = freq / highF;
      const midLpMag = 1 / (1 + Math.pow(midLpRatio, 4));
      const midMag = midHpMag * midLpMag;
      const midDb = Math.max(-48, 10 * Math.log10(Math.max(1e-5, midMag)) + (xover.mid.gainDb || 0));
      const midY = height * 0.45 - (midDb / 24) * (height * 0.4);
      midPoints.push(`${x.toFixed(1)},${midY.toFixed(1)}`);
    }

    return {
      subPath: `M ${subPoints.join(' L ')}`,
      midPath: `M ${midPoints.join(' L ')}`,
      highPath: `M ${highPoints.join(' L ')}`,
      subSplitX: freqToX(subF, width),
      highSplitX: freqToX(highF, width),
    };
  }, [xover]);

  return (
    <div className="space-y-4 rounded-lg border border-slate-800 bg-[#0B0F17] p-4 text-slate-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.6)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-violet-400">LR-24 CROSSOVER</span>
              <h2 className="font-display text-base font-semibold text-white tracking-tight">
                Active 3-Way Linkwitz-Riley Crossover &amp; Driver Time Alignment
              </h2>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              4th-Order 24 dB/Octave Slopes · Zero Acoustic Phase Distortion · Subwoofer &amp; Horn Time Alignment Delay
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <ConsolePushButton
            label={xover.enabled && !dsp.bypassed ? 'CROSSOVER ACTIVE' : 'FULL-RANGE BYPASS'}
            active={xover.enabled && !dsp.bypassed}
            tone={xover.enabled && !dsp.bypassed ? 'emerald' : 'amber'}
            onClick={() => updateXover({ enabled: !xover.enabled })}
          />
        </div>
      </div>

      {/* Real-Time Overlapping Linkwitz-Riley Filter Slopes Visualizer */}
      <div className="relative rounded-md border border-slate-800 bg-[#070A10] p-3 shadow-inner">
        <div className="flex items-center justify-between mb-2">
          <div className="font-mono text-[10px] text-slate-400 uppercase flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-fuchsia-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-fuchsia-500" />
              Subwoofer Band (LP-24)
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Mid / Vocal Band (BP-24)
            </span>
            <span className="flex items-center gap-1.5 text-sky-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
              High Horn Band (HP-24)
            </span>
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            Cutoffs: {xover.subToMidHz} Hz / {(xover.midToHighHz / 1000).toFixed(2)} kHz
          </div>
        </div>

        <svg viewBox="0 0 800 120" className="w-full h-28 overflow-visible">
          {/* Grids */}
          <line x1={0} y1={25} x2={800} y2={25} stroke="rgba(148,163,184,0.15)" strokeDasharray="3 3" />
          <line x1={0} y1={55} x2={800} y2={55} stroke="rgba(148,163,184,0.3)" />
          <line x1={0} y1={85} x2={800} y2={85} stroke="rgba(148,163,184,0.15)" strokeDasharray="3 3" />

          {/* Crossover Cutoff Vertical Guides */}
          <line
            x1={curves.subSplitX}
            y1={0}
            x2={curves.subSplitX}
            y2={120}
            stroke="rgba(217,70,239,0.5)"
            strokeDasharray="4 2"
          />
          <line
            x1={curves.highSplitX}
            y1={0}
            x2={curves.highSplitX}
            y2={120}
            stroke="rgba(56,189,248,0.5)"
            strokeDasharray="4 2"
          />

          {/* Sub Curve */}
          <path
            d={curves.subPath}
            fill="none"
            stroke="#D946EF"
            strokeWidth={xover.sub.mute ? 1 : 2.5}
            opacity={xover.sub.mute ? 0.3 : 1}
            className="filter drop-shadow-[0_0_6px_rgba(217,70,239,0.5)]"
          />

          {/* Mid Curve */}
          <path
            d={curves.midPath}
            fill="none"
            stroke="#10B981"
            strokeWidth={xover.mid.mute ? 1 : 2.5}
            opacity={xover.mid.mute ? 0.3 : 1}
            className="filter drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]"
          />

          {/* High Curve */}
          <path
            d={curves.highPath}
            fill="none"
            stroke="#38BDF8"
            strokeWidth={xover.high.mute ? 1 : 2.5}
            opacity={xover.high.mute ? 0.3 : 1}
            className="filter drop-shadow-[0_0_6px_rgba(56,189,248,0.5)]"
          />
        </svg>
      </div>

      {/* Crossover Cutoff Frequency Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg border border-slate-800 bg-[#0E131C]">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span className="text-fuchsia-300 font-semibold uppercase">
              Sub / Mid Crossover Frequency
            </span>
            <span className="text-white font-bold bg-[#141C2B] px-2 py-0.5 rounded border border-fuchsia-500/40">
              {xover.subToMidHz} Hz
            </span>
          </div>
          <input
            type="range"
            min={40}
            max={180}
            step={5}
            value={xover.subToMidHz}
            disabled={panelLocked}
            onChange={(e) => updateXover({ subToMidHz: parseInt(e.target.value, 10) })}
            className="w-full accent-fuchsia-500 cursor-pointer"
          />
          <div className="flex justify-between font-mono text-[9px] text-slate-500">
            <span>40 Hz</span>
            <span>80 Hz (Standard)</span>
            <span>120 Hz</span>
            <span>180 Hz</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span className="text-sky-300 font-semibold uppercase">
              Mid / High Crossover Frequency
            </span>
            <span className="text-white font-bold bg-[#141C2B] px-2 py-0.5 rounded border border-sky-500/40">
              {(xover.midToHighHz / 1000).toFixed(2)} kHz
            </span>
          </div>
          <input
            type="range"
            min={1000}
            max={6000}
            step={50}
            value={xover.midToHighHz}
            disabled={panelLocked}
            onChange={(e) => updateXover({ midToHighHz: parseInt(e.target.value, 10) })}
            className="w-full accent-sky-500 cursor-pointer"
          />
          <div className="flex justify-between font-mono text-[9px] text-slate-500">
            <span>1.0 kHz</span>
            <span>2.5 kHz (Horn Default)</span>
            <span>4.0 kHz</span>
            <span>6.0 kHz</span>
          </div>
        </div>
      </div>

      {/* 3 Physical Band Processing Channel Strips */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* BAND 1: SUBWOOFER */}
        <div className="rounded-lg border border-fuchsia-500/40 bg-[#120F1A] p-3 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-fuchsia-500/20 pb-2">
            <span className="font-mono text-xs font-bold text-fuchsia-300 uppercase">
              1. SUBWOOFERS
            </span>
            <span className="font-mono text-[10px] text-fuchsia-400/80">
              Low-Pass &lt; {xover.subToMidHz} Hz
            </span>
          </div>

          <div className="flex items-center justify-around py-1">
            <RotaryKnob
              label="Trim"
              value={xover.sub.gainDb}
              min={-12}
              max={12}
              step={0.5}
              defaultValue={0}
              unit="dB"
              size={48}
              accent="amber"
              onChange={(v) => updateBand('sub', { gainDb: v })}
            />
            <RotaryKnob
              label="Sub Align"
              value={xover.sub.delayMs}
              min={0}
              max={30}
              step={0.1}
              defaultValue={4.5}
              unit="ms"
              size={48}
              accent="amber"
              onChange={(v) => updateBand('sub', { delayMs: v })}
            />
          </div>

          <div className="space-y-1.5 font-mono text-[10px]">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-fuchsia-400" /> Time Align:
              </span>
              <span className="text-white font-bold">{xover.sub.delayMs.toFixed(1)} ms</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <ConsolePushButton
                label={xover.sub.mute ? 'MUTED' : 'MUTE'}
                active={xover.sub.mute}
                tone="red"
                onClick={() => updateBand('sub', { mute: !xover.sub.mute })}
              />
              <ConsolePushButton
                label={xover.sub.solo ? 'SOLO' : 'SOLO'}
                active={xover.sub.solo}
                tone="amber"
                onClick={() => updateBand('sub', { solo: !xover.sub.solo })}
              />
              <ConsolePushButton
                label={xover.sub.polarityInverted ? '180° Ø' : '0°'}
                active={xover.sub.polarityInverted}
                tone="amber"
                onClick={() => updateBand('sub', { polarityInverted: !xover.sub.polarityInverted })}
              />
            </div>
          </div>
        </div>

        {/* BAND 2: MID / VOCALS */}
        <div className="rounded-lg border border-emerald-500/40 bg-[#0B1514] p-3 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
            <span className="font-mono text-xs font-bold text-emerald-300 uppercase">
              2. MIDS &amp; VOCALS
            </span>
            <span className="font-mono text-[10px] text-emerald-400/80">
              {xover.subToMidHz} Hz – {(xover.midToHighHz / 1000).toFixed(1)}k
            </span>
          </div>

          <div className="flex items-center justify-around py-1">
            <RotaryKnob
              label="Trim"
              value={xover.mid.gainDb}
              min={-12}
              max={12}
              step={0.5}
              defaultValue={0}
              unit="dB"
              size={48}
              accent="emerald"
              onChange={(v) => updateBand('mid', { gainDb: v })}
            />
            <div className="flex flex-col items-center justify-center p-2 rounded border border-slate-800 bg-[#070D0C] w-20 text-center">
              <span className="font-mono text-[9px] text-slate-400 uppercase">Acoustic</span>
              <span className="font-mono text-xs font-bold text-emerald-400 mt-1">MAIN REF</span>
              <span className="font-mono text-[9px] text-slate-500">0.0 ms</span>
            </div>
          </div>

          <div className="space-y-1.5 font-mono text-[10px]">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3 text-emerald-400" /> Vocal Core:
              </span>
              <span className="text-white font-bold">{xover.mid.gainDb > 0 ? `+${xover.mid.gainDb.toFixed(1)}` : xover.mid.gainDb.toFixed(1)} dB</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <ConsolePushButton
                label={xover.mid.mute ? 'MUTED' : 'MUTE'}
                active={xover.mid.mute}
                tone="red"
                onClick={() => updateBand('mid', { mute: !xover.mid.mute })}
              />
              <ConsolePushButton
                label={xover.mid.solo ? 'SOLO' : 'SOLO'}
                active={xover.mid.solo}
                tone="amber"
                onClick={() => updateBand('mid', { solo: !xover.mid.solo })}
              />
              <ConsolePushButton
                label={xover.mid.polarityInverted ? '180° Ø' : '0°'}
                active={xover.mid.polarityInverted}
                tone="emerald"
                onClick={() => updateBand('mid', { polarityInverted: !xover.mid.polarityInverted })}
              />
            </div>
          </div>
        </div>

        {/* BAND 3: HIGH HORNS */}
        <div className="rounded-lg border border-sky-500/40 bg-[#0C131D] p-3 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-sky-500/20 pb-2">
            <span className="font-mono text-xs font-bold text-sky-300 uppercase">
              3. HIGH HORNS
            </span>
            <span className="font-mono text-[10px] text-sky-400/80">
              High-Pass &gt; {(xover.midToHighHz / 1000).toFixed(1)}k
            </span>
          </div>

          <div className="flex items-center justify-around py-1">
            <RotaryKnob
              label="Trim"
              value={xover.high.gainDb}
              min={-12}
              max={12}
              step={0.5}
              defaultValue={0}
              unit="dB"
              size={48}
              accent="sky"
              onChange={(v) => updateBand('high', { gainDb: v })}
            />
            <RotaryKnob
              label="Horn Align"
              value={xover.high.delayMs}
              min={0}
              max={10}
              step={0.1}
              defaultValue={0.8}
              unit="ms"
              size={48}
              accent="sky"
              onChange={(v) => updateBand('high', { delayMs: v })}
            />
          </div>

          <div className="space-y-1.5 font-mono text-[10px]">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-sky-400" /> Horn Delay:
              </span>
              <span className="text-white font-bold">{xover.high.delayMs.toFixed(1)} ms</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <ConsolePushButton
                label={xover.high.mute ? 'MUTED' : 'MUTE'}
                active={xover.high.mute}
                tone="red"
                onClick={() => updateBand('high', { mute: !xover.high.mute })}
              />
              <ConsolePushButton
                label={xover.high.solo ? 'SOLO' : 'SOLO'}
                active={xover.high.solo}
                tone="amber"
                onClick={() => updateBand('high', { solo: !xover.high.solo })}
              />
              <ConsolePushButton
                label={xover.high.polarityInverted ? '180° Ø' : '0°'}
                active={xover.high.polarityInverted}
                tone="sky"
                onClick={() => updateBand('high', { polarityInverted: !xover.high.polarityInverted })}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
