import React, { useCallback, useRef } from 'react';

interface PrecisionVerticalFaderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  subLabel?: string;
  disabled?: boolean;
  accent?: 'cyan' | 'amber' | 'emerald' | 'sky' | 'fuchsia' | 'slate';
  isKeyFreq?: boolean;
  trackHeightClass?: string;
  compact?: boolean;
  onChange: (val: number) => void;
  onDoubleClick?: () => void;
}

export const PrecisionVerticalFader: React.FC<PrecisionVerticalFaderProps> = ({
  value,
  min,
  max,
  step = 0.5,
  label,
  subLabel,
  disabled = false,
  accent = 'cyan',
  isKeyFreq = false,
  trackHeightClass = 'h-44',
  compact = false,
  onChange,
  onDoubleClick,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);

  const clamped = Math.max(min, Math.min(max, value));
  const norm = max === min ? 0.5 : (clamped - min) / (max - min); // 0 (min) to 1 (max)
  const isDormant = accent === 'slate';
  const isZero = !isDormant && Math.abs(clamped) < 0.05;
  const isBoost = !isDormant && clamped > 0.05;
  const isCut = !isDormant && clamped < -0.05;
  const absGainRatio = Math.min(1, Math.abs(clamped) / Math.max(1, Math.max(Math.abs(min), Math.abs(max))));

  const updateFromY = useCallback(
    (clientY: number, rect: DOMRect) => {
      const offsetY = clientY - rect.top;
      // Invert: top = +max gain, bottom = -min gain
      const ratio = Math.max(0, Math.min(1, 1 - offsetY / rect.height));
      const raw = min + ratio * (max - min);

      // Snap to 0 dB detent if close
      const detentMargin = (max - min) * 0.035;
      let target = Math.abs(raw) <= detentMargin ? 0 : Math.round(raw / step) * step;
      target = Math.max(min, Math.min(max, Number(target.toFixed(1))));
      onChange(target);
    },
    [max, min, onChange, step]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    isDraggingRef.current = true;
    updateFromY(e.clientY, rect);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || disabled || e.buttons !== 1) {
      if (isDraggingRef.current && e.buttons !== 1) isDraggingRef.current = false;
      return;
    }
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    updateFromY(e.clientY, rect);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = Math.max(min, Math.min(max, Number((clamped + dir * step).toFixed(1))));
    onChange(next);
  };

  const handleReset = (e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    if (onDoubleClick) {
      onDoubleClick();
    } else {
      onChange(0);
    }
  };

  const topPercent = (1 - norm) * 100;

  // Visual lighting palette
  const theme =
    accent === 'amber'
      ? {
          glow: 'rgba(245,158,11,0.7)',
          fill: 'bg-amber-400',
          text: 'text-amber-400',
          border: 'border-amber-500/50',
          ledHex: '#F59E0B',
        }
      : accent === 'emerald'
        ? {
            glow: 'rgba(16,185,129,0.7)',
            fill: 'bg-emerald-400',
            text: 'text-emerald-400',
            border: 'border-emerald-500/50',
            ledHex: '#10B981',
          }
        : accent === 'fuchsia'
          ? {
              glow: 'rgba(217,70,239,0.7)',
              fill: 'bg-fuchsia-400',
              text: 'text-fuchsia-400',
              border: 'border-fuchsia-500/50',
              ledHex: '#D946EF',
            }
          : {
              glow: 'rgba(6,182,212,0.75)',
              fill: 'bg-cyan-400',
              text: 'text-cyan-400',
              border: 'border-cyan-500/50',
              ledHex: '#06B6D4',
            };

  return (
    <div
      className={`flex flex-col items-center select-none group relative ${
        compact ? 'flex-1 min-w-[18px] max-w-[28px]' : 'w-6 sm:w-7'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      onWheel={handleWheel}
      title={`${subLabel || label || ''}: ${clamped > 0 ? '+' : ''}${clamped.toFixed(1)} dB (Click/drag to slide, double-click to reset)`}
    >
      {/* Top LED Optical Indicator Dot */}
      {!compact && (
        <div
          className="w-1.5 h-1.5 rounded-full mb-1 transition-all duration-150"
          style={{
            backgroundColor: isDormant
              ? 'rgba(71,85,105,0.25)'
              : isBoost
                ? theme.ledHex
                : isCut
                  ? '#F59E0B'
                  : 'rgba(100,116,139,0.4)',
            boxShadow: isDormant
              ? 'none'
              : isBoost || isCut
                ? `0 0 6px ${isBoost ? theme.glow : 'rgba(245,158,11,0.7)'}`
                : 'none',
          }}
        />
      )}

      {/* Real-time gain numeric display above fader */}
      <span
        className={`font-mono ${compact ? 'text-[8px] mb-0.5 h-3.5' : 'text-[9px] mb-1 h-4'} font-semibold tabular-nums flex items-center justify-center transition-colors ${
          isDormant
            ? 'text-slate-600'
            : isZero
              ? 'text-slate-500'
              : isBoost
                ? `${theme.text} font-bold drop-shadow-[0_0_4px_rgba(6,182,212,0.4)]`
                : 'text-amber-400 font-bold'
        }`}
      >
        {isDormant ? '--' : isBoost ? `+${clamped.toFixed(1)}` : isZero ? '0.0' : clamped.toFixed(1)}
      </span>

      {/* Futuristic Backlit Fader Track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleReset}
        className={`relative ${trackHeightClass} ${
          compact ? 'w-4' : 'w-5 sm:w-5.5'
        } rounded-sm bg-[#04070D] border border-slate-800/90 shadow-[inset_0_2px_8px_rgba(0,0,0,0.95)] flex items-center justify-center touch-none overflow-visible`}
        style={{
          boxShadow: isDormant
            ? 'inset 0 2px 8px rgba(0,0,0,0.95)'
            : isBoost
              ? `inset 0 0 8px rgba(0,0,0,0.9), 0 0 ${Math.round(absGainRatio * 8)}px ${theme.glow}`
              : isCut
                ? `inset 0 0 8px rgba(0,0,0,0.9), 0 0 ${Math.round(absGainRatio * 6)}px rgba(245,158,11,0.4)`
                : 'inset 0 2px 8px rgba(0,0,0,0.95)',
        }}
      >
        {/* Center 0 dB detent line */}
        <div className="absolute top-1/2 left-0 right-0 h-[1.5px] bg-slate-500/80 z-0 pointer-events-none" />

        {/* Reference marks (+6dB and -6dB) */}
        <div className="absolute top-[25%] left-0.5 right-0.5 h-[1px] bg-slate-800/90 z-0 pointer-events-none" />
        <div className="absolute top-[75%] left-0.5 right-0.5 h-[1px] bg-slate-800/90 z-0 pointer-events-none" />

        {/* Center vertical slit with neon channel groove */}
        <div className="absolute top-2 bottom-2 w-1.5 rounded-full bg-[#020306] border-x border-slate-800/70 z-0 pointer-events-none" />

        {/* Illuminated LED light strip inside track slit (omitted when dormant slate) */}
        {!isDormant && (
          <div
            className={`absolute w-1 rounded-full pointer-events-none transition-all duration-75 ${
              isBoost
                ? `${theme.fill}`
                : isCut
                  ? 'bg-amber-400'
                  : 'bg-transparent'
            }`}
            style={{
              top: isBoost ? `${topPercent}%` : '50%',
              bottom: isCut ? `${100 - topPercent}%` : '50%',
              boxShadow: isBoost
                ? `0 0 10px ${theme.ledHex}, 0 0 2px #fff`
                : isCut
                  ? '0 0 10px #F59E0B, 0 0 2px #fff'
                  : 'none',
            }}
          />
        )}

        {/* Studio-Grade Sculpted Metallic Fader Cap with Laser-Cut Illuminated Line */}
        <div
          className={`absolute left-[-5px] right-[-5px] h-5 rounded-xs bg-gradient-to-b from-[#4A5568] via-[#2D3748] to-[#1A202C] border-2 ${
            isDormant ? 'border-slate-700/75' : 'border-slate-300/80 group-hover:border-white'
          } shadow-[0_4px_12px_rgba(0,0,0,0.95),inset_0_1px_2px_rgba(255,255,255,0.4)] flex items-center justify-center z-10 pointer-events-none transition-transform active:scale-105`}
          style={{
            top: `${topPercent}%`,
            transform: 'translateY(-50%)',
          }}
        >
          {/* Laser-etched glowing center line on fader knob */}
          <div
            className="w-full h-[2px] transition-all shadow-sm"
            style={{
              backgroundColor: isDormant
                ? '#475569'
                : isZero
                  ? '#FFFFFF'
                  : isBoost
                    ? theme.ledHex
                    : '#F59E0B',
              boxShadow: isDormant
                ? 'none'
                : isBoost
                  ? `0 0 6px ${theme.glow}`
                  : isCut
                    ? '0 0 6px rgba(245,158,11,0.8)'
                    : '0 0 4px rgba(255,255,255,0.8)',
            }}
          />
        </div>
      </div>

      {/* Frequency / Axis Label under fader */}
      {label && (
        <span
          className={`font-mono text-[9px] mt-1.5 transition-colors text-center ${
            isKeyFreq
              ? 'text-white font-bold bg-[#141C2B] px-1 py-0.5 rounded border border-slate-700'
              : 'text-slate-400 group-hover:text-slate-200'
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
};
