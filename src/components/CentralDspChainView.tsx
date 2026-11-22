import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Copy, Check, RotateCcw, Plus } from 'lucide-react';
import type {
  DriverBackend,
  DspConfig,
  HardwareDevice,
  InputChannel,
  PlatformTarget,
  SignalTelemetry,
  SpeakerZone,
} from '../types/audio.ts';
import { liveAudioEngine } from '../audio/liveAudioEngine.ts';
import { computeFilterCurveDb, generateCamillaDspYaml } from '../utils/camillaDsp.ts';
import { RotaryKnob } from './StudioControls.tsx';
import { StereoGraphicEqModule } from './StereoGraphicEqModule.tsx';
import { ActiveCrossoverModule } from './ActiveCrossoverModule.tsx';
import { CleanStandbyModule } from './CleanStandbyModule.tsx';

interface CentralDspChainViewProps {
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  selectedChannel: InputChannel;
  onUpdateChannel: (id: string, patch: Partial<InputChannel>) => void;
  device: HardwareDevice;
  platform: PlatformTarget;
  driver: DriverBackend;
  sampleRate: number;
  bufferSize: number;
  zones: SpeakerZone[];
  telemetry: SignalTelemetry;
  engineRunning: boolean;
  monitorAudible: boolean;
  onToggleMonitor: () => void;
  emergencyMuted: boolean;
  locked?: boolean;
  onAddEqBand?: () => void;
}

type ChainSubView = 'chain' | 'geq' | 'xover' | 'hum' | 'yaml';

interface ColumnSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  ticks?: string[];
  accent?: 'green' | 'cyan' | 'amber';
  thumbStyle?: 'bar' | 'puck';
  disabled?: boolean;
  ariaLabel: string;
  onChange: (next: number) => void;
}

