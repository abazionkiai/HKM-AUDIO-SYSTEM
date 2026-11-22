import React, { useMemo, useState } from 'react';
import { Sliders, RotateCcw, Sparkles, Link2, Unlink, Copy, Volume2, Flame, Zap } from 'lucide-react';
import type { DspConfig, GraphicEq31Config } from '../types/audio.ts';
import { ISO_31_FREQUENCIES } from '../types/audio.ts';
import { ConsolePushButton } from './StudioControls.tsx';
import { PrecisionVerticalFader } from './PrecisionVerticalFader.tsx';

interface StereoGraphicEqModuleProps {
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  panelLocked?: boolean;
  compactConsoleMode?: boolean;
}

const PRESET_CURVES: {
  id: string;
  name: string;
  description: string;
  apply: () => number[];
}[] = [
  {
    id: 'flat',
    name: 'FLAT (0 dB)',
    description: 'Completely uncolored flat response across all 31 ISO bands',
    apply: () => Array(31).fill(0),
  },
  {
    id: 'superbass-slam',
    name: '⚡ SUPERBASS SLAM (+8 dB)',
    description: 'Deep subwoofer expansion with massive low-end weight (31.5-63Hz) and clean mid cut',
    apply: () => {
      return ISO_31_FREQUENCIES.map((hz) => {
        if (hz <= 31.5) return 4.0;
        if (hz === 40 || hz === 50) return 7.5;
        if (hz === 63) return 8.0;
        if (hz === 80) return 5.0;
        if (hz === 100) return 2.5;
        if (hz >= 200 && hz <= 315) return -2.5;
        return 0;
      });
    },
  },
  {
    id: 'punch-kick',
    name: '💥 PUNCHY 808 & KICK',
    description: 'Tight sub punch (+6dB @ 63-100Hz) with aggressive sub-sonic rumble filtering below 35Hz',
    apply: () => {
      return ISO_31_FREQUENCIES.map((hz) => {
        if (hz <= 31.5) return -6.0;
        if (hz === 40) return 2.0;
        if (hz >= 63 && hz <= 100) return 6.5;
        if (hz === 250) return -2.0;
        return 0;
      });
    },
  },
  {
    id: 'speech-clarity',
    name: 'SPEECH CLARITY',
    description: 'Reduces pulpit boominess & chest resonance (-3dB @ 250Hz) and boosts speech presence (+2.5dB @ 2.5kHz-4kHz)',
    apply: () => {
      return ISO_31_FREQUENCIES.map((hz) => {
        if (hz < 63) return -9.0;
        if (hz >= 200 && hz <= 315) return -3.0;
        if (hz >= 2000 && hz <= 4000) return 2.5;
        if (hz >= 16000) return -2.0;
        return 0;
      });
    },
  },
  {
    id: 'sanctuary-warmth',
    name: 'SANCTUARY WARMTH',
    description: 'Rich analog acoustic warmth with gentle sub containment and smooth high-end roll-off for live worship halls',
    apply: () => {
      return ISO_31_FREQUENCIES.map((hz) => {
        if (hz < 40) return -4.5;
        if (hz >= 80 && hz <= 160) return 2.0;
        if (hz >= 400 && hz <= 800) return -1.5;
        if (hz >= 2500 && hz <= 5000) return 1.5;
        if (hz > 12500) return -1.5;
        return 0;
      });
    },
  },
  {
    id: 'feedback-suppression',
    name: 'NOTCH TRAP (ANTI-RING)',
    description: 'Pre-emptive cuts at typical church room mode resonance frequencies (160Hz, 400Hz, 800Hz, 3.15kHz)',
    apply: () => {
      return ISO_31_FREQUENCIES.map((hz) => {
        if (hz === 160 || hz === 400 || hz === 800) return -3.5;
        if (hz === 3150) return -4.0;
        if (hz < 50) return -6.0;
        return 0;
      });
    },
  },
  {
    id: 'air-presence',
    name: 'AIR & SPARKLE',
    description: 'Transparent top-end lift (+3dB @ 8k-16kHz) for broadcast clarity and cymbal definition without harshness',
    apply: () => {
      return ISO_31_FREQUENCIES.map((hz) => {
        if (hz < 50) return -4.0;
        if (hz >= 6300 && hz <= 16000) return 3.0;
        return 0;
      });
    },
  },
];

