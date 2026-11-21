import React from 'react';
import { ArrowRight, GitBranch, X } from 'lucide-react';
import type {
  DspConfig,
  HardwareDevice,
  InputChannel,
  ModuleId,
  SpeakerZone,
} from '../types/audio.ts';

interface SignalJourneyModalProps {
  open: boolean;
  onClose: () => void;
  channel: InputChannel | null;
  device: HardwareDevice;
  dsp: DspConfig;
  zones: SpeakerZone[];
  onNavigateModule: (mod: ModuleId) => void;
}

export const SignalJourneyModal: React.FC<SignalJourneyModalProps> = ({
  open,
  onClose,
  channel,
  device,
  dsp,
  zones,
  onNavigateModule,
}) => {
  if (!open || !channel) return null;

  const stages = [
    {
      step: '1',
      title: `Physical Input · ${device.model}`,
      domain: 'Hardware ADC',
      status: channel.mute ? 'MUTED' : 'LOCKED',
      note: `${channel.name} (${channel.role}) · Preamp +${channel.gainDb} dB · ${channel.phantom48v ? '+48V ON' : '+48V OFF'}${channel.padDb ? ' · -20dB PAD' : ''}`,
      target: 'console' as ModuleId,
    },
    {
      step: '2',
      title: 'HPF / LPF & Standby Gate',
      domain: 'DSP Phase 2',
      status: dsp.bypassed ? 'BYPASSED' : dsp.hpfEnabled ? 'ACTIVE' : 'OPEN',
      note: `HPF @ ${dsp.hpfHz} Hz · LPF @ ${(dsp.lpfHz / 1000).toFixed(1)} kHz · Gate @ ${dsp.gate.thresholdDb} dB`,
      target: 'console' as ModuleId,
    },
    {
      step: '3',
      title: '4-Band PEQ & VCA Dynamics',
      domain: 'DSP Phases 3–4',
      status: dsp.bypassed ? 'BYPASSED' : 'ACTIVE',
      note: `4-Band Parametric EQ · Compressor ${dsp.compressor.enabled ? `${dsp.compressor.ratio.toFixed(1)}:1 @ ${dsp.compressor.thresholdDb} dB` : 'Bypassed'}`,
      target: 'console' as ModuleId,
    },
    {
      step: '4',
      title: '31-Band GEQ & 3-Way Crossover',
      domain: 'DSP Phases 5–6',
      status: dsp.bypassed ? 'BYPASSED' : 'ACTIVE',
      note: `GEQ ±${dsp.graphicEq31?.rangeDb ?? 12} dB · LR-24 Sub/Mid @ ${dsp.crossover?.subToMidHz ?? 80} Hz · Mid/High @ ${dsp.crossover?.midToHighHz ?? 2500} Hz`,
      target: 'dsp' as ModuleId,
    },
    {
      step: '5',
      title: `Output Matrix & ${zones.length || 3} Speaker Zones`,
      domain: 'PA / Broadcast DAC',
      status: dsp.limiter.enabled ? 'PROTECTED' : 'OPEN',
      note: `Fader ${channel.faderDb.toFixed(1)} dB · Limiter Ceiling ${dsp.limiter.ceilingDb.toFixed(1)} dBFS · Master Delay ${dsp.masterDelayMs} ms`,
      target: 'speakers' as ModuleId,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Signal Journey Trace"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-xl border border-sky-500/40 bg-[#0A0F18] shadow-2xl overflow-hidden font-sans text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 bg-[#0D1320] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <GitBranch className="w-4 h-4 text-sky-400" />
            <div>
              <h2 className="font-display text-base font-bold text-white">
                End-to-End Signal Journey — CH {channel.index} ({channel.name})
              </h2>
              <p className="font-mono text-[11px] text-slate-400">
                Real-time physical-to-output routing trace · Live Level {channel.levelDb.toFixed(1)} dBFS
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2.5 max-h-[75vh] overflow-y-auto">
          {stages.map((st, idx) => (
            <div key={st.step} className="space-y-2">
              <div className="p-3 rounded-lg border border-slate-800 bg-[#060910] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-300 font-bold">
                      STAGE {st.step}
                    </span>
                    <span className="font-bold text-white">{st.title}</span>
                    <span className="text-[10px] text-slate-500">({st.domain})</span>
                  </div>
                  <p className="text-xs font-mono text-slate-400 mt-1">{st.note}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${
                      st.status === 'MUTED'
                        ? 'bg-red-500/20 border-red-500/40 text-red-300'
                        : st.status === 'BYPASSED'
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    }`}
                  >
                    {st.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateModule(st.target);
                      onClose();
                    }}
                    className="px-2.5 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-sky-300 font-mono text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    Open
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
