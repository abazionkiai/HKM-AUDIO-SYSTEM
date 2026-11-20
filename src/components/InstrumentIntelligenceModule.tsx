import React, { useState } from 'react';
import { Check, Music, ShieldAlert } from 'lucide-react';
import { INSTRUMENT_PROFILES } from '../data/hardwareCatalog.ts';
import type {
  DspConfig,
  HardwareDevice,
  InputChannel,
  InstrumentProfile,
  SignalTelemetry,
} from '../types/audio.ts';
import {
  ArcGauge,
  ConsolePushButton,
  RotaryKnob,
  SegmentedLedMeter,
} from './StudioControls.tsx';

interface InstrumentIntelligenceModuleProps {
  device: HardwareDevice;
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  channels: InputChannel[];
  onUpdateChannel: (id: string, patch: Partial<InputChannel>) => void;
  telemetry: SignalTelemetry;
  onLogAction: (detail: string) => void;
}

const BAND_SPECTRUM_SLOTS = [
  { name: 'Kick Drum', lowHz: 45, highHz: 110, punchHz: 3200, color: '#F59E0B', note: 'HPF 35 Hz · Carve 300 Hz mud' },
  { name: 'Bass Guitar DI', lowHz: 41, highHz: 260, punchHz: 900, color: '#38BDF8', note: 'Carve 80 Hz for Kick · 50 Hz hum check' },
  { name: 'Keys / Piano', lowHz: 85, highHz: 4500, punchHz: 2400, color: '#A78BFA', note: 'HPF 85 Hz · Dip 350 Hz when band dense' },
  { name: 'Acoustic Guitar', lowHz: 100, highHz: 6000, punchHz: 4500, color: '#10B981', note: 'HPF 100 Hz · Notch 180 Hz body boom' },
  { name: 'Electric Guitar', lowHz: 110, highHz: 5200, punchHz: 2100, color: '#F472B6', note: 'Leave 2.5–3.5 kHz vocal pocket clear' },
  { name: 'Lead Vocal Pocket', lowHz: 120, highHz: 8000, punchHz: 3000, color: '#FDE047', note: 'Priority clarity lane 2.0–4.2 kHz' },
];

