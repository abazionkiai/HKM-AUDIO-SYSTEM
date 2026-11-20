import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck, RotateCcw } from 'lucide-react';
import type { DspConfig, EqBand, SignalTelemetry } from '../types/audio.ts';
import type { SpectrumSnapshot } from '../audio/liveAudioEngine.ts';
import {
  ArcGauge,
  ConsolePushButton,
  RotaryKnob,
  SegmentedLedMeter,
} from './StudioControls.tsx';

interface FeedbackAnalyzerModuleProps {
  telemetry: SignalTelemetry;
  spectrum: SpectrumSnapshot;
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  onLogVerification: (summary: string) => void;
}

function heatColor(db: number): [number, number, number] {
  const norm = Math.max(0, Math.min(1, (db + 84) / 80));
  if (norm < 0.25) {
    const t = norm / 0.25;
    return [9, Math.round(12 + t * 26), Math.round(18 + t * 55)];
  }
  if (norm < 0.55) {
    const t = (norm - 0.25) / 0.3;
    return [Math.round(9 + t * 18), Math.round(38 + t * 135), Math.round(73 + t * 165)];
  }
  if (norm < 0.8) {
    const t = (norm - 0.55) / 0.25;
    return [Math.round(27 + t * 218), Math.round(173 - t * 15), Math.round(238 - t * 227)];
  }
  const t = (norm - 0.8) / 0.2;
  return [239 + Math.round(t * 16), Math.round(158 - t * 100), Math.round(11 + t * 55)];
}

interface WaterfallSlice {
  timestamp: number;
  binsDb: Float32Array;
  peakFreqHz: number | null;
}

const WINDOW_SECONDS = 10;
const SAMPLE_INTERVAL_MS = 110;
const MAX_SLICES = 90; // ~10s rolling window
const FREQ_POINTS = 64;

