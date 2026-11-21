import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { DspConfig, ModuleId, ObsStatus, SignalTelemetry } from '../types/audio.ts';
import { liveAudioEngine, type SpectrumSnapshot } from '../audio/liveAudioEngine.ts';
import { SegmentedLedMeter } from './StudioControls.tsx';

interface MasterPreviewDockProps {
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  telemetry: SignalTelemetry;
  spectrum: SpectrumSnapshot;
  emergencyMuted: boolean;
  onToggleEmergencyMute: () => void;
  onToggleTotalBypass: () => void;
  obsStatus: ObsStatus;
  onNavigateModule: (mod: ModuleId) => void;
}

export const MasterPreviewDock: React.FC<MasterPreviewDockProps> = ({
  dsp,
  onUpdateDsp,
  telemetry,
  spectrum,
  emergencyMuted,
  onToggleEmergencyMute,
  onToggleTotalBypass,
  obsStatus,
  onNavigateModule,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [fastPreDb, setFastPreDb] = useState(-96);
  const [fastPostLDb, setFastPostLDb] = useState(-96);
  const [fastPostRDb, setFastPostRDb] = useState(-96);
  const [fastPeakDb, setFastPeakDb] = useState(-96);
  const [fastGrDb, setFastGrDb] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 60fps live meter & mini spectrum preview across all modules
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const fast = liveAudioEngine.sampleFastLevels();
      if (fast.isRunning) {
        setFastPreDb(fast.preRmsDb);
        setFastPostLDb(fast.postLRmsDb);
        setFastPostRDb(fast.postRRmsDb);
        setFastPeakDb(fast.postPeakDb);
        setFastGrDb(fast.masterGrDb);
      } else {
        setFastPreDb(-96);
        setFastPostLDb(-96);
        setFastPostRDb(-96);
        setFastPeakDb(-96);
        setFastGrDb(0);
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#04060B';
          ctx.fillRect(0, 0, w, h);

          // Grid
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, h * 0.5);
          ctx.lineTo(w, h * 0.5);
          ctx.stroke();

          if (telemetry.isRunning && spectrum.preDb.length > 0) {
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
            drawTrace(spectrum.preDb, 'rgba(245, 158, 11, 0.45)', null);
            drawTrace(spectrum.postDb, '#38BDF8', 'rgba(56, 189, 248, 0.16)');
          }
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [telemetry.isRunning, telemetry.sampleRate, spectrum]);

  const qualityScore = telemetry.qualityScorePct ?? 100;
  const agcGainDb = telemetry.agcGainDb ?? 0;
  const surgicalFilters = telemetry.activeSurgicalFilters ?? [];
  const headroomDb = telemetry.isRunning ? Math.max(0, -fastPeakDb) : 18;
  // Stereo correlation proxy from L/R RMS balance (1.0 = centered mono/stereo, lower = wide/asymmetric)
  const lrDiff = Math.abs(fastPostLDb - fastPostRDb);
  const phaseCorr = telemetry.isRunning ? Math.max(-0.5, Math.min(1, 1 - lrDiff / 24)) : 1;

  const handleSmartOptimize = () => {
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

  if (collapsed) {
    return (
      <aside
        aria-label="Master Live Preview Rail"
        className="w-10 shrink-0 h-full bg-[#090D16] border-l border-slate-800 flex flex-col items-center justify-between py-2 select-none"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand Master Live Preview Dock"
          className="p-1.5 rounded bg-slate-900 border border-slate-700 text-sky-300 hover:text-white cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-1">
          <SegmentedLedMeter
            levelDb={fastPostLDb}
            peakDb={fastPeakDb}
            muted={emergencyMuted}
            height={160}
            segments={18}
          />
          <SegmentedLedMeter
            levelDb={fastPostRDb}
            peakDb={fastPeakDb}
            muted={emergencyMuted}
            height={160}
            segments={18}
          />
        </div>

        <div className="flex flex-col items-center gap-1.5 font-mono text-[9px]">
          <span
            className={`px-1 py-0.5 rounded font-bold ${
              qualityScore >= 80 ? 'text-emerald-300 bg-emerald-500/15' : 'text-amber-300 bg-amber-500/20'
            }`}
            title="Live Output Quality Score"
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
      aria-label="Master Live Preview & Control Dock"
      className="w-60 shrink-0 h-full bg-gradient-to-b from-[#0C111D] to-[#070A11] border-l border-slate-800 flex flex-col justify-between p-2.5 gap-2 overflow-y-auto scrollbar-none select-none font-mono text-[10px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              telemetry.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
            }`}
          />
          <span className="font-bold text-white tracking-wider">LIVE MASTER PREVIEW</span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Collapse to meter rail"
          className="p-1 rounded bg-slate-900 border border-slate-700 text-slate-400 hover:text-white cursor-pointer"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      {/* Live Pre vs Post Stereo Meters + LUFS */}
      <div className="p-2 rounded-lg border border-slate-800 bg-[#05080F] space-y-2 shrink-0">
        <div className="flex items-center justify-between text-[9px] text-slate-400">
          <span>PRE · POST L/R</span>
          <span className="text-sky-300 font-bold tabular-nums">
            {telemetry.isRunning ? `${telemetry.estimatedLufs.toFixed(1)} LUFS` : 'STANDBY'}
          </span>
        </div>

        <div className="flex items-end justify-around py-1">
          <div className="flex flex-col items-center gap-1">
            <SegmentedLedMeter levelDb={fastPreDb} peakDb={fastPreDb} height={82} segments={12} />
            <span className="text-[8px] text-amber-400">PRE</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <SegmentedLedMeter
              levelDb={fastPostLDb}
              peakDb={fastPeakDb}
              muted={emergencyMuted}
              height={82}
              segments={12}
            />
            <span className="text-[8px] text-emerald-400">OUT L</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <SegmentedLedMeter
              levelDb={fastPostRDb}
              peakDb={fastPeakDb}
              muted={emergencyMuted}
              height={82}
              segments={12}
            />
            <span className="text-[8px] text-emerald-400">OUT R</span>
          </div>
          <div className="flex flex-col items-center justify-between h-[96px] text-[9px] text-right">
            <div>
              <div className="text-[8px] text-slate-500">PEAK</div>
              <div
                className={`font-bold tabular-nums ${
                  fastPeakDb > -1.5 ? 'text-amber-400' : 'text-emerald-300'
                }`}
              >
                {telemetry.isRunning ? `${fastPeakDb.toFixed(1)}` : '--'}
              </div>
            </div>
            <div>
              <div className="text-[8px] text-slate-500">GR</div>
              <div className="font-bold text-amber-300 tabular-nums">-{fastGrDb.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-[8px] text-slate-500">AGC</div>
              <div className="font-bold text-sky-300 tabular-nums">
                {agcGainDb >= 0 ? `+${agcGainDb.toFixed(1)}` : agcGainDb.toFixed(1)}
              </div>
            </div>
          </div>
        </div>

        {/* Mini Pre/Post Real-Time Spectrum Scope */}
        <canvas
          ref={canvasRef}
          width={210}
          height={48}
          className="w-full h-12 rounded border border-slate-800/80 block"
        />

        {/* Live Signal Chain LEDs + Stereo Phase Correlation */}
        <div className="grid grid-cols-6 gap-0.5 text-[7px] font-bold text-center">
          {[
            { label: 'PRE', on: telemetry.isRunning, warn: fastPreDb > -3 },
            { label: 'AGC', on: Boolean(dsp.smartAgc?.enabled && !dsp.bypassed), warn: Math.abs(agcGainDb) > 6 },
            { label: 'EQ', on: !dsp.bypassed, warn: surgicalFilters.length > 0 },
            { label: 'CMP', on: Boolean(dsp.compressor.enabled && !dsp.bypassed), warn: fastGrDb > 4 },
            { label: 'LIM', on: Boolean(dsp.limiter.enabled && !dsp.bypassed), warn: fastPeakDb > dsp.limiter.ceilingDb - 1 },
            { label: 'OUT', on: telemetry.isRunning && !emergencyMuted, warn: emergencyMuted },
          ].map((n) => (
            <div
              key={n.label}
              className={`py-0.5 rounded border ${
                n.warn
                  ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                  : n.on
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-600'
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
          <div className="h-1.5 rounded-full bg-[#030509] border border-slate-800 relative overflow-hidden">
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600" />
            <div
              className={`h-full transition-all duration-100 ${
                phaseCorr >= 0.5 ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
              style={{ width: `${Math.max(10, Math.min(100, ((phaseCorr + 1) / 2) * 100))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Live Output Quality Gate & Surgical Filter Alerts */}
      <div className="p-2 rounded-lg border border-slate-800 bg-[#070B12] space-y-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            QUALITY GATE
          </span>
          <span
            className={`font-bold ${
              qualityScore >= 80
                ? 'text-emerald-400'
                : qualityScore >= 60
                  ? 'text-amber-400'
                  : 'text-rose-400'
            }`}
          >
            {qualityScore}% {telemetry.qualityGateEngaged ? 'PROTECT' : 'CLEAN'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <span
            className={`flex-1 text-center py-0.5 rounded border text-[9px] font-bold ${
              telemetry.feedbackRisk.detected
                ? 'bg-red-600/30 border-red-400 text-red-200 animate-pulse'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            {telemetry.feedbackRisk.detected
              ? `RING ${telemetry.feedbackRisk.frequencyHz}Hz`
              : 'NO RING'}
          </span>
          <span
            className={`flex-1 text-center py-0.5 rounded border text-[9px] font-bold ${
              telemetry.humRisk.detected
                ? 'bg-amber-600/30 border-amber-400 text-amber-200'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            {telemetry.humRisk.detected ? `HUM ${telemetry.humRisk.fundamentalHz}Hz` : 'NO HUM'}
          </span>
        </div>

        {surgicalFilters.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {surgicalFilters.slice(0, 3).map((f) => (
              <span
                key={f}
                className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-sky-200 text-[8px] truncate max-w-full"
              >
                {f}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleSmartOptimize}
          className="w-full py-1 rounded border border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/30 text-sky-200 font-bold text-[9px] flex items-center justify-center gap-1 cursor-pointer"
          title="Engage Smart AGC, Quality Gate, HPF & Hum Protection in 1 click"
        >
          <Sparkles className="w-3 h-3 text-sky-300" />
          SMART AUTO-OPTIMIZE
        </button>
      </div>

      {/* Always-On Master Output & Safety Controls */}
      <div className="p-2 rounded-lg border border-sky-500/30 bg-[#080D17] space-y-2 shrink-0">
        <div className="flex items-center justify-between text-sky-300 font-bold">
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
          value={dsp.masterOutputGainDb ?? 0}
          onChange={(e) => onUpdateDsp({ masterOutputGainDb: parseFloat(e.target.value) })}
          className="w-full accent-sky-400 cursor-pointer"
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
          value={dsp.limiter.ceilingDb}
          onChange={(e) =>
            onUpdateDsp({
              limiter: { ...dsp.limiter, ceilingDb: parseFloat(e.target.value), enabled: true },
            })
          }
          className="w-full accent-amber-400 cursor-pointer"
        />

        <div className="grid grid-cols-2 gap-1 pt-1">
          <button
            type="button"
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
            className={`py-1 rounded border font-bold text-[9px] cursor-pointer ${
              dsp.smartAgc?.enabled
                ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
          >
            AGC {dsp.smartAgc?.enabled ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={onToggleTotalBypass}
            className={`py-1 rounded border font-bold text-[9px] cursor-pointer ${
              dsp.bypassed
                ? 'bg-amber-500 text-slate-950 border-amber-300'
                : 'bg-sky-500/20 border-sky-400/50 text-sky-200'
            }`}
          >
            {dsp.bypassed ? 'BYPASSED' : 'DSP ACTIVE'}
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleEmergencyMute}
          className={`w-full py-1.5 rounded border font-bold text-[10px] flex items-center justify-center gap-1.5 cursor-pointer ${
            emergencyMuted
              ? 'bg-red-600 border-red-300 text-white shadow-[0_0_10px_rgba(239,68,68,0.6)]'
              : 'bg-red-950/40 border-red-500/50 text-red-300 hover:bg-red-600/25'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          {emergencyMuted ? 'PA & STREAM MUTED' : 'EMERGENCY SAFE MUTE'}
        </button>
      </div>

      {/* Live OBS Sync Status Pill */}
      <button
        type="button"
        onClick={() => onNavigateModule('livestream')}
        className="p-2 rounded-lg border border-slate-800 bg-[#060910] hover:border-sky-500/40 text-left space-y-0.5 shrink-0 cursor-pointer"
      >
        <div className="flex items-center justify-between text-[9px]">
          <span className="text-slate-400 flex items-center gap-1">
            <Radio className="w-3 h-3 text-sky-400" />
            OBS SYNC
          </span>
          <span className={obsStatus.streaming ? 'text-rose-400 font-bold' : obsStatus.connected ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
            {obsStatus.streaming ? '● LIVE' : obsStatus.connected ? 'READY' : 'STANDBY'}
          </span>
        </div>
        <div className="text-[9px] text-slate-300 truncate">
          Scene: {obsStatus.activeScene}
        </div>
      </button>
    </aside>
  );
};
