import React, { useEffect, useRef, useState } from 'react';

export interface VerticalVuMeterProps {
  label: string;
  levelDb: number;
  peakDb?: number;
  muted?: boolean;
  height?: number;
  minDb?: number;
  maxDb?: number;
  tone?: 'pre' | 'post' | 'gr';
  showScale?: boolean;
  inverted?: boolean;
}

const SCALE_TICKS = [
  { db: 0, label: '0' },
  { db: -6, label: '-6' },
  { db: -12, label: '-12' },
  { db: -24, label: '-24' },
  { db: -48, label: '-48' },
];

export const VerticalVuMeter: React.FC<VerticalVuMeterProps> = ({
  label,
  levelDb,
  peakDb,
  muted = false,
  height = 166,
  minDb = -64,
  maxDb = 0,
  tone = 'post',
  showScale = false,
  inverted = false,
}) => {
  const effectivePeak = peakDb !== undefined ? Math.max(levelDb, peakDb) : levelDb;
  const [heldPeakDb, setHeldPeakDb] = useState<number>(minDb);
  const lastDecayTsRef = useRef<number>(0);

  useEffect(() => {
    if (muted || effectivePeak <= minDb + 0.5) {
      setHeldPeakDb(minDb);
      return;
    }

    const now = performance.now();
    const dtSec = lastDecayTsRef.current ? Math.min(0.5, (now - lastDecayTsRef.current) / 1000) : 0.06;
    lastDecayTsRef.current = now;

    setHeldPeakDb((prev) => {
      if (effectivePeak >= prev) return effectivePeak;
      const decayed = prev - dtSec * 12; // ~12 dB/s broadcast peak release
      return Math.max(effectivePeak, minDb, decayed);
    });
  }, [effectivePeak, muted, minDb]);

  // Inverted Gain Reduction Meter Mode (0 dB at top down to -24 dB)
  if (inverted) {
    const grRange = 24;
    const grVal = muted ? 0 : Math.max(0, Math.min(grRange, Math.abs(levelDb)));
    const grPct = (grVal / grRange) * 100;
    const heavyGr = !muted && grVal >= 8;

    return (
      <div
        className="flex flex-col items-center gap-1 select-none shrink-0"
        title={`${label}: -${grVal.toFixed(1)} dB Gain Reduction`}
      >
        {/* Status / Overload LED */}
        <div
          className={`w-3.5 h-1.5 rounded-full transition-colors ${
            heavyGr
              ? 'bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.85)]'
              : 'bg-slate-800'
          }`}
        />

        <div
          style={{ height }}
          aria-label={`${label} Gain Reduction Meter: -${grVal.toFixed(1)} dB`}
          className="relative w-3.5 rounded-xs bg-[#05080D] border border-slate-800 overflow-hidden"
        >
          <div
            className="absolute top-0 inset-x-0 transition-[height] duration-75 ease-out"
            style={{
              height: `${grPct.toFixed(2)}%`,
              background:
                'linear-gradient(to bottom, #F59E0B 0%, #F97316 65%, #EF4444 100%)',
              boxShadow: grVal > 0.3 ? '0 0 8px rgba(245, 158, 11, 0.45)' : 'none',
            }}
          />
          {/* Segmented LED Grid Mask */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to bottom, transparent 0px, transparent 5px, rgba(5,8,13,0.92) 5px, rgba(5,8,13,0.92) 7px)',
            }}
          />
        </div>

        <span className="font-mono text-[8px] font-semibold uppercase tracking-wider text-amber-400 leading-none">
          {label}
        </span>
        <span className="w-[5.5ch] text-center font-mono text-[9px] tabular-nums text-amber-300 leading-none">
          {muted ? 'MUTE' : `-${grVal.toFixed(1)}`}
        </span>
      </div>
    );
  }

  const span = Math.max(1, maxDb - minDb);
  const silent = muted || levelDb <= minDb + 0.5;
  const pct = silent
    ? 0
    : Math.max(0, Math.min(100, ((levelDb - minDb) / span) * 100));
  const peakPct =
    muted || heldPeakDb <= minDb + 0.5
      ? 0
      : Math.max(0, Math.min(98.5, ((heldPeakDb - minDb) / span) * 100));

  const isClip = !muted && (heldPeakDb > -1.5 || effectivePeak > -1.5);
  const isWarm = !muted && levelDb > -14;

  const fillGradient =
    tone === 'pre'
      ? 'linear-gradient(to top, #0284C7 0%, #38BDF8 52%, #10B981 68%, #F59E0B 84%, #EF4444 96%)'
      : 'linear-gradient(to top, #059669 0%, #10B981 48%, #34D399 66%, #F59E0B 82%, #EF4444 96%)';

  const labelToneClass =
    tone === 'pre' ? 'text-slate-300' : 'text-sky-400';
  const readoutToneClass = muted
    ? 'text-red-400'
    : isClip
      ? 'text-red-300'
      : isWarm
        ? 'text-amber-300'
        : tone === 'pre'
          ? 'text-slate-200'
          : 'text-sky-400';

  return (
    <div
      className="flex flex-col items-center gap-1 select-none shrink-0"
      title={`${label}: ${silent ? '-∞' : `${levelDb.toFixed(1)} dBFS`} (Peak ${heldPeakDb <= minDb + 0.5 ? '-∞' : `${heldPeakDb.toFixed(1)} dBFS`})`}
    >
      {/* Peak Clip LED */}
      <div
        className={`w-3.5 h-1.5 rounded-full transition-colors ${
          isClip
            ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]'
            : 'bg-slate-800'
        }`}
      />

      <div className="flex items-stretch gap-1">
        {showScale && (
          <div
            style={{ height }}
            className="relative w-5 flex flex-col justify-between py-0.5 font-mono text-[8px] tabular-nums text-slate-500 text-right pr-0.5 pointer-events-none"
            aria-hidden="true"
          >
            {SCALE_TICKS.map((tick) => {
              const topPct = Math.max(0, Math.min(100, ((maxDb - tick.db) / span) * 100));
              return (
                <span
                  key={tick.db}
                  style={{ top: `${topPct.toFixed(1)}%` }}
                  className="absolute right-0.5 -translate-y-1/2 leading-none"
                >
                  {tick.label}
                </span>
              );
            })}
          </div>
        )}

        {/* Recessed Vertical VU Column */}
        <div
          role="meter"
          aria-label={`${label} VU Meter`}
          aria-valuemin={minDb}
          aria-valuemax={maxDb}
          aria-valuenow={Number(levelDb.toFixed(1))}
          style={{ height }}
          className="relative w-3.5 rounded-xs bg-[#05080D] border border-slate-800 overflow-hidden"
        >
          {/* Active Bar Fill */}
          <div
            className="absolute bottom-0 inset-x-0 transition-[height] duration-75 ease-out"
            style={{
              height: `${pct.toFixed(2)}%`,
              background: fillGradient,
              filter: muted
                ? 'brightness(0.35)'
                : isClip
                  ? 'brightness(1.25) saturate(1.15)'
                  : isWarm
                    ? 'brightness(1.12)'
                    : 'none',
              boxShadow:
                pct > 8 && !muted
                  ? tone === 'pre'
                    ? '0 0 7px rgba(56, 189, 248, 0.35)'
                    : '0 0 7px rgba(16, 185, 129, 0.42)'
                  : 'none',
            }}
          />

          {/* Segmented LED Mask */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to top, transparent 0px, transparent 5px, rgba(5,8,13,0.92) 5px, rgba(5,8,13,0.92) 7px)',
            }}
          />

          {/* Ballistic Peak-Hold Indicator */}
          <div
            className="absolute inset-x-0 h-[2px] pointer-events-none transition-[bottom,opacity] duration-75 ease-out"
            style={{
              bottom: `${peakPct.toFixed(2)}%`,
              opacity: muted || peakPct < 2 ? 0 : 1,
              backgroundColor: isClip ? '#FCA5A5' : isWarm ? '#FDE68A' : '#A7F3D0',
            }}
          />
        </div>
      </div>

      {/* Fixed-Width Label & Numeric Readout (Zero Horizontal Jitter) */}
      <span className={`font-mono text-[8px] font-semibold uppercase tracking-wider leading-none ${labelToneClass}`}>
        {label}
      </span>
      <span className={`w-[5.5ch] text-center font-mono text-[9px] tabular-nums leading-none ${readoutToneClass}`}>
        {muted ? 'MUTE' : levelDb <= minDb + 1 ? '-∞' : levelDb.toFixed(1)}
      </span>
    </div>
  );
};
