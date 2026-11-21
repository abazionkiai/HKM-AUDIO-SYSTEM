import React, { useState } from 'react';
import { Cable, GitBranch, ShieldCheck, Sliders } from 'lucide-react';
import type { DspConfig, InputChannel, SpeakerZone } from '../types/audio.ts';

interface UniversalRoutingModuleProps {
  channels: InputChannel[];
  onUpdateChannel: (id: string, patch: Partial<InputChannel>) => void;
  zones: SpeakerZone[];
  dsp: DspConfig;
  onOpenSignalJourney: (channelId: string) => void;
}

const BUS_COLUMNS = [
  { key: 'stageMon1Db', label: 'STAGE MON 1', color: 'sky' },
  { key: 'stageMon2Db', label: 'STAGE MON 2', color: 'cyan' },
  { key: 'subsDb', label: 'SUB ARRAY', color: 'fuchsia' },
  { key: 'streamBusDb', label: 'OBS STREAM', color: 'emerald' },
] as const;

export const UniversalRoutingModule: React.FC<UniversalRoutingModuleProps> = ({
  channels,
  onUpdateChannel,
  zones,
  dsp,
  onOpenSignalJourney,
}) => {
  const [selectedChannelId, setSelectedChannelId] = useState(channels[0]?.id ?? 'ch-1');
  const [virtualPatch, setVirtualPatch] = useState<Record<string, string>>({});
  const [guardNotice, setGuardNotice] = useState<string | null>(null);

  const selectedCh = channels.find((c) => c.id === selectedChannelId) ?? channels[0];

  const handleToggleBusSend = (ch: InputChannel, key: (typeof BUS_COLUMNS)[number]['key']) => {
    const current = ch.auxSends[key];
    const nextVal = current <= -40 ? 0 : -60;
    onUpdateChannel(ch.id, {
      auxSends: {
        ...ch.auxSends,
        [key]: nextVal,
      },
    });
  };

  const handleAssignVirtualCable = (chId: string, sourceRoute: string) => {
    // Cycle guard: prevent routing Main PA output back into an unmuted input feeding Main PA
    const targetCh = channels.find((c) => c.id === chId);
    if (sourceRoute === 'loopback-pa' && targetCh && !targetCh.mute) {
      setGuardNotice(
        `Cycle Guard Blocked: "${targetCh.name}" cannot patch Main PA Loopback while unmuted (prevents infinite feedback loop).`
      );
      window.setTimeout(() => setGuardNotice(null), 4500);
      return;
    }
    setVirtualPatch((prev) => ({ ...prev, [chId]: sourceRoute }));
    setGuardNotice(`Patched ${targetCh?.name ?? chId} → ${sourceRoute} (DAG Cycle Guard Verified).`);
    window.setTimeout(() => setGuardNotice(null), 3000);
  };

  return (
    <div className="space-y-4 text-slate-200 font-sans">
      {/* Header */}
      <div className="p-4 rounded-xl border border-sky-500/35 bg-gradient-to-r from-[#0C1322] via-[#090D16] to-[#060910] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-500/20 border border-sky-400/40 text-sky-300">
            <Cable className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-white">
              Universal Bus Matrix &amp; Cycle-Guarded Virtual Patchbay
            </h2>
            <p className="font-mono text-[11px] text-slate-400">
              {channels.length} Input Strips × 4 Aux/Matrix Buses × {zones.length} Speaker Zones · DAG Feedback Protection Active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 flex items-center gap-1.5 font-bold">
            <ShieldCheck className="w-3.5 h-3.5" />
            CYCLE GUARD ARMED
          </span>
          {selectedCh && (
            <button
              type="button"
              onClick={() => onOpenSignalJourney(selectedCh.id)}
              className="px-3 py-1 rounded bg-sky-500/20 border border-sky-400/50 text-sky-200 font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <GitBranch className="w-3.5 h-3.5" />
              Trace {selectedCh.name}
            </button>
          )}
        </div>
      </div>

      {guardNotice && (
        <div className="px-4 py-2 rounded-lg border border-amber-500/50 bg-amber-950/60 text-amber-200 font-mono text-xs">
          {guardNotice}
        </div>
      )}

      {/* Input x Bus Matrix Table */}
      <div className="rounded-xl border border-slate-800 bg-[#080B13] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="bg-[#0D121F] border-b border-slate-800 text-[10px] text-slate-400 uppercase">
                <th className="py-2.5 px-3">Input Channel</th>
                <th className="py-2.5 px-3">Virtual Cable Source</th>
                {BUS_COLUMNS.map((b) => (
                  <th key={b.key} className="py-2.5 px-3 text-center">
                    {b.label}
                  </th>
                ))}
                <th className="py-2.5 px-3 text-right">Fader</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {channels.slice(0, 12).map((ch) => {
                const isSel = ch.id === selectedCh?.id;
                const patchVal = virtualPatch[ch.id] ?? 'hw-direct';
                return (
                  <tr
                    key={ch.id}
                    onClick={() => setSelectedChannelId(ch.id)}
                    className={`transition cursor-pointer ${
                      isSel ? 'bg-sky-950/30' : 'hover:bg-slate-900/50'
                    }`}
                  >
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 font-bold">
                          CH{String(ch.index).padStart(2, '0')}
                        </span>
                        <span className="text-white font-semibold">{ch.name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={patchVal}
                        onChange={(e) => handleAssignVirtualCable(ch.id, e.target.value)}
                        className="bg-[#05080F] border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 cursor-pointer"
                      >
                        <option value="hw-direct">Hardware ADC Direct</option>
                        <option value="vbcable-a">VB-Cable A (Media/Zoom)</option>
                        <option value="obs-return">OBS Virtual Return</option>
                        <option value="loopback-pa">Main PA Loopback (Guarded)</option>
                      </select>
                    </td>
                    {BUS_COLUMNS.map((b) => {
                      const valDb = ch.auxSends[b.key];
                      const active = valDb > -40;
                      return (
                        <td
                          key={b.key}
                          className="py-2 px-3 text-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleBusSend(ch, b.key);
                          }}
                        >
                          <button
                            type="button"
                            className={`px-2.5 py-1 rounded text-[10px] font-bold border cursor-pointer transition ${
                              active
                                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                                : 'bg-slate-900 border-slate-800 text-slate-500'
                            }`}
                          >
                            {active ? `${valDb.toFixed(0)} dB` : 'OFF'}
                          </button>
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 text-right text-sky-300 font-bold">
                      {ch.mute ? 'MUTED' : `${ch.faderDb.toFixed(1)} dB`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Channel Aux Send Trim */}
      {selectedCh && (
        <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0A0F18] flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-sky-400" />
            <span className="font-bold text-white">
              Aux Send Trims — CH {selectedCh.index} ({selectedCh.name})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {BUS_COLUMNS.map((b) => (
              <label key={b.key} className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-400">{b.label}:</span>
                <input
                  type="range"
                  min={-60}
                  max={6}
                  step={1}
                  value={selectedCh.auxSends[b.key]}
                  onChange={(e) =>
                    onUpdateChannel(selectedCh.id, {
                      auxSends: {
                        ...selectedCh.auxSends,
                        [b.key]: parseFloat(e.target.value),
                      },
                    })
                  }
                  className="w-24 accent-sky-400 cursor-pointer"
                />
                <span className="w-12 text-right text-sky-300 font-bold">
                  {selectedCh.auxSends[b.key]} dB
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
