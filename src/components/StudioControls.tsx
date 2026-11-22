import React, { useCallback, useId, useRef } from 'react';
export { VerticalVuMeter, type VerticalVuMeterProps } from './VerticalVuMeter.tsx';

interface RotaryKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  unit?: string;
  size?: number;
  accent?: 'sky' | 'emerald' | 'amber' | 'red' | 'fuchsia' | 'slate';
  disabled?: boolean;
  formatValue?: (val: number) => string;
  onChange: (next: number) => void;
}

const ACCENT_COLORS = {
  sky: { stroke: '#38BDF8', glow: 'rgba(56,189,248,0.45)', text: 'text-sky-400' },
  emerald: { stroke: '#10B981', glow: 'rgba(16,185,129,0.45)', text: 'text-emerald-400' },
  amber: { stroke: '#F59E0B', glow: 'rgba(245,158,11,0.45)', text: 'text-amber-400' },
  red: { stroke: '#EF4444', glow: 'rgba(239,68,68,0.45)', text: 'text-red-400' },
  fuchsia: { stroke: '#D946EF', glow: 'rgba(217,70,239,0.45)', text: 'text-fuchsia-400' },
  slate: { stroke: '#334155', glow: 'transparent', text: 'text-slate-600' },
};

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  label,
  value,
  min,
  max,
  step = 0.5,
  defaultValue,
  unit = '',
  size = 54,
  accent = 'sky',
  disabled = false,
  formatValue,
  onChange,
}) => {
  const uid = useId().replace(/:/g, '');
  const gradId = `knob-cap-${uid}`;
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);
  const clamped = Math.max(min, Math.min(max, value));
  const norm = max === min ? 0 : (clamped - min) / (max - min);

  // Sweep from -135 deg to +135 deg (270 deg total)
  const startAngle = -135;
  const endAngle = 135;
  const currentAngle = startAngle + norm * (endAngle - startAngle);

  const cx = size / 2;
  const cy = size / 2;
  const ringRadius = size * 0.41;
  const capRadius = size * 0.29;

  const polarToCartesian = (angleDeg: number, r: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (fromDeg: number, toDeg: number, r: number) => {
    if (Math.abs(toDeg - fromDeg) < 0.5) return '';
    const start = polarToCartesian(toDeg, r);
    const end = polarToCartesian(fromDeg, r);
    const largeArc = toDeg - fromDeg <= 180 ? '0' : '1';
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  };

  const snapStep = useCallback(
    (raw: number) => {
      const stepped = Math.round(raw / step) * step;
      return Math.max(min, Math.min(max, Number(stepped.toFixed(2))));
    },
    [min, max, step]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startVal: clamped };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || disabled) return;
    const dy = dragRef.current.startY - e.clientY;
    const range = max - min;
    const sensitivity = e.shiftKey ? 360 : 140;
    const delta = (dy / sensitivity) * range;
    onChange(snapStep(dragRef.current.startVal + delta));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragRef.current = null;
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    onChange(snapStep(clamped + dir * step));
  };

  const handleDoubleClick = () => {
    if (disabled || defaultValue === undefined) return;
    onChange(snapStep(defaultValue));
  };

  const indicatorStart = polarToCartesian(currentAngle, capRadius * 0.28);
  const indicatorEnd = polarToCartesian(currentAngle, capRadius * 0.85);
  const colors = ACCENT_COLORS[accent];

  const displayStr = formatValue
    ? formatValue(clamped)
    : `${clamped > 0 && min < 0 ? '+' : ''}${Number.isInteger(step) ? clamped.toFixed(0) : clamped.toFixed(1)}${unit ? ` ${unit}` : ''}`;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-disabled={disabled || undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            onChange(snapStep(clamped + step));
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            onChange(snapStep(clamped - step));
          }
        }}
        title={`${label}: ${displayStr} (Drag vertically or scroll; double-click to reset)`}
        className={`relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
          disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-ns-resize'
        }`}
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <defs>
            <radialGradient id={gradId} cx="38%" cy="32%" r="70%">
              <stop offset="0%" stopColor="#3B4559" />
              <stop offset="55%" stopColor="#1E2533" />
              <stop offset="100%" stopColor="#0E121A" />
            </radialGradient>
          </defs>

          {/* Track Background Arc */}
          <path
            d={describeArc(startAngle, endAngle, ringRadius)}
            fill="none"
            stroke={accent === 'slate' ? 'rgba(100,116,139,0.14)' : 'rgba(148,163,184,0.18)'}
            strokeWidth={3.2}
            strokeLinecap="round"
          />

          {/* Active Glowing LED Arc (omitted when dormant slate) */}
          {accent !== 'slate' && (
            <path
              d={describeArc(startAngle, currentAngle, ringRadius)}
              fill="none"
              stroke={accent === 'sky' ? 'var(--theme-accent, #38BDF8)' : colors.stroke}
              strokeWidth={3.2}
              strokeLinecap="round"
              style={{
                filter:
                  accent === 'sky'
                    ? 'drop-shadow(0 0 4px var(--theme-accent-glow, rgba(56,189,248,0.45)))'
                    : `drop-shadow(0 0 4px ${colors.glow})`,
              }}
            />
          )}

          {/* Tick notches */}
          {[-135, -67.5, 0, 67.5, 135].map((deg) => {
            const p1 = polarToCartesian(deg, ringRadius + 4);
            const p2 = polarToCartesian(deg, ringRadius + 6);
            return (
              <line
                key={deg}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={accent === 'slate' ? 'rgba(100,116,139,0.2)' : 'rgba(148,163,184,0.35)'}
                strokeWidth={1}
              />
            );
          })}

          {/* Metallic Knob Cap */}
          <circle
            cx={cx}
            cy={cy}
            r={capRadius}
            fill={`url(#${gradId})`}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={1}
          />

          {/* Indicator Line */}
          <line
            x1={indicatorStart.x}
            y1={indicatorStart.y}
            x2={indicatorEnd.x}
            y2={indicatorEnd.y}
            stroke={accent === 'slate' ? '#475569' : '#F8FAFC'}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider leading-none text-center">
        {label}
      </div>
      <div className={`font-mono text-[10px] tabular-nums leading-none ${colors.text}`}>
        {displayStr}
      </div>
    </div>
  );
};

