import React, { useMemo, useState } from 'react';
import {
  Sliders,
  Volume2,
  Clock,
  Radio,
  Flame,
  Zap,
  Shield,
  Layers,
  ArrowRightLeft,
  Link2,
  Unlink,
  Headphones,
  Check,
} from 'lucide-react';
import type { ActiveCrossoverConfig, CrossoverBandConfig, DspConfig } from '../types/audio.ts';
import { ConsolePushButton, RotaryKnob } from './StudioControls.tsx';

interface ActiveCrossoverModuleProps {
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  panelLocked?: boolean;
  compactConsoleMode?: boolean;
}

export const ActiveCrossoverModule: React.FC<ActiveCrossoverModuleProps> = ({
  dsp,
  onUpdateDsp,
  panelLocked = false,
  compactConsoleMode = false,
}) => {
  const [activeChannelTab, setActiveChannelTab] = useState<'L' | 'R'>('L');

  const xover: ActiveCrossoverConfig = useMemo(() => {
    if (dsp.crossover) {
      return {
        ...dsp.crossover,
        stereoLinked: dsp.crossover.stereoLinked ?? true,
        superBass: dsp.crossover.superBass || {
          enabled: false,
          mode: 'deep-sub',
          boostDb: 6.0,
          subHarmonics: true,
          subInfrasoundHpfHz: 28,
        },
      };
    }
    return {
      enabled: true,
      stereoLinked: true,
      subToMidHz: 80,
      midToHighHz: 2500,
      slope: 'LR24',
      sub: {
        name: 'Subwoofer',
        enabled: true,
        gainDb: 0,
        mute: false,
        solo: false,
        polarityInverted: false,
        delayMs: 4.5,
        outputAssignment: 'sub-out',
      },
      mid: {
        name: 'Mid / Main Vocals',
        enabled: true,
        gainDb: 0,
        mute: false,
        solo: false,
        polarityInverted: false,
        delayMs: 0,
        outputAssignment: 'main-lr',
      },
      high: {
        name: 'High Frequency Horns',
        enabled: true,
        gainDb: 0,
        mute: false,
        solo: false,
        polarityInverted: false,
        delayMs: 0.8,
        outputAssignment: 'horn-out',
      },
      superBass: {
        enabled: false,
        mode: 'deep-sub',
        boostDb: 6.0,
        subHarmonics: true,
        subInfrasoundHpfHz: 28,
      },
    };
  }, [dsp.crossover]);

  const isLinked = xover.stereoLinked ?? true;

  const updateXover = (patch: Partial<ActiveCrossoverConfig>) => {
    if (panelLocked) return;
    onUpdateDsp({
      crossover: {
        ...xover,
        ...patch,
      },
    });
  };

  const updateBand = (bandKey: 'sub' | 'mid' | 'high', patch: Partial<CrossoverBandConfig>) => {
    if (panelLocked) return;
    const targetKey =
      !isLinked && activeChannelTab === 'R'
        ? (bandKey === 'sub' ? 'subRight' : bandKey === 'mid' ? 'midRight' : 'highRight')
        : bandKey;

    const currentBand = (xover as any)[targetKey] || (xover as any)[bandKey];
    const updatedBand = { ...currentBand, ...patch };

    const updates: Partial<ActiveCrossoverConfig> = {
      [targetKey]: updatedBand,
    };

    if (isLinked) {
      if (bandKey === 'sub') updates.subRight = updatedBand;
      if (bandKey === 'mid') updates.midRight = updatedBand;
      if (bandKey === 'high') updates.highRight = updatedBand;
    }

    updateXover(updates);
  };

  const activeSubBand: CrossoverBandConfig =
    !isLinked && activeChannelTab === 'R' && xover.subRight ? xover.subRight : xover.sub;
  const activeMidBand: CrossoverBandConfig =
    !isLinked && activeChannelTab === 'R' && xover.midRight ? xover.midRight : xover.mid;
  const activeHighBand: CrossoverBandConfig =
    !isLinked && activeChannelTab === 'R' && xover.highRight ? xover.highRight : xover.high;

  // Toggle Solo / Isolate
  const handleToggleSolo = (bandKey: 'sub' | 'mid' | 'high') => {
    const band = bandKey === 'sub' ? activeSubBand : bandKey === 'mid' ? activeMidBand : activeHighBand;
    const nextSolo = !band.solo;
    updateBand(bandKey, { solo: nextSolo });
  };

  // Toggle Mute
  const handleToggleMute = (bandKey: 'sub' | 'mid' | 'high') => {
    const band = bandKey === 'sub' ? activeSubBand : bandKey === 'mid' ? activeMidBand : activeHighBand;
    updateBand(bandKey, { mute: !band.mute });
  };

  // Output Assignment
  const handleAssignOutput = (bandKey: 'sub' | 'mid' | 'high', outputBus: string) => {
    updateBand(bandKey, { outputAssignment: outputBus });
  };

  // SuperBass toggles
  const superBass = xover.superBass || {
    enabled: false,
    mode: 'deep-sub',
    boostDb: 6.0,
    subHarmonics: true,
    subInfrasoundHpfHz: 28,
  };

  const handleToggleSuperBass = () => {
    if (panelLocked) return;
    updateXover({
      superBass: {
        ...superBass,
        enabled: !superBass.enabled,
      },
    });
  };

  const handleSuperBassMode = (mode: 'deep-sub' | 'punch-808' | 'subharmonic') => {
    if (panelLocked) return;
    updateXover({
      superBass: {
        ...superBass,
        mode,
        enabled: true,
      },
    });
  };

  const handleSuperBassGain = (boostDb: number) => {
    if (panelLocked) return;
    updateXover({
      superBass: {
        ...superBass,
        boostDb: Math.max(0, Math.min(12, Number(boostDb.toFixed(1)))),
      },
    });
  };

  // Crossover visualization geometry with strict boundary clamping
  const curves = useMemo(() => {
    const width = 800;
    const height = 120;
    const minF = 20;
    const maxF = 20000;
    const subF = xover.subToMidHz || 80;
    const highF = xover.midToHighHz || 2500;

    const freqToX = (f: number, w: number) => {
      const minLog = Math.log10(minF);
      const maxLog = Math.log10(maxF);
      const fLog = Math.log10(Math.max(minF, Math.min(maxF, f)));
      return ((fLog - minLog) / (maxLog - minLog)) * w;
    };

    const subPoints: string[] = [];
    const midPoints: string[] = [];
    const highPoints: string[] = [];

    const numPoints = 80;
    for (let i = 0; i <= numPoints; i++) {
      const f = minF * Math.pow(maxF / minF, i / numPoints);
      const x = freqToX(f, width);

      // LR-24 Sub response (4th order lowpass = (1 / (1 + (f/fc)^2))^2)
      const subRatio = f / subF;
      const subMag = 1 / (1 + Math.pow(subRatio, 4));
      const subDb = Math.max(-48, Math.min(18, 10 * Math.log10(Math.max(1e-5, subMag)) + (activeSubBand.gainDb || 0)));
      const subY = Math.max(6, Math.min(height - 4, height * 0.45 - (subDb / 24) * (height * 0.38)));
      subPoints.push(`${x.toFixed(1)},${subY.toFixed(1)}`);

      // LR-24 High response (4th order highpass = ( (f/fc)^2 / (1 + (f/fc)^2) )^2 )
      const highRatio = f / highF;
      const highMag = Math.pow(highRatio, 4) / (1 + Math.pow(highRatio, 4));
      const highDb = Math.max(-48, Math.min(18, 10 * Math.log10(Math.max(1e-5, highMag)) + (activeHighBand.gainDb || 0)));
      const highY = Math.max(6, Math.min(height - 4, height * 0.45 - (highDb / 24) * (height * 0.38)));
      highPoints.push(`${x.toFixed(1)},${highY.toFixed(1)}`);

      // Mid response (Band-pass = Sub HP * High LP)
      const midHpRatio = f / subF;
      const midHpMag = Math.pow(midHpRatio, 4) / (1 + Math.pow(midHpRatio, 4));
      const midLpRatio = f / highF;
      const midLpMag = 1 / (1 + Math.pow(midLpRatio, 4));
      const midMag = midHpMag * midLpMag;
      const midDb = Math.max(-48, Math.min(18, 10 * Math.log10(Math.max(1e-5, midMag)) + (activeMidBand.gainDb || 0)));
      const midY = Math.max(6, Math.min(height - 4, height * 0.45 - (midDb / 24) * (height * 0.38)));
      midPoints.push(`${x.toFixed(1)},${midY.toFixed(1)}`);
    }

    return {
      subPath: `M ${subPoints.join(' L ')}`,
      midPath: `M ${midPoints.join(' L ')}`,
      highPath: `M ${highPoints.join(' L ')}`,
      subSplitX: freqToX(subF, width),
      highSplitX: freqToX(highF, width),
    };
  }, [activeHighBand.gainDb, activeMidBand.gainDb, activeSubBand.gainDb, xover.midToHighHz, xover.subToMidHz]);

  return (
    <div
      className={`${
        compactConsoleMode
          ? 'h-full min-h-0 flex flex-col justify-between gap-1.5 p-2 overflow-hidden'
          : 'space-y-4 p-4'
      } rounded-xl border border-violet-500/35 bg-gradient-to-b from-[#110E1E] via-[#090D17] to-[#06080F] text-slate-200 shadow-2xl`}
    >
      {compactConsoleMode ? (
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg border border-slate-800 bg-[#0B0F1A] font-mono text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-violet-500/20 border border-violet-400/40 text-violet-300 font-bold">
              LR-24 XOVER
            </span>
            <button
              type="button"
              disabled={panelLocked}
              onClick={() => updateXover({ stereoLinked: !isLinked })}
              className={`px-2 py-1 rounded border font-bold flex items-center gap-1 cursor-pointer ${
                isLinked
                  ? 'bg-violet-500/20 border-violet-400/60 text-violet-200'
                  : 'bg-amber-500/20 border-amber-400/60 text-amber-200'
              }`}
            >
              {isLinked ? <Link2 className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
              {isLinked ? 'L+R' : 'DUAL'}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={panelLocked}
              onClick={handleToggleSuperBass}
              className={`px-2 py-1 rounded border font-bold flex items-center gap-1 cursor-pointer ${
                superBass.enabled
                  ? 'bg-fuchsia-600 text-white border-fuchsia-400'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              <Zap className="w-3 h-3" />
              SUPERBASS {superBass.enabled ? `+${superBass.boostDb.toFixed(0)}dB` : 'OFF'}
            </button>
            <select
              aria-label="SuperBass Voicing"
              value={superBass.mode}
              disabled={panelLocked}
              onChange={(e) => handleSuperBassMode(e.target.value as 'deep-sub' | 'punch-808' | 'subharmonic')}
              className="rounded border border-slate-700 bg-[#05080F] px-2 py-1 text-[10px] text-fuchsia-200 cursor-pointer"
            >
              <option value="deep-sub">Deep Sub (45 Hz)</option>
              <option value="punch-808">808 Punch (63 Hz)</option>
              <option value="subharmonic">Subharmonic Synth</option>
            </select>
          </div>

          <ConsolePushButton
            label={xover.enabled && !dsp.bypassed ? 'XOVER IN' : 'BYP'}
            active={xover.enabled && !dsp.bypassed}
            tone={xover.enabled && !dsp.bypassed ? 'emerald' : 'amber'}
            onClick={() => updateXover({ enabled: !xover.enabled })}
          />
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-9 rounded-xs bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.8)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-violet-400 tracking-wider">
                LR-24 ACTIVE CROSSOVER
              </span>
              <h2 className="font-display text-base font-semibold text-white tracking-tight">
                Stereo 3-Way Linkwitz-Riley Crossover &amp; Output Matrix
              </h2>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              4th-Order 24 dB/Octave Slopes · Driver Time Alignment · SuperBass Subwoofer Synthesizer
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          {/* Stereo Link Mode Toggle */}
          <button
            type="button"
            disabled={panelLocked}
            onClick={() => updateXover({ stereoLinked: !isLinked })}
            className={`px-3 py-1 rounded border text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              isLinked
                ? 'bg-violet-500/20 border-violet-400/60 text-violet-200 shadow-[0_0_10px_rgba(167,139,250,0.2)]'
                : 'bg-amber-500/15 border-amber-400/50 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
            }`}
          >
            {isLinked ? (
              <>
                <Link2 className="w-3.5 h-3.5 text-violet-400" />
                <span>LINKED STEREO (L+R)</span>
              </>
            ) : (
              <>
                <Unlink className="w-3.5 h-3.5 text-amber-400" />
                <span>DUAL INDEPENDENT</span>
              </>
            )}
          </button>

          <ConsolePushButton
            label={xover.enabled && !dsp.bypassed ? 'CROSSOVER ACTIVE' : 'FULL-RANGE BYPASS'}
            active={xover.enabled && !dsp.bypassed}
            tone={xover.enabled && !dsp.bypassed ? 'emerald' : 'amber'}
            onClick={() => updateXover({ enabled: !xover.enabled })}
          />
        </div>
      </div>

      {/* SUPERBASS SUBWOOFER ACCELERATOR SECTION */}
      <div className="p-3.5 rounded-xl border border-fuchsia-500/40 bg-gradient-to-r from-fuchsia-950/40 via-[#100D1A] to-[#0A0D18] shadow-lg space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-fuchsia-500/20 pb-2">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 shadow-[0_0_10px_rgba(217,70,239,0.3)]">
              <Flame className="w-4 h-4 text-fuchsia-400 animate-pulse" />
            </div>
            <div>
              <span className="font-mono text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
                SUPERBASS™ SUB ACCELERATOR &amp; SUBHARMONIC SYNTHESIZER
              </span>
              <p className="text-[10px] font-mono text-fuchsia-300/80">
                Psychoacoustic Low-End Fundamental Generation + 28 Hz Subsonic Cone Protection
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={panelLocked}
              onClick={handleToggleSuperBass}
              className={`px-3 py-1 rounded text-xs font-mono font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                superBass.enabled
                  ? 'bg-fuchsia-600 text-white border-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.5)]'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              {superBass.enabled ? 'SUPERBASS ENGAGED' : 'ENGAGE SUPERBASS'}
            </button>
          </div>
        </div>

        {/* SuperBass Tuning Modes & Boost Slider */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] text-fuchsia-300 uppercase font-semibold">
              Sub Acoustic Voicing:
            </span>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                disabled={panelLocked}
                onClick={() => handleSuperBassMode('deep-sub')}
                className={`px-2.5 py-1 rounded text-[10px] font-mono font-semibold border transition cursor-pointer ${
                  superBass.mode === 'deep-sub' && superBass.enabled
                    ? 'bg-fuchsia-500/30 border-fuchsia-400 text-fuchsia-200'
                    : 'bg-[#090C14] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                🌊 DEEP SUB (45 Hz)
              </button>
              <button
                type="button"
                disabled={panelLocked}
                onClick={() => handleSuperBassMode('punch-808')}
                className={`px-2.5 py-1 rounded text-[10px] font-mono font-semibold border transition cursor-pointer ${
                  superBass.mode === 'punch-808' && superBass.enabled
                    ? 'bg-fuchsia-500/30 border-fuchsia-400 text-fuchsia-200'
                    : 'bg-[#090C14] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                💥 808 PUNCH (63 Hz)
              </button>
              <button
                type="button"
                disabled={panelLocked}
                onClick={() => handleSuperBassMode('subharmonic')}
                className={`px-2.5 py-1 rounded text-[10px] font-mono font-semibold border transition cursor-pointer ${
                  superBass.mode === 'subharmonic' && superBass.enabled
                    ? 'bg-fuchsia-500/30 border-fuchsia-400 text-fuchsia-200'
                    : 'bg-[#090C14] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                ⚡ SUBHARMONIC
              </button>
            </div>
          </div>

          {/* Draggable SuperBass Drive Slider */}
          <div className="space-y-1 md:col-span-2 bg-[#090C14] p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-fuchsia-400" />
                SuperBass Subwoofer Boost Level:
              </span>
              <span className="text-fuchsia-300 font-bold text-xs bg-fuchsia-950/60 px-2 py-0.5 rounded border border-fuchsia-500/40">
                +{superBass.boostDb.toFixed(1)} dB
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] text-slate-500">0 dB</span>
              <input
                type="range"
                min={0}
                max={12}
                step={0.5}
                value={superBass.boostDb}
                disabled={panelLocked || !superBass.enabled}
                onChange={(e) => handleSuperBassGain(parseFloat(e.target.value))}
                className="flex-1 accent-fuchsia-500 cursor-pointer h-2 rounded-lg bg-slate-800"
              />
              <span className="font-mono text-[10px] text-fuchsia-400 font-bold">+12 dB MAX</span>
            </div>
          </div>
        </div>
      </div>
        </>
      )}

      {/* Real-Time Filter Slopes Visualizer */}
      <div
        className={`relative rounded-lg border border-slate-800 bg-[#06080F] ${
          compactConsoleMode ? 'p-1.5 shrink-0' : 'p-3'
        } shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 font-mono text-[10px]">
          <div className="text-slate-400 uppercase flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-fuchsia-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-fuchsia-500 shadow-[0_0_6px_rgba(217,70,239,0.8)]" />
              Subwoofer Band (LP-24)
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
              Mid / Vocal Band (BP-24)
            </span>
            <span className="flex items-center gap-1.5 text-sky-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
              High Horn Band (HP-24)
            </span>
          </div>
          <div className="text-slate-400 font-mono">
            Cutoffs: <strong className="text-fuchsia-300">{xover.subToMidHz} Hz</strong> /{' '}
            <strong className="text-sky-300">{(xover.midToHighHz / 1000).toFixed(2)} kHz</strong>
          </div>
        </div>

        <svg
          viewBox="0 0 800 120"
          className={`w-full ${compactConsoleMode ? 'h-14' : 'h-28'} overflow-hidden rounded bg-[#04060C]`}
        >
          {/* Grids */}
          <line x1={0} y1={25} x2={800} y2={25} stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
          <line x1={0} y1={55} x2={800} y2={55} stroke="rgba(148,163,184,0.25)" />
          <line x1={0} y1={85} x2={800} y2={85} stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />

          {/* Crossover Cutoff Vertical Guides */}
          <line
            x1={curves.subSplitX}
            y1={0}
            x2={curves.subSplitX}
            y2={120}
            stroke="rgba(217,70,239,0.7)"
            strokeDasharray="4 2"
          />
          <line
            x1={curves.highSplitX}
            y1={0}
            x2={curves.highSplitX}
            y2={120}
            stroke="rgba(56,189,248,0.7)"
            strokeDasharray="4 2"
          />

          {/* Sub Curve */}
          <path
            d={curves.subPath}
            fill="none"
            stroke="#D946EF"
            strokeWidth={activeSubBand.mute ? 1 : 2.5}
            opacity={activeSubBand.mute ? 0.25 : 1}
            className="filter drop-shadow-[0_0_6px_rgba(217,70,239,0.6)]"
          />

          {/* Mid Curve */}
          <path
            d={curves.midPath}
            fill="none"
            stroke="#10B981"
            strokeWidth={activeMidBand.mute ? 1 : 2.5}
            opacity={activeMidBand.mute ? 0.25 : 1}
            className="filter drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]"
          />

          {/* High Curve */}
          <path
            d={curves.highPath}
            fill="none"
            stroke="#38BDF8"
            strokeWidth={activeHighBand.mute ? 1 : 2.5}
            opacity={activeHighBand.mute ? 0.25 : 1}
            className="filter drop-shadow-[0_0_6px_rgba(56,189,248,0.6)]"
          />
        </svg>
      </div>

      {/* Crossover Frequency Cutoff Draggable Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 p-3 rounded-lg border border-slate-800 bg-[#0B0F18]">
        {/* Sub/Mid Cutoff Slider */}
        <div className="space-y-1.5 bg-[#070A10] p-2.5 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span className="text-fuchsia-300 font-semibold uppercase flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_6px_rgba(217,70,239,0.8)]" />
              Sub / Mid Crossover Cutoff
            </span>
            <span className="text-white font-bold bg-[#141C2B] px-2.5 py-0.5 rounded border border-fuchsia-500/50">
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
            className="w-full accent-fuchsia-500 cursor-pointer h-2 rounded bg-slate-800"
          />
          <div className="flex justify-between font-mono text-[9px] text-slate-500">
            <span>40 Hz</span>
            <span className="text-fuchsia-400/80 font-bold">80 Hz (Standard Church Sub)</span>
            <span>120 Hz</span>
            <span>180 Hz</span>
          </div>
        </div>

        {/* Mid/High Cutoff Slider */}
        <div className="space-y-1.5 bg-[#070A10] p-2.5 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span className="text-sky-300 font-semibold uppercase flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
              Mid / High Horn Crossover Cutoff
            </span>
            <span className="text-white font-bold bg-[#141C2B] px-2.5 py-0.5 rounded border border-sky-500/50">
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
            className="w-full accent-sky-500 cursor-pointer h-2 rounded bg-slate-800"
          />
          <div className="flex justify-between font-mono text-[9px] text-slate-500">
            <span>1.0 kHz</span>
            <span className="text-sky-400/80 font-bold">2.5 kHz (Horn Default)</span>
            <span>4.0 kHz</span>
            <span>6.0 kHz</span>
          </div>
        </div>
      </div>

      {/* 3 Physical Band Processing & Output Matrix Strips */}
      <div className={`grid grid-cols-1 md:grid-cols-3 ${compactConsoleMode ? 'flex-1 min-h-0 gap-2' : 'gap-3'}`}>
        {/* BAND 1: SUBWOOFER CHANNEL STRIP */}
        <div
          className={`rounded-xl border p-3 flex flex-col justify-between gap-3 transition-all ${
            activeSubBand.solo
              ? 'border-fuchsia-400 bg-[#1A0E24] shadow-[0_0_15px_rgba(217,70,239,0.3)]'
              : 'border-fuchsia-500/35 bg-[#100D18]'
          }`}
        >
          <div className="flex items-center justify-between border-b border-fuchsia-500/20 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_6px_rgba(217,70,239,0.8)]" />
              <span className="font-mono text-xs font-bold text-fuchsia-200 uppercase">
                1. SUBWOOFER BAND
              </span>
            </div>
            <span className="font-mono text-[10px] text-fuchsia-400">
              Low-Pass &lt; {xover.subToMidHz} Hz
            </span>
          </div>

          {/* Knobs */}
          <div className="flex items-center justify-around py-1">
            <RotaryKnob
              label="Sub Gain"
              value={activeSubBand.gainDb}
              min={-12}
              max={12}
              step={0.5}
              defaultValue={0}
              unit="dB"
              size={50}
              accent="amber"
              onChange={(v) => updateBand('sub', { gainDb: v })}
            />
            <RotaryKnob
              label="Driver Delay"
              value={activeSubBand.delayMs}
              min={0}
              max={45}
              step={0.1}
              defaultValue={4.5}
              unit="ms"
              size={50}
              accent="amber"
              onChange={(v) => updateBand('sub', { delayMs: v })}
            />
          </div>

          {/* Output Patch Assignment Matrix */}
          <div className="space-y-2 font-mono text-[10px] bg-[#070912] p-2 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center gap-1">
                <Volume2 className="w-3 h-3 text-fuchsia-400" /> Output Patch:
              </span>
              <select
                value={activeSubBand.outputAssignment || 'sub-out'}
                onChange={(e) => handleAssignOutput('sub', e.target.value)}
                className="rounded border border-fuchsia-500/40 bg-[#120F1C] px-2 py-0.5 text-[10px] text-fuchsia-200 font-mono cursor-pointer"
              >
                <option value="sub-out">Aux 1 / Subwoofer Out (Dedicated)</option>
                <option value="main-lr">Main Sanctuary L/R (Internal Sum)</option>
                <option value="mono-sub">Matrix Out 3 (Mono Sub Center)</option>
              </select>
            </div>

            {/* Solo / Isolate & Mute & Polarity */}
            <div className="grid grid-cols-3 gap-1 pt-1">
              <button
                type="button"
                onClick={() => handleToggleSolo('sub')}
                className={`py-1 rounded font-bold text-[10px] border transition cursor-pointer flex items-center justify-center gap-1 ${
                  activeSubBand.solo
                    ? 'bg-fuchsia-500 text-white border-fuchsia-400 shadow-[0_0_8px_rgba(217,70,239,0.8)]'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Headphones className="w-3 h-3" />
                {activeSubBand.solo ? 'ISOLATED' : 'ISOLATE'}
              </button>

              <button
                type="button"
                onClick={() => handleToggleMute('sub')}
                className={`py-1 rounded font-bold text-[10px] border transition cursor-pointer ${
                  activeSubBand.mute
                    ? 'bg-red-600 text-white border-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {activeSubBand.mute ? 'MUTED' : 'MUTE'}
              </button>

              <button
                type="button"
                onClick={() => updateBand('sub', { polarityInverted: !activeSubBand.polarityInverted })}
                className={`py-1 rounded font-bold text-[10px] border transition cursor-pointer ${
                  activeSubBand.polarityInverted
                    ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {activeSubBand.polarityInverted ? '180° Ø' : '0° PHASE'}
              </button>
            </div>
          </div>
        </div>

        {/* BAND 2: MID / VOCALS CHANNEL STRIP */}
        <div
          className={`rounded-xl border p-3 flex flex-col justify-between gap-3 transition-all ${
            activeMidBand.solo
              ? 'border-emerald-400 bg-[#0B1A16] shadow-[0_0_15px_rgba(16,185,129,0.3)]'
              : 'border-emerald-500/35 bg-[#091211]'
          }`}
        >
          <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
              <span className="font-mono text-xs font-bold text-emerald-200 uppercase">
                2. MID / VOCAL BAND
              </span>
            </div>
            <span className="font-mono text-[10px] text-emerald-400">
              {xover.subToMidHz} Hz — {(xover.midToHighHz / 1000).toFixed(1)}k
            </span>
          </div>

          {/* Knobs */}
          <div className="flex items-center justify-around py-1">
            <RotaryKnob
              label="Mid Gain"
              value={activeMidBand.gainDb}
              min={-12}
              max={12}
              step={0.5}
              defaultValue={0}
              unit="dB"
              size={50}
              accent="emerald"
              onChange={(v) => updateBand('mid', { gainDb: v })}
            />
            <RotaryKnob
              label="Mid Delay"
              value={activeMidBand.delayMs}
              min={0}
              max={45}
              step={0.1}
              defaultValue={0}
              unit="ms"
              size={50}
              accent="emerald"
              onChange={(v) => updateBand('mid', { delayMs: v })}
            />
          </div>

          {/* Output Patch Assignment Matrix */}
          <div className="space-y-2 font-mono text-[10px] bg-[#070912] p-2 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center gap-1">
                <Volume2 className="w-3 h-3 text-emerald-400" /> Output Patch:
              </span>
              <select
                value={activeMidBand.outputAssignment || 'main-lr'}
                onChange={(e) => handleAssignOutput('mid', e.target.value)}
                className="rounded border border-emerald-500/40 bg-[#0C1613] px-2 py-0.5 text-[10px] text-emerald-200 font-mono cursor-pointer"
              >
                <option value="main-lr">Main Sanctuary PA Array L/R</option>
                <option value="aux-vocal">Aux 2 / Platform Vocal Cluster</option>
                <option value="center-fill">Out 4 (Center Platform Fill)</option>
              </select>
            </div>

            {/* Solo / Isolate & Mute & Polarity */}
            <div className="grid grid-cols-3 gap-1 pt-1">
              <button
                type="button"
                onClick={() => handleToggleSolo('mid')}
                className={`py-1 rounded font-bold text-[10px] border transition cursor-pointer flex items-center justify-center gap-1 ${
                  activeMidBand.solo
                    ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Headphones className="w-3 h-3" />
                {activeMidBand.solo ? 'ISOLATED' : 'ISOLATE'}
              </button>

              <button
                type="button"
                onClick={() => handleToggleMute('mid')}
                className={`py-1 rounded font-bold text-[10px] border transition cursor-pointer ${
                  activeMidBand.mute
                    ? 'bg-red-600 text-white border-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {activeMidBand.mute ? 'MUTED' : 'MUTE'}
              </button>

              <button
                type="button"
                onClick={() => updateBand('mid', { polarityInverted: !activeMidBand.polarityInverted })}
                className={`py-1 rounded font-bold text-[10px] border transition cursor-pointer ${
                  activeMidBand.polarityInverted
                    ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {activeMidBand.polarityInverted ? '180° Ø' : '0° PHASE'}
              </button>
            </div>
          </div>
        </div>

        {/* BAND 3: HIGH HORNS CHANNEL STRIP */}
        <div
          className={`rounded-xl border p-3 flex flex-col justify-between gap-3 transition-all ${
            activeHighBand.solo
              ? 'border-sky-400 bg-[#0B1524] shadow-[0_0_15px_rgba(56,189,248,0.3)]'
              : 'border-sky-500/35 bg-[#09101A]'
          }`}
        >
          <div className="flex items-center justify-between border-b border-sky-500/20 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
              <span className="font-mono text-xs font-bold text-sky-200 uppercase">
                3. HIGH HORNS &amp; AIR
              </span>
            </div>
            <span className="font-mono text-[10px] text-sky-400">
              High-Pass &gt; {(xover.midToHighHz / 1000).toFixed(1)}k Hz
            </span>
          </div>

          {/* Knobs */}
          <div className="flex items-center justify-around py-1">
            <RotaryKnob
              label="High Gain"
              value={activeHighBand.gainDb}
              min={-12}
              max={12}
              step={0.5}
              defaultValue={0}
              unit="dB"
              size={50}
              accent="sky"
              onChange={(v) => updateBand('high', { gainDb: v })}
            />
            <RotaryKnob
              label="Horn Align"
              value={activeHighBand.delayMs}
              min={0}
              max={30}
              step={0.1}
              defaultValue={0.8}
              unit="ms"
              size={50}
              accent="sky"
              onChange={(v) => updateBand('high', { delayMs: v })}
            />
          </div>

          {/* Output Patch Assignment Matrix */}
          <div className="space-y-2 font-mono text-[10px] bg-[#070912] p-2 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center gap-1">
                <Volume2 className="w-3 h-3 text-sky-400" /> Output Patch:
              </span>
              <select
                value={activeHighBand.outputAssignment || 'horn-out'}
                onChange={(e) => handleAssignOutput('high', e.target.value)}
                className="rounded border border-sky-500/40 bg-[#0C1522] px-2 py-0.5 text-[10px] text-sky-200 font-mono cursor-pointer"
              >
                <option value="horn-out">High Frequency Horns (Dedicated)</option>
                <option value="main-lr">Main Sanctuary PA Array L/R</option>
                <option value="delay-zone">Out 5-6 / Balcony Delay Horns</option>
              </select>
            </div>

            {/* Solo / Isolate & Mute & Polarity */}
            <div className="grid grid-cols-3 gap-1 pt-1">
              <button
                type="button"
                onClick={() => handleToggleSolo('high')}
                className={`py-1 rounded font-bold text-[10px] border transition cursor-pointer flex items-center justify-center gap-1 ${
                  activeHighBand.solo
                    ? 'bg-sky-500 text-white border-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Headphones className="w-3 h-3" />
                {activeHighBand.solo ? 'ISOLATED' : 'ISOLATE'}
              </button>

              <button
                type="button"
                onClick={() => handleToggleMute('high')}
                className={`py-1 rounded font-bold text-[10px] border transition cursor-pointer ${
                  activeHighBand.mute
                    ? 'bg-red-600 text-white border-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {activeHighBand.mute ? 'MUTED' : 'MUTE'}
              </button>

              <button
                type="button"
                onClick={() => updateBand('high', { polarityInverted: !activeHighBand.polarityInverted })}
                className={`py-1 rounded font-bold text-[10px] border transition cursor-pointer ${
                  activeHighBand.polarityInverted
                    ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {activeHighBand.polarityInverted ? '180° Ø' : '0° PHASE'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
