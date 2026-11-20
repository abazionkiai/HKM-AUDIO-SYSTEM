import React, { useMemo, useState } from 'react';
import { Check, Mic, Radio, ShieldAlert } from 'lucide-react';
import { MICROPHONE_PROFILES } from '../data/hardwareCatalog.ts';
import type {
  DspConfig,
  HardwareDevice,
  InputChannel,
  MicrophoneProfile,
  SignalTelemetry,
} from '../types/audio.ts';
import {
  ArcGauge,
  ConsolePushButton,
  RotaryKnob,
  SegmentedLedMeter,
} from './StudioControls.tsx';

interface MicrophoneIntelligenceModuleProps {
  device: HardwareDevice;
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  channels: InputChannel[];
  onUpdateChannel: (id: string, patch: Partial<InputChannel>) => void;
  telemetry: SignalTelemetry;
  onLogAction: (detail: string) => void;
}

const STAGE_MIC_NODES = [
  { id: 'mic-pulpit', label: 'Pulpit Gooseneck', x: 50, y: 66, pattern: 'Supercardioid', nullAngleDeg: 126, ch: 1 },
  { id: 'mic-preacher', label: 'Preacher Headset', x: 42, y: 52, pattern: 'Omnidirectional', nullAngleDeg: 0, ch: 2 },
  { id: 'mic-lead', label: 'Worship Lead 1', x: 32, y: 40, pattern: 'Cardioid', nullAngleDeg: 180, ch: 3 },
  { id: 'mic-bvox2', label: 'Backing Vocal 2', x: 64, y: 42, pattern: 'Cardioid', nullAngleDeg: 180, ch: 4 },
  { id: 'mic-choir-l', label: 'Choir Condenser L', x: 24, y: 20, pattern: 'Cardioid', nullAngleDeg: 180, ch: 5 },
  { id: 'mic-choir-r', label: 'Choir Condenser R', x: 76, y: 20, pattern: 'Cardioid', nullAngleDeg: 180, ch: 6 },
];

const WIRELESS_RF_FLEET = [
  { id: 'rf-1', slot: 'RX-A1', label: 'Preacher Beltpack', freqMhz: '518.425 MHz', rfDbm: -64, battPct: 88, ant: 'A', squelch: 'LOCKED' },
  { id: 'rf-2', slot: 'RX-A2', label: 'Pastor Handheld', freqMhz: '522.150 MHz', rfDbm: -68, battPct: 76, ant: 'B', squelch: 'LOCKED' },
  { id: 'rf-3', slot: 'RX-B1', label: 'Worship Lead HH', freqMhz: '530.800 MHz', rfDbm: -61, battPct: 92, ant: 'A', squelch: 'LOCKED' },
  { id: 'rf-4', slot: 'RX-B2', label: 'Host / Announcements', freqMhz: '538.275 MHz', rfDbm: -74, battPct: 54, ant: 'B', squelch: 'STBY' },
];