interface VerticalFaderProps {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  height?: number;
  disabled?: boolean;
  accent?: 'sky' | 'emerald' | 'amber' | 'slate';
  onChange: (next: number) => void;
}

export const VerticalFader: React.FC<VerticalFaderProps> = ({
  label,
  value,
  min = -48,
  max = 10,
  step = 0.5,
  defaultValue = 0,
  height = 176,
  disabled = false,
  accent = 'sky',
  onChange,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const clamped = Math.max(min, Math.min(max, value));
  const norm = (clamped - min) / (max - min);

  const updateFromClientY = useCallback(
    (clientY: number) => {
      if (!trackRef.current || disabled) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pad = 14;
      const usable = Math.max(1, rect.height - pad * 2);
      const ratio = 1 - (clientY - rect.top - pad) / usable;
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const raw = min + clampedRatio * (max - min);
      const stepped = Math.round(raw / step) * step;
      onChange(Math.max(min, Math.min(max, Number(stepped.toFixed(1)))));
    },
    [disabled, max, min, onChange, step]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientY(e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 || disabled) return;
    updateFromClientY(e.clientY);
  };

  const fillBg =
    accent === 'slate'
      ? 'bg-slate-700'
      : accent === 'emerald'
        ? 'bg-emerald-500'
        : accent === 'amber'
          ? 'bg-amber-500'
          : 'bg-sky-400';

  const capBottomPct = 6 + norm * 82;

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label || 'Channel Fader'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={clamped}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onDoubleClick={() => !disabled && onChange(defaultValue)}
        onWheel={(e) => {
          if (disabled) return;
          e.preventDefault();
          const dir = e.deltaY < 0 ? 1 : -1;
          onChange(Math.max(min, Math.min(max, Number((clamped + dir * step).toFixed(1)))));
        }}
        style={{ height }}
        className={`relative w-10 flex items-center justify-center rounded bg-[#080B10] border border-slate-800/90 shadow-inner ${
          disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-ns-resize'
        }`}
      >
        {/* Calibration Scale Ticks */}
        <div className="absolute inset-y-3 left-1 w-1.5 flex flex-col justify-between pointer-events-none">
          {[0, 1, 2, 3, 4, 5, 6].map((t) => (
            <div
              key={t}
              className={`h-px ${
                t === 1
                  ? accent === 'slate'
                    ? 'w-2 bg-slate-700/50'
                    : 'w-2 bg-sky-400/70'
                  : 'w-1.5 bg-slate-600/60'
              }`}
            />
          ))}
        </div>
        <div className="absolute inset-y-3 right-1 w-1.5 flex flex-col justify-between items-end pointer-events-none">
          {[0, 1, 2, 3, 4, 5, 6].map((t) => (
            <div
              key={t}
              className={`h-px ${
                t === 1
                  ? accent === 'slate'
                    ? 'w-2 bg-slate-700/50'
                    : 'w-2 bg-sky-400/70'
                  : 'w-1.5 bg-slate-600/60'
              }`}
            />
          ))}
        </div>

        {/* Recessed Slot */}
        <div className="relative w-1.5 h-[84%] rounded-full bg-[#030508] border border-slate-800 overflow-hidden">
          <div
            className={`absolute bottom-0 inset-x-0 ${fillBg} opacity-80`}
            style={{
              height: `${accent === 'slate' ? 0 : norm * 100}%`,
              ...(accent === 'sky' ? { backgroundColor: 'var(--theme-accent, #38BDF8)' } : {}),
            }}
          />
        </div>

        {/* Tactile Metallic Fader Cap */}
        <div
          className="absolute left-1.5 right-1.5 h-6 -translate-y-1/2 rounded-xs border border-slate-500/60 shadow-md flex flex-col items-center justify-center gap-0.5 pointer-events-none"
          style={{
            bottom: `${capBottomPct}%`,
            background: 'linear-gradient(180deg, #475569 0%, #1E293B 48%, #0F172A 52%, #334155 100%)',
          }}
        >
          <div className={`w-full h-px ${accent === 'slate' ? 'bg-slate-600/45' : 'bg-white/80'}`} />
        </div>
      </div>

      <div
        className={`font-mono text-[10px] tabular-nums bg-[#080B10] border border-slate-800 px-1.5 py-0.5 rounded ${
          accent === 'slate' ? 'text-slate-600' : 'text-slate-300'
        }`}
      >
        {accent === 'slate'
          ? '--'
          : clamped <= min + 0.5
            ? '-∞'
            : `${clamped > 0 ? '+' : ''}${clamped.toFixed(1)} dB`}
      </div>
    </div>
  );
};

