import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gauge, Sliders, Sparkles, X } from 'lucide-react';
import type { HardwareDevice, InputChannel } from '../types/audio.ts';

interface GainStagingAssistantModalProps {
  open: boolean;
  onClose: () => void;
  channels: InputChannel[];
  device: HardwareDevice;
  onUpdateChannel: (id: string, patch: Partial<InputChannel>) => void;
  onSelectChannel?: (id: string) => void;
}

type StageVerdict = {
  label: 'IDLE' | 'UNDER-GAINED' | 'OPTIMAL' | 'HOT' | 'CLIPPING';
  colorClass: string;
  guidance: string;
};

function dbToPct(db: number): number {
  const clamped = Math.max(-80, Math.min(0, db));
  return ((clamped + 80) / 80) * 100;
}

function evaluateGainStage(ch: InputChannel, targetRmsDb: number): StageVerdict {
  if (ch.mute || ch.levelDb <= -68) {
    return {
      label: 'IDLE',
      colorClass: 'text-slate-400 border-slate-600/50 bg-slate-800/40',
      guidance: ch.mute
        ? 'Channel muted. Unmute or unpatch to measure live headroom.'
        : 'No active signal above noise floor (-68 dBFS).',
    };
  }
  if (ch.peakDb >= -0.5) {
    return {
      label: 'CLIPPING',
      colorClass: 'text-rose-300 border-rose-500/60 bg-rose-500/15',
      guidance: 'Peak hit 0 dBFS! Engage -20 dB Pad or lower Preamp Gain immediately.',
    };
  }
  if (ch.peakDb > -4.0 || ch.levelDb > targetRmsDb + 7.5) {
    return {
      label: 'HOT',
      colorClass: 'text-amber-300 border-amber-500/60 bg-amber-500/15',
      guidance: 'Headroom under 4 dB. Trim down 3–6 dB to protect vocal transients.',
    };
  }
  if (ch.levelDb < targetRmsDb - 14) {
    const snr = ch.levelDb - ch.noiseFloorDb;
    return {
      label: 'UNDER-GAINED',
      colorClass: 'text-sky-300 border-sky-500/50 bg-sky-500/15',
      guidance:
        snr < 18
          ? `Low SNR (${snr.toFixed(0)} dB above floor). Raise Preamp Gain toward ${targetRmsDb} dBFS.`
          : `Signal below nominal sweet spot. Increase gain toward ${targetRmsDb} dBFS.`,
    };
  }
  return {
    label: 'OPTIMAL',
    colorClass: 'text-emerald-300 border-emerald-500/50 bg-emerald-500/15',
    guidance: `Healthy ${targetRmsDb} dBFS nominal RMS with clean headroom above noise floor.`,
  };
}