export const MicrophoneIntelligenceModule: React.FC<MicrophoneIntelligenceModuleProps> = ({
  device,
  dsp,
  onUpdateDsp,
  channels,
  onUpdateChannel,
  telemetry,
  onLogAction,
}) => {
  const [selectedMicId, setSelectedMicId] = useState<string>(MICROPHONE_PROFILES[0]?.id ?? '');
  const [targetChannelId, setTargetChannelId] = useState<string>(channels[0]?.id ?? '');
  const [micDistanceCm, setMicDistanceCm] = useState<number>(12);
  const [wedgeAngleDeg, setWedgeAngleDeg] = useState<number>(180);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  const selectedMic =
    MICROPHONE_PROFILES.find((m) => m.id === selectedMicId) ?? MICROPHONE_PROFILES[0];

  const gbfHeadroomDb = useMemo(() => {
    const distancePenalty = Math.max(0, (micDistanceCm - 8) * 0.42);
    const idealNull = selectedMic.pickupPattern === 'Supercardioid' ? 126 : 180;
    const angleDelta = Math.abs(wedgeAngleDeg - idealNull);
    const polarBonus =
      selectedMic.pickupPattern === 'Omnidirectional'
        ? -5.5
        : Math.max(-4, 6 - angleDelta * 0.08);
    return Number(Math.max(1, Math.min(24, 14 + polarBonus - distancePenalty)).toFixed(1));
  }, [micDistanceCm, wedgeAngleDeg, selectedMic.pickupPattern]);

  const applyMicProfile = (mic: MicrophoneProfile) => {
    const updatedBands = dsp.eqBands.map((b, i) => {
      const hint = mic.eqHints[i];
      if (hint) return { ...hint, enabled: true };
      return b;
    });
    onUpdateDsp({
      hpfEnabled: true,
      hpfHz: mic.hpfHz,
      eqBands: updatedBands,
      compressor: {
        ...dsp.compressor,
        enabled: true,
        thresholdDb: mic.compThresholdDb,
        ratio: mic.compRatio,
      },
    });
    if (targetChannelId) {
      onUpdateChannel(targetChannelId, {
        hpfHz: mic.hpfHz,
        compThresholdDb: mic.compThresholdDb,
        compRatio: mic.compRatio,
        phantom48v: mic.requiresPhantom,
      });
    }
    setAppliedId(mic.id);
    onLogAction(`Applied microphone profile ${mic.role} (${mic.makeModel}) to console DSP`);
  };

  // Polar pattern SVG path
  const polarPath = useMemo(() => {
    const cx = 80;
    const cy = 80;
    const maxR = 58;
    const pts: string[] = [];
    for (let deg = 0; deg <= 360; deg += 5) {
      const rad = ((deg - 90) * Math.PI) / 180;
      const cos = Math.cos((deg * Math.PI) / 180);
      let gain = 1;
      if (selectedMic.pickupPattern === 'Cardioid') {
        gain = 0.5 + 0.5 * cos;
      } else if (selectedMic.pickupPattern === 'Supercardioid') {
        gain = Math.abs(0.37 + 0.63 * cos);
      } else if (selectedMic.pickupPattern === 'Shotgun') {
        gain = Math.pow(Math.max(0.08, 0.35 + 0.65 * cos), 1.6);
      } else {
        gain = 0.92;
      }
      const r = Math.max(4, gain * maxR);
      const x = cx + Math.cos(rad) * r;
      const y = cy + Math.sin(rad) * r;
      pts.push(`${deg === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ') + ' Z';
  }, [selectedMic.pickupPattern]);

  const vocalChannels = channels.slice(0, 8);

  return (
    <div className="space-y-4">
      {/* Studio Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-sky-400">06</span>
              <h1 className="font-display text-lg font-semibold text-white tracking-tight">
                MICROPHONE INTELLIGENCE &amp; RF FLEET MONITOR
              </h1>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              Polar Null Geometry · Gain-Before-Feedback Margin · Preamp &amp; Phantom Control ({device.model})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-[#090D14] border border-slate-800 rounded px-2.5 py-1.5">
            <span className="font-mono text-[10px] text-slate-400 uppercase">Target Strip</span>
            <select
              aria-label="Target Console Channel"
              value={targetChannelId}
              onChange={(e) => setTargetChannelId(e.target.value)}
              className="bg-transparent text-xs font-mono font-semibold text-sky-300 focus:outline-none"
            >
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id} className="bg-[#0E131C] text-slate-100">
                  CH {String(ch.index).padStart(2, '0')} · {ch.name}
                </option>
              ))}
            </select>
          </div>
          <span className="font-mono text-[10px] text-slate-400 px-2.5 py-1.5 rounded border border-slate-800 bg-[#090D14]">
            {device.capabilities.phantomPowerControl ? 'HW +48V LINKED' : 'SW DSP / MANUAL +48V'}
          </span>
        </div>
      </div>

      {/* Top Row: Stage Placement + Polar Null & GBF Calculator + Selected Mic Profile */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Stage Map */}
        <div className="xl:col-span-4 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
            <span className="font-mono font-semibold text-white uppercase flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-sky-400" />
              <span>Sanctuary Mic Stage Plot</span>
            </span>
            <span className="font-mono text-[10px] text-emerald-400">Monitor-Only Topology</span>
          </div>
          <div className="rounded bg-[#070A10] border border-slate-800 p-2">
            <svg viewBox="0 0 400 220" className="w-full h-52 select-none">
              <rect x={16} y={14} width={368} height={154} fill="#101725" stroke="#334155" rx={5} />
              <text x={200} y={30} fill="#64748B" fontSize="9" textAnchor="middle" fontFamily="JetBrains Mono">
                UPSTAGE / CHOIR RISERS
              </text>
              {/* Floor monitor wedges */}
              <polygon points="120,148 148,148 140,160 128,160" fill="#1E293B" stroke="#F59E0B" strokeWidth={1} />
              <polygon points="252,148 280,148 272,160 260,160" fill="#1E293B" stroke="#F59E0B" strokeWidth={1} />
              <text x={200} y={194} fill="#475569" fontSize="9" textAnchor="middle" fontFamily="JetBrains Mono">
                STAGE LIP / FLOOR WEDGES → CONGREGATION
              </text>
              {STAGE_MIC_NODES.map((n) => {
                const cx = (n.x / 100) * 400;
                const cy = (n.y / 100) * 220;
                return (
                  <g key={n.id}>
                    <circle cx={cx} cy={cy} r={13} fill="rgba(56,189,248,0.12)" stroke="rgba(56,189,248,0.38)" />
                    <circle cx={cx} cy={cy} r={4.5} fill="#38BDF8" />
                    <text x={cx} y={cy - 17} fill="#E2E8F0" fontSize="8.5" textAnchor="middle" fontFamily="JetBrains Mono">
                      CH{n.ch} · {n.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Polar Pattern & GBF Calculator */}
        <div className="xl:col-span-3 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold text-white uppercase">
              Polar Null &amp; GBF
            </span>
            <span className="font-mono text-[10px] text-sky-400">{selectedMic.pickupPattern}</span>
          </div>

          <div className="flex items-center justify-around bg-[#070A10] border border-slate-800 rounded p-2">
            <svg viewBox="0 0 160 160" className="w-32 h-32">
              <circle cx={80} cy={80} r={58} fill="none" stroke="#1E293B" strokeDasharray="3 3" />
              <circle cx={80} cy={80} r={34} fill="none" stroke="#1E293B" />
              <line x1={80} y1={14} x2={80} y2={146} stroke="#1E293B" />
              <line x1={14} y1={80} x2={146} y2={80} stroke="#1E293B" />
              <path d={polarPath} fill="rgba(56,189,248,0.22)" stroke="#38BDF8" strokeWidth={2} />
              {/* Monitor wedge direction indicator */}
              {(() => {
                const wrad = ((wedgeAngleDeg - 90) * Math.PI) / 180;
                const wx = 80 + Math.cos(wrad) * 64;
                const wy = 80 + Math.sin(wrad) * 64;
                return (
                  <g>
                    <line x1={80} y1={80} x2={wx} y2={wy} stroke="#F59E0B" strokeDasharray="3 2" strokeWidth={1.5} />
                    <circle cx={wx} cy={wy} r={4.5} fill="#F59E0B" />
                  </g>
                );
              })()}
            </svg>
            <ArcGauge
              label="GBF Margin"
              value={gbfHeadroomDb}
              max={24}
              displayValue={`${gbfHeadroomDb}dB`}
              sublabel={gbfHeadroomDb < 8 ? 'Feedback Risk' : 'Safe Margin'}
              tone={gbfHeadroomDb < 8 ? 'red' : gbfHeadroomDb < 12 ? 'amber' : 'emerald'}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 py-1.5 bg-[#070A10] border border-slate-800 rounded place-items-center">
            <RotaryKnob
              label="MIC DIST"
              value={micDistanceCm}
              min={3}
              max={45}
              step={1}
              defaultValue={12}
              unit="cm"
              size={44}
              accent="sky"
              onChange={setMicDistanceCm}
            />
            <RotaryKnob
              label="WEDGE ANG"
              value={wedgeAngleDeg}
              min={90}
              max={270}
              step={5}
              defaultValue={180}
              unit="°"
              size={44}
              accent="amber"
              onChange={setWedgeAngleDeg}
            />
          </div>
        </div>

        {/* Selected Microphone DSP Profile Console */}
        <div className="xl:col-span-5 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {MICROPHONE_PROFILES.map((mic) => (
              <button
                key={mic.id}
                type="button"
                onClick={() => setSelectedMicId(mic.id)}
                className={`px-2.5 py-1.5 rounded-xs border font-mono text-[11px] transition-colors ${
                  selectedMic.id === mic.id
                    ? 'border-sky-400 bg-sky-500/20 text-sky-300 font-semibold'
                    : 'border-slate-800 bg-[#090D14] text-slate-400 hover:text-slate-200'
                }`}
              >
                {mic.role}
              </button>
            ))}
          </div>

          <div className="p-3 rounded border border-slate-800 bg-[#090D14] grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-5 space-y-1.5">
              <div className="font-mono text-[10px] text-sky-400 uppercase">
                {selectedMic.makeModel}
              </div>
              <div className="text-sm font-semibold text-white">{selectedMic.role}</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{selectedMic.feedbackNote}</p>
              <div className="font-mono text-[10px] text-amber-400">
                {selectedMic.requiresPhantom ? '+48V PHANTOM REQUIRED' : 'DYNAMIC CAPSULE'} ·{' '}
                {selectedMic.sensitivityMvPa} mV/Pa
              </div>
            </div>

            <div className="md:col-span-7 grid grid-cols-4 gap-2 place-items-center">
              <RotaryKnob
                label="PREAMP"
                value={selectedMic.recommendedGainDb}
                min={0}
                max={60}
                step={1}
                unit="dB"
                size={46}
                accent="sky"
                onChange={(v) => onUpdateDsp({ inputTrimDb: Math.max(-12, Math.min(12, v - 30)) })}
              />
              <RotaryKnob
                label="HPF"
                value={selectedMic.hpfHz}
                min={40}
                max={220}
                step={5}
                unit="Hz"
                size={46}
                accent="amber"
                onChange={(v) => onUpdateDsp({ hpfEnabled: true, hpfHz: v })}
              />
              <RotaryKnob
                label="COMP THR"
                value={selectedMic.compThresholdDb}
                min={-36}
                max={0}
                step={1}
                unit="dB"
                size={46}
                accent="emerald"
                onChange={(v) =>
                  onUpdateDsp({ compressor: { ...dsp.compressor, enabled: true, thresholdDb: v } })
                }
              />
              <RotaryKnob
                label="DE-ESS"
                value={dsp.deEsser.frequencyHz}
                min={4000}
                max={9500}
                step={250}
                unit="Hz"
                size={46}
                accent="sky"
                formatValue={(v) => `${(v / 1000).toFixed(1)}k`}
                onChange={(v) =>
                  onUpdateDsp({ deEsser: { ...dsp.deEsser, enabled: true, frequencyHz: v } })
                }
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => applyMicProfile(selectedMic)}
            className={`w-full py-2 px-3 rounded text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              appliedId === selectedMic.id
                ? 'bg-emerald-600 text-white'
                : 'bg-sky-600 hover:bg-sky-500 text-white'
            }`}
          >
            {appliedId === selectedMic.id && <Check className="w-3.5 h-3.5" />}
            <span>
              {appliedId === selectedMic.id
                ? `APPLIED ${selectedMic.role.toUpperCase()} CONTOUR`
                : `APPLY ${selectedMic.role.toUpperCase()} PROFILE TO DSP & CHANNEL`}
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Row: Wireless RF Telemetry + Live Preamp Strip */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Wireless RF Fleet Monitor (Observational) */}
        <div className="xl:col-span-4 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold text-white uppercase flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>Wireless RF &amp; Battery Telemetry</span>
            </span>
            <span className="font-mono text-[10px] text-slate-400">Observational</span>
          </div>

          <div className="space-y-2">
            {WIRELESS_RF_FLEET.map((rx) => (
              <div
                key={rx.id}
                className="p-2.5 rounded border border-slate-800 bg-[#070A10] flex items-center justify-between gap-2 text-xs font-mono"
              >
                <div className="min-w-0">
                  <div className="text-slate-100 font-semibold truncate">
                    {rx.slot} · {rx.label}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {rx.freqMhz} · ANT {rx.ant} · {rx.squelch}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 tabular-nums">
                  <div className="text-right">
                    <div className="text-[10px] text-sky-400">{rx.rfDbm} dBm</div>
                    <div className={rx.battPct < 60 ? 'text-[10px] text-amber-400' : 'text-[10px] text-emerald-400'}>
                      BAT {rx.battPct}%
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="p-2.5 rounded border border-slate-800 bg-[#090D14] text-[10px] font-mono text-slate-400 flex items-start gap-2">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Keep speech mics 10–15 cm from mouth; engage 110–130 Hz HPF before boosting presence.
            </span>
          </div>
        </div>

        {/* Vocal / Mic Preamp Bank */}
        <div className="xl:col-span-8 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 overflow-x-auto">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
            <span className="font-mono text-xs font-semibold text-white uppercase">
              Stage Mic Preamp, HPF &amp; +48V Phantom Strip
            </span>
            <span className="font-mono text-[10px] text-sky-400">
              {device.capabilities.perChannelFaderControl ? 'Hardware-Linked' : 'Software DSP Trim'}
            </span>
          </div>
          <div className="flex gap-2.5 min-w-max">
            {vocalChannels.map((ch, idx) => {
              const lvl = telemetry.isRunning
                ? Math.max(-56, Math.min(-1, ch.levelDb + (telemetry.postRmsDb + 20) * 0.4 + Math.sin(idx) * 2))
                : -48;
              return (
                <div
                  key={ch.id}
                  className="w-36 shrink-0 p-2.5 rounded border border-slate-800 bg-[#090D14] flex flex-col justify-between gap-2"
                >
                  <div className="text-center">
                    <div className="font-mono text-[9px] text-sky-400">CH {String(ch.index).padStart(2, '0')}</div>
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
                        label="PREAMP"
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
                        max={280}
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
                      label="+48V"
                      active={ch.phantom48v}
                      tone="amber"
                      disabled={!device.capabilities.phantomPowerControl}
                      onClick={() => onUpdateChannel(ch.id, { phantom48v: !ch.phantom48v })}
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
    </div>
  );
};