interface SegmentedLedMeterProps {
  levelDb: number;
  peakDb: number;
  muted?: boolean;
  height?: number;
  segments?: number;
}

export const SegmentedLedMeter: React.FC<SegmentedLedMeterProps> = ({
  levelDb,
  peakDb,
  muted = false,
  height = 176,
  segments = 20,
}) => {
  const norm = Math.max(0, Math.min(1, (levelDb + 64) / 64));
  const peakNorm = Math.max(0, Math.min(1, (peakDb + 64) / 64));
  const litCount = muted || levelDb <= -63.5 ? 0 : Math.max(1, Math.round(norm * segments));
  const peakSeg = muted || peakDb <= -63.5 ? -1 : Math.min(segments - 1, Math.floor(peakNorm * segments));

  return (
    <div
      style={{ height }}
      className="w-3 bg-[#070A0F] border border-slate-800 rounded-xs p-0.5 flex flex-col-reverse justify-between gap-[2px]"
      aria-label={`Level ${levelDb.toFixed(1)} dBFS`}
    >
      {Array.from({ length: segments }).map((_, i) => {
        const isLit = i < litCount || i === peakSeg;
        const pct = i / segments;
        const color =
          pct >= 0.88
            ? isLit
              ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]'
              : 'bg-red-950/40'
            : pct >= 0.72
              ? isLit
                ? 'bg-amber-400 shadow-[0_0_4px_rgba(245,158,11,0.65)]'
                : 'bg-amber-950/40'
              : isLit
                ? 'bg-emerald-400 shadow-[0_0_4px_rgba(16,185,129,0.55)]'
                : 'bg-emerald-950/35';
        return <div key={i} className={`w-full flex-1 rounded-[1px] ${color}`} />;
      })}
    </div>
  );
};

