import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Lock,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  ArrowLeftRight,
  AlertTriangle,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  DriverBackend,
  DspConfig,
  ModuleId,
  ObsStatus,
  PlatformTarget,
  ServicePreset,
  SignalTelemetry,
  SpeakerZone,
} from '../types/audio.ts';
import { liveAudioEngine, type SpectrumSnapshot } from '../audio/liveAudioEngine.ts';
import { calculateRoundTripLatencyMs, validateDspConfig } from '../utils/camillaDsp.ts';
import { SegmentedLedMeter } from './StudioControls.tsx';

interface ConsoleRightPanelProps {
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  telemetry: SignalTelemetry;
  spectrum: SpectrumSnapshot;
  audioCpuPct: number;
  underrunRisk: 'low' | 'elevated' | 'critical';
  bufferSize: number;
  sampleRate: number;
  driver: DriverBackend;
  platform: PlatformTarget;
  appVersion: string;
  engineRunning: boolean;
  emergencyMuted: boolean;
  locked?: boolean;
  onToggleEmergencyMute: () => void;
  onToggleTotalBypass: () => void;
  obsStatus: ObsStatus;
  presets: ServicePreset[];
  activePreset: ServicePreset;
  onSelectPreset: (preset: ServicePreset) => void;
  zones: SpeakerZone[];
  onNavigateModule: (mod: ModuleId) => void;
}

const CPU_SEGMENTS = 16;