export const GainStagingAssistantModal: React.FC<GainStagingAssistantModalProps> = ({
  open,
  onClose,
  channels,
  device,
  onUpdateChannel,
  onSelectChannel,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'active'>('all');
  const [targetNominalRmsDb, setTargetNominalRmsDb] = useState<number>(-18);

  const displayedChannels = useMemo(() => {
    if (filterMode === 'active') {
      const active = channels.filter((c) => !c.mute && c.levelDb > -65);
      return active.length > 0 ? active : channels;
    }
    return channels;
  }, [channels, filterMode]);

  if (!open) return null;

  const autoStageChannel = (ch: InputChannel) => {
    const delta = targetNominalRmsDb - ch.levelDb;
    const nextGain = Math.max(0, Math.min(60, Math.round(ch.gainDb + delta)));
    onUpdateChannel(ch.id, { gainDb: nextGain });
  };

  const autoStageAll = () => {
    channels.forEach((ch) => {
      if (!ch.mute && ch.levelDb > -65) {
        autoStageChannel(ch);
      }
    });
  };

  const clippingCount = channels.filter((c) => !c.mute && c.peakDb >= -0.5).length;
  const optimalCount = channels.filter(
    (c) => evaluateGainStage(c, targetNominalRmsDb).label === 'OPTIMAL'
  ).length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Gain Staging Assistant"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[88vh] flex flex-col rounded-xl border border-amber-500/40 bg-[#090D16] shadow-2xl overflow-hidden font-sans text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-[#17120A] via-[#0F1420] to-[#0A0E17] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-400/40 text-amber-300">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-white">
                Pro Gain Staging Assistant
              </h2>
              <p className="font-mono text-[11px] text-slate-400">
                {device.manufacturer} {device.model} · Target Nominal RMS: {targetNominalRmsDb} dBFS · Optimal: {optimalCount}/{channels.length}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px]">
            {clippingCount > 0 && (
              <span className="px-2 py-1 rounded bg-rose-500/20 border border-rose-500/50 text-rose-300 font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {clippingCount} CLIPPING
              </span>
            )}
            <button
              type="button"
              onClick={autoStageAll}
              className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Auto-Stage All Active
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter & Nominal Target Controls */}
        <div className="px-5 py-2.5 bg-[#060910] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 rounded border cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-bold'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              All Channels ({channels.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('active')}
              className={`px-2.5 py-1 rounded border cursor-pointer ${
                filterMode === 'active'
                  ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-bold'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              Active Signal Only
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">Nominal Target:</span>
            {[-20, -18, -15, -12].map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setTargetNominalRmsDb(lvl)}
                className={`px-2 py-0.5 rounded border cursor-pointer ${
                  targetNominalRmsDb === lvl
                    ? 'bg-amber-500 text-slate-950 border-amber-300 font-bold'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                {lvl} dBFS
              </button>
            ))}
          </div>
        </div>

        {/* Channel Staging Rows */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {displayedChannels.map((ch) => {
            const verdict = evaluateGainStage(ch, targetNominalRmsDb);
            const rmsPct = dbToPct(ch.levelDb);
            const targetPct = dbToPct(targetNominalRmsDb);
            return (
              <div
                key={ch.id}
                className="p-3 rounded-lg border border-slate-800 bg-[#0B101A] flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-white">
                      CH {String(ch.index).padStart(2, '0')} · {ch.name}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">({ch.role})</span>
                    <span className={`px-2 py-0.5 rounded border font-mono text-[10px] font-bold ${verdict.colorClass}`}>
                      {verdict.label}
                    </span>
                    {ch.phantom48v && (
                      <span className="px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-300 font-mono text-[9px] font-bold">
                        +48V
                      </span>
                    )}
                    {ch.padDb && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-[9px] font-bold">
                        -20dB PAD
                      </span>
                    )}
                  </div>

                  {/* Headroom Meter with Target Marker */}
                  <div className="relative h-2.5 w-full rounded bg-[#04060B] border border-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        verdict.label === 'CLIPPING'
                          ? 'bg-rose-500'
                          : verdict.label === 'HOT'
                            ? 'bg-amber-400'
                            : verdict.label === 'OPTIMAL'
                              ? 'bg-emerald-400'
                              : 'bg-sky-400'
                      }`}
                      style={{ width: `${rmsPct}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-white/90"
                      style={{ left: `${targetPct}%` }}
                      title={`Target: ${targetNominalRmsDb} dBFS`}
                    />
                  </div>

                  <p className="text-[11px] text-slate-400">{verdict.guidance}</p>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
                  <div className="px-2.5 py-1 rounded bg-[#05080F] border border-slate-800 text-center">
                    <div className="text-[9px] text-slate-500">PREAMP</div>
                    <div className="font-bold text-amber-300">+{ch.gainDb} dB</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUpdateChannel(ch.id, { padDb: !ch.padDb })}
                    className={`px-2 py-1.5 rounded border text-[10px] font-bold cursor-pointer ${
                      ch.padDb
                        ? 'bg-amber-500 text-slate-950 border-amber-300'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                    }`}
                  >
                    PAD
                  </button>
                  <button
                    type="button"
                    onClick={() => autoStageChannel(ch)}
                    className="px-2.5 py-1.5 rounded border border-emerald-500/50 bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Auto-Stage
                  </button>
                  {onSelectChannel && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectChannel(ch.id);
                        onClose();
                      }}
                      className="px-2.5 py-1.5 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Sliders className="w-3 h-3" />
                      Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
