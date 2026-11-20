import React, { useMemo, useState } from 'react';
import { Sliders, RotateCcw, Zap, Sparkles, Volume2, Shield } from 'lucide-react';
import type { DspConfig, GraphicEq31Config } from '../types/audio.ts';
import { ISO_31_FREQUENCIES } from '../types/audio.ts';
import { ConsolePushButton } from './StudioControls.tsx';

interface StereoGraphicEqModuleProps {
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  panelLocked?: boolean;
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
    id: 'speech-clarity',
    name: 'SPEECH CLARITY',
    description: 'Reduces pulpit boominess & chest resonance (-3dB @ 250Hz) and boosts speech presence (+2.5dB @ 2.5kHz-4kHz)',
    apply: () => {
      return ISO_31_FREQUENCIES.map((hz) => {
        if (hz < 63) return -9;
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
    name: 'SANCTUARY NOTCH TRAP',
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
        if (hz < 50) return -4;
        if (hz >= 6300 && hz <= 16000) return 3.0;
        return 0;
      });
    },
  },
  {
    id: 'sub-punch',
    name: 'PUNCHY SUBS / CLEAN LOWS',
    description: 'Tight sub punch (+3dB @ 63-100Hz) with aggressive sub-sonic rumble filtering below 40Hz',
    apply: () => {
      return ISO_31_FREQUENCIES.map((hz) => {
        if (hz <= 31.5) return -12;
        if (hz === 40) return -4;
        if (hz >= 63 && hz <= 100) return 3.5;
        if (hz === 250) return -2;
        return 0;
      });
    },
  },
];