export const InstrumentIntelligenceModule: React.FC<InstrumentIntelligenceModuleProps> = ({
  device,
  dsp,
  onUpdateDsp,
  channels,
  onUpdateChannel,
  telemetry,
  onLogAction,
}) => {
  const [selectedInstId, setSelectedInstId] = useState<string>(INSTRUMENT_PROFILES[0]?.id ?? '');
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [diGroundLiftAdvice, setDiGroundLiftAdvice] = useState<boolean>(true);
  const [vocalPocketCarveDb, setVocalPocketCarveDb] = useState<number>(-2.5);

  const selectedInst =
    INSTRUMENT_PROFILES.find((i) => i.id === selectedInstId) ?? INSTRUMENT_PROFILES[0];

  const applyInstrumentProfile = (inst: InstrumentProfile) => {
    const updatedBands = dsp.eqBands.map((b, i) => {
      const hint = inst.eqHints[i];
      if (hint) return { ...hint, enabled: true };
      return b;
    });
    onUpdateDsp({
      hpfEnabled: true,
      hpfHz: inst.hpfHz,
      eqBands: updatedBands,
      compressor: {
        ...dsp.compressor,
        enabled: true,
        thresholdDb: inst.compThresholdDb,
        ratio: inst.compRatio,
      },
    });
    setAppliedId(inst.id);
    onLogAction(`Applied instrument DSP profile: ${inst.instrument}`);
  };

  const handleCarveVocalPocket = () => {
    const nextBands = dsp.eqBands.map((b, i) =>
      i === 4
        ? {
            ...b,
            enabled: true,
            label: 'Band Vocal Pocket',
            frequency: 2800,
            gainDb: vocalPocketCarveDb,
            q: 1.6,
          }
        : b
    );
    onUpdateDsp({ eqBands: nextBands, bypassed: false });
    onLogAction(`Carved ${vocalPocketCarveDb} dB band pocket @ 2.8 kHz to protect worship vocals`);
  };

  const instrumentChannels =
    channels.length > 8 ? channels.slice(8, 16) : channels;

  const crestFactorDb = telemetry.isRunning
    ? Math.max(3, Math.min(20, telemetry.postPeakDb - telemetry.postRmsDb))
    : 11.4;

  return (
    <div className="space-y-4">
      {/* Studio Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-emerald-400">07</span>
              <h1 className="font-display text-lg font-semibold text-white tracking-tight">
                INSTRUMENT &amp; WORSHIP MUSIC INTELLIGENCE
              </h1>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              Band Frequency Masking Matrix · DI Ground-Loop Guard · Crest Factor &amp; Channel Preamp Strip
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ConsolePushButton
            label={diGroundLiftAdvice ? 'DI GROUND LIFT REC' : 'DI GROUNDED'}
            active={diGroundLiftAdvice}
            tone="amber"
            onClick={() => setDiGroundLiftAdvice(!diGroundLiftAdvice)}
          />
          <button
            type="button"
            onClick={handleCarveVocalPocket}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-semibold"
          >
            CARVE {vocalPocketCarveDb.toFixed(1)} dB VOCAL POCKET
          </button>
        </div>
      </div>

      {/* Top Row: Frequency Allocation Matrix + Selected Instrument Processor */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Frequency Masking Map */}
        <div className="xl:col-span-6 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold text-white uppercase flex items-center gap-1.5">
              <Music className="w-3.5 h-3.5 text-emerald-400" />
              <span>Worship Band Frequency Masking Map</span>
            </span>
            <span className="font-mono text-[10px] text-slate-400">30 Hz – 16 kHz</span>
          </div>

          <div className="space-y-2.5 bg-[#070A10] border border-slate-800 rounded p-3">
            {BAND_SPECTRUM_SLOTS.map((slot) => {
              const minLog = Math.log10(30);
              const maxLog = Math.log10(16000);
              const leftPct =
                ((Math.log10(slot.lowHz) - minLog) / (maxLog - minLog)) * 100;
              const rightPct =
                ((Math.log10(slot.highHz) - minLog) / (maxLog - minLog)) * 100;
              return (
                <div key={slot.name} className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-200 font-semibold">{slot.name}</span>
                    <span className="text-slate-500">{slot.note}</span>
                  </div>
                  <div className="relative h-3.5 rounded-xs bg-[#0B0F17] border border-slate-800 overflow-hidden">
                    <div
                      className="absolute top-0.5 bottom-0.5 rounded-xs opacity-80"
                      style={{
                        left: `${Math.max(0, leftPct)}%`,
                        width: `${Math.max(4, rightPct - leftPct)}%`,
                        backgroundColor: slot.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-2 items-center pt-1">
            <ArcGauge
              label="Band Crest Factor"
              value={crestFactorDb}
              max={20}
              displayValue={`${crestFactorDb.toFixed(1)}dB`}
              sublabel={crestFactorDb < 7 ? 'Over-Compressed' : 'Healthy Punch'}
              tone={crestFactorDb < 7 ? 'amber' : 'emerald'}
            />
            <div className="flex justify-center">
              <RotaryKnob
                label="VOCAL POCKET"
                value={vocalPocketCarveDb}
                min={-6}
                max={0}
                step={0.5}
                defaultValue={-2.5}
                unit="dB"
                size={50}
                accent="sky"
                onChange={setVocalPocketCarveDb}
              />
            </div>
            <div className="p-2 rounded border border-slate-800 bg-[#090D14] text-[10px] font-mono text-slate-400">
              <div className="text-amber-400 font-semibold mb-0.5">50 Hz HUM CHECK</div>
              {telemetry.humRisk.detected ? (
                <span className="text-red-400">HUM DETECTED @ {telemetry.humRisk.fundamentalHz} Hz</span>
              ) : (
                <span className="text-emerald-400">DI LINES CLEAN</span>
              )}
            </div>
          </div>
        </div>

        {/* Instrument Profile Rack */}
        <div className="xl:col-span-6 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {INSTRUMENT_PROFILES.map((inst) => (
              <button
                key={inst.id}
                type="button"
                onClick={() => setSelectedInstId(inst.id)}
                className={`px-2.5 py-1.5 rounded-xs border font-mono text-[11px] transition-colors ${
                  selectedInst.id === inst.id
                    ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 font-semibold'
                    : 'border-slate-800 bg-[#090D14] text-slate-400 hover:text-slate-200'
                }`}
              >
                {inst.instrument}
              </button>
            ))}
          </div>

          <div className="p-3 rounded border border-slate-800 bg-[#090D14] grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-6 space-y-1.5">
              <div className="font-mono text-[10px] text-emerald-400 uppercase">
                {selectedInst.sourceType} · {selectedInst.diRequired ? 'ACTIVE / ISOLATED DI' : 'DIRECT / MIC'}
              </div>
              <div className="text-base font-semibold text-white">{selectedInst.instrument}</div>
              <ul className="space-y-1 text-xs text-slate-400 list-disc pl-4">
                {selectedInst.diagnosticNotes.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-6 grid grid-cols-3 gap-2 place-items-center">
              <RotaryKnob
                label="HPF"
                value={selectedInst.hpfHz}
                min={25}
                max={200}
                step={5}
                unit="Hz"
                size={50}
                accent="amber"
                onChange={(v) => onUpdateDsp({ hpfEnabled: true, hpfHz: v })}
              />
              <RotaryKnob
                label="COMP THR"
                value={selectedInst.compThresholdDb}
                min={-36}
                max={0}
                step={1}
                unit="dB"
                size={50}
                accent="emerald"
                onChange={(v) =>
                  onUpdateDsp({ compressor: { ...dsp.compressor, enabled: true, thresholdDb: v } })
                }
              />
              <RotaryKnob
                label="RATIO"
                value={selectedInst.compRatio}
                min={1}
                max={10}
                step={0.5}
                size={50}
                accent="sky"
                formatValue={(v) => `${v.toFixed(1)}:1`}
                onChange={(v) =>
                  onUpdateDsp({ compressor: { ...dsp.compressor, enabled: true, ratio: v } })
                }
              />
            </div>
          </div>

          <div className="p-2.5 rounded border border-slate-800 bg-[#070A10] text-[11px] font-mono text-slate-400 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              {selectedInst.diRequired
                ? 'Active DI Box Required: Engage physical Ground Lift switch if 50/60 Hz mains buzz persists before applying EQ cuts.'
                : 'Dynamic/Modeler Input: Check pad (-20 dB) if input preamps clip during full band chorus.'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => applyInstrumentProfile(selectedInst)}
            className={`w-full py-2 px-3 rounded text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              appliedId === selectedInst.id
                ? 'bg-emerald-600 text-white'
                : 'bg-sky-600 hover:bg-sky-500 text-white'
            }`}
          >
            {appliedId === selectedInst.id && <Check className="w-3.5 h-3.5" />}
            <span>
              {appliedId === selectedInst.id
                ? `LOADED ${selectedInst.instrument.toUpperCase()} CONTOUR`
                : `APPLY ${selectedInst.instrument.toUpperCase()} DSP CONTOUR`}
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Row: Instrument Console Channels Strip */}
      <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 overflow-x-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
          <span className="font-mono text-xs font-semibold text-white uppercase">
            Instrument &amp; Band Channel Preamp / DI Bank
          </span>
          <span className="font-mono text-[10px] text-sky-400">
            {device.capabilities.perChannelCapture ? `${instrumentChannels.length} Band Channels` : 'Stereo USB Return Mode'}
          </span>
        </div>

        <div className="flex gap-2.5 min-w-max">
          {instrumentChannels.map((ch) => {
            const lvl = telemetry.isRunning
              ? Math.max(-56, Math.min(-1, telemetry.postRmsDb + (ch.gainDb - 24) * 0.25 + ch.faderDb * 0.65))
              : -96;
            return (
              <div
                key={ch.id}
                className="w-36 shrink-0 p-2.5 rounded border border-slate-800 bg-[#090D14] flex flex-col justify-between gap-2"
              >
                <div className="text-center">
                  <div className="font-mono text-[9px] text-emerald-400">CH {String(ch.index).padStart(2, '0')}</div>
                  <div className="text-xs font-semibold text-white truncate">{ch.name}</div>
                  <div className="text-[10px] text-slate-500 truncate">{ch.role}</div>
                </div>

                <div className="flex items-center justify-around py-1">
                  <SegmentedLedMeter
                    levelDb={lvl}
                    peakDb={lvl + 4}
                    muted={ch.mute}
                    height={84}
                    segments={12}
                  />
                  <div className="flex flex-col items-center gap-2">
                    <RotaryKnob
                      label="GAIN"
                      value={ch.gainDb}
                      min={-12}
                      max={54}
                      step={1}
                      unit="dB"
                      size={42}
                      accent="sky"
                      onChange={(next) => onUpdateChannel(ch.id, { gainDb: next })}
                    />
                    <RotaryKnob
                      label="HPF"
                      value={ch.hpfHz}
                      min={20}
                      max={240}
                      step={5}
                      unit="Hz"
                      size={40}
                      accent="amber"
                      onChange={(next) => onUpdateChannel(ch.id, { hpfHz: next })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1">
                  <ConsolePushButton
                    label={ch.padDb ? '-20 PAD' : '0 dB'}
                    active={ch.padDb}
                    tone="amber"
                    onClick={() => onUpdateChannel(ch.id, { padDb: !ch.padDb })}
                  />
                  <ConsolePushButton
                    label={ch.mute ? 'MUTE' : 'ON'}
                    active={ch.mute}
                    tone="red"
                    onClick={() => onUpdateChannel(ch.id, { mute: !ch.mute })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