export const FeedbackAnalyzerModule: React.FC<FeedbackAnalyzerModuleProps> = ({
  telemetry,
  spectrum,
  dsp,
  onUpdateDsp,
  onLogVerification,
}) => {
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const historySlicesRef = useRef<WaterfallSlice[]>([]);
  const lastSampleTimeRef = useRef<number>(0);

  const [beforeSnap, setBeforeSnap] = useState<{ label: string; peakFreq: number | null; rmsDb: number } | null>(null);
  const [verificationMsg, setVerificationMsg] = useState<string | null>(null);
  const [sensitivityDb, setSensitivityDb] = useState<number>(6.0);
  const [autoGuardArmed, setAutoGuardArmed] = useState<boolean>(false);
  const [waterfallFrozen, setWaterfallFrozen] = useState<boolean>(false);
  const [perspectiveTilt, setPerspectiveTilt] = useState<'isometric' | 'steep'>('isometric');
  const [ringLog, setRingLog] = useState<
    { id: string; time: string; freqHz: number; action: string; depthDb: number }[]
  >([]);

  const notchBand = dsp.eqBands[3] ?? dsp.eqBands[0];
  const mudBand = dsp.eqBands[1] ?? dsp.eqBands[0];
  const headroomMarginDb = telemetry.isRunning ? Math.max(0, -telemetry.postPeakDb) : 0;

  const updateBandByIndex = (idx: number, patch: Partial<EqBand>) => {
    onUpdateDsp({
      eqBands: dsp.eqBands.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    });
  };

  // Render Live Dual-Trace FFT Canvas + Scrolling Waterfall Spectrogram
  useEffect(() => {
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);

    const canvas = spectrumCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#070A10';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = 1;
        [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].forEach((f) => {
          const x = ((Math.log10(f) - minLog) / (maxLog - minLog)) * w;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h - 18);
          ctx.stroke();
          ctx.fillStyle = '#64748B';
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, h - 5);
        });

        [-12, -24, -36, -48, -60, -72].forEach((db) => {
          const y = ((0 - db) / 84) * (h - 20);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          ctx.fillStyle = '#475569';
          ctx.textAlign = 'left';
          ctx.fillText(`${db}`, 6, y - 3);
        });

        const drawTrace = (bins: Float32Array, stroke: string, fill: string | null) => {
          ctx.beginPath();
          const sampleCount = 260;
          for (let i = 0; i <= sampleCount; i++) {
            const f = Math.pow(10, minLog + (i / sampleCount) * (maxLog - minLog));
            const binIdx = Math.min(
              bins.length - 1,
              Math.max(1, Math.round((f * 4096) / telemetry.sampleRate))
            );
            const db = Math.max(-84, Math.min(0, bins[binIdx] ?? -84));
            const x = (i / sampleCount) * w;
            const y = ((0 - db) / 84) * (h - 20);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.9;
          ctx.stroke();

          if (fill) {
            ctx.lineTo(w, h - 20);
            ctx.lineTo(0, h - 20);
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
          }
        };

        if (telemetry.isRunning) {
          drawTrace(spectrum.preDb, 'rgba(245, 158, 11, 0.52)', null);
          drawTrace(spectrum.postDb, '#38BDF8', 'rgba(56, 189, 248, 0.16)');
        }

        if (telemetry.feedbackRisk.detected && telemetry.feedbackRisk.frequencyHz) {
          const fx =
            ((Math.log10(telemetry.feedbackRisk.frequencyHz) - minLog) / (maxLog - minLog)) * w;
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 1.6;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(fx, 0);
          ctx.lineTo(fx, h - 20);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#F87171';
          ctx.font = '11px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`CRITICAL ${telemetry.feedbackRisk.frequencyHz} Hz`, Math.min(w - 135, fx + 6), 16);
        }
      }
    }

    // Append slice into 10-second rolling buffer when live & unfrozen
    const nowMs = performance.now();
    if (
      telemetry.isRunning &&
      !waterfallFrozen &&
      nowMs - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS
    ) {
      lastSampleTimeRef.current = nowMs;
      const sampled = new Float32Array(FREQ_POINTS);
      for (let i = 0; i < FREQ_POINTS; i++) {
        const f = Math.pow(10, minLog + (i / (FREQ_POINTS - 1)) * (maxLog - minLog));
        const binIdx = Math.min(
          spectrum.postDb.length - 1,
          Math.max(1, Math.round((f * 4096) / telemetry.sampleRate))
        );
        sampled[i] = Math.max(-84, Math.min(0, spectrum.postDb[binIdx] ?? -84));
      }
      const cutoff = nowMs - WINDOW_SECONDS * 1000;
      const next = [
        ...historySlicesRef.current.filter((s) => s.timestamp >= cutoff),
        {
          timestamp: nowMs,
          binsDb: sampled,
          peakFreqHz: telemetry.feedbackRisk.detected ? telemetry.feedbackRisk.frequencyHz : null,
        },
      ].slice(-MAX_SLICES);
      historySlicesRef.current = next;
    }

    // Render 3D Perspective Spectral Waterfall (10s Rolling Window)
    const wf = waterfallCanvasRef.current;
    if (wf) {
      const wctx = wf.getContext('2d');
      if (wctx) {
        const w = wf.width;
        const h = wf.height;
        wctx.fillStyle = '#070A10';
        wctx.fillRect(0, 0, w, h);

        const padLeft = 30;
        const padRight = perspectiveTilt === 'isometric' ? 112 : 76;
        const padBottom = 26;
        const depthDx = perspectiveTilt === 'isometric' ? 92 : 52;
        const depthDy = perspectiveTilt === 'isometric' ? 128 : 154;
        const baseW = w - padLeft - padRight;
        const frontY = h - padBottom;
        const maxPeakPx = perspectiveTilt === 'isometric' ? 88 : 68;

        // 3D Floor Reference Grid (Frequency x 10s Depth)
        wctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
        wctx.lineWidth = 1;

        [0, 0.25, 0.5, 0.75, 1].forEach((dNorm) => {
          const bx = padLeft + dNorm * depthDx;
          const by = frontY - dNorm * depthDy;
          wctx.beginPath();
          wctx.moveTo(bx, by);
          wctx.lineTo(bx + baseW, by);
          wctx.stroke();

          wctx.fillStyle = '#64748B';
          wctx.font = '9px "JetBrains Mono", monospace';
          wctx.textAlign = 'left';
          const secLabel = dNorm === 0 ? 'NOW' : `-${(dNorm * WINDOW_SECONDS).toFixed(1)}s`;
          wctx.fillText(secLabel, bx + baseW + 5, by + 3);
        });

        [50, 200, 1000, 4000, 16000].forEach((f) => {
          const fNorm = (Math.log10(f) - minLog) / (maxLog - minLog);
          const x0 = padLeft + fNorm * baseW;
          const y0 = frontY;
          const x1 = x0 + depthDx;
          const y1 = frontY - depthDy;
          wctx.beginPath();
          wctx.moveTo(x0, y0);
          wctx.lineTo(x1, y1);
          wctx.stroke();

          wctx.fillStyle = '#64748B';
          wctx.font = '9px "JetBrains Mono", monospace';
          wctx.textAlign = 'center';
          wctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x0, h - 7);
        });

        const slices = historySlicesRef.current;
        if (slices.length > 0) {
          const refTime = waterfallFrozen
            ? slices[slices.length - 1].timestamp
            : nowMs;

          // Back-to-front painter's algorithm for crisp 3D occlusion
          for (let sIdx = 0; sIdx < slices.length; sIdx++) {
            const slice = slices[sIdx];
            const ageSec = Math.max(0, Math.min(WINDOW_SECONDS, (refTime - slice.timestamp) / 1000));
            const depth = ageSec / WINDOW_SECONDS; // 0 = NOW (front), 1 = -10s (back)
            const ox = padLeft + depth * depthDx;
            const oy = frontY - depth * depthDy;

            // Find local max db on slice to modulate ridge brightness
            let sliceMaxDb = -84;
            wctx.beginPath();
            for (let k = 0; k < FREQ_POINTS; k++) {
              const db = slice.binsDb[k];
              if (db > sliceMaxDb) sliceMaxDb = db;
              const normAmp = Math.max(0, (db + 84) / 84);
              const px = ox + (k / (FREQ_POINTS - 1)) * baseW;
              const py = oy - Math.pow(normAmp, 1.35) * maxPeakPx;
              if (k === 0) wctx.moveTo(px, py);
              else wctx.lineTo(px, py);
            }

            // Fill opaque dark occlusion skirt down to slice baseline
            wctx.lineTo(ox + baseW, oy + 2);
            wctx.lineTo(ox, oy + 2);
            wctx.closePath();
            wctx.fillStyle = 'rgba(7, 10, 16, 0.92)';
            wctx.fill();

            // Stroke luminous ridge colored by spectral peak intensity
            wctx.beginPath();
            for (let k = 0; k < FREQ_POINTS; k++) {
              const db = slice.binsDb[k];
              const normAmp = Math.max(0, (db + 84) / 84);
              const px = ox + (k / (FREQ_POINTS - 1)) * baseW;
              const py = oy - Math.pow(normAmp, 1.35) * maxPeakPx;
              if (k === 0) wctx.moveTo(px, py);
              else wctx.lineTo(px, py);
            }
            const [r, g, b] = heatColor(Math.max(-68, sliceMaxDb));
            const alpha = Math.max(0.28, 1 - depth * 0.65);
            wctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
            wctx.lineWidth = depth < 0.08 ? 2.1 : 1.35;
            wctx.stroke();

            // Highlight ringing peaks directly on the 3D ridge
            if (slice.peakFreqHz) {
              const fNorm = (Math.log10(slice.peakFreqHz) - minLog) / (maxLog - minLog);
              const pkIdx = Math.min(FREQ_POINTS - 1, Math.max(0, Math.round(fNorm * (FREQ_POINTS - 1))));
              const pkAmp = Math.max(0, (slice.binsDb[pkIdx] + 84) / 84);
              const px = ox + fNorm * baseW;
              const py = oy - Math.pow(pkAmp, 1.35) * maxPeakPx;
              wctx.fillStyle = '#EF4444';
              wctx.fillRect(px - 1.5, py - 3, 3, 6);
            }
          }
        } else {
          wctx.fillStyle = '#64748B';
          wctx.font = '11px "JetBrains Mono", monospace';
          wctx.textAlign = 'center';
          wctx.fillText(
            '3D 10-SECOND ROLLING WATERFALL STANDBY — START AUDIO ENGINE',
            w / 2,
            h / 2 - 6
          );
        }
      }
    }
  }, [spectrum, telemetry, waterfallFrozen, perspectiveTilt]);

  const handleApplyNotchAndMeasure = () => {
    const targetFreq = telemetry.feedbackRisk.frequencyHz ?? 2420;
    setBeforeSnap({
      label: `Feedback Notch @ ${targetFreq} Hz`,
      peakFreq: targetFreq,
      rmsDb: telemetry.postRmsDb,
    });
    const nextBands = dsp.eqBands.map((b, i) =>
      i === 3
        ? { ...b, label: 'Feedback Notch', enabled: true, type: 'peaking' as const, frequency: targetFreq, gainDb: -9.5, q: 7.5 }
        : b
    );
    onUpdateDsp({ eqBands: nextBands, bypassed: false });
    setRingLog((prev) => [
      {
        id: `ring-${Date.now()}`,
        time: new Date().toLocaleTimeString(),
        freqHz: targetFreq,
        action: 'Notch Applied (Q=7.5)',
        depthDb: -9.5,
      },
      ...prev.slice(0, 11),
    ]);
    setVerificationMsg(`Engaged -9.5 dB Q7.5 notch at ${targetFreq} Hz. Monitoring post-DSP stability.`);
    onLogVerification(`Applied feedback notch at ${targetFreq} Hz (-9.5 dB, Q=7.5)`);
  };

  const handleResetNotch = () => {
    updateBandByIndex(3, { enabled: false, gainDb: 0, q: 4.0 });
    setVerificationMsg('Reset adaptive feedback notch band to flat.');
  };

  const handleApplyHumHpfAndVerify = () => {
    setBeforeSnap({
      label: '50/60 Hz Sub-Sonic Clean',
      peakFreq: 50,
      rmsDb: telemetry.postRmsDb,
    });
    onUpdateDsp({ hpfEnabled: true, hpfHz: 95, bypassed: false });
    setVerificationMsg('Engaged 95 Hz HPF. Verify DI Ground Lift if 100/150 Hz harmonics persist.');
    onLogVerification('Engaged 95 Hz HPF for mains hum mitigation');
  };

  const handleApplyMudCut = () => {
    setBeforeSnap({
      label: '220 Hz Mud Trim',
      peakFreq: 220,
      rmsDb: telemetry.postRmsDb,
    });
    const nextBands = dsp.eqBands.map((b, i) =>
      i === 1
        ? { ...b, label: 'Mud Cut', enabled: true, type: 'peaking' as const, frequency: 220, gainDb: -5.5, q: 2.4 }
        : b
    );
    onUpdateDsp({ eqBands: nextBands, bypassed: false });
    setVerificationMsg('Applied -5.5 dB cut at 220 Hz (Q=2.4) to clear vocal low-mid buildup.');
    onLogVerification('Applied -5.5 dB low-mid mud reduction at 220 Hz');
  };

  return (
    <div className="space-y-4">
      {/* Studio Rack Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-2.5 h-8 rounded-xs ${
              telemetry.feedbackRisk.detected
                ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]'
                : 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]'
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-sky-400">03</span>
              <h1 className="font-display text-lg font-semibold text-white tracking-tight">
                FEEDBACK DETECTION &amp; ADAPTIVE SUPPRESSION
              </h1>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              4096-pt Dual-Trace FFT · Scrolling Frequency Waterfall · Adaptive Surgical Notch Rack
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="px-2.5 py-1 rounded border border-slate-800 bg-[#090D14] text-slate-300">
            {telemetry.isRunning
              ? `${(telemetry.sampleRate / 1000).toFixed(1)} kHz · FLOOR ${telemetry.noiseFloorDb.toFixed(1)} dBFS`
              : 'ENGINE STANDBY'}
          </span>
          <ConsolePushButton
            label={autoGuardArmed ? 'GUARD ARMED' : 'MANUAL GUARD'}
            active={autoGuardArmed}
            tone="sky"
            onClick={() => setAutoGuardArmed(!autoGuardArmed)}
          />
          <ConsolePushButton
            label={telemetry.feedbackRisk.detected ? `RING ${telemetry.feedbackRisk.frequencyHz} Hz` : 'SYSTEM STABLE'}
            active={telemetry.feedbackRisk.detected}
            tone={telemetry.feedbackRisk.detected ? 'red' : 'emerald'}
            onClick={handleApplyNotchAndMeasure}
          />
        </div>
      </div>

      {/* Main Analyzer Console Grid: Left Bus Meters + Gauges | Center FFT + Waterfall | Right Adaptive Notch Rack */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Left Telemetry & Bus Strip */}
        <div className="xl:col-span-2 rounded-lg border border-slate-800 bg-[#0D1119] p-3 flex flex-col justify-between gap-3">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-300 border-b border-slate-800 pb-2">
            Bus Telemetry
          </div>

          <div className="flex items-center justify-around py-2 bg-[#070A10] border border-slate-800 rounded">
            <div className="flex flex-col items-center gap-1">
              <SegmentedLedMeter
                levelDb={telemetry.isRunning ? telemetry.preRmsDb : -56}
                peakDb={telemetry.isRunning ? telemetry.prePeakDb : -56}
                height={128}
                segments={16}
              />
              <span className="font-mono text-[9px] text-slate-400">PRE</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <SegmentedLedMeter
                levelDb={telemetry.isRunning ? telemetry.postRmsDb : -56}
                peakDb={telemetry.isRunning ? telemetry.postPeakDb : -56}
                height={128}
                segments={16}
              />
              <span className="font-mono text-[9px] text-sky-400">POST</span>
            </div>
          </div>

          <ArcGauge
            label="Feedback Confidence"
            value={telemetry.feedbackRisk.detected ? telemetry.feedbackRisk.confidence : 0}
            max={100}
            displayValue={`${telemetry.feedbackRisk.detected ? telemetry.feedbackRisk.confidence : 0}%`}
            sublabel={
              telemetry.feedbackRisk.frequencyHz
                ? `Peak ${telemetry.feedbackRisk.frequencyHz} Hz`
                : 'No Ringing'
            }
            tone={telemetry.feedbackRisk.detected ? 'red' : 'emerald'}
          />

          <ArcGauge
            label="Gain Margin"
            value={headroomMarginDb}
            max={24}
            displayValue={telemetry.isRunning ? `${headroomMarginDb.toFixed(1)}dB` : '--'}
            sublabel={telemetry.isRunning ? 'Peak Headroom' : 'Standby'}
            tone={!telemetry.isRunning ? 'emerald' : headroomMarginDb < 4 ? 'red' : headroomMarginDb < 8 ? 'amber' : 'emerald'}
          />
        </div>

        {/* Center Live Spectrum + 3D Spectral Waterfall History Alongside */}
        <div className="xl:col-span-7 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-3 flex flex-col justify-between">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1">
            {/* Left: Current Real-Time Dual-Trace FFT */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono font-semibold text-white uppercase">
                  Real-Time FFT Spectrum
                </span>
                <span className="font-mono text-[10px] text-sky-400">
                  Amber = Raw · Cyan = Post-DSP
                </span>
              </div>

              <canvas
                ref={spectrumCanvasRef}
                width={520}
                height={290}
                className="w-full h-72 rounded border border-slate-800 bg-[#070A10]"
              />
            </div>

            {/* Right: 3D Spectral History Waterfall (10s Rolling Window) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono font-semibold text-white uppercase">
                  3D Waterfall (10s Window)
                </span>
                <div className="flex items-center gap-1 font-mono text-[9px]">
                  <button
                    type="button"
                    onClick={() =>
                      setPerspectiveTilt((prev) =>
                        prev === 'isometric' ? 'steep' : 'isometric'
                      )
                    }
                    className="px-1.5 py-0.5 rounded border border-slate-700 bg-[#090D14] text-slate-300 hover:border-sky-500/50"
                  >
                    {perspectiveTilt === 'isometric' ? 'ISO 3D' : 'STEEP 3D'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWaterfallFrozen((f) => !f)}
                    className={`px-1.5 py-0.5 rounded border ${
                      waterfallFrozen
                        ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                        : 'border-slate-700 bg-[#090D14] text-slate-300 hover:border-sky-500/50'
                    }`}
                  >
                    {waterfallFrozen ? 'FROZEN' : 'LIVE'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      historySlicesRef.current = [];
                    }}
                    className="px-1.5 py-0.5 rounded border border-slate-700 bg-[#090D14] text-slate-400 hover:text-slate-200"
                  >
                    CLR
                  </button>
                </div>
              </div>

              <canvas
                ref={waterfallCanvasRef}
                width={520}
                height={290}
                className="w-full h-72 rounded border border-slate-800 bg-[#070A10]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-slate-400 border-t border-slate-800 pt-2">
            <span>20 Hz – 20 kHz Log Axis · Vertical Ridge = Transient Ringing Energy</span>
            <span className="text-sky-400">
              {telemetry.isRunning
                ? `${historySlicesRef.current.length} / ${MAX_SLICES} slices (10.0s depth)`
                : 'Standby'}
            </span>
          </div>

          {verificationMsg && (
            <div className="p-2.5 rounded bg-sky-500/10 border border-sky-500/30 text-xs text-sky-300 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{verificationMsg}</span>
              </span>
              {beforeSnap && telemetry.isRunning && (
                <span className="font-mono text-[11px] shrink-0">
                  Before {beforeSnap.rmsDb.toFixed(1)} dB → Now {telemetry.postRmsDb.toFixed(1)} dB
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right Adaptive Notch & HPF Rotary Rack */}
        <div className="xl:col-span-3 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold text-white uppercase">
              Adaptive Notch Filters
            </span>
            <button
              type="button"
              onClick={handleResetNotch}
              className="px-2 py-0.5 rounded border border-slate-700 text-[10px] font-mono text-slate-300 hover:border-slate-500 flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>RESET</span>
            </button>
          </div>

          {/* Filter Slot 1: Surgical Feedback Notch (Band 4) */}
          <div className="p-2.5 rounded border border-slate-800 bg-[#121824] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold text-red-300">
                NOTCH 1 · FEEDBACK RING
              </span>
              <ConsolePushButton
                label={notchBand.enabled ? 'ACTIVE' : 'BYPASS'}
                active={notchBand.enabled}
                tone="red"
                onClick={() => updateBandByIndex(3, { enabled: !notchBand.enabled })}
              />
            </div>
            <div className="grid grid-cols-3 gap-1 place-items-center">
              <RotaryKnob
                label="FREQ"
                value={notchBand.frequency}
                min={250}
                max={10000}
                step={25}
                defaultValue={2420}
                size={46}
                accent="red"
                formatValue={(v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}k` : `${v}`)}
                onChange={(next) => updateBandByIndex(3, { frequency: next, enabled: true })}
              />
              <RotaryKnob
                label="DEPTH"
                value={notchBand.gainDb}
                min={-15}
                max={0}
                step={0.5}
                defaultValue={-9.5}
                unit="dB"
                size={46}
                accent="amber"
                onChange={(next) => updateBandByIndex(3, { gainDb: next, enabled: true })}
              />
              <RotaryKnob
                label="Q"
                value={notchBand.q}
                min={1}
                max={12}
                step={0.5}
                defaultValue={7.5}
                size={46}
                accent="sky"
                onChange={(next) => updateBandByIndex(3, { q: next, enabled: true })}
              />
            </div>
          </div>

          {/* Filter Slot 2: 220 Hz Vocal Mud Notch (Band 2) */}
          <div className="p-2.5 rounded border border-slate-800 bg-[#121824] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold text-amber-300">
                NOTCH 2 · LOW-MID MUD
              </span>
              <ConsolePushButton
                label={mudBand.enabled ? 'ACTIVE' : 'BYPASS'}
                active={mudBand.enabled}
                tone="amber"
                onClick={() => updateBandByIndex(1, { enabled: !mudBand.enabled })}
              />
            </div>
            <div className="grid grid-cols-3 gap-1 place-items-center">
              <RotaryKnob
                label="FREQ"
                value={mudBand.frequency}
                min={100}
                max={500}
                step={5}
                defaultValue={220}
                unit="Hz"
                size={46}
                accent="amber"
                onChange={(next) => updateBandByIndex(1, { frequency: next, enabled: true })}
              />
              <RotaryKnob
                label="DEPTH"
                value={mudBand.gainDb}
                min={-15}
                max={6}
                step={0.5}
                defaultValue={-4.0}
                unit="dB"
                size={46}
                accent="amber"
                onChange={(next) => updateBandByIndex(1, { gainDb: next, enabled: true })}
              />
              <RotaryKnob
                label="Q"
                value={mudBand.q}
                min={0.5}
                max={8}
                step={0.2}
                defaultValue={2.2}
                size={46}
                accent="sky"
                onChange={(next) => updateBandByIndex(1, { q: next, enabled: true })}
              />
            </div>
          </div>

          {/* Filter Slot 3: Subsonic Mains Hum HPF */}
          <div className="p-2.5 rounded border border-slate-800 bg-[#121824] flex items-center justify-between gap-2">
            <RotaryKnob
              label="HUM HPF"
              value={dsp.hpfHz}
              min={20}
              max={200}
              step={5}
              defaultValue={95}
              unit="Hz"
              size={48}
              accent="emerald"
              onChange={(next) => onUpdateDsp({ hpfHz: next, hpfEnabled: true })}
            />
            <div className="flex-1 space-y-1.5">
              <div className="font-mono text-[10px] text-slate-300">SUBSONIC CLEAN</div>
              <ConsolePushButton
                label={dsp.hpfEnabled ? 'HPF ENGAGED' : 'HPF BYPASS'}
                active={dsp.hpfEnabled}
                tone="emerald"
                onClick={() => onUpdateDsp({ hpfEnabled: !dsp.hpfEnabled })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Detectors & One-Click Verified Operator Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-3.5 rounded-lg border border-slate-800 bg-[#0D1119] flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-white">NARROW-BAND FEEDBACK</span>
            {telemetry.feedbackRisk.detected ? (
              <span className="flex items-center gap-1 text-xs font-mono text-red-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{telemetry.feedbackRisk.frequencyHz} Hz</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-mono text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>STABLE</span>
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono text-xs bg-[#070A10] p-2 rounded border border-slate-800">
            <div>
              <div className="text-[10px] text-slate-500">PEAK</div>
              <div className="text-slate-100">
                {telemetry.feedbackRisk.frequencyHz ? `${telemetry.feedbackRisk.frequencyHz} Hz` : '--'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">PROM</div>
              <div className="text-slate-100">+{telemetry.feedbackRisk.prominenceDb.toFixed(1)} dB</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">HOLD</div>
              <div className="text-slate-100">{telemetry.feedbackRisk.persistenceSec.toFixed(1)}s</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleApplyNotchAndMeasure}
            disabled={!telemetry.feedbackRisk.detected}
            className="w-full py-2 px-3 rounded bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-mono font-semibold transition-colors"
          >
            {telemetry.feedbackRisk.detected
              ? `APPLY NOTCH @ ${telemetry.feedbackRisk.frequencyHz} Hz`
              : 'NO FEEDBACK RING ACTIVE'}
          </button>
        </div>

        <div className="p-3.5 rounded-lg border border-slate-800 bg-[#0D1119] flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-white">50/60 Hz MAINS HUM</span>
            {telemetry.humRisk.detected ? (
              <span className="flex items-center gap-1 text-xs font-mono text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>HARMONICS</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-mono text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>CLEAN</span>
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono text-xs bg-[#070A10] p-2 rounded border border-slate-800">
            <div>
              <div className="text-[10px] text-slate-500">FUND</div>
              <div className="text-slate-100">
                {telemetry.humRisk.fundamentalHz ? `${telemetry.humRisk.fundamentalHz} Hz` : '--'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">100 Hz</div>
              <div className="text-slate-100">{telemetry.humRisk.harmonic100Db.toFixed(1)} dB</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">150 Hz</div>
              <div className="text-slate-100">{telemetry.humRisk.harmonic150Db.toFixed(1)} dB</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleApplyHumHpfAndVerify}
            disabled={!telemetry.humRisk.detected}
            className="w-full py-2 px-3 rounded bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-mono font-semibold transition-colors"
          >
            {telemetry.humRisk.detected ? 'ENGAGE 95 Hz HPF & LOG DI CHECK' : 'NO MAINS HUM DETECTED'}
          </button>
        </div>

        <div className="p-3.5 rounded-lg border border-slate-800 bg-[#0D1119] flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-white">LOW-MID SPEECH MUD</span>
            {telemetry.mudRisk.detected ? (
              <span className="flex items-center gap-1 text-xs font-mono text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>BUILDUP @ 220 Hz</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-mono text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>BALANCED</span>
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs bg-[#070A10] p-2 rounded border border-slate-800">
            <div>
              <div className="text-[10px] text-slate-500">CENTER</div>
              <div className="text-slate-100">{telemetry.mudRisk.centerHz} Hz</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">BAND ENERGY</div>
              <div className="text-slate-100">{telemetry.mudRisk.bandEnergyDb.toFixed(1)} dB</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleApplyMudCut}
            disabled={!telemetry.mudRisk.detected}
            className="w-full py-2 px-3 rounded bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-mono font-semibold transition-colors"
          >
            {telemetry.mudRisk.detected ? 'APPLY -5.5 dB CUT @ 220 Hz' : 'VOCAL MIDRANGE CLEAR'}
          </button>
        </div>
      </div>

      {/* Ring-Out Event Log & Detector Sensitivity */}
      <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        <div className="lg:col-span-4 flex items-center gap-4 border-b lg:border-b-0 lg:border-r border-slate-800 pb-3 lg:pb-0 lg:pr-4">
          <RotaryKnob
            label="RING THRESH"
            value={sensitivityDb}
            min={3}
            max={14}
            step={0.5}
            defaultValue={6}
            unit="dB"
            size={48}
            accent="sky"
            onChange={setSensitivityDb}
          />
          <div className="text-xs space-y-1">
            <div className="font-mono font-semibold text-white uppercase">
              Detector Prominence Sensitivity
            </div>
            <p className="text-[11px] text-slate-400">
              Flags narrow-band FFT spikes exceeding neighbors by +{sensitivityDb.toFixed(1)} dB for &gt;0.8s.
            </p>
          </div>
        </div>

        <div className="lg:col-span-8">
          <div className="flex items-center justify-between mb-1.5 font-mono text-[10px] text-slate-400 uppercase">
            <span>Session Ring-Out &amp; Notch Intervention Log</span>
            <span>{ringLog.length} events</span>
          </div>
          {ringLog.length === 0 ? (
            <div className="p-2.5 rounded border border-slate-800 bg-[#070A10] font-mono text-[11px] text-slate-500">
              No feedback notch interventions logged this session.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-24 overflow-y-auto">
              {ringLog.map((entry) => (
                <div
                  key={entry.id}
                  className="p-2 rounded border border-slate-800 bg-[#070A10] font-mono text-[11px] flex items-center justify-between gap-2"
                >
                  <span className="text-sky-300 font-semibold">{entry.freqHz} Hz</span>
                  <span className="text-amber-400">{entry.depthDb} dB</span>
                  <span className="text-slate-500 text-[10px]">{entry.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