interface ConsolePushButtonProps {
  label: string;
  active: boolean;
  tone?: 'red' | 'amber' | 'emerald' | 'sky' | 'fuchsia';
  disabled?: boolean;
  onClick: () => void;
}

export const ConsolePushButton: React.FC<ConsolePushButtonProps> = ({
  label,
  active,
  tone = 'sky',
  disabled = false,
  onClick,
}) => {
  const activeStyle =
    tone === 'red'
      ? 'bg-red-600/90 border-red-400 text-white shadow-[0_0_10px_rgba(239,68,68,0.45)]'
      : tone === 'amber'
        ? 'bg-amber-500 border-amber-300 text-slate-950 shadow-[0_0_10px_rgba(245,158,11,0.4)]'
        : tone === 'emerald'
          ? 'bg-emerald-500/90 border-emerald-300 text-slate-950 shadow-[0_0_10px_rgba(16,185,129,0.4)]'
          : tone === 'fuchsia'
            ? 'bg-fuchsia-600/90 border-fuchsia-400 text-white shadow-[0_0_10px_rgba(217,70,239,0.45)]'
            : 'bg-sky-500 border-sky-300 text-slate-950 shadow-[0_0_10px_rgba(56,189,248,0.4)]';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-active={active ? 'true' : 'false'}
      className={`console-push-btn px-2 py-1 rounded-xs border text-[10px] font-mono font-semibold tracking-wide whitespace-nowrap disabled:opacity-40 ${
        active
          ? activeStyle
          : 'bg-[#121722] border-slate-700/80 text-slate-400 hover:text-slate-200 hover:border-slate-600'
      }`}
    >
      {label}
    </button>
  );
};

interface ArcGaugeProps {
  label: string;
  value: number;
  max: number;
  displayValue: string;
  sublabel?: string;
  tone?: 'sky' | 'emerald' | 'amber' | 'red';
}

export const ArcGauge: React.FC<ArcGaugeProps> = ({
  label,
  value,
  max,
  displayValue,
  sublabel,
  tone = 'sky',
}) => {
  const pct = Math.max(0, Math.min(1, value / Math.max(1, max)));
  const r = 42;
  const c = 54;
  const circ = Math.PI * r;
  const strokeColor =
    tone === 'red' ? '#EF4444' : tone === 'amber' ? '#F59E0B' : tone === 'emerald' ? '#10B981' : '#38BDF8';

  return (
    <div className="flex flex-col items-center p-2.5 rounded bg-[#0B0F17] border border-slate-800">
      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{label}</div>
      <svg width={108} height={66} viewBox="0 0 108 66" className="mt-1">
        <path
          d={`M ${c - r} ${c} A ${r} ${r} 0 0 1 ${c + r} ${c}`}
          fill="none"
          stroke="rgba(148,163,184,0.16)"
          strokeWidth={8}
          strokeLinecap="round"
        />
        <path
          d={`M ${c - r} ${c} A ${r} ${r} 0 0 1 ${c + r} ${c}`}
          fill="none"
          stroke={tone === 'sky' ? 'var(--theme-accent, #38BDF8)' : strokeColor}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`}
        />
        <text
          x={c}
          y={c - 6}
          textAnchor="middle"
          fill="var(--theme-heading, #F8FAFC)"
          fontSize="15"
          fontWeight="600"
          fontFamily="JetBrains Mono"
        >
          {displayValue}
        </text>
      </svg>
      {sublabel && <div className="text-[10px] font-mono text-slate-400 -mt-1">{sublabel}</div>}
    </div>
  );
};