export const StereoGraphicEqModule: React.FC<StereoGraphicEqModuleProps> = ({
  dsp,
  onUpdateDsp,
  panelLocked = false,
}) => {
  const [rangeMode, setRangeMode] = useState<6 | 12>(12);
  const eqConfig: GraphicEq31Config = useMemo(() => {
    if (dsp.graphicEq31 && dsp.graphicEq31.bands && dsp.graphicEq31.bands.length === 31) {
      return dsp.graphicEq31;
    }
    return {
      enabled: true,
      rangeDb: rangeMode,
      bands: ISO_31_FREQUENCIES.map((freq) => ({
        hz: freq,
        gainDb: 0,
      })),
    };
  }, [dsp.graphicEq31, rangeMode]);

  const handleBandChange = (index: number, newGainDb: number) => {
    if (panelLocked) return;
    const clamped = Math.max(-rangeMode, Math.min(rangeMode, newGainDb));
    const nextBands = eqConfig.bands.map((b, i) =>
      i === index ? { ...b, gainDb: clamped } : b
    );
    onUpdateDsp({
      graphicEq31: {
        ...eqConfig,
        bands: nextBands,
      },
    });
  };

  const handleApplyPreset = (preset: typeof PRESET_CURVES[0]) => {
    if (panelLocked) return;
    const gains = preset.apply();
    const nextBands = eqConfig.bands.map((b, i) => ({
      ...b,
      gainDb: Math.max(-rangeMode, Math.min(rangeMode, gains[i] ?? 0)),
    }));
    onUpdateDsp({
      graphicEq31: {
        ...eqConfig,
        bands: nextBands,
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

  const formatFreqLabel = (hz: number) => {
    if (hz >= 1000) {
      return `${(hz / 1000).toString().replace('.0', '')}k`;
    }
    return `${hz}`;
  };

  // SVG Response curve calculations
  const curvePoints = useMemo(() => {
    const width = 860;
    const height = 90;
    const paddingX = 14;
    const availableWidth = width - paddingX * 2;
    const baselineY = height / 2;

    const coords = eqConfig.bands.map((band, idx) => {
      const x = paddingX + (idx / 30) * availableWidth;
      const normalizedGain = band.gainDb / rangeMode; // -1 to +1
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
  }, [eqConfig.bands, rangeMode]);

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-[#0B0F17] p-4 text-slate-200">
      {/* Top Header Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-cyan-400">PRO EQ-31</span>
              <h2 className="font-display text-base font-semibold text-white tracking-tight">
                31-Band Stereo Graphic Equalizer (ISO 1/3-Octave Standard)
              </h2>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              Constant-Q (4.31) Precision Filters · Post-Master Dynamics · Acoustic Room Tuning
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          {/* Range Selector: +/-12dB or +/-6dB */}
          <div className="flex items-center rounded border border-slate-800 bg-[#070A10] p-0.5">
            <button
              type="button"
              onClick={() => setRangeMode(12)}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${
                rangeMode === 12
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ±12 dB (FOH)
            </button>
            <button
              type="button"
              onClick={() => setRangeMode(6)}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${
                rangeMode === 6
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
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
            className="px-2.5 py-1 rounded border border-slate-700 bg-[#121824] hover:bg-slate-800 text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-40"
          >
            <RotateCcw className="w-3 h-3 text-cyan-400" />
            <span>FLAT RESET</span>
          </button>

          {/* Bypass / Active Toggle */}
          <ConsolePushButton
            label={eqConfig.enabled && !dsp.bypassed ? 'EQ-31 ACTIVE' : 'EQ-31 BYPASS'}
            active={eqConfig.enabled && !dsp.bypassed}
            tone={eqConfig.enabled && !dsp.bypassed ? 'emerald' : 'amber'}
            onClick={handleToggleEnabled}
          />
        </div>
      </div>

      {/* Preset Curve Pills Bar */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="font-mono text-[10px] uppercase text-slate-400 mr-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-cyan-400" />
          Acoustic Profiles:
        </span>
        {PRESET_CURVES.map((curve) => (
          <button
            key={curve.id}
            type="button"
            disabled={panelLocked}
            onClick={() => handleApplyPreset(curve)}
            title={curve.description}
            className="px-2 py-0.5 rounded border border-slate-800 bg-[#0E1420] hover:border-cyan-500/40 hover:bg-[#131D2E] text-[10px] font-mono text-slate-300 transition-colors disabled:opacity-40"
          >
            {curve.name}
          </button>
        ))}
      </div>

      {/* Real-Time SVG Frequency Response Display */}
      <div className="relative rounded-md border border-slate-800 bg-[#070A10] p-2 overflow-hidden shadow-inner">
        <div className="absolute top-1.5 left-2 font-mono text-[9px] text-cyan-400/80 font-semibold tracking-wider">
          LIVE EQUALIZATION TRANSFER CURVE (20 Hz — 20 kHz)
        </div>
        <div className="absolute top-1.5 right-2 font-mono text-[9px] text-slate-500">
          Range: ±{rangeMode} dB
        </div>

        <svg viewBox="0 0 860 90" className="w-full h-20 overflow-visible mt-2">
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

          {/* Active EQ Glow Curve */}
          <path
            d={curvePoints}
            fill="none"
            stroke={eqConfig.enabled && !dsp.bypassed ? '#06B6D4' : '#F59E0B'}
            strokeWidth={2.5}
            className="filter drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]"
          />

          {/* Data Points */}
          {eqConfig.bands.map((band, idx) => {
            const x = 14 + (idx / 30) * (860 - 28);
            const normalizedGain = band.gainDb / rangeMode;
            const y = 45 - normalizedGain * (90 * 0.42);
            return (
              <circle
                key={band.hz}
                cx={x}
                cy={y}
                r={band.gainDb !== 0 ? 3 : 1.5}
                fill={eqConfig.enabled && !dsp.bypassed ? '#38BDF8' : '#F59E0B'}
              />
            );
          })}
        </svg>
      </div>

      {/* 31 Vertical Precision Fader Strip */}
      <div className="relative rounded-md border border-slate-800 bg-[#080C14] p-3 overflow-x-auto">
        <div className="flex items-end justify-between min-w-[820px] gap-1 px-1">
          {eqConfig.bands.map((band, idx) => {
            const isZero = band.gainDb === 0;
            const isBoost = band.gainDb > 0;
            const isCut = band.gainDb < 0;
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

            return (
              <div
                key={band.hz}
                className="flex-1 flex flex-col items-center group relative select-none"
              >
                {/* Real-time gain value readout */}
                <span
                  className={`font-mono text-[9px] mb-1 font-semibold tabular-nums h-4 flex items-center ${
                    isZero
                      ? 'text-slate-500'
                      : isBoost
                        ? 'text-cyan-400 font-bold'
                        : 'text-amber-400 font-bold'
                  }`}
                >
                  {band.gainDb > 0 ? `+${band.gainDb.toFixed(1)}` : band.gainDb === 0 ? '0' : band.gainDb.toFixed(1)}
                </span>

                {/* Vertical Slider Track Container */}
                <div className="relative h-44 w-5 flex items-center justify-center bg-[#05080E] border border-slate-800/80 rounded">
                  {/* Center zero detent line */}
                  <div className="absolute top-1/2 left-0 right-0 h-[1.5px] bg-slate-600/70 z-0" />

                  {/* +6dB / -6dB guide marks */}
                  <div className="absolute top-[28%] left-1 right-1 h-[1px] bg-slate-800 z-0" />
                  <div className="absolute top-[72%] left-1 right-1 h-[1px] bg-slate-800 z-0" />

                  {/* Active travel fill bar */}
                  <div
                    className={`absolute w-1 rounded-xs transition-all pointer-events-none ${
                      isBoost ? 'bg-cyan-400/60 shadow-[0_0_6px_rgba(6,182,212,0.6)]' : isCut ? 'bg-amber-400/60' : 'bg-transparent'
                    }`}
                    style={{
                      top: isBoost ? `${50 - (band.gainDb / rangeMode) * 44}%` : '50%',
                      bottom: isCut ? `${50 + (band.gainDb / rangeMode) * 44}%` : '50%',
                    }}
                  />

                  {/* HTML Range Input styled vertically */}
                  <input
                    type="range"
                    min={-rangeMode}
                    max={rangeMode}
                    step={0.5}
                    value={band.gainDb}
                    disabled={panelLocked}
                    onChange={(e) => handleBandChange(idx, parseFloat(e.target.value))}
                    onDoubleClick={() => handleBandChange(idx, 0)}
                    title={`${band.hz} Hz: ${band.gainDb > 0 ? '+' : ''}${band.gainDb.toFixed(1)} dB (Double-click to reset)`}
                    aria-label={`${band.hz} Hz Gain`}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    style={{
                      WebkitAppearance: 'slider-vertical',
                      appearance: 'none',
                    }}
                  />

                  {/* Visual Physical Fader Thumb Knob */}
                  <div
                    className={`absolute w-4 h-2.5 rounded-xs border shadow-md pointer-events-none transition-transform z-10 flex items-center justify-center ${
                      isBoost
                        ? 'bg-gradient-to-b from-cyan-400 to-cyan-600 border-cyan-300'
                        : isCut
                          ? 'bg-gradient-to-b from-amber-400 to-amber-600 border-amber-300'
                          : 'bg-gradient-to-b from-slate-600 to-slate-800 border-slate-500'
                    }`}
                    style={{
                      top: `calc(${50 - (band.gainDb / rangeMode) * 44}% - 5px)`,
                    }}
                  >
                    <div className="w-2.5 h-[1px] bg-white/80" />
                  </div>
                </div>

                {/* Frequency Band Label */}
                <span
                  className={`font-mono text-[9px] mt-1.5 transition-colors ${
                    isKeyFreq
                      ? 'text-white font-bold'
                      : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                >
                  {formatFreqLabel(band.hz)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