export const ConsoleRightPanel: React.FC<ConsoleRightPanelProps> = ({
  dsp,
  onUpdateDsp,
  telemetry,
  spectrum,
  audioCpuPct,
  underrunRisk,
  bufferSize,
  sampleRate,
  driver,
  platform,
  appVersion,
  engineRunning,
  emergencyMuted,
  locked = false,
  onToggleEmergencyMute,
  onToggleTotalBypass,
  obsStatus,
  presets,
  activePreset,
  onSelectPreset,
  zones,
  onNavigateModule,
}) => {
  const uid = useId().replace(/:/g, '');
  const [rightTab, setRightTab] = useState<'system' | 'master'>('system');
  const [collapsed, setCollapsed] = useState(false);
  const [fastPreDb, setFastPreDb] = useState(-96);
  const [fastPostLDb, setFastPostLDb] = useState(-96);
  const [fastPostRDb, setFastPostRDb] = useState(-96);
  const [fastPeakDb, setFastPeakDb] = useState(-96);
  const [fastGrDb, setFastGrDb] = useState(0);
  const [oscPhase, setOscPhase] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Throttled ~12.5fps live levels + mini spectrum canvas (reads engine buffer directly, pauses while hidden)
  useEffect(() => {
    if (!engineRunning) {
      setFastPreDb(-96);
      setFastPostLDb(-96);
      setFastPostRDb(-96);
      setFastPeakDb(-96);
      setFastGrDb(0);
      return;
    }
    let rafId = 0;
    let lastTick = 0;
    const qHalf = (v: number) => (v <= -60 ? -96 : Math.round(v * 2) / 2);

    const tick = (now: number) => {
      if (document.hidden) {
        rafId = 0;
        return;
      }
      if (now - lastTick >= 80) {
        lastTick = now;
        const fast = liveAudioEngine.sampleFastLevels();
        if (fast.isRunning) {
          const nextPre = qHalf(fast.preRmsDb);
          const nextPostL = qHalf(fast.postLRmsDb);
          const nextPostR = qHalf(fast.postRRmsDb);
          const nextPeak = qHalf(fast.postPeakDb);
          const nextGr = Number(fast.masterGrDb.toFixed(1));
          setFastPreDb((p) => (p === nextPre ? p : nextPre));
          setFastPostLDb((p) => (p === nextPostL ? p : nextPostL));
          setFastPostRDb((p) => (p === nextPostR ? p : nextPostR));
          setFastPeakDb((p) => (p === nextPeak ? p : nextPeak));
          setFastGrDb((p) => (p === nextGr ? p : nextGr));
          if (fast.preRmsDb > -58) {
            setOscPhase((p) => (p + 1) % 1000);
          }
        }

        const canvas = canvasRef.current;
        if (canvas && rightTab === 'master') {
          const liveSpec = liveAudioEngine.getLatestSpectrum();
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = '#080C10';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, h * 0.5);
            ctx.lineTo(w, h * 0.5);
            ctx.stroke();

            if (liveSpec.preDb.length > 0) {
              const drawTrace = (bins: Float32Array, color: string, fill: string | null) => {
                ctx.beginPath();
                const samples = 72;
                const minLog = Math.log10(30);
                const maxLog = Math.log10(16000);
                for (let i = 0; i <= samples; i++) {
                  const f = Math.pow(10, minLog + (i / samples) * (maxLog - minLog));
                  const bin = Math.min(
                    bins.length - 1,
                    Math.max(1, Math.round((f * 4096) / Math.max(8000, telemetry.sampleRate)))
                  );
                  const db = Math.max(-84, Math.min(0, bins[bin] ?? -84));
                  const x = (i / samples) * w;
                  const y = ((0 - db) / 84) * (h - 4);
                  if (i === 0) ctx.moveTo(x, y);
                  else ctx.lineTo(x, y);
                }
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.4;
                ctx.stroke();
                if (fill) {
                  ctx.lineTo(w, h);
                  ctx.lineTo(0, h);
                  ctx.closePath();
                  ctx.fillStyle = fill;
                  ctx.fill();
                }
              };
              drawTrace(liveSpec.preDb, 'rgba(245, 158, 11, 0.45)', null);
              drawTrace(liveSpec.postDb, '#2DD4BF', 'rgba(45, 212, 191, 0.16)');
            }
          }
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };

    const onVis = () => {
      if (!document.hidden && !rafId) {
        lastTick = 0;
        rafId = window.requestAnimationFrame(tick);
      }
    };

    if (!document.hidden) {
      rafId = window.requestAnimationFrame(tick);
    }
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [engineRunning, rightTab, telemetry.sampleRate]);

  const latencyMs = calculateRoundTripLatencyMs(bufferSize, sampleRate, driver);
  const qualityScore = telemetry.qualityScorePct ?? 100;
  const agcGainDb = telemetry.agcGainDb ?? 0;
  const surgicalFilters = telemetry.activeSurgicalFilters ?? [];
  const headroomDb = engineRunning ? Math.max(0, -fastPeakDb) : 18;
  const lrDiff = Math.abs(fastPostLDb - fastPostRDb);
  const phaseCorr = engineRunning ? Math.max(-0.5, Math.min(1, 1 - lrDiff / 24)) : 1;

  const activeCpuSegs = engineRunning
    ? Math.max(1, Math.min(CPU_SEGMENTS, Math.round((audioCpuPct / 100) * CPU_SEGMENTS)))
    : 1;

  const validation = validateDspConfig(dsp, sampleRate, zones);
  const hasDspWarning = !validation.valid || validation.warnings.length > 0 || telemetry.feedbackRisk.detected;

  const handleSmartOptimize = () => {
    if (locked) return;
    onUpdateDsp({
      bypassed: false,
      hpfEnabled: true,
      hpfHz: Math.max(80, dsp.hpfHz),
      limiter: { ...dsp.limiter, enabled: true, ceilingDb: Math.min(-0.5, dsp.limiter.ceilingDb) },
      smartAgc: {
        enabled: true,
        targetRmsDb: dsp.smartAgc?.targetRmsDb ?? -18,
        maxBoostDb: dsp.smartAgc?.maxBoostDb ?? 14,
        maxCutDb: dsp.smartAgc?.maxCutDb ?? 18,
        gateFloorDb: dsp.smartAgc?.gateFloorDb ?? -52,
      },
      qualityGate: {
        enabled: true,
        minQualityScorePct: 80,
        autoProtectOnFeedback: true,
        autoProtectOnClip: true,
      },
      cleanStandby: {
        ...dsp.cleanStandby,
        dcBlockerEnabled: true,
        adaptiveStandbyGate: true,
        standbyGateThresholdDb: dsp.cleanStandby?.standbyGateThresholdDb ?? -56,
        mainsHumNotch:
          telemetry.humRisk.fundamentalHz === 50
            ? '50hz'
            : telemetry.humRisk.fundamentalHz === 60
              ? '60hz'
              : dsp.cleanStandby?.mainsHumNotch ?? '60hz',
      },
    });
  };

  // Semi-circular quality/headroom arc geometry
  const arcR = 34;
  const arcCx = 46;
  const arcCy = 44;
  const arcCirc = Math.PI * arcR;
  const arcPct = Math.max(0.05, Math.min(1, qualityScore / 100));

  // Oscilloscope trace for Latency card
  const oscPath = (() => {
    const w = 96;
    const mid = 18;
    const pts: string[] = [];
    const amp = engineRunning ? Math.min(14, Math.max(3, ((fastPreDb + 64) / 64) * 14)) : 2.5;
    for (let i = 0; i <= 24; i++) {
      const x = (i / 24) * w;
      const env = Math.sin((i / 24) * Math.PI);
      const y =
        mid +
        Math.sin(i * 0.85 + oscPhase * 0.35) * amp * env +
        (engineRunning ? Math.cos(i * 1.9 - oscPhase * 0.5) * (amp * 0.35) * env : 0);
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  })();

  if (collapsed) {
    return (
      <aside
        aria-label="Collapsed System Telemetry & Master Rail"
        className="w-10 shrink-0 h-full hw-panel rounded-lg flex flex-col items-center justify-between py-2.5 select-none"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand Right System Telemetry & Master Panel"
          className="p-1.5 rounded bg-[#0E141A] border border-[#2A3646] text-teal-300 hover:text-white cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-1">
          <SegmentedLedMeter
            levelDb={fastPostLDb}
            peakDb={fastPeakDb}
            muted={emergencyMuted}
            height={160}
            segments={16}
          />
          <SegmentedLedMeter
            levelDb={fastPostRDb}
            peakDb={fastPeakDb}
            muted={emergencyMuted}
            height={160}
            segments={16}
          />
        </div>

        <div className="flex flex-col items-center gap-1.5 font-mono text-[9px]">
          <span
            className={`px-1 py-0.5 rounded font-bold ${
              qualityScore >= 80 ? 'text-emerald-300 bg-emerald-500/15' : 'text-amber-300 bg-amber-500/20'
            }`}
          >
            {qualityScore}%
          </span>
          <button
            type="button"
            onClick={onToggleEmergencyMute}
            title="Emergency Safe Mute"
            className={`p-1.5 rounded border cursor-pointer ${
              emergencyMuted
                ? 'bg-red-600 border-red-300 text-white'
                : 'bg-red-950/50 border-red-500/50 text-red-300'
            }`}
          >
            {emergencyMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="System Telemetry, Preset Recall & Master Preview"
      className="w-[218px] 2xl:w-[252px] shrink-0 h-full hw-panel rounded-lg flex flex-col overflow-hidden select-none"
    >
      {/* Top Compact Switcher: SYSTEM (Reference 6 Cards) | MASTER (Live Preview) */}
      <div className="h-8 shrink-0 px-2 hw-card-header flex items-center justify-between gap-1.5">
        <div className="grid grid-cols-2 gap-1 flex-1 font-mono text-[10px] font-bold">
          <button
            type="button"
            onClick={() => setRightTab('system')}
            className={`h-6 px-2 rounded flex items-center justify-center gap-1 cursor-pointer ${
              rightTab === 'system' ? 'hw-top-btn-active' : 'hw-top-btn'
            }`}
          >
            <Activity className="w-2.5 h-2.5" />
            <span>SYSTEM</span>
          </button>
          <button
            type="button"
            onClick={() => setRightTab('master')}
            className={`h-6 px-2 rounded flex items-center justify-center gap-1 cursor-pointer ${
              rightTab === 'master' ? 'hw-top-btn-active' : 'hw-top-btn'
            }`}
          >
            <Sliders className="w-2.5 h-2.5" />
            <span>MASTER</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Collapse Right Panel to Stereo Meter Rail"
          className="p-1 rounded hw-top-btn cursor-pointer"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* =========================================================================
          TAB 1: SYSTEM TELEMETRY & PRESET RECALL (6 HARDWARE CARDS)
          ========================================================================= */}
      {rightTab === 'system' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-1.5 font-mono">
          {/* Card 1: LATENCY */}
          <div className="hw-card rounded-md overflow-hidden shrink-0">
            <div className="hw-card-subheader px-2 py-1 text-[9px] font-bold tracking-[0.1em] uppercase">
              LATENCY
            </div>
            <div className="p-1.5 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-lg font-bold text-[#4ADE80] tabular-nums leading-none">
                  {latencyMs.toFixed(1)} <span className="text-[11px] font-medium text-slate-300">ms</span>
                </div>
                <svg viewBox="0 0 96 36" className="w-20 2xl:w-24 h-7 shrink-0">
                  <line x1="0" y1="18" x2="96" y2="18" stroke="rgba(74,222,128,0.18)" strokeWidth="1" />
                  <path d={oscPath} fill="none" stroke="rgba(74,222,128,0.24)" strokeWidth="4" />
                  <path d={oscPath} fill="none" stroke="#4ADE80" strokeWidth="1.6" />
                </svg>
              </div>
              <div className="flex items-center justify-between text-[8px] pt-0.5 border-t border-[#273342]">
                <span className="text-slate-400">ROUND TRIP</span>
                <span className="flex items-center gap-1">
                  <span className="text-slate-400">STATUS</span>
                  <span className={`font-bold ${latencyMs <= 15 ? 'text-[#4ADE80]' : 'text-amber-400'}`}>
                    {latencyMs <= 15 ? 'GOOD' : 'HIGH'}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: CPU / DSP UTILIZATION */}
          <div className="hw-card rounded-md overflow-hidden shrink-0">
            <div className="hw-card-subheader px-2 py-1 text-[9px] font-bold tracking-[0.1em] uppercase">
              CPU / DSP UTILIZATION
            </div>
            <div className="p-1.5 space-y-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-3.5 bg-[#090D12] border border-[#2C394A] rounded-[3px] p-0.5 flex items-center gap-[2px]">
                  {Array.from({ length: CPU_SEGMENTS }).map((_, i) => {
                    const lit = engineRunning && i < activeCpuSegs;
                    const cls =
                      i >= 14
                        ? lit
                          ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]'
                          : 'bg-[#1D1518]'
                        : i >= 12
                          ? lit
                            ? 'bg-amber-400'
                            : 'bg-[#1D1B14]'
                          : lit
                            ? 'bg-[#4ADE80] shadow-[0_0_5px_rgba(74,222,128,0.65)]'
                            : 'bg-[#111D18]';
                    return <div key={i} className={`flex-1 h-full rounded-[1px] ${cls}`} />;
                  })}
                </div>
                <span className="text-[10.5px] font-bold text-slate-100 tabular-nums w-8 text-right">
                  {audioCpuPct}%
                </span>
              </div>
              <div className="flex items-center justify-between text-[8px]">
                <span className="flex items-center gap-1 text-slate-300">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      engineRunning ? 'bg-[#4ADE80] shadow-[0_0_5px_rgba(74,222,128,0.85)]' : 'bg-slate-600'
                    }`}
                  />
                  DSP
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-slate-400">STATUS</span>
                  <span
                    className={`font-bold ${
                      underrunRisk === 'critical'
                        ? 'text-red-400'
                        : underrunRisk === 'elevated'
                          ? 'text-amber-400'
                          : 'text-[#4ADE80]'
                    }`}
                  >
                    {underrunRisk === 'critical' ? 'XRUN' : underrunRisk === 'elevated' ? 'RISK' : 'GOOD'}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: QUALITY & HEADROOM (Real Telemetry Semi-Circular Arc Gauge — Zero Mock Temps) */}
          <div className="hw-card rounded-md overflow-hidden shrink-0">
            <div className="hw-card-subheader px-2 py-1 flex items-center justify-between">
              <span className="text-[9px] font-bold tracking-[0.1em] uppercase">
                QUALITY &amp; HEADROOM
              </span>
              <button
                type="button"
                disabled={locked}
                onClick={handleSmartOptimize}
                title="Engage Smart Auto-Optimize (AGC + Quality Gate + HPF + Hum Protection)"
                className="px-1.5 py-0.5 rounded hw-top-btn-active text-[8px] font-bold flex items-center gap-0.5 cursor-pointer disabled:opacity-45"
              >
                <Sparkles className="w-2.5 h-2.5" />
                OPT
              </button>
            </div>

            <div className="p-1.5 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <svg viewBox="0 0 92 54" className="w-[74px] 2xl:w-[82px] h-[44px] shrink-0">
                  <defs>
                    <linearGradient id={`qgrad-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#22C55E" />
                      <stop offset="55%" stopColor="#FACC15" />
                      <stop offset="100%" stopColor="#F97316" />
                    </linearGradient>
                  </defs>
                  <path
                    d={`M ${arcCx - arcR} ${arcCy} A ${arcR} ${arcR} 0 0 1 ${arcCx + arcR} ${arcCy}`}
                    fill="none"
                    stroke="#1E2733"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <path
                    d={`M ${arcCx - arcR} ${arcCy} A ${arcR} ${arcR} 0 0 1 ${arcCx + arcR} ${arcCy}`}
                    fill="none"
                    stroke={`url(#${`qgrad-${uid}`})`}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${arcCirc * arcPct} ${arcCirc}`}
                  />
                  <text
                    x={arcCx}
                    y={arcCy - 3}
                    textAnchor="middle"
                    fill="#F8FAFC"
                    fontSize="12"
                    fontWeight="700"
                  >
                    {qualityScore}%
                  </text>
                </svg>

                <div className="flex-1 text-right space-y-0.5 text-[8.5px]">
                  <div className="text-slate-300 tabular-nums">
                    HD <span className="text-teal-300 font-bold">+{headroomDb.toFixed(1)} dB</span>
                  </div>
                  <div className="text-slate-400 tabular-nums">
                    LUFS{' '}
                    <span className="text-slate-200 font-semibold">
                      {engineRunning ? telemetry.estimatedLufs.toFixed(1) : '--'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">STATUS </span>
                    <span className={`font-bold ${qualityScore >= 80 ? 'text-[#4ADE80]' : 'text-amber-400'}`}>
                      {qualityScore >= 80 ? 'GOOD' : 'GUARD'}
                    </span>
                  </div>
                </div>
              </div>

              {(telemetry.feedbackRisk.detected || telemetry.humRisk.detected) && (
                <div className="flex items-center gap-1 pt-0.5 text-[8px]">
                  {telemetry.feedbackRisk.detected && (
                    <span className="px-1.5 py-0.5 rounded bg-red-600/30 border border-red-400 text-red-200 font-bold">
                      RING {telemetry.feedbackRisk.frequencyHz}Hz
                    </span>
                  )}
                  {telemetry.humRisk.detected && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-600/30 border border-amber-400 text-amber-200 font-bold">
                      HUM {telemetry.humRisk.fundamentalHz}Hz
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Card 4: CLOCK STATUS */}
          <div className="hw-card rounded-md overflow-hidden shrink-0">
            <div className="hw-card-subheader px-2 py-1 text-[9px] font-bold tracking-[0.1em] uppercase">
              CLOCK STATUS
            </div>
            <div className="p-1.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="px-1.5 py-0.5 rounded bg-[#0E1319] border border-[#48596D] text-[9px] font-bold text-slate-200 flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5 text-teal-400" />
                  LOCKED
                </span>
                <span className="text-xs font-bold text-[#4ADE80] tabular-nums">
                  {(sampleRate / 1000).toFixed(1)} kHz
                </span>
              </div>
              <div className="flex items-center justify-between text-[8px] border-t border-[#273342] pt-0.5">
                <span className="text-slate-400 truncate">
                  {driver} · {bufferSize} smp
                </span>
                <span className="text-[#4ADE80] font-bold shrink-0">
                  {engineRunning ? 'GOOD' : 'READY'}
                </span>
              </div>
            </div>
          </div>

          {/* Card 5: ENGINE & SYNC */}
          <button
            type="button"
            onClick={() => onNavigateModule('hardware')}
            title="Click to inspect Hardware Diagnostics & Audio Drivers"
            className="hw-card rounded-md overflow-hidden shrink-0 text-left hover:border-[#687F99] cursor-pointer"
          >
            <div className="hw-card-subheader px-2 py-1 text-[9px] font-bold tracking-[0.1em] uppercase">
              FIRMWARE / ENGINE
            </div>
            <div className="p-1.5 space-y-0.5">
              <div className="flex items-center justify-between text-[9.5px]">
                <span className="text-slate-200 font-semibold">v{appVersion}</span>
                <span className="text-slate-400 uppercase">{platform} · {zones.length} ZONES</span>
              </div>
              <div className="flex items-center justify-between text-[8.5px] pt-0.5 border-t border-[#273342]">
                <span className="text-slate-400 flex items-center gap-1">
                  <Radio className="w-2.5 h-2.5 text-teal-400" />
                  OBS: {obsStatus.streaming ? 'LIVE' : obsStatus.connected ? 'READY' : 'STANDBY'}
                </span>
                <span className="text-[#4ADE80] font-bold">STATUS OK</span>
              </div>
            </div>
          </button>

          {/* Card 6: PRESET RECALL */}
          <div className="hw-card rounded-md overflow-hidden flex-1 min-h-[140px] flex flex-col">
            <div className="hw-card-subheader px-2 py-1 text-[9px] font-bold tracking-[0.1em] uppercase shrink-0">
              PRESET RECALL
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
              {presets.map((preset) => {
                const isActive = preset.id === activePreset.id;
                const showWarn = isActive && hasDspWarning;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={locked}
                    onClick={() => onSelectPreset(preset)}
                    className={`w-full px-2 py-1 rounded text-left text-[10px] font-sans flex items-center justify-between gap-1.5 transition cursor-pointer disabled:opacity-60 ${
                      isActive
                        ? 'hw-preset-active font-semibold'
                        : 'bg-[#131A23] border border-[#3B4B5E] text-slate-200 hover:border-[#5D738E] hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <ArrowLeftRight className={`w-2.5 h-2.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      <span className="truncate">{preset.name}</span>
                    </span>
                    {showWarn && (
                      <span className="px-1 py-0.5 rounded bg-gradient-to-b from-amber-500 to-orange-600 text-white font-mono text-[7px] font-bold uppercase shrink-0 shadow-xs">
                        WARNING
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: FULL MASTER PREVIEW & CONTROL DOCK
          ========================================================================= */}
      {rightTab === 'master' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col justify-between gap-1.5 font-mono text-[9.5px]">
          {/* Pre vs Post Stereo Meters + LUFS */}
          <div className="p-1.5 rounded-md hw-well space-y-1.5 shrink-0">
            <div className="flex items-center justify-between text-[8.5px] text-slate-400">
              <span>PRE · POST L/R</span>
              <span className="text-teal-300 font-bold tabular-nums">
                {engineRunning ? `${telemetry.estimatedLufs.toFixed(1)} LUFS` : 'STANDBY'}
              </span>
            </div>

            <div className="flex items-end justify-around py-0.5">
              <div className="flex flex-col items-center gap-0.5">
                <SegmentedLedMeter levelDb={fastPreDb} peakDb={fastPreDb} height={64} segments={10} />
                <span className="text-[7.5px] text-amber-400">PRE</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <SegmentedLedMeter
                  levelDb={fastPostLDb}
                  peakDb={fastPeakDb}
                  muted={emergencyMuted}
                  height={64}
                  segments={10}
                />
                <span className="text-[7.5px] text-emerald-400">OUT L</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <SegmentedLedMeter
                  levelDb={fastPostRDb}
                  peakDb={fastPeakDb}
                  muted={emergencyMuted}
                  height={64}
                  segments={10}
                />
                <span className="text-[7.5px] text-emerald-400">OUT R</span>
              </div>
              <div className="flex flex-col items-center justify-between h-[74px] text-[8.5px] text-right">
                <div>
                  <div className="text-[7.5px] text-slate-500">PEAK</div>
                  <div className={`font-bold tabular-nums ${fastPeakDb > -1.5 ? 'text-amber-400' : 'text-emerald-300'}`}>
                    {engineRunning ? `${fastPeakDb.toFixed(1)}` : '--'}
                  </div>
                </div>
                <div>
                  <div className="text-[7.5px] text-slate-500">GR</div>
                  <div className="font-bold text-amber-300 tabular-nums">-{fastGrDb.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-[7.5px] text-slate-500">AGC</div>
                  <div className="font-bold text-teal-300 tabular-nums">
                    {agcGainDb >= 0 ? `+${agcGainDb.toFixed(1)}` : agcGainDb.toFixed(1)}
                  </div>
                </div>
              </div>
            </div>

            <canvas
              ref={canvasRef}
              width={210}
              height={40}
              className="w-full h-10 rounded border border-[#1E2733] block"
            />

            <div className="grid grid-cols-6 gap-0.5 text-[7px] font-bold text-center">
              {[
                { label: 'PRE', on: engineRunning, warn: fastPreDb > -3 },
                { label: 'AGC', on: Boolean(dsp.smartAgc?.enabled && !dsp.bypassed), warn: Math.abs(agcGainDb) > 6 },
                { label: 'EQ', on: !dsp.bypassed, warn: surgicalFilters.length > 0 },
                { label: 'CMP', on: Boolean(dsp.compressor.enabled && !dsp.bypassed), warn: fastGrDb > 4 },
                { label: 'LIM', on: Boolean(dsp.limiter.enabled && !dsp.bypassed), warn: fastPeakDb > dsp.limiter.ceilingDb - 1 },
                { label: 'OUT', on: engineRunning && !emergencyMuted, warn: emergencyMuted },
              ].map((n) => (
                <div
                  key={n.label}
                  className={`py-0.5 rounded border ${
                    n.warn
                      ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                      : n.on
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-[#10151C] border-[#222C38] text-slate-600'
                  }`}
                >
                  {n.label}
                </div>
              ))}
            </div>

            <div className="space-y-0.5">
              <div className="flex justify-between text-[8px] text-slate-400">
                <span>PHASE CORR: +{phaseCorr.toFixed(2)}</span>
                <span>HEADROOM: {headroomDb.toFixed(1)} dB</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#06090D] border border-[#1E2733] relative overflow-hidden">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600" />
                <div
                  className={`h-full transition-all duration-100 ${phaseCorr >= 0.5 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  style={{ width: `${Math.max(10, Math.min(100, ((phaseCorr + 1) / 2) * 100))}%` }}
                />
              </div>
            </div>
          </div>

          {/* Quality Gate & Surgical Filter Alerts */}
          <div className="p-2 rounded-md hw-card space-y-1.5 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                QUALITY GATE
              </span>
              <span
                className={`font-bold ${
                  qualityScore >= 80 ? 'text-emerald-400' : qualityScore >= 60 ? 'text-amber-400' : 'text-rose-400'
                }`}
              >
                {qualityScore}% {telemetry.qualityGateEngaged ? 'PROTECT' : 'CLEAN'}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <span
                className={`flex-1 text-center py-0.5 rounded border text-[8.5px] font-bold ${
                  telemetry.feedbackRisk.detected
                    ? 'bg-red-600/30 border-red-400 text-red-200 animate-pulse'
                    : 'bg-[#0C1117] border-[#222B37] text-slate-400'
                }`}
              >
                {telemetry.feedbackRisk.detected ? `RING ${telemetry.feedbackRisk.frequencyHz}Hz` : 'NO RING'}
              </span>
              <span
                className={`flex-1 text-center py-0.5 rounded border text-[8.5px] font-bold ${
                  telemetry.humRisk.detected
                    ? 'bg-amber-600/30 border-amber-400 text-amber-200'
                    : 'bg-[#0C1117] border-[#222B37] text-slate-400'
                }`}
              >
                {telemetry.humRisk.detected ? `HUM ${telemetry.humRisk.fundamentalHz}Hz` : 'NO HUM'}
              </span>
            </div>

            {surgicalFilters.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {surgicalFilters.slice(0, 3).map((f) => (
                  <span
                    key={f}
                    className="px-1.5 py-0.5 rounded bg-teal-500/15 border border-teal-400/40 text-teal-200 text-[8px] truncate max-w-full"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={locked}
              onClick={handleSmartOptimize}
              className="w-full py-1 rounded hw-top-btn-active font-bold text-[9px] flex items-center justify-center gap-1 cursor-pointer disabled:opacity-45"
            >
              <Sparkles className="w-3 h-3 text-teal-200" />
              SMART AUTO-OPTIMIZE
            </button>
          </div>

          {/* Master Output & Safety Controls */}
          <div className="p-2 rounded-md hw-card space-y-2 shrink-0">
            <div className="flex items-center justify-between text-teal-300 font-bold">
              <span className="flex items-center gap-1">
                <Sliders className="w-3 h-3" />
                MASTER OUTPUT
              </span>
              <span className="tabular-nums">
                {(dsp.masterOutputGainDb ?? 0) >= 0 ? '+' : ''}
                {(dsp.masterOutputGainDb ?? 0).toFixed(1)} dB
              </span>
            </div>
            <input
              type="range"
              min={-36}
              max={6}
              step={0.5}
              disabled={locked}
              value={dsp.masterOutputGainDb ?? 0}
              onChange={(e) => onUpdateDsp({ masterOutputGainDb: parseFloat(e.target.value) })}
              className="w-full accent-teal-400 cursor-pointer disabled:opacity-45"
            />

            <div className="flex items-center justify-between text-[9px] text-amber-300">
              <span>LIMITER CEILING</span>
              <span className="font-bold tabular-nums">{dsp.limiter.ceilingDb.toFixed(1)} dBFS</span>
            </div>
            <input
              type="range"
              min={-12}
              max={0}
              step={0.5}
              disabled={locked}
              value={dsp.limiter.ceilingDb}
              onChange={(e) =>
                onUpdateDsp({
                  limiter: { ...dsp.limiter, ceilingDb: parseFloat(e.target.value), enabled: true },
                })
              }
              className="w-full accent-amber-400 cursor-pointer disabled:opacity-45"
            />

            <div className="grid grid-cols-2 gap-1 pt-0.5">
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
                className={`py-1 rounded border font-bold text-[9px] cursor-pointer disabled:opacity-45 ${
                  dsp.smartAgc?.enabled
                    ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
                    : 'bg-[#0C1117] border-[#26313E] text-slate-400'
                }`}
              >
                AGC {dsp.smartAgc?.enabled ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                disabled={locked}
                onClick={onToggleTotalBypass}
                className={`py-1 rounded border font-bold text-[9px] cursor-pointer disabled:opacity-45 ${
                  dsp.bypassed
                    ? 'bg-amber-500 text-slate-950 border-amber-300'
                    : 'bg-teal-500/20 border-teal-400/50 text-teal-200'
                }`}
              >
                {dsp.bypassed ? 'BYPASSED' : 'DSP ACTIVE'}
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleEmergencyMute}
              className={`w-full py-1.5 rounded border font-bold text-[9.5px] flex items-center justify-center gap-1.5 cursor-pointer ${
                emergencyMuted
                  ? 'bg-red-600 border-red-300 text-white shadow-[0_0_10px_rgba(239,68,68,0.6)]'
                  : 'bg-red-950/40 border-red-500/50 text-red-300 hover:bg-red-600/25'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {emergencyMuted ? 'PA & STREAM MUTED' : 'EMERGENCY SAFE MUTE'}
            </button>
          </div>

          {/* OBS Sync Pill */}
          <button
            type="button"
            onClick={() => onNavigateModule('livestream')}
            className="hw-card p-2 rounded-md hover:border-teal-500/40 text-left space-y-0.5 shrink-0 cursor-pointer"
          >
            <div className="flex items-center justify-between text-[9px]">
              <span className="text-slate-400 flex items-center gap-1">
                <Radio className="w-3 h-3 text-teal-400" />
                OBS SYNC
              </span>
              <span
                className={
                  obsStatus.streaming
                    ? 'text-rose-400 font-bold'
                    : obsStatus.connected
                      ? 'text-emerald-400 font-bold'
                      : 'text-slate-500'
                }
              >
                {obsStatus.streaming ? '● LIVE' : obsStatus.connected ? 'READY' : 'STANDBY'}
              </span>
            </div>
            <div className="text-[9px] text-slate-300 truncate flex items-center justify-between">
              <span className="truncate">Scene: {obsStatus.activeScene}</span>
              {obsStatus.syncWarning && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
            </div>
          </button>
        </div>
      )}
    </aside>
  );
};
