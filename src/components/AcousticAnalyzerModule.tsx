import React, { useState } from 'react';
import { Upload, Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AcousticMeasurement } from '../types/audio.ts';
import { ArcGauge, ConsolePushButton, RotaryKnob } from './StudioControls.tsx';

interface AcousticAnalyzerModuleProps {
  measurement: AcousticMeasurement;
  onUpdateMeasurement: (next: AcousticMeasurement) => void;
  onExportRoomModeCut?: (freqHz: number) => void;
}

export const AcousticAnalyzerModule: React.FC<AcousticAnalyzerModuleProps> = ({
  measurement,
  onUpdateMeasurement,
  onExportRoomModeCut,
}) => {
  const [importError, setImportError] = useState<string | null>(null);
  const [targetTiltDb, setTargetTiltDb] = useState<number>(-0.5);
  const [splOffsetDb, setSplOffsetDb] = useState<number>(0);
  const [roomLengthM, setRoomLengthM] = useState<number>(24);
  const [roomWidthM, setRoomWidthM] = useState<number>(16);
  const [roomHeightM, setRoomHeightM] = useState<number>(6.5);
  const [exportedNote, setExportedNote] = useState<string | null>(null);

  const axialLengthHz = Math.round(343 / (2 * Math.max(2, roomLengthM)));
  const axialWidthHz = Math.round(343 / (2 * Math.max(2, roomWidthM)));
  const axialHeightHz = Math.round(343 / (2 * Math.max(2, roomHeightM)));
  const primaryModeHz = Math.round(343 / Math.max(2, roomHeightM)); // 2nd vertical or dominant sanctuary mode
  const estimatedSti = Math.max(0.32, Math.min(0.86, 0.88 - measurement.rt60AvgSec * 0.24));

  const handleToggleCalibrated = () => {
    onUpdateMeasurement({
      ...measurement,
      calibratedMic: !measurement.calibratedMic,
      micModel: !measurement.calibratedMic
        ? 'miniDSP UMIK-1 (Calibrated 90° File Loaded)'
        : 'Uncalibrated Reference Mic (Room Correction Locked)',
    });
  };

  const handleExportRewTxt = () => {
    const header = `* Room EQ Wizard Measurement Export — ${measurement.name}\n* Position: ${measurement.position}\n* Mic: ${measurement.micModel}\n* Freq(Hz)\tSPL(dB)\tPhase(deg)\n`;
    const rows = measurement.frequencyResponse
      .map((pt) => `${pt.freqHz}\t${(80 + pt.db).toFixed(2)}\t0.0`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${measurement.id}-rew-export.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportRewFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const parsed: { freqHz: number; db: number; targetDb: number }[] = [];
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;
          const parts = trimmed.split(/[\s,;]+/).map(Number);
          if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
            parsed.push({
              freqHz: parts[0],
              db: Number((parts[1] - 80).toFixed(2)),
              targetDb: 0,
            });
          }
        }
        if (parsed.length < 4) {
          setImportError('File did not contain enough valid REW frequency/SPL rows.');
          return;
        }
        onUpdateMeasurement({
          ...measurement,
          id: `rew-${Date.now()}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          frequencyResponse: parsed.slice(0, 32),
          notes: `Imported ${parsed.length} measurement points from REW export (${file.name}).`,
        });
      } catch {
        setImportError('Failed to parse REW measurement file.');
      }
    };
    reader.readAsText(file);
  };

  const width = 760;
  const height = 220;
  const minLog = Math.log10(25);
  const maxLog = Math.log10(18000);

  const frPath = measurement.frequencyResponse
    .map((pt, i) => {
      const x = ((Math.log10(Math.max(25, Math.min(18000, pt.freqHz))) - minLog) / (maxLog - minLog)) * width;
      const y = 18 + ((10 - Math.max(-10, Math.min(10, pt.db + splOffsetDb))) / 20) * (height - 36);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const targetLineY1 = 18 + ((10 - Math.max(-10, Math.min(10, -targetTiltDb * 2))) / 20) * (height - 36);
  const targetLineY2 = 18 + ((10 - Math.max(-10, Math.min(10, targetTiltDb * 4))) / 20) * (height - 36);

  return (
    <div className="space-y-4">
      {/* Studio Rack Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-sky-400">04</span>
              <h1 className="font-display text-lg font-semibold text-white tracking-tight">
                ACOUSTIC INTELLIGENCE &amp; REW ROOM ANALYZER
              </h1>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              {measurement.name} · {measurement.position} · STI {estimatedSti.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="px-2.5 py-1.5 rounded border border-slate-700 bg-[#121824] text-[11px] font-mono font-semibold text-slate-200 hover:border-sky-500/50 cursor-pointer flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span>IMPORT REW .TXT</span>
            <input type="file" accept=".txt,.csv" onChange={handleImportRewFile} className="hidden" />
          </label>
          <button
            type="button"
            onClick={handleExportRewTxt}
            className="px-2.5 py-1.5 rounded border border-slate-700 bg-[#121824] text-[11px] font-mono font-semibold text-slate-200 hover:border-sky-500/50 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span>EXPORT REW .TXT</span>
          </button>
          <ConsolePushButton
            label={measurement.calibratedMic ? 'UMIK-1 CALIBRATED' : 'UNCALIBRATED'}
            active={measurement.calibratedMic}
            tone={measurement.calibratedMic ? 'emerald' : 'amber'}
            onClick={handleToggleCalibrated}
          />
        </div>
      </div>

      {importError && (
        <div className="p-3 rounded border border-red-500/40 bg-red-500/10 text-xs text-red-300">
          {importError}
        </div>
      )}

      {/* Main Analyzer Console */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Left Calibration & Room Target Rack */}
        <div className="xl:col-span-3 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-300 border-b border-slate-800 pb-2">
            Room Target &amp; Calibration
          </div>

          <div className="grid grid-cols-2 gap-2">
            <ArcGauge
              label="Sanctuary SPL"
              value={measurement.splC}
              max={110}
              displayValue={`${measurement.splC.toFixed(0)}`}
              sublabel="dBC Slow"
              tone={measurement.splC > 95 ? 'amber' : 'sky'}
            />
            <ArcGauge
              label="Avg RT60"
              value={measurement.rt60AvgSec}
              max={3.0}
              displayValue={`${measurement.rt60AvgSec.toFixed(2)}s`}
              sublabel="1 kHz Decay"
              tone={measurement.rt60AvgSec > 1.6 ? 'amber' : 'emerald'}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 py-2 bg-[#070A10] border border-slate-800 rounded place-items-center">
            <RotaryKnob
              label="TARGET TILT"
              value={targetTiltDb}
              min={-2.0}
              max={1.0}
              step={0.1}
              defaultValue={-0.5}
              unit="dB/o"
              size={50}
              accent="sky"
              onChange={setTargetTiltDb}
            />
            <RotaryKnob
              label="REF OFFSET"
              value={splOffsetDb}
              min={-6}
              max={6}
              step={0.5}
              defaultValue={0}
              unit="dB"
              size={50}
              accent="emerald"
              onChange={setSplOffsetDb}
            />
          </div>

          <div className="p-2.5 rounded border border-slate-800 bg-[#090D14] space-y-1.5 text-[11px]">
            <div className="flex items-center gap-1.5 font-mono font-semibold text-slate-200">
              {measurement.calibratedMic ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span className="truncate">{measurement.micModel}</span>
            </div>
            <p className="text-slate-400 leading-snug text-[11px]">
              {measurement.calibratedMic
                ? '90° calibration curve active — room-correction filter export permitted.'
                : 'Safety Policy: Room-correction EQ filters locked without a calibrated mic.'}
            </p>
          </div>
        </div>

        {/* Center Measured Sanctuary Frequency Response */}
        <div className="xl:col-span-6 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-white uppercase">
              Measured Sanctuary Frequency Response (40 Hz – 16 kHz)
            </span>
            <span className="font-mono text-[11px] text-amber-400">
              63–80 Hz AXIAL MODE: +6.4 dB
            </span>
          </div>
          <div className="rounded bg-[#070A10] border border-slate-800 p-2">
            <svg viewBox="0 0 760 220" className="w-full h-56">
              {[40, 63, 80, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((f) => {
                const x = ((Math.log10(f) - minLog) / (maxLog - minLog)) * width;
                return (
                  <g key={f}>
                    <line x1={x} y1={10} x2={x} y2={198} stroke="rgba(148,163,184,0.12)" />
                    <text x={x} y={212} fill="#64748B" fontSize="9" textAnchor="middle" fontFamily="JetBrains Mono">
                      {f >= 1000 ? `${f / 1000}k` : f}
                    </text>
                  </g>
                );
              })}
              <rect
                x={((Math.log10(55) - minLog) / (maxLog - minLog)) * width}
                y={12}
                width={((Math.log10(92) - Math.log10(55)) / (maxLog - minLog)) * width}
                height={186}
                fill="rgba(245,158,11,0.12)"
              />
              <line
                x1={0}
                y1={targetLineY1}
                x2={760}
                y2={targetLineY2}
                stroke="rgba(16,185,129,0.55)"
                strokeDasharray="5 4"
                strokeWidth={1.4}
              />
              <line x1={0} y1={110} x2={760} y2={110} stroke="rgba(148,163,184,0.28)" strokeDasharray="3 3" />
              <path d={frPath} fill="none" stroke="#38BDF8" strokeWidth={2.4} />
            </svg>
          </div>
          <p className="text-xs text-slate-400 font-mono leading-relaxed">{measurement.notes}</p>
        </div>

        {/* Right Octave RT60 Decay Matrix */}
        <div className="xl:col-span-3 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-300 border-b border-slate-800 pb-2">
            Reverberation Decay (RT60)
          </div>
          <div className="space-y-2.5 flex-1">
            {measurement.octaveRt60.map((row) => {
              const pct = Math.min(100, (row.seconds / 2.5) * 100);
              const highDecay = row.seconds > 1.7;
              return (
                <div key={row.bandHz} className="space-y-1">
                  <div className="flex justify-between font-mono text-[11px]">
                    <span className="text-slate-400">{row.bandHz} Hz</span>
                    <span className={highDecay ? 'text-amber-400 font-semibold' : 'text-sky-300'}>
                      {row.seconds.toFixed(2)}s
                    </span>
                  </div>
                  <div className="h-2.5 rounded-xs bg-[#070A10] border border-slate-800 overflow-hidden p-px">
                    <div
                      className={`h-full rounded-[1px] ${highDecay ? 'bg-amber-400' : 'bg-sky-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="p-2.5 rounded bg-[#090D14] border border-slate-800 text-[11px] text-slate-400 leading-snug">
            Measure 4+ sanctuary seating zones, verify sub polarity, and treat early reflections before cutting global EQ.
          </div>
        </div>
      </div>

      {/* Sanctuary Axial Room Mode Calculator & Calibrated DSP Export */}
      <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        <div className="lg:col-span-5 grid grid-cols-3 gap-2.5 font-mono text-xs">
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">LENGTH (m)</label>
            <input
              type="number"
              min={4}
              max={80}
              step={0.5}
              value={roomLengthM}
              onChange={(e) => setRoomLengthM(Number(e.target.value) || 24)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-700 bg-[#070A10] text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">WIDTH (m)</label>
            <input
              type="number"
              min={4}
              max={60}
              step={0.5}
              value={roomWidthM}
              onChange={(e) => setRoomWidthM(Number(e.target.value) || 16)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-700 bg-[#070A10] text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">HEIGHT (m)</label>
            <input
              type="number"
              min={2.5}
              max={25}
              step={0.5}
              value={roomHeightM}
              onChange={(e) => setRoomHeightM(Number(e.target.value) || 6.5)}
              className="w-full px-2.5 py-1.5 rounded border border-slate-700 bg-[#070A10] text-slate-100"
            />
          </div>
        </div>

        <div className="lg:col-span-4 grid grid-cols-4 gap-2 font-mono text-xs">
          <div className="p-2 rounded bg-[#070A10] border border-slate-800">
            <div className="text-[9px] text-slate-500">AXIAL L</div>
            <div className="text-sky-300 font-semibold">{axialLengthHz} Hz</div>
          </div>
          <div className="p-2 rounded bg-[#070A10] border border-slate-800">
            <div className="text-[9px] text-slate-500">AXIAL W</div>
            <div className="text-sky-300 font-semibold">{axialWidthHz} Hz</div>
          </div>
          <div className="p-2 rounded bg-[#070A10] border border-slate-800">
            <div className="text-[9px] text-slate-500">MODE 2H</div>
            <div className="text-amber-300 font-semibold">{primaryModeHz} Hz</div>
          </div>
          <div className="p-2 rounded bg-[#070A10] border border-slate-800">
            <div className="text-[9px] text-slate-500">STI EST</div>
            <div className={estimatedSti >= 0.55 ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
              {estimatedSti.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 flex flex-col gap-1.5">
          <button
            type="button"
            disabled={!measurement.calibratedMic || !onExportRoomModeCut}
            onClick={() => {
              if (!onExportRoomModeCut) return;
              onExportRoomModeCut(primaryModeHz);
              setExportedNote(`Exported -3.5 dB modal cut @ ${primaryModeHz} Hz to DSP Band 1.`);
            }}
            className="w-full py-2 px-3 rounded bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-mono font-semibold transition-colors"
          >
            {measurement.calibratedMic
              ? `EXPORT ${primaryModeHz} Hz CUT TO DSP`
              : 'LOCKED (CALIBRATE MIC FIRST)'}
          </button>
          <div className="font-mono text-[10px] text-slate-400 truncate">
            {exportedNote || `Vertical mode f=${axialHeightHz} Hz / 2nd=${primaryModeHz} Hz`}
          </div>
        </div>
      </div>
    </div>
  );
};