const ColumnSlider: React.FC<ColumnSliderProps> = ({
  value,
  min,
  max,
  step = 0.5,
  defaultValue = 0,
  ticks,
  accent = 'green',
  thumbStyle = 'bar',
  disabled = false,
  ariaLabel,
  onChange,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const clamped = Math.max(min, Math.min(max, value));
  const ratio = max === min ? 0.5 : (clamped - min) / (max - min);
  const topPct = (1 - ratio) * 100;

  const updateFromY = useCallback(
    (clientY: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || disabled) return;
      const pct = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      const raw = min + pct * (max - min);
      const next = Math.max(min, Math.min(max, Number((Math.round(raw / step) * step).toFixed(1))));
      onChange(next);
    },
    [disabled, max, min, onChange, step]
  );

  const glowColor =
    accent === 'cyan'
      ? '#22D3EE'
      : accent === 'amber'
        ? '#F59E0B'
        : '#4ADE80';

  return (
    <div
      className={`flex items-stretch justify-center gap-1 flex-1 min-h-[72px] select-none ${
        disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-ns-resize'
      }`}
      onWheel={(e) => {
        if (disabled) return;
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        onChange(Math.max(min, Math.min(max, Number((clamped + dir * step).toFixed(1)))));
      }}
    >
      {ticks && ticks.length > 0 && (
        <div className="flex flex-col justify-between items-end py-1 font-mono text-[7px] text-slate-500 tabular-nums pointer-events-none select-none">
          {ticks.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      )}
      <div
        ref={trackRef}
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          draggingRef.current = true;
          updateFromY(e.clientY);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current || e.buttons !== 1 || disabled) {
            if (draggingRef.current && e.buttons !== 1) draggingRef.current = false;
            return;
          }
          updateFromY(e.clientY);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }}
        onDoubleClick={() => !disabled && onChange(defaultValue)}
        className="relative w-5 flex items-center justify-center touch-none"
      >
        {/* Recessed Track Slot */}
        <div className="w-1.5 h-full rounded-full bg-[#090D12] border border-[#1E2733] shadow-inner relative overflow-hidden">
          <div
            className="absolute bottom-0 inset-x-0 rounded-full transition-all duration-75"
            style={{
              height: `${ratio * 100}%`,
              backgroundColor: glowColor,
              boxShadow: `0 0 8px ${glowColor}`,
              opacity: 0.78,
            }}
          />
        </div>
        {/* Center zero/midline tick */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-600/45 pointer-events-none" />
        {/* Thumb */}
        {thumbStyle === 'puck' ? (
          <div
            className="absolute w-3.5 h-3.5 rounded-full border border-slate-300/80 shadow-[0_2px_6px_rgba(0,0,0,0.9)] pointer-events-none"
            style={{
              top: `${topPct}%`,
              transform: 'translateY(-50%)',
              background: 'radial-gradient(circle at 35% 30%, #94A3B8 0%, #334155 55%, #0F172A 100%)',
            }}
          >
            <div className="w-1 h-1 rounded-full bg-teal-300 m-auto mt-[4px]" />
          </div>
        ) : (
          <div
            className="absolute left-0 right-0 h-3 rounded-[2px] border border-slate-400/75 shadow-[0_2px_6px_rgba(0,0,0,0.9)] flex items-center justify-center pointer-events-none"
            style={{
              top: `${topPct}%`,
              transform: 'translateY(-50%)',
              background: 'linear-gradient(180deg, #64748B 0%, #2D3748 48%, #1A202C 100%)',
            }}
          >
            <div
              className="w-full h-[1.5px]"
              style={{ backgroundColor: glowColor, boxShadow: `0 0 5px ${glowColor}` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const CentralDspChainView: React.FC<CentralDspChainViewProps> = ({
  dsp,
  onUpdateDsp,
  selectedChannel,
  onUpdateChannel,
  device,
  platform,
  driver,
  sampleRate,
  bufferSize,
  zones,
  telemetry,
  engineRunning,
  monitorAudible,
  onToggleMonitor,
  emergencyMuted,
  locked = false,
  onAddEqBand,
}) => {
  const uid = useId().replace(/:/g, '');
  const [subView, setSubView] = useState<ChainSubView>('chain');
  const [slotA, setSlotA] = useState<DspConfig | null>(null);
  const [slotB, setSlotB] = useState<DspConfig | null>(null);
  const [activeSlot, setActiveSlot] = useState<'A' | 'B'>('A');
  const [eqPage, setEqPage] = useState(0);
  const [selectedBandId, setSelectedBandId] = useState<string>(dsp.eqBands[0]?.id ?? 'eq-1');
  const [copiedYaml, setCopiedYaml] = useState(false);

  const [fastPostLDb, setFastPostLDb] = useState(-96);
  const [fastPostRDb, setFastPostRDb] = useState(-96);
  const [phaseTick, setPhaseTick] = useState(0);

  // Throttled ~30fps live stereo MAIN L / MAIN R meter & scope animation
  useEffect(() => {
    if (!engineRunning) {
      setFastPostLDb(-96);
      setFastPostRDb(-96);
      return;
    }
    let rafId = 0;
    let lastTick = 0;
    const tick = (now: number) => {
      if (now - lastTick >= 33) {
        lastTick = now;
        const fast = liveAudioEngine.sampleFastLevels();
        if (fast.isRunning) {
          setFastPostLDb(fast.postLRmsDb);
          setFastPostRDb(fast.postRRmsDb);
          setPhaseTick((p) => (p + 1) % 360);
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [engineRunning]);

  // Preamp arc geometry (Col 1)
  const trimEquivDb = selectedChannel.gainDb - 24;
  const gainArcNorm = Math.max(0, Math.min(1, selectedChannel.gainDb / 60));
  const arcR = 32;
  const arcCx = 44;
  const arcCy = 42;
  const arcCirc = Math.PI * arcR;

  // Live 4-Band EQ Transfer Curve (Col 3)
  const eqCurve = useMemo(() => {
    const w = 130;
    const h = 44;
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const f = Math.pow(10, minLog + (i / 40) * (maxLog - minLog));
      const db = computeFilterCurveDb(dsp, f, sampleRate);
      const x = (i / 40) * w;
      const y = 4 + ((15 - Math.max(-18, Math.min(15, db))) / 33) * (h - 8);
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    const stroke = pts.join(' ');
    const area = `${stroke} L ${w},${h * 0.5} L 0,${h * 0.5} Z`;
    return { stroke, area };
  }, [dsp, sampleRate]);

  // Dynamics oscilloscope trace (Col 4)
  const compScopePath = useMemo(() => {
    const w = 110;
    const mid = 22;
    const amp = engineRunning ? 14 : 6;
    const pts: string[] = [];
    for (let i = 0; i <= 28; i++) {
      const x = (i / 28) * w;
      const t = i / 28;
      const burst = Math.exp(-Math.pow((t - 0.58) * 6.5, 2));
      const wave =
        Math.sin(t * 26 + phaseTick * 0.25) * (2.2 + amp * burst) * (dsp.compressor.enabled ? 0.72 : 1.0);
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${(mid + wave).toFixed(1)}`);
    }
    return pts.join(' ');
  }, [dsp.compressor.enabled, engineRunning, phaseTick]);

  const camillaYaml = useMemo(
    () => generateCamillaDspYaml(dsp, device, platform, driver, sampleRate, bufferSize, zones),
    [bufferSize, device, driver, dsp, platform, sampleRate, zones]
  );

  const anyEqEnabled = dsp.eqBands.some((b) => b.enabled);
  const fbxActive = !dsp.bypassed && ((dsp.qualityGate?.enabled ?? true) || dsp.hpfEnabled);
  const agcActive = Boolean(dsp.smartAgc?.enabled && !dsp.bypassed);
  const compActive = Boolean(dsp.compressor.enabled && !dsp.bypassed);
  const chActive = !selectedChannel.mute;
  const monActive = monitorAudible && !emergencyMuted;
  const streamAssigned = selectedChannel.streamAssign ?? true;
  const subAssigned = selectedChannel.subAssign ?? false;

  const visibleBands = dsp.eqBands.slice(eqPage, eqPage + 4);
  const activeBand = dsp.eqBands.find((b) => b.id === selectedBandId) ?? visibleBands[0];

  // Dynamic routing bus line stroke helper
  const busColor = (active: boolean) =>
    emergencyMuted ? '#EF4444' : active && !dsp.bypassed ? '#4ADE80' : '#2DD4BF';

  const leftSegmentsLit =
    engineRunning && !emergencyMuted && fastPostLDb > -58
      ? Math.max(1, Math.min(18, Math.round(((fastPostLDb + 60) / 60) * 18)))
      : 0;
  const rightSegmentsLit =
    engineRunning && !emergencyMuted && fastPostRDb > -58
      ? Math.max(1, Math.min(18, Math.round(((fastPostRDb + 60) / 60) * 18)))
      : 0;

  return (
    <div className="h-full w-full hw-panel rounded-lg flex flex-col overflow-hidden select-none">
      {/* Top Centered Console Title & Compact Sub-Tool Strip */}
      <div className="h-8 shrink-0 px-3 border-b border-[#25303D] bg-gradient-to-b from-[#1D2530] to-[#141A22] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0C1418] border border-teal-500/40 text-teal-300 truncate max-w-[140px]">
            CH{selectedChannel.index} · {selectedChannel.name}
          </span>
          <h1 className="font-display text-xs font-bold tracking-[0.14em] text-slate-200 uppercase truncate hidden sm:block">
            CENTRAL DSP PROCESSING CHAIN
          </h1>
        </div>

        {/* Sub-View Tabs + A/B + YAML (Zero dropped DSP functionality) */}
        <div className="flex items-center gap-1 font-mono text-[9.5px] shrink-0">
          {(
            [
              { id: 'chain', label: 'SIGNAL CHAIN' },
              { id: 'geq', label: '31-BAND GEQ' },
              { id: 'xover', label: '3-WAY XOVER' },
              { id: 'hum', label: 'ZERO-HUM' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubView(t.id)}
              className={`px-2 py-0.5 rounded border font-bold cursor-pointer ${
                subView === t.id
                  ? 'bg-[#0C1518] border-teal-400/70 text-teal-300'
                  : 'bg-[#11171F] border-[#26313E] text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}

          <div className="hidden xl:flex items-center rounded border border-[#26313E] bg-[#0D1218] overflow-hidden ml-1">
            <button
              type="button"
              onClick={() => {
                setSlotA(structuredClone(dsp));
                setActiveSlot('A');
              }}
              className="px-1.5 py-0.5 text-slate-300 hover:bg-[#1B232E] border-r border-[#26313E] cursor-pointer"
              title="Store current DSP state to Snapshot A"
            >
              {slotA ? 'A*' : 'A'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSlotB(structuredClone(dsp));
                setActiveSlot('B');
              }}
              className="px-1.5 py-0.5 text-slate-300 hover:bg-[#1B232E] border-r border-[#26313E] cursor-pointer"
              title="Store current DSP state to Snapshot B"
            >
              {slotB ? 'B*' : 'B'}
            </button>
            <button
              type="button"
              disabled={!slotA || !slotB || locked}
              onClick={() => {
                const next = activeSlot === 'A' ? 'B' : 'A';
                const target = next === 'A' ? slotA : slotB;
                if (target) {
                  setActiveSlot(next);
                  onUpdateDsp(structuredClone(target));
                }
              }}
              className="px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-40 cursor-pointer font-bold"
              title="Toggle A / B Compare"
            >
              A↔B
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSubView((v) => (v === 'yaml' ? 'chain' : 'yaml'))}
            className={`px-2 py-0.5 rounded border font-bold cursor-pointer ${
              subView === 'yaml'
                ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                : 'bg-[#11171F] border-[#26313E] text-slate-400 hover:text-white'
            }`}
          >
            YAML
          </button>
        </div>
      </div>

      {/* Sub-Views: 31-Band GEQ, 3-Way Xover, Zero-Hum, CamillaDSP YAML */}
      {subView === 'geq' && (
        <div className="flex-1 min-h-0 overflow-hidden p-2 flex flex-col">
          <StereoGraphicEqModule dsp={dsp} onUpdateDsp={onUpdateDsp} panelLocked={locked} compactConsoleMode />
        </div>
      )}

      {subView === 'xover' && (
        <div className="flex-1 min-h-0 overflow-hidden p-2 flex flex-col">
          <ActiveCrossoverModule dsp={dsp} onUpdateDsp={onUpdateDsp} panelLocked={locked} compactConsoleMode />
        </div>
      )}

      {subView === 'hum' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <CleanStandbyModule dsp={dsp} onUpdateDsp={onUpdateDsp} telemetry={telemetry} panelLocked={locked} />
        </div>
      )}

      {subView === 'yaml' && (
        <div className="flex-1 min-h-0 flex flex-col p-3 gap-2 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 font-bold uppercase tracking-wider">
              Generated CamillaDSP Pipeline Configuration
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(camillaYaml);
                setCopiedYaml(true);
                window.setTimeout(() => setCopiedYaml(false), 1800);
              }}
              className="px-2.5 py-1 rounded border border-teal-500/40 bg-teal-500/15 text-teal-200 flex items-center gap-1.5 cursor-pointer"
            >
              {copiedYaml ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedYaml ? 'COPIED' : 'COPY YAML'}</span>
            </button>
          </div>
          <pre className="flex-1 min-h-0 overflow-auto p-3 rounded-md hw-well text-[11px] text-emerald-300 leading-relaxed">
            {camillaYaml}
          </pre>
        </div>
      )}

      {/* =========================================================================
          MAIN SIGNAL CHAIN VIEW (EXACT 7-COLUMN CONNECTED GRAPH + MAIN OUTPUTS)
          ========================================================================= */}
      {subView === 'chain' && (
        <div className="flex-1 min-h-0 flex flex-col p-2 gap-2 overflow-x-auto overflow-y-hidden">
          <div className="relative flex-1 min-h-0 min-w-[780px] grid grid-cols-7 gap-2">
            {/* Dynamic Glowing SVG Signal Routing Overlay Along Seams & Bridge */}
            <svg
              viewBox="0 0 1400 600"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 w-full h-full z-20"
            >
              <defs>
                <filter id={`glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Continuous Stage 1: Input Conditioning (100,108) -> Seam 1/2 -> AGC (300,138) */}
              <path
                d="M 100 108 L 200 108 L 200 590 L 300 590 L 300 138"
                fill="none"
                stroke={busColor(chActive)}
                strokeWidth="2.4"
                strokeOpacity="0.88"
                filter={`url(#glow-${uid})`}
              />
              <circle cx="200" cy="108" r="4" fill={busColor(chActive)} filter={`url(#glow-${uid})`} />
              <circle cx="200" cy="590" r="3.5" fill={busColor(chActive)} />

              {/* Continuous Stage 2: AGC (300,138) -> Seam 2/3 -> 4-Band EQ (500,236) */}
              <path
                d="M 300 138 L 400 138 L 400 236 L 500 236"
                fill="none"
                stroke={busColor(agcActive)}
                strokeWidth="2.4"
                strokeOpacity="0.88"
                filter={`url(#glow-${uid})`}
              />
              <circle cx="400" cy="138" r="4" fill={busColor(agcActive)} filter={`url(#glow-${uid})`} />
              <circle cx="400" cy="236" r="3.5" fill={busColor(agcActive)} />

              {/* Continuous Stage 3: 4-Band EQ (500,236) -> Seam 3/4 -> Compression (700,112) */}
              <path
                d="M 500 236 L 600 236 L 600 590 L 700 590 L 700 112"
                fill="none"
                stroke={busColor(anyEqEnabled)}
                strokeWidth="2.3"
                strokeOpacity="0.86"
                filter={`url(#glow-${uid})`}
              />
              <circle cx="600" cy="236" r="4" fill={busColor(anyEqEnabled)} filter={`url(#glow-${uid})`} />
              <circle cx="600" cy="590" r="3.5" fill={busColor(anyEqEnabled)} />

              {/* Continuous Stage 4: Compression (700,112) -> Seam 4/5 -> Feedback-Safe (900,190) */}
              <path
                d="M 700 112 L 800 112 L 800 190 L 900 190"
                fill="none"
                stroke={busColor(compActive)}
                strokeWidth="2.3"
                strokeOpacity="0.86"
                filter={`url(#glow-${uid})`}
              />
              <circle cx="800" cy="112" r="4" fill={busColor(compActive)} filter={`url(#glow-${uid})`} />
              <circle cx="800" cy="190" r="3.5" fill={busColor(compActive)} />

              {/* Continuous Stage 5: Feedback-Safe (900,190) -> Seam 5/6 -> Effects Sends (1100,218) */}
              <path
                d="M 900 190 L 1000 190 L 1000 590 L 1100 590 L 1100 218"
                fill="none"
                stroke={busColor(fbxActive)}
                strokeWidth="2.3"
                strokeOpacity="0.86"
                filter={`url(#glow-${uid})`}
              />
              <circle cx="1000" cy="190" r="4" fill={busColor(fbxActive)} filter={`url(#glow-${uid})`} />
              <circle cx="1000" cy="590" r="3.5" fill={busColor(fbxActive)} />

              {/* Continuous Stage 6 & 7: Effects Sends (1100,218) -> Monitor Mixes (1300) -> Main Outputs Bridge */}
              <path
                d="M 1100 218 L 1200 218 L 1200 590 L 1300 590 L 1300 599"
                fill="none"
                stroke={busColor(monActive || chActive)}
                strokeWidth="2.4"
                strokeOpacity="0.9"
                filter={`url(#glow-${uid})`}
              />
              {/* Post-Dynamics / Direct Main Tap to Output Bridge */}
              <path
                d="M 700 590 L 700 599"
                fill="none"
                stroke={busColor(chActive)}
                strokeWidth="2.4"
                strokeOpacity="0.88"
                filter={`url(#glow-${uid})`}
              />
              <circle cx="1200" cy="218" r="4" fill={busColor(monActive || chActive)} filter={`url(#glow-${uid})`} />
              <circle cx="1200" cy="590" r="3.5" fill={busColor(monActive || chActive)} />
              <circle cx="700" cy="596" r="4.5" fill="#4ADE80" filter={`url(#glow-${uid})`} />
              <circle cx="1300" cy="596" r="4.5" fill="#4ADE80" filter={`url(#glow-${uid})`} />
            </svg>

            {/* ==============================================================
                COL 1: INPUT CONDITIONING
                ============================================================== */}
            <div className="hw-card rounded-md p-2 flex flex-col items-center justify-between gap-1.5 relative z-10 min-h-0">
              <div className="text-center shrink-0">
                <div className="text-[9.5px] font-bold tracking-wider text-slate-200 uppercase leading-tight">
                  INPUT CONDITIONING
                </div>
                <div className="text-[9px] font-mono text-teal-300 truncate max-w-[110px]">
                  Selected CH{selectedChannel.index}
                </div>
              </div>

              {/* Green/Amber Semi-Circular Preamp Gain Arc */}
              <svg viewBox="0 0 88 50" className="w-[88px] h-[48px] shrink-0">
                <defs>
                  <linearGradient id={`inArc-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#22C55E" />
                    <stop offset="65%" stopColor="#84CC16" />
                    <stop offset="100%" stopColor="#F59E0B" />
                  </linearGradient>
                </defs>
                <path
                  d={`M ${arcCx - arcR} ${arcCy} A ${arcR} ${arcR} 0 0 1 ${arcCx + arcR} ${arcCy}`}
                  fill="none"
                  stroke="#1E2733"
                  strokeWidth="7"
                  strokeLinecap="round"
                />
                <path
                  d={`M ${arcCx - arcR} ${arcCy} A ${arcR} ${arcR} 0 0 1 ${arcCx + arcR} ${arcCy}`}
                  fill="none"
                  stroke={`url(#inArc-${uid})`}
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={`${arcCirc * gainArcNorm} ${arcCirc}`}
                />
                <text x={arcCx} y={arcCy - 4} textAnchor="middle" fill="#4ADE80" fontSize="11" fontWeight="700" fontFamily="JetBrains Mono">
                  {trimEquivDb >= 0 ? `+${trimEquivDb.toFixed(1)}` : trimEquivDb.toFixed(1)}
                </text>
              </svg>

              <div className="-mt-1 shrink-0">
                <RotaryKnob
                  label="PREAMP"
                  value={selectedChannel.gainDb}
                  min={0}
                  max={60}
                  step={1}
                  defaultValue={24}
                  unit="dB"
                  size={44}
                  disabled={locked}
                  accent="emerald"
                  onChange={(next) => onUpdateChannel(selectedChannel.id, { gainDb: next })}
                />
              </div>

              {/* Micro Stage Switches (+48V, -20dB, Ø) */}
              <div className="w-full grid grid-cols-3 gap-0.5 font-mono text-[8px] shrink-0">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onUpdateChannel(selectedChannel.id, { phantom48v: !selectedChannel.phantom48v })}
                  className={`py-0.5 rounded border font-bold cursor-pointer disabled:opacity-45 ${
                    selectedChannel.phantom48v
                      ? 'bg-red-600 border-red-300 text-white'
                      : 'bg-[#0C1016] border-[#26313E] text-slate-400 hover:text-white'
                  }`}
                >
                  48V
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onUpdateChannel(selectedChannel.id, { padDb: !selectedChannel.padDb })}
                  className={`py-0.5 rounded border font-bold cursor-pointer disabled:opacity-45 ${
                    selectedChannel.padDb
                      ? 'bg-amber-500 border-amber-300 text-slate-950'
                      : 'bg-[#0C1016] border-[#26313E] text-slate-400 hover:text-white'
                  }`}
                >
                  -20
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    onUpdateChannel(selectedChannel.id, { polarityInverted: !selectedChannel.polarityInverted })
                  }
                  className={`py-0.5 rounded border font-bold cursor-pointer disabled:opacity-45 ${
                    selectedChannel.polarityInverted
                      ? 'bg-teal-500 border-teal-300 text-slate-950'
                      : 'bg-[#0C1016] border-[#26313E] text-slate-400 hover:text-white'
                  }`}
                >
                  Ø
                </button>
              </div>

              <button
                type="button"
                disabled={locked}
                onClick={() => onUpdateChannel(selectedChannel.id, { mute: !selectedChannel.mute })}
                className={`w-full py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider shrink-0 cursor-pointer disabled:opacity-45 ${
                  chActive ? 'hw-pill-active' : 'hw-pill-bypass'
                }`}
              >
                {chActive ? 'ACTIVE' : 'MUTED'}
              </button>

              <ColumnSlider
                ariaLabel={`Channel ${selectedChannel.index} Fader`}
                value={selectedChannel.faderDb}
                min={-48}
                max={10}
                step={0.5}
                defaultValue={0}
                ticks={['+10', '0', '-20', '-48']}
                accent="green"
                disabled={locked}
                onChange={(next) => onUpdateChannel(selectedChannel.id, { faderDb: next })}
              />
            </div>

            {/* ==============================================================
                COL 2: AUTOMATIC GAIN CONTROL (AGC)
                ============================================================== */}
            <div className="hw-card rounded-md p-1.5 pb-2.5 flex flex-col items-center justify-between gap-1 relative z-10 min-h-0">
              <div className="text-center shrink-0">
                <div className="text-[9px] font-bold tracking-wider text-slate-200 uppercase leading-tight">
                  AUTO GAIN
                </div>
                <div className="text-[8.5px] font-mono text-slate-400">AGC</div>
              </div>

              {/* AGC Transfer Knee Crosshair Well */}
              <div className="w-full h-12 hw-well rounded p-1 shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 110 46" className="w-full h-full">
                  <line x1="55" y1="0" x2="55" y2="46" stroke="rgba(148,163,184,0.22)" />
                  <line x1="0" y1="23" x2="110" y2="23" stroke="rgba(148,163,184,0.22)" />
                  <path
                    d="M 10 40 L 55 23 L 100 12"
                    fill="none"
                    stroke={agcActive ? '#4ADE80' : '#475569'}
                    strokeWidth="2"
                  />
                  <circle
                    cx={Math.max(15, Math.min(95, 55 + (telemetry.agcGainDb ?? 0) * 2))}
                    cy={Math.max(8, Math.min(38, 23 - (telemetry.agcGainDb ?? 0) * 0.8))}
                    r="3.5"
                    fill="#4ADE80"
                  />
                </svg>
              </div>

              {/* AGC Target & Live Gain Readout (Single-line non-wrapping) */}
              <div className="w-full space-y-1 font-mono text-[8px] text-center shrink-0">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    const curr = dsp.smartAgc?.targetRmsDb ?? -18;
                    const nextTarget = curr === -18 ? -14 : curr === -14 ? -20 : -18;
                    onUpdateDsp({
                      smartAgc: {
                        enabled: true,
                        targetRmsDb: nextTarget,
                        maxBoostDb: dsp.smartAgc?.maxBoostDb ?? 14,
                        maxCutDb: dsp.smartAgc?.maxCutDb ?? 18,
                        gateFloorDb: dsp.smartAgc?.gateFloorDb ?? -52,
                      },
                    });
                  }}
                  title="Click to cycle Smart AGC Target RMS (-20 / -18 / -14 dBFS)"
                  className="w-full px-1 py-0.5 rounded bg-[#0C1016] border border-[#222B37] hover:border-emerald-400/50 text-emerald-300 tabular-nums whitespace-nowrap truncate cursor-pointer disabled:opacity-45"
                >
                  TGT {(dsp.smartAgc?.targetRmsDb ?? -18).toFixed(0)} dBFS
                </button>
                <div className="text-slate-300 tabular-nums whitespace-nowrap">
                  LIVE{' '}
                  <span className="text-[#4ADE80] font-bold">
                    {(telemetry.agcGainDb ?? 0) >= 0 ? '+' : ''}
                    {(telemetry.agcGainDb ?? 0).toFixed(1)} dB
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  onUpdateDsp({
                    smartAgc: {
                      enabled: !(dsp.smartAgc?.enabled ?? true),
                      targetRmsDb: dsp.smartAgc?.targetRmsDb ?? -18,
                      maxBoostDb: dsp.smartAgc?.maxBoostDb ?? 14,
                      maxCutDb: dsp.smartAgc?.maxCutDb ?? 18,
                      gateFloorDb: dsp.smartAgc?.gateFloorDb ?? -52,
                    },
                  })
                }
                className={`w-full py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider shrink-0 cursor-pointer disabled:opacity-45 ${
                  agcActive ? 'hw-pill-active' : 'hw-pill-bypass'
                }`}
              >
                {agcActive ? 'ACTIVE' : 'BYPASSED'}
              </button>

              <ColumnSlider
                ariaLabel="AGC Max Boost Depth"
                value={dsp.smartAgc?.maxBoostDb ?? 14}
                min={0}
                max={24}
                step={1}
                defaultValue={14}
                ticks={['+24', '+12', '0 dB']}
                accent="green"
                disabled={locked}
                onChange={(next) =>
                  onUpdateDsp({
                    smartAgc: {
                      enabled: true,
                      targetRmsDb: dsp.smartAgc?.targetRmsDb ?? -18,
                      maxBoostDb: next,
                      maxCutDb: dsp.smartAgc?.maxCutDb ?? 18,
                      gateFloorDb: dsp.smartAgc?.gateFloorDb ?? -52,
                    },
                  })
                }
              />
            </div>

            {/* ==============================================================
                COL 3: EQUALIZATION (4-BAND EQ)
                ============================================================== */}
            <div className="hw-card rounded-md p-2 flex flex-col items-center justify-between gap-1.5 relative z-10 min-h-0">
              <div className="text-center shrink-0">
                <div className="text-[9.5px] font-bold tracking-wider text-slate-200 uppercase leading-tight">
                  EQUALIZATION
                </div>
                <div className="text-[9px] font-mono text-slate-400">
                  {dsp.eqBands.length}-BAND PEQ
                </div>
              </div>

              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  onUpdateDsp({
                    eqBands: dsp.eqBands.map((b) => ({ ...b, enabled: !anyEqEnabled })),
                  })
                }
                className={`w-full py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider shrink-0 cursor-pointer disabled:opacity-45 ${
                  anyEqEnabled && !dsp.bypassed ? 'hw-pill-active' : 'hw-pill-bypass'
                }`}
              >
                {anyEqEnabled && !dsp.bypassed ? 'ACTIVE' : 'BYPASSED'}
              </button>

              {/* Live Glowing EQ Response Curve */}
              <div className="w-full h-12 hw-well rounded p-1 shrink-0">
                <svg viewBox="0 0 130 44" className="w-full h-full">
                  <line x1="0" y1="22" x2="130" y2="22" stroke="rgba(148,163,184,0.22)" strokeDasharray="3 2" />
                  <path d={eqCurve.area} fill="rgba(45,212,191,0.16)" />
                  <path
                    d={eqCurve.stroke}
                    fill="none"
                    stroke={anyEqEnabled && !dsp.bypassed ? '#22D3EE' : '#64748B'}
                    strokeWidth="2"
                  />
                </svg>
              </div>

              {/* 4 Vertical Paged EQ Band Sliders */}
              <div className="flex-1 min-h-0 w-full grid grid-cols-4 gap-1 items-stretch">
                {visibleBands.map((band) => {
                  const isSel = band.id === activeBand?.id;
                  const fLabel =
                    band.frequency >= 1000
                      ? `${(band.frequency / 1000).toFixed(1)}k`
                      : `${Math.round(band.frequency)}`;
                  return (
                    <div
                      key={band.id}
                      onClick={() => setSelectedBandId(band.id)}
                      className={`flex flex-col items-center justify-between py-0.5 rounded cursor-pointer ${
                        isSel ? 'bg-teal-500/10 ring-1 ring-teal-500/40' : ''
                      }`}
                    >
                      <span className="font-mono text-[7.5px] text-slate-300 font-semibold leading-none">
                        {fLabel}
                      </span>
                      <ColumnSlider
                        ariaLabel={`${band.label} Gain`}
                        value={band.gainDb}
                        min={-15}
                        max={15}
                        step={0.5}
                        defaultValue={0}
                        accent="cyan"
                        thumbStyle="puck"
                        disabled={locked}
                        onChange={(next) =>
                          onUpdateDsp({
                            eqBands: dsp.eqBands.map((b) =>
                              b.id === band.id ? { ...b, gainDb: next, enabled: true } : b
                            ),
                          })
                        }
                      />
                      <span
                        className={`font-mono text-[8px] tabular-nums leading-none ${
                          band.gainDb > 0
                            ? 'text-teal-300'
                            : band.gainDb < 0
                              ? 'text-amber-400'
                              : 'text-slate-500'
                        }`}
                      >
                        {band.gainDb > 0 ? `+${band.gainDb.toFixed(0)}` : band.gainDb.toFixed(0)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Footer Page / Reset / +Band Controls */}
              <div className="w-full flex items-center justify-between gap-1 font-mono text-[8px] shrink-0">
                {dsp.eqBands.length > 4 ? (
                  <button
                    type="button"
                    onClick={() => setEqPage((p) => (p + 4 >= dsp.eqBands.length ? 0 : p + 4))}
                    className="px-1.5 py-0.5 rounded bg-[#0C1016] border border-[#26313E] text-teal-300 cursor-pointer"
                  >
                    {eqPage + 1}-{Math.min(dsp.eqBands.length, eqPage + 4)}
                  </button>
                ) : (
                  <span className="text-slate-500">±15dB</span>
                )}
                {onAddEqBand && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={onAddEqBand}
                    title="Add parametric EQ band"
                    className="px-1 py-0.5 rounded bg-[#0C1016] border border-[#26313E] text-emerald-300 cursor-pointer disabled:opacity-45"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    onUpdateDsp({ eqBands: dsp.eqBands.map((b) => ({ ...b, gainDb: 0 })) })
                  }
                  title="Flatten all EQ bands to 0 dB"
                  className="px-1.5 py-0.5 rounded bg-[#0C1016] border border-[#26313E] text-slate-300 hover:text-white flex items-center gap-0.5 cursor-pointer disabled:opacity-45"
                >
                  <RotateCcw className="w-2 h-2" />
                  FLAT
                </button>
              </div>
            </div>

            {/* ==============================================================
                COL 4: COMPRESSION (DYNAMICS)
                ============================================================== */}
            <div className="hw-card rounded-md p-2 flex flex-col items-center justify-between gap-1.5 relative z-10 min-h-0">
              <div className="text-center shrink-0">
                <div className="text-[9.5px] font-bold tracking-wider text-slate-200 uppercase leading-tight">
                  COMPRESSION
                </div>
                <div className="text-[9px] font-mono text-slate-400">DYNAMICS</div>
              </div>

              {/* Dynamics Oscilloscope Well */}
              <div className="w-full h-14 hw-well rounded p-1 shrink-0">
                <svg viewBox="0 0 110 44" className="w-full h-full">
                  <line x1="0" y1="22" x2="110" y2="22" stroke="rgba(148,163,184,0.18)" />
                  <line
                    x1="62"
                    y1="2"
                    x2="62"
                    y2="42"
                    stroke="#F59E0B"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  <path
                    d={compScopePath}
                    fill="none"
                    stroke={compActive ? '#4ADE80' : '#2DD4BF'}
                    strokeWidth="1.6"
                  />
                </svg>
              </div>

              <div className="w-full space-y-0.5 font-mono text-[8.5px] text-center shrink-0">
                <div className="flex items-center justify-between text-slate-300 px-1">
                  <span>THRESH</span>
                  <span className="text-amber-300 font-bold tabular-nums">
                    {dsp.compressor.thresholdDb.toFixed(0)} dBFS
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400 px-1">
                  <span>GR</span>
                  <span className="text-emerald-300 font-bold tabular-nums">
                    -{Math.abs(telemetry.gainReductionDb).toFixed(1)} dB
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  onUpdateDsp({
                    compressor: { ...dsp.compressor, enabled: !dsp.compressor.enabled },
                  })
                }
                className={`w-full py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider shrink-0 cursor-pointer disabled:opacity-45 ${
                  compActive ? 'hw-pill-active' : 'hw-pill-bypass'
                }`}
              >
                {compActive ? 'ACTIVE' : 'BYPASSED'}
              </button>

              {/* Ratio / Attack / Release Quick Scrub Controls + Bottom Threshold Fader */}
              <div className="w-full space-y-1 font-mono text-[8.5px] shrink-0 bg-[#0B1015] border border-[#1E2733] rounded p-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">RATIO</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        onUpdateDsp({
                          compressor: {
                            ...dsp.compressor,
                            ratio: Math.max(1, Number((dsp.compressor.ratio - 0.5).toFixed(1))),
                          },
                        })
                      }
                      className="px-1 bg-[#161E28] rounded text-slate-300 hover:text-white cursor-pointer"
                    >
                      −
                    </button>
                    <span className="text-slate-100 font-bold tabular-nums">{dsp.compressor.ratio.toFixed(1)}:1</span>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        onUpdateDsp({
                          compressor: {
                            ...dsp.compressor,
                            ratio: Math.min(16, Number((dsp.compressor.ratio + 0.5).toFixed(1))),
                          },
                        })
                      }
                      className="px-1 bg-[#161E28] rounded text-slate-300 hover:text-white cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">ATTACK</span>
                  <span className="text-slate-200 tabular-nums">{dsp.compressor.attackMs} ms</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">RELEASE</span>
                  <span className="text-slate-200 tabular-nums">{dsp.compressor.releaseMs} ms</span>
                </div>
              </div>

              <ColumnSlider
                ariaLabel="Compressor Threshold"
                value={dsp.compressor.thresholdDb}
                min={-48}
                max={0}
                step={1}
                defaultValue={-18}
                ticks={['0', '-24', '-48']}
                accent="amber"
                disabled={locked}
                onChange={(next) =>
                  onUpdateDsp({
                    compressor: { ...dsp.compressor, thresholdDb: next, enabled: true },
                  })
                }
              />
            </div>

            {/* ==============================================================
                COL 5: FEEDBACK-SAFE PROCESSING (FBX · HPF)
                ============================================================== */}
            <div className="hw-card rounded-md p-2 flex flex-col items-center justify-between gap-1.5 relative z-10 min-h-0">
              <div className="text-center shrink-0">
                <div className="text-[9.5px] font-bold tracking-wider text-slate-200 uppercase leading-tight">
                  FEEDBACK-SAFE
                </div>
                <div className="text-[9px] font-mono text-slate-400">FBX · HPF</div>
              </div>

              {/* Notch & HPF Crosshair Display */}
              <div className="w-full h-14 hw-well rounded p-1 shrink-0">
                <svg viewBox="0 0 110 46" className="w-full h-full">
                  <line x1="55" y1="0" x2="55" y2="46" stroke="rgba(148,163,184,0.22)" />
                  <line x1="0" y1="23" x2="110" y2="23" stroke="rgba(148,163,184,0.22)" />
                  <path
                    d="M 6 42 Q 16 14 34 14 L 58 14 L 62 34 L 66 14 L 104 14"
                    fill="none"
                    stroke={fbxActive ? '#22D3EE' : '#475569'}
                    strokeWidth="2"
                  />
                  <circle cx="62" cy="34" r="3" fill="#22D3EE" />
                </svg>
              </div>

              <div className="w-full space-y-1 font-mono text-[8.5px] text-center shrink-0">
                <div className="flex items-center justify-between text-slate-300 px-1">
                  <span>HPF CUT</span>
                  <span className="text-teal-300 font-bold tabular-nums">{dsp.hpfHz} Hz</span>
                </div>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    const curr = dsp.cleanStandby?.mainsHumNotch ?? 'off';
                    const nextHum = curr === 'off' ? '50hz' : curr === '50hz' ? '60hz' : 'off';
                    onUpdateDsp({
                      cleanStandby: {
                        ...dsp.cleanStandby,
                        dcBlockerEnabled: true,
                        adaptiveStandbyGate: true,
                        standbyGateThresholdDb: dsp.cleanStandby?.standbyGateThresholdDb ?? -56,
                        mainsHumNotch: nextHum,
                      },
                    });
                  }}
                  title="Cycle 50/60 Hz AC Mains Hum Notch Trap"
                  className="w-full py-0.5 rounded bg-[#0C1016] border border-[#222B37] hover:border-teal-400/50 text-slate-300 cursor-pointer disabled:opacity-45"
                >
                  HUM TRAP: {(dsp.cleanStandby?.mainsHumNotch ?? 'off').toUpperCase()}
                </button>
              </div>

              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  onUpdateDsp({
                    hpfEnabled: !dsp.hpfEnabled,
                    qualityGate: {
                      enabled: !(dsp.qualityGate?.enabled ?? true),
                      minQualityScorePct: dsp.qualityGate?.minQualityScorePct ?? 80,
                      autoProtectOnFeedback: true,
                      autoProtectOnClip: true,
                    },
                  })
                }
                className={`w-full py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider shrink-0 cursor-pointer disabled:opacity-45 ${
                  fbxActive ? 'hw-pill-active' : 'hw-pill-bypass'
                }`}
              >
                {fbxActive ? 'ACTIVE' : 'BYPASSED'}
              </button>

              <ColumnSlider
                ariaLabel="High-Pass Filter Frequency"
                value={dsp.hpfHz}
                min={20}
                max={300}
                step={5}
                defaultValue={80}
                ticks={['300', '160', '20Hz']}
                accent="cyan"
                disabled={locked}
                onChange={(next) => onUpdateDsp({ hpfHz: next, hpfEnabled: true })}
              />
            </div>

            {/* ==============================================================
                COL 6: EFFECTS & BUS SENDS (STREAM & SUBS)
                ============================================================== */}
            <div className="hw-card rounded-md p-2 flex flex-col items-center justify-between gap-1.5 relative z-10 min-h-0">
              <div className="text-center shrink-0">
                <div className="text-[9.5px] font-bold tracking-wider text-slate-200 uppercase leading-tight">
                  EFFECTS SENDS
                </div>
                <div className="text-[9px] font-mono text-slate-400">BUS SENDS</div>
              </div>

              {/* Dual Mini Pill Toggles matching Reference Layout */}
              <div className="w-full grid grid-cols-2 gap-1 font-mono text-[8px] font-bold shrink-0">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onUpdateChannel(selectedChannel.id, { streamAssign: !streamAssigned })}
                  className={`py-0.5 rounded-full cursor-pointer disabled:opacity-45 ${
                    streamAssigned ? 'hw-pill-active' : 'hw-pill-bypass'
                  }`}
                >
                  {streamAssigned ? 'STRM ON' : 'BYPASS'}
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onUpdateChannel(selectedChannel.id, { subAssign: !subAssigned })}
                  className={`py-0.5 rounded-full cursor-pointer disabled:opacity-45 ${
                    subAssigned ? 'hw-pill-active' : 'hw-pill-bypass'
                  }`}
                >
                  {subAssigned ? 'SUB ON' : 'BYPASS'}
                </button>
              </div>

              {/* Row 1 of Brushed Knobs */}
              <div className="w-full grid grid-cols-2 gap-1 justify-items-center shrink-0">
                <RotaryKnob
                  label="STREAM"
                  value={selectedChannel.auxSends.streamBusDb}
                  min={-48}
                  max={6}
                  step={1}
                  defaultValue={0}
                  unit="dB"
                  size={34}
                  disabled={locked}
                  accent="sky"
                  onChange={(next) =>
                    onUpdateChannel(selectedChannel.id, {
                      auxSends: { ...selectedChannel.auxSends, streamBusDb: next },
                    })
                  }
                />
                <RotaryKnob
                  label="SUBS"
                  value={selectedChannel.auxSends.subsDb}
                  min={-48}
                  max={6}
                  step={1}
                  defaultValue={-6}
                  unit="dB"
                  size={34}
                  disabled={locked}
                  accent="fuchsia"
                  onChange={(next) =>
                    onUpdateChannel(selectedChannel.id, {
                      auxSends: { ...selectedChannel.auxSends, subsDb: next },
                    })
                  }
                />
              </div>

              {/* Row 2 of Brushed Knobs */}
              <div className="w-full grid grid-cols-2 gap-1 justify-items-center shrink-0">
                <RotaryKnob
                  label="WIDTH"
                  value={Math.round(dsp.stereoWidth * 100)}
                  min={0}
                  max={150}
                  step={5}
                  defaultValue={100}
                  unit="%"
                  size={34}
                  disabled={locked}
                  accent="emerald"
                  onChange={(next) => onUpdateDsp({ stereoWidth: Number((next / 100).toFixed(2)) })}
                />
                <RotaryKnob
                  label="DELAY"
                  value={dsp.masterDelayMs}
                  min={0}
                  max={200}
                  step={1}
                  defaultValue={0}
                  unit="ms"
                  size={34}
                  disabled={locked}
                  accent="amber"
                  onChange={(next) => onUpdateDsp({ masterDelayMs: next })}
                />
              </div>

              <div className="w-full flex items-center justify-between px-1 font-mono text-[8px] text-slate-400 shrink-0">
                <span>PAN {(selectedChannel.pan || 0) === 0 ? 'CTR' : `${selectedChannel.pan}%`}</span>
                <span>DLY {dsp.masterDelayMs}ms</span>
              </div>
            </div>

            {/* ==============================================================
                COL 7: MONITOR MIXES (MON 1 & SAFETY LIMITER)
                ============================================================== */}
            <div className="hw-card rounded-md p-2 flex flex-col items-center justify-between gap-1.5 relative z-10 min-h-0">
              <div className="text-center shrink-0">
                <div className="text-[9.5px] font-bold tracking-wider text-slate-200 uppercase leading-tight">
                  MONITOR MIXES
                </div>
                <div className="text-[9px] font-mono text-slate-400">MON 1</div>
              </div>

              <div className="font-mono text-base font-bold text-slate-100 tabular-nums leading-none shrink-0">
                {selectedChannel.auxSends.stageMon1Db >= 0 ? '+' : ''}
                {selectedChannel.auxSends.stageMon1Db.toFixed(1)} <span className="text-[10px] text-slate-400">dB</span>
              </div>

              {/* Monitor Crosshair Balance Display */}
              <div className="w-full h-14 hw-well rounded p-1 shrink-0">
                <svg viewBox="0 0 110 46" className="w-full h-full">
                  <line x1="55" y1="2" x2="55" y2="44" stroke="rgba(45,212,191,0.35)" />
                  <line x1="6" y1="23" x2="104" y2="23" stroke="rgba(45,212,191,0.35)" />
                  <circle cx="55" cy="23" r="3.5" fill={monActive ? '#4ADE80' : '#22D3EE'} />
                  <rect x="28" y="34" width="6" height="8" rx="1" fill="#1E293B" />
                  <rect x="38" y="30" width="6" height="12" rx="1" fill="#2DD4BF" />
                  <rect x="52" y="26" width="6" height="16" rx="1" fill="#4ADE80" />
                  <rect x="66" y="30" width="6" height="12" rx="1" fill="#2DD4BF" />
                  <rect x="76" y="34" width="6" height="8" rx="1" fill="#1E293B" />
                </svg>
              </div>

              <div className="font-mono text-[8px] text-amber-300 text-center shrink-0">
                LIM {dsp.limiter.enabled ? `${dsp.limiter.ceilingDb.toFixed(1)} dBFS` : 'OFF'}
              </div>

              <button
                type="button"
                onClick={onToggleMonitor}
                disabled={!engineRunning}
                className={`w-full py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider shrink-0 cursor-pointer disabled:opacity-45 ${
                  monActive ? 'hw-pill-active' : 'hw-pill-bypass'
                }`}
              >
                {monActive ? 'ACTIVE' : 'STANDBY'}
              </button>

              <ColumnSlider
                ariaLabel="Stage Monitor 1 Send Level"
                value={selectedChannel.auxSends.stageMon1Db}
                min={-48}
                max={10}
                step={0.5}
                defaultValue={-6}
                ticks={['+10', '0', '-24', '-48']}
                accent="green"
                disabled={locked}
                onChange={(next) =>
                  onUpdateChannel(selectedChannel.id, {
                    auxSends: { ...selectedChannel.auxSends, stageMon1Db: next },
                  })
                }
              />
            </div>
          </div>

          {/* =========================================================================
              BOTTOM STEREO BRIDGE: MAIN OUTPUTS (18-SEGMENT MAIN L & MAIN R METERS)
              ========================================================================= */}
          <div className="h-[74px] shrink-0 hw-well rounded-md px-3 py-2 flex flex-col justify-between relative">
            {/* Horizontal Glowing Teal->Green Bus Connector Line */}
            <div className="flex items-center justify-between gap-2 pb-1">
              <span className="font-mono text-[9.5px] font-bold tracking-wider text-slate-300 uppercase shrink-0">
                MAIN OUTPUTS
              </span>
              <div className="flex-1 h-[2px] bg-gradient-to-r from-[#2DD4BF] via-[#4ADE80] to-[#4ADE80] shadow-[0_0_8px_rgba(74,222,128,0.65)] relative">
                <span className="w-2 h-2 rounded-full bg-[#2DD4BF] absolute left-0 -top-[3px]" />
                <span className="w-2 h-2 rounded-full bg-[#4ADE80] absolute left-1/3 -top-[3px]" />
                <span className="w-2 h-2 rounded-full bg-[#4ADE80] absolute left-2/3 -top-[3px]" />
                <span className="w-2 h-2 rounded-full bg-[#4ADE80] absolute right-0 -top-[3px]" />
              </div>
              <span className="font-mono text-[9.5px] font-bold text-slate-300 uppercase shrink-0">
                OUTPUT LEVEL:{' '}
                <span className="text-[#4ADE80] tabular-nums">
                  {(dsp.masterOutputGainDb ?? 0) >= 0 ? '+' : ''}
                  {(dsp.masterOutputGainDb ?? 0).toFixed(1)} dB
                </span>
              </span>
            </div>

            {/* Dual Horizontal 18-Segment Meters + Output Gain Slider */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 flex flex-col gap-1">
                <div className="flex items-center gap-[3px] h-4 bg-[#06090D] border border-[#1E2733] rounded px-1 py-0.5">
                  {Array.from({ length: 18 }).map((_, i) => {
                    const lit = i < leftSegmentsLit;
                    const color =
                      i >= 16
                        ? lit
                          ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]'
                          : 'bg-[#1D1418]'
                        : i >= 13
                          ? lit
                            ? 'bg-amber-400'
                            : 'bg-[#1D1B14]'
                          : lit
                            ? 'bg-[#4ADE80] shadow-[0_0_6px_rgba(74,222,128,0.75)]'
                            : 'bg-[#101C18]';
                    return <div key={i} className={`flex-1 h-full rounded-[1px] ${color}`} />;
                  })}
                </div>
                <div className="text-center font-mono text-[8.5px] font-bold text-slate-400 tracking-wider">
                  MAIN L {engineRunning ? `(${fastPostLDb.toFixed(1)} dBFS)` : ''}
                </div>
              </div>

              <div className="flex-1 flex flex-col gap-1">
                <div className="flex items-center gap-[3px] h-4 bg-[#06090D] border border-[#1E2733] rounded px-1 py-0.5">
                  {Array.from({ length: 18 }).map((_, i) => {
                    const lit = i < rightSegmentsLit;
                    const color =
                      i >= 16
                        ? lit
                          ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]'
                          : 'bg-[#1D1418]'
                        : i >= 13
                          ? lit
                            ? 'bg-amber-400'
                            : 'bg-[#1D1B14]'
                          : lit
                            ? 'bg-[#4ADE80] shadow-[0_0_6px_rgba(74,222,128,0.75)]'
                            : 'bg-[#101C18]';
                    return <div key={i} className={`flex-1 h-full rounded-[1px] ${color}`} />;
                  })}
                </div>
                <div className="text-center font-mono text-[8.5px] font-bold text-slate-400 tracking-wider">
                  MAIN R {engineRunning ? `(${fastPostRDb.toFixed(1)} dBFS)` : ''}
                </div>
              </div>

              <div className="w-36 shrink-0 flex flex-col gap-0.5">
                <input
                  type="range"
                  aria-label="Master Output Gain Level"
                  min={-36}
                  max={6}
                  step={0.5}
                  disabled={locked}
                  value={dsp.masterOutputGainDb ?? 0}
                  onChange={(e) => onUpdateDsp({ masterOutputGainDb: parseFloat(e.target.value) })}
                  className="w-full accent-[#4ADE80] cursor-pointer disabled:opacity-45"
                />
                <div className="flex justify-between font-mono text-[8px] text-slate-500">
                  <span>-36</span>
                  <span>0 dB</span>
                  <span>+6</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