export const StereoGraphicEqModule: React.FC<StereoGraphicEqModuleProps> = ({
  dsp,
  onUpdateDsp,
  panelLocked = false,
  compactConsoleMode = false,
}) => {
  const [rangeMode, setRangeMode] = useState<6 | 12>(12);
  const [activeTab, setActiveTab] = useState<'L' | 'R'>('L');

  const eqConfig: GraphicEq31Config = useMemo(() => {
    const defaultBands = ISO_31_FREQUENCIES.map((hz) => ({ hz, gainDb: 0 }));
    if (dsp.graphicEq31 && Array.isArray(dsp.graphicEq31.bands) && dsp.graphicEq31.bands.length === 31) {
      return {
        ...dsp.graphicEq31,
        stereoLinked: dsp.graphicEq31.stereoLinked ?? true,
        activeChannel: dsp.graphicEq31.activeChannel ?? 'L',
        bandsRight:
          dsp.graphicEq31.bandsRight && dsp.graphicEq31.bandsRight.length === 31
            ? dsp.graphicEq31.bandsRight
            : [...dsp.graphicEq31.bands],
        outputAssignment: dsp.graphicEq31.outputAssignment || 'main-lr',
      };
    }
    return {
      enabled: true,
      rangeDb: rangeMode,
      stereoLinked: true,
      activeChannel: 'L',
      bands: defaultBands,
      bandsRight: defaultBands,
      outputAssignment: 'main-lr',
    };
  }, [dsp.graphicEq31, rangeMode]);

  const isLinked = eqConfig.stereoLinked ?? true;
  const currentBands =
    activeTab === 'L' || isLinked ? eqConfig.bands : eqConfig.bandsRight || eqConfig.bands;

  const handleBandChange = (index: number, newGainDb: number) => {
    if (panelLocked) return;
    const clamped = Math.max(-rangeMode, Math.min(rangeMode, newGainDb));

    if (isLinked) {
      const nextBands = eqConfig.bands.map((b, i) => (i === index ? { ...b, gainDb: clamped } : b));
      onUpdateDsp({
        graphicEq31: {
          ...eqConfig,
          bands: nextBands,
          bandsRight: nextBands,
        },
      });
    } else if (activeTab === 'L') {
      const nextBandsL = eqConfig.bands.map((b, i) => (i === index ? { ...b, gainDb: clamped } : b));
      onUpdateDsp({
        graphicEq31: {
          ...eqConfig,
          bands: nextBandsL,
        },
      });
    } else {
      const rightList = eqConfig.bandsRight || eqConfig.bands;
      const nextBandsR = rightList.map((b, i) => (i === index ? { ...b, gainDb: clamped } : b));
      onUpdateDsp({
        graphicEq31: {
          ...eqConfig,
          bandsRight: nextBandsR,
        },
      });
    }
  };

  // One-touch SuperBass Instant Injection
  const handleTriggerSuperBass = (boostAmount: number) => {
    if (panelLocked) return;
    const targetFreqs = [31.5, 40, 50, 63, 80];
    const updateList = (bands: typeof eqConfig.bands) =>
      bands.map((b, idx) => {
        const hz = b.hz ?? (ISO_31_FREQUENCIES[idx] ?? 1000);
        if (targetFreqs.includes(hz)) {
          const factor = hz === 50 || hz === 63 ? 1.0 : hz === 40 ? 0.85 : 0.65;
          const nextVal = Math.min(rangeMode, Math.max(-rangeMode, Number((b.gainDb + boostAmount * factor).toFixed(1))));
          return { ...b, gainDb: nextVal };
        }
        return b;
      });

    const nextBandsL = updateList(eqConfig.bands);
    const nextBandsR = isLinked ? nextBandsL : updateList(eqConfig.bandsRight || eqConfig.bands);

    onUpdateDsp({
      graphicEq31: {
        ...eqConfig,
        bands: nextBandsL,
        bandsRight: nextBandsR,
      },
    });
  };

  const handleToggleStereoLink = () => {
    if (panelLocked) return;
    const nextLink = !isLinked;
    onUpdateDsp({
      graphicEq31: {
        ...eqConfig,
        stereoLinked: nextLink,
        bandsRight: nextLink ? [...eqConfig.bands] : eqConfig.bandsRight || [...eqConfig.bands],
      },
    });
  };

  const handleCopyLtoR = () => {
    if (panelLocked) return;
    onUpdateDsp({
      graphicEq31: {
        ...eqConfig,
        bandsRight: [...eqConfig.bands],
      },
    });
  };

  const handleCopyRtoL = () => {
    if (panelLocked || !eqConfig.bandsRight) return;
    onUpdateDsp({
      graphicEq31: {
        ...eqConfig,
        bands: [...eqConfig.bandsRight],
      },
    });
  };

  const handleApplyPreset = (preset: typeof PRESET_CURVES[0]) => {
    if (panelLocked) return;
    const gains = preset.apply();
    const updated = eqConfig.bands.map((b, i) => ({
      ...b,
      gainDb: Math.max(-rangeMode, Math.min(rangeMode, gains[i] ?? 0)),
    }));

    onUpdateDsp({
      graphicEq31: {
        ...eqConfig,
        bands: updated,
        bandsRight: isLinked ? updated : eqConfig.bandsRight || updated,
      },
    });
  };

  const handleToggleEnabled = () => {
    if (panelLocked) return;
    onUpdateDsp({
      graphicEq31: {
        ...eqConfig,
        enabled: !eqConfig.enabled,
      },
    });
  };

  const handleOutputAssignment = (bus: string) => {
    if (panelLocked) return;
    onUpdateDsp({
      graphicEq31: {
        ...eqConfig,
        outputAssignment: bus,
      },
    });
  };

  const formatFreqLabel = (hz?: number) => {
    if (!hz) return '1k';
    if (hz >= 1000) {
      return `${(hz / 1000).toString().replace('.0', '')}k`;
    }
    return `${hz}`;
  };

  const calculateCurve = (bands: typeof eqConfig.bands) => {
    const width = 860;
    const height = 90;
    const paddingX = 14;
    const availableWidth = width - paddingX * 2;
    const baselineY = height / 2;

    const coords = bands.map((band, idx) => {
      const x = paddingX + (idx / 30) * availableWidth;
      const normalizedGain = band.gainDb / rangeMode;
      const y = baselineY - normalizedGain * (height * 0.42);
      return { x, y };
    });

    if (coords.length === 0) return '';
    let d = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const cur = coords[i];
      const cpX = (prev.x + cur.x) / 2;
      d += ` C ${cpX} ${prev.y}, ${cpX} ${cur.y}, ${cur.x} ${cur.y}`;
    }
    return d;
  };

  const curveLeft = useMemo(() => calculateCurve(eqConfig.bands), [eqConfig.bands, rangeMode]);
  const curveRight = useMemo(
    () => calculateCurve(eqConfig.bandsRight || eqConfig.bands),
    [eqConfig.bandsRight, eqConfig.bands, rangeMode]
  );

  return (
    <div
      className={`${
        compactConsoleMode
          ? 'h-full min-h-0 flex flex-col justify-between gap-1.5 p-2'
          : 'space-y-3.5 p-4'
      } rounded-xl border border-fuchsia-500/35 bg-gradient-to-b from-[#130D1B] via-[#090D16] to-[#06080E] text-slate-200 shadow-2xl`}
    >
      {/* Single-Line Hardware Rack Control Strip (Zero Stacked Pill Rows) */}
      {compactConsoleMode ? (
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg border border-slate-800 bg-[#0B0F1A] font-mono text-[10px]">
          {/* Left: Identity, Stereo Link, Channel Focus, Range */}
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/20 border border-fuchsia-400/40 text-fuchsia-300 font-bold">
              EQ-31
            </span>
            <button
              type="button"
              disabled={panelLocked}
              onClick={handleToggleStereoLink}
              className={`px-2 py-1 rounded border font-bold flex items-center gap-1 cursor-pointer ${
                isLinked
                  ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                  : 'bg-amber-500/20 border-amber-400/60 text-amber-200'
              }`}
            >
              {isLinked ? <Link2 className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
              {isLinked ? 'L+R' : 'DUAL'}
            </button>
            {!isLinked && (
              <div className="flex items-center rounded border border-slate-700 bg-[#05080F] p-0.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('L')}
                  className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                    activeTab === 'L' ? 'bg-cyan-500/30 text-cyan-200' : 'text-slate-400'
                  }`}
                >
                  CH1
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('R')}
                  className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                    activeTab === 'R' ? 'bg-violet-500/30 text-violet-200' : 'text-slate-400'
                  }`}
                >
                  CH2
                </button>
              </div>
            )}
            <div className="flex items-center rounded border border-slate-700 bg-[#05080F] p-0.5">
              <button
                type="button"
                onClick={() => setRangeMode(12)}
                className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                  rangeMode === 12 ? 'bg-cyan-500/25 text-cyan-200' : 'text-slate-400'
                }`}
              >
                ±12
              </button>
              <button
                type="button"
                onClick={() => setRangeMode(6)}
                className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                  rangeMode === 6 ? 'bg-cyan-500/25 text-cyan-200' : 'text-slate-400'
                }`}
              >
                ±6
              </button>
            </div>
          </div>

          {/* Center: Voicing Curve & Output Bus Dropdowns */}
          <div className="flex items-center gap-1.5">
            <select
              aria-label="EQ Voicing Curve"
              defaultValue=""
              disabled={panelLocked}
              onChange={(e) => {
                const found = PRESET_CURVES.find((c) => c.id === e.target.value);
                if (found) handleApplyPreset(found);
              }}
              className="rounded border border-slate-700 bg-[#05080F] px-2 py-1 text-[10px] text-slate-200 cursor-pointer"
            >
              <option value="" disabled>
                Voicing Curve…
              </option>
              {PRESET_CURVES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              aria-label="GEQ Output Bus"
              value={eqConfig.outputAssignment || 'main-lr'}
              onChange={(e) => handleOutputAssignment(e.target.value)}
              disabled={panelLocked}
              className="rounded border border-slate-700 bg-[#05080F] px-2 py-1 text-[10px] text-sky-200 cursor-pointer"
            >
              <option value="main-lr">Bus: Main PA L/R</option>
              <option value="aux-sub">Bus: Aux 1 Sub Array</option>
              <option value="aux-mids">Bus: Aux 2 Vocals</option>
              <option value="balcony-fill">Bus: Out 3-4 Balcony</option>
              <option value="cryroom-overflow">Bus: Out 5-6 Foyer</option>
            </select>
          </div>

          {/* Right: SuperBass Keys, Flat Reset & EQ Active */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={panelLocked}
              onClick={() => handleTriggerSuperBass(4.0)}
              className="px-2 py-1 rounded border border-cyan-400/50 bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 font-bold cursor-pointer"
              title="SuperBass +4 dB Sub Punch"
            >
              +4 SUB
            </button>
            <button
              type="button"
              disabled={panelLocked}
              onClick={() => handleTriggerSuperBass(7.5)}
              className="px-2 py-1 rounded border border-fuchsia-400/60 bg-fuchsia-600/25 hover:bg-fuchsia-600/40 text-fuchsia-200 font-bold cursor-pointer"
              title="SuperBass +7.5 dB Sub Slam"
            >
              +7.5 SLAM
            </button>
            <button
              type="button"
              disabled={panelLocked}
              onClick={() => handleApplyPreset(PRESET_CURVES[0])}
              className="px-2 py-1 rounded border border-slate-700 bg-[#121824] hover:bg-slate-800 text-slate-200 font-bold cursor-pointer flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3 text-cyan-400" />
              FLAT
            </button>
            <ConsolePushButton
              label={eqConfig.enabled && !dsp.bypassed ? 'EQ IN' : 'BYP'}
              active={eqConfig.enabled && !dsp.bypassed}
              tone={eqConfig.enabled && !dsp.bypassed ? 'emerald' : 'amber'}
              onClick={handleToggleEnabled}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Top Header Strip */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-2 ${
              compactConsoleMode ? 'h-5' : 'h-9'
            } rounded-xs bg-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.8)]`}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-fuchsia-400 tracking-wider">
                PRO STEREO EQ-31
              </span>
              <h2 className="font-display text-sm font-semibold text-white tracking-tight">
                Dual-Channel 31-Band Stereo Graphic Equalizer
              </h2>
            </div>
            {!compactConsoleMode && (
              <p className="text-[11px] font-mono text-slate-400">
                Illuminated Constant-Q Sliders · Stereo L/R Matrix Routing · Instant SuperBass Accel
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          {/* Stereo Link Mode Toggle */}
          <button
            type="button"
            disabled={panelLocked}
            onClick={handleToggleStereoLink}
            className={`px-3 py-1 rounded border text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              isLinked
                ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                : 'bg-amber-500/15 border-amber-400/50 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
            }`}
          >
            {isLinked ? (
              <>
                <Link2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>LINKED STEREO (L+R)</span>
              </>
            ) : (
              <>
                <Unlink className="w-3.5 h-3.5 text-amber-400" />
                <span>DUAL INDEPENDENT</span>
              </>
            )}
          </button>

          {/* Range Selector: +/-12dB or +/-6dB */}
          <div className="flex items-center rounded border border-slate-800 bg-[#070A10] p-0.5">
            <button
              type="button"
              onClick={() => setRangeMode(12)}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                rangeMode === 12
                  ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ±12 dB (FOH)
            </button>
            <button
              type="button"
              onClick={() => setRangeMode(6)}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                rangeMode === 6
                  ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ±6 dB (FINE)
            </button>
          </div>

          {/* Reset Flat */}
          <button
            type="button"
            disabled={panelLocked}
            onClick={() => handleApplyPreset(PRESET_CURVES[0])}
            className="px-2.5 py-1 rounded border border-slate-700 bg-[#121824] hover:bg-slate-800 text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3 text-cyan-400" />
            <span>FLAT RESET</span>
          </button>

          {/* Bypass / Active Toggle */}
          <ConsolePushButton
            label={eqConfig.enabled && !dsp.bypassed ? 'EQ ACTIVE' : 'EQ BYPASS'}
            active={eqConfig.enabled && !dsp.bypassed}
            tone={eqConfig.enabled && !dsp.bypassed ? 'emerald' : 'amber'}
            onClick={handleToggleEnabled}
          />
        </div>
      </div>

      {/* SuperBass Quick Boost Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-gradient-to-r from-cyan-950/40 via-[#0A101C] to-fuchsia-950/30 border border-cyan-500/30">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase font-bold text-cyan-300 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-fuchsia-400 animate-pulse" />
            SuperBass Accelerator:
          </span>
          <button
            type="button"
            disabled={panelLocked}
            onClick={() => handleTriggerSuperBass(4.0)}
            className="px-2.5 py-1 rounded border border-cyan-400/50 bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 font-mono text-[10px] font-bold flex items-center gap-1 transition cursor-pointer shadow-[0_0_8px_rgba(6,182,212,0.3)]"
          >
            <Zap className="w-3 h-3 text-cyan-300" />
            +4 dB SUB PUNCH
          </button>
          <button
            type="button"
            disabled={panelLocked}
            onClick={() => handleTriggerSuperBass(7.5)}
            className="px-2.5 py-1 rounded border border-fuchsia-400/60 bg-fuchsia-600/25 hover:bg-fuchsia-600/40 text-fuchsia-200 font-mono text-[10px] font-bold flex items-center gap-1 transition cursor-pointer shadow-[0_0_10px_rgba(217,70,239,0.3)]"
          >
            <Flame className="w-3 h-3 text-fuchsia-300" />
            +7.5 dB SUB SLAM
          </button>
        </div>

        {/* Real-World Hardware Output Routing Matrix */}
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-slate-400 text-[10px] uppercase font-semibold flex items-center gap-1">
            <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
            Output Bus:
          </span>
          <select
            value={eqConfig.outputAssignment || 'main-lr'}
            onChange={(e) => handleOutputAssignment(e.target.value)}
            disabled={panelLocked}
            className="rounded border border-slate-700 bg-[#06090F] px-2.5 py-1 text-xs text-white font-mono focus:border-cyan-400 focus:outline-hidden cursor-pointer"
          >
            <option value="main-lr">Master PA Output (Main Sanctuary L/R)</option>
            <option value="aux-sub">Aux 1 / Dedicated Subwoofer Array Bus</option>
            <option value="aux-mids">Aux 2 / Platform Vocal Cluster</option>
            <option value="balcony-fill">Out 3-4 / Balcony Delay Zone</option>
            <option value="cryroom-overflow">Out 5-6 / Foyer &amp; Overflow</option>
          </select>
        </div>
      </div>

      {/* Channel Selector Bar when Independent */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-lg bg-[#080C14] border border-slate-800">
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <span className="text-slate-400 text-[10px] uppercase font-semibold mr-1">Channel Focus:</span>
          {isLinked ? (
            <div className="px-3 py-1 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
              CH 1 &amp; CH 2 (STEREO PA COUPLED)
            </div>
          ) : (
            <div className="flex items-center rounded border border-slate-800 bg-[#06090F] p-0.5">
              <button
                type="button"
                onClick={() => setActiveTab('L')}
                className={`px-3 py-1 rounded font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'L'
                    ? 'bg-cyan-500/25 border border-cyan-500/50 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                CH 1 (LEFT PA)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('R')}
                className={`px-3 py-1 rounded font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'R'
                    ? 'bg-violet-500/25 border border-violet-500/50 text-violet-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-violet-400" />
                CH 2 (RIGHT PA)
              </button>
            </div>
          )}

          {!isLinked && (
            <div className="flex items-center gap-1 ml-2">
              <button
                type="button"
                onClick={handleCopyLtoR}
                className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-[10px] text-cyan-300 flex items-center gap-1 cursor-pointer"
                title="Copy Left Channel EQ curve onto Right Channel"
              >
                <Copy className="w-3 h-3" />
                COPY L &rarr; R
              </button>
              <button
                type="button"
                onClick={handleCopyRtoL}
                className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-[10px] text-violet-300 flex items-center gap-1 cursor-pointer"
                title="Copy Right Channel EQ curve onto Left Channel"
              >
                <Copy className="w-3 h-3" />
                COPY R &rarr; L
              </button>
            </div>
          )}
        </div>

        {/* Preset Curve Pills Bar */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-[10px] uppercase text-slate-400 mr-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            Curves:
          </span>
          {PRESET_CURVES.map((curve) => (
            <button
              key={curve.id}
              type="button"
              disabled={panelLocked}
              onClick={() => handleApplyPreset(curve)}
              title={curve.description}
              className="px-2 py-0.5 rounded border border-slate-800 bg-[#0E1420] hover:border-cyan-500/40 hover:bg-[#131D2E] text-[10px] font-mono text-slate-300 transition-colors disabled:opacity-40 cursor-pointer"
            >
              {curve.name}
            </button>
          ))}
        </div>
      </div>
        </>
      )}

      {/* Real-Time SVG Frequency Response Display */}
      <div
        className={`relative rounded-md border border-slate-800 bg-[#05080F] ${
          compactConsoleMode ? 'px-2 py-1 shrink-0' : 'p-2.5'
        } overflow-hidden shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]`}
      >
        <div className="flex items-center justify-between font-mono text-[9px] mb-0.5">
          <div className="flex items-center gap-3">
            <span className="text-cyan-400 font-semibold tracking-wider flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
              CH 1 / LEFT TRANSFER CURVE
            </span>
            {!isLinked && (
              <span className="text-violet-400 font-semibold tracking-wider flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.8)]" />
                CH 2 / RIGHT TRANSFER CURVE
              </span>
            )}
          </div>
          <span className="text-slate-500 font-mono">Range: ±{rangeMode} dB</span>
        </div>

        <svg
          viewBox="0 0 860 90"
          className={`w-full ${compactConsoleMode ? 'h-8' : 'h-20'} overflow-visible mt-0.5`}
        >
          {/* Horizontal Grid lines */}
          <line x1={0} y1={12} x2={860} y2={12} stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
          <line x1={0} y1={45} x2={860} y2={45} stroke="rgba(148,163,184,0.3)" />
          <line x1={0} y1={78} x2={860} y2={78} stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />

          {/* Vertical frequency tick lines */}
          {[0, 6, 12, 18, 24, 30].map((idx) => {
            const x = 14 + (idx / 30) * (860 - 28);
            return (
              <line
                key={idx}
                x1={x}
                y1={0}
                x2={x}
                y2={90}
                stroke="rgba(148,163,184,0.08)"
              />
            );
          })}

          {/* Right Curve when Independent */}
          {!isLinked && (
            <path
              d={curveRight}
              fill="none"
              stroke="#A78BFA"
              strokeWidth={2}
              strokeDasharray="4 2"
              opacity={0.8}
            />
          )}

          {/* Left / Active EQ Glow Curve */}
          <path
            d={curveLeft}
            fill="none"
            stroke={eqConfig.enabled && !dsp.bypassed ? '#06B6D4' : '#F59E0B'}
            strokeWidth={2.5}
            className="filter drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]"
          />

          {/* Data Points */}
          {currentBands.map((band, idx) => {
            const x = 14 + (idx / 30) * (860 - 28);
            const normalizedGain = band.gainDb / rangeMode;
            const y = 45 - normalizedGain * (90 * 0.42);
            return (
              <circle
                key={band.hz}
                cx={x}
                cy={y}
                r={band.gainDb !== 0 ? 3 : 1.5}
                fill={
                  activeTab === 'R' && !isLinked
                    ? '#A78BFA'
                    : eqConfig.enabled && !dsp.bypassed
                      ? '#38BDF8'
                      : '#F59E0B'
                }
              />
            );
          })}
        </svg>
      </div>

      {/* 31 Vertical Precision Faders with Neon Lighting & Tactile Drag */}
      <div
        className={`relative rounded-lg border border-slate-800 bg-[#05070E] ${
          compactConsoleMode ? 'flex-1 min-h-0 p-1.5 flex items-center' : 'p-3'
        } shadow-inner overflow-x-auto`}
      >
        <div
          className={`flex items-end justify-between w-full ${
            compactConsoleMode ? 'gap-0.5 px-0.5' : 'min-w-[850px] gap-1 px-1'
          }`}
        >
          {currentBands.map((band, idx) => {
            const isKeyFreq =
              band.hz === 63 ||
              band.hz === 125 ||
              band.hz === 250 ||
              band.hz === 500 ||
              band.hz === 1000 ||
              band.hz === 2000 ||
              band.hz === 4000 ||
              band.hz === 8000 ||
              band.hz === 16000;

            const bandHz = band.hz ?? ISO_31_FREQUENCIES[idx] ?? 1000;
            const bandAccent =
              activeTab === 'R' && !isLinked
                ? 'fuchsia'
                : bandHz <= 63
                  ? 'fuchsia'
                  : bandHz <= 250
                    ? 'amber'
                    : bandHz <= 2500
                      ? 'emerald'
                      : 'cyan';

            return (
              <PrecisionVerticalFader
                key={band.hz}
                value={band.gainDb}
                min={-rangeMode}
                max={rangeMode}
                step={0.5}
                label={formatFreqLabel(band.hz)}
                subLabel={`${band.hz} Hz`}
                disabled={panelLocked}
                isKeyFreq={isKeyFreq}
                trackHeightClass={compactConsoleMode ? 'h-28' : 'h-44'}
                compact={compactConsoleMode}
                accent={bandAccent}
                onChange={(nextVal) => handleBandChange(idx, nextVal)}
                onDoubleClick={() => handleBandChange(idx, 0)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
