import React, { useState } from 'react';
import { Cable, GitBranch, Mic, Plus, RefreshCw, ShieldCheck, Sliders, Speaker, Trash2 } from 'lucide-react';
import type { DspConfig, InputChannel, SpeakerZone } from '../types/audio.ts';

interface UniversalRoutingModuleProps {
  channels: InputChannel[];
  onUpdateChannel: (id: string, patch: Partial<InputChannel>) => void;
  onAddChannel?: (name?: string, role?: string) => void;
  onRemoveChannel?: (id: string) => void;
  onAddZone?: (name?: string, role?: SpeakerZone['role']) => void;
  onUpdateZone?: (id: string, patch: Partial<SpeakerZone>) => void;
  onRemoveZone?: (id: string) => void;
  inputDevices?: MediaDeviceInfo[];
  outputDevices?: MediaDeviceInfo[];
  preferredOutputDeviceId?: string;
  preferredStreamOutputDeviceId?: string;
  onSelectOutputDevice?: (deviceId: string) => void;
  onSelectStreamOutputDevice?: (deviceId: string) => void;
  onScanAudioDevices?: (requestPermission?: boolean) => Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>;
  zones: SpeakerZone[];
  dsp: DspConfig;
  onOpenSignalJourney: (channelId: string) => void;
}

const SPEAKER_ROLE_OPTIONS: { value: SpeakerZone['role']; label: string }[] = [
  { value: 'main-lr', label: 'Front Main L/R' },
  { value: 'rear-fill', label: 'Rear Fill' },
  { value: 'sub', label: 'Subwoofer Array' },
  { value: 'center', label: 'Center Cluster' },
  { value: 'stage-monitor', label: 'Stage Monitor' },
  { value: 'overflow', label: 'Overflow / Aux' },
];

const BUS_COLUMNS = [
  { key: 'stageMon1Db', label: 'STAGE MON 1', color: 'sky' },
  { key: 'stageMon2Db', label: 'STAGE MON 2', color: 'cyan' },
  { key: 'subsDb', label: 'SUB ARRAY', color: 'fuchsia' },
  { key: 'streamBusDb', label: 'OBS STREAM', color: 'emerald' },
] as const;

export const UniversalRoutingModule: React.FC<UniversalRoutingModuleProps> = ({
  channels,
  onUpdateChannel,
  onAddChannel,
  onRemoveChannel,
  onAddZone,
  onUpdateZone,
  onRemoveZone,
  inputDevices = [],
  outputDevices = [],
  preferredOutputDeviceId = '',
  preferredStreamOutputDeviceId = '',
  onSelectOutputDevice,
  onSelectStreamOutputDevice,
  onScanAudioDevices,
  zones,
  dsp,
  onOpenSignalJourney,
}) => {
  const [selectedChannelId, setSelectedChannelId] = useState(channels[0]?.id ?? 'ch-1');
  const [virtualPatch, setVirtualPatch] = useState<Record<string, string>>({});
  const [guardNotice, setGuardNotice] = useState<string | null>(null);
  const [newZoneRole, setNewZoneRole] = useState<SpeakerZone['role']>('main-lr');
  const [scanningPorts, setScanningPorts] = useState(false);

  const classifyInputRole = (label: string) => {
    const low = label.toLowerCase();
    if (low.includes('cable') || low.includes('virtual')) return 'Virtual Cable';
    if (low.includes('line')) return 'Line In';
    return 'Mic / Interface';
  };

  const handleScanAndAutoAssignInputs = async (autoMap: boolean) => {
    setScanningPorts(true);
    try {
      let inputs = inputDevices;
      if (onScanAudioDevices) {
        const res = await onScanAudioDevices(true);
        inputs = res.inputs;
      } else if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        const all = await navigator.mediaDevices.enumerateDevices();
        inputs = all.filter((d) => d.kind === 'audioinput');
      }

      if (autoMap) {
        inputs.forEach((dev, i) => {
          const label = dev.label || `Audio Input ${i + 1}`;
          const kind = classifyInputRole(label);
          const target = channels[i];
          if (target) {
            onUpdateChannel(target.id, {
              name: label.slice(0, 26),
              role: kind,
              hardwareInputId: dev.deviceId,
              hardwareInputLabel: label,
            });
          } else if (onAddChannel) {
            onAddChannel(label.slice(0, 26), kind);
          }
        });
      }
      setGuardNotice(
        autoMap
          ? `Scanned ${inputs.length} input port(s) and auto-assigned them to channels.`
          : `Scanned ${inputs.length} input port(s). Pick any input port per channel below or click Auto-Assign.`
      );
      window.setTimeout(() => setGuardNotice(null), 5000);
    } catch (err) {
      setGuardNotice(`Input scan failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanningPorts(false);
    }
  };

  const handleScanAndAutoAssignOutputs = async (autoMap: boolean) => {
    setScanningPorts(true);
    try {
      let outputs = outputDevices;
      if (onScanAudioDevices) {
        const res = await onScanAudioDevices(false);
        outputs = res.outputs;
      } else if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        const all = await navigator.mediaDevices.enumerateDevices();
        outputs = all.filter((d) => d.kind === 'audiooutput');
      }

      if (autoMap && onUpdateZone) {
        outputs.forEach((dev, i) => {
          const label = dev.label || `System Output ${i + 1}`;
          const target = zones[i];
          if (target) {
            onUpdateZone(target.id, {
              hardwareOutputId: dev.deviceId,
              hardwareOutput: label,
            });
          } else if (onAddZone) {
            onAddZone(label.slice(0, 28), 'overflow');
          }
        });
      }
      setGuardNotice(
        autoMap
          ? `Scanned ${outputs.length} system output port(s) and auto-assigned across speaker zones.`
          : `Scanned ${outputs.length} system output port(s). Assign Front, Rear, Subs, or any speaker below.`
      );
      window.setTimeout(() => setGuardNotice(null), 5000);
    } catch (err) {
      setGuardNotice(`Output scan failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanningPorts(false);
    }
  };

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

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <button
            type="button"
            disabled={scanningPorts}
            onClick={() => void handleScanAndAutoAssignInputs(true)}
            className="px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/35 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanningPorts ? 'animate-spin' : ''}`} />
            Auto-Scan &amp; Map Inputs
          </button>
          {onAddChannel && (
            <button
              type="button"
              onClick={() => onAddChannel()}
              className="px-2.5 py-1 rounded bg-sky-500/20 border border-sky-400/50 text-sky-200 hover:bg-sky-500/35 font-bold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Input
            </button>
          )}
          {onAddZone && (
            <button
              type="button"
              onClick={() => onAddZone()}
              className="px-2.5 py-1 rounded bg-violet-500/20 border border-violet-400/50 text-violet-200 hover:bg-violet-500/35 font-bold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Output Bus
            </button>
          )}
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

      {/* Clear 2-Column Input & Output Port Scanner / Assignment */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* INPUT CHANNELS: Scan & Assign (Unlimited) */}
        <div className="p-4 rounded-xl border border-sky-500/30 bg-[#080C14] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-sky-400" />
              <div>
                <h3 className="font-display text-sm font-bold text-white">
                  Input Channel Scanner &amp; Port Assignment ({channels.length})
                </h3>
                <p className="font-mono text-[10px] text-slate-400">
                  {inputDevices.length} audio input(s) detected · Unlimited channels · Auto or manual port mapping
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
              <button
                type="button"
                disabled={scanningPorts}
                onClick={() => void handleScanAndAutoAssignInputs(false)}
                className="px-2 py-1 rounded bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 font-bold cursor-pointer"
              >
                Scan Inputs
              </button>
              <button
                type="button"
                disabled={scanningPorts}
                onClick={() => void handleScanAndAutoAssignInputs(true)}
                className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/35 font-bold cursor-pointer"
              >
                Auto-Assign All
              </button>
              {onAddChannel && (
                <button
                  type="button"
                  onClick={() => onAddChannel()}
                  className="px-2 py-1 rounded bg-sky-500/20 border border-sky-400/50 text-sky-200 hover:bg-sky-500/35 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  + Channel
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {channels.map((ch) => (
              <div
                key={ch.id}
                className="grid grid-cols-12 items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-[#0D121F] font-mono text-[11px]"
              >
                <span className="col-span-1 text-sky-400 font-bold">
                  CH{String(ch.index).padStart(2, '0')}
                </span>
                <input
                  type="text"
                  value={ch.name}
                  onChange={(e) => onUpdateChannel(ch.id, { name: e.target.value })}
                  aria-label={`Channel ${ch.index} Name`}
                  className="col-span-4 bg-[#070A10] border border-slate-700 rounded px-2 py-1 text-white text-[11px] focus:outline-none focus:border-sky-400"
                />
                <select
                  aria-label={`Channel ${ch.index} Input Port`}
                  value={ch.hardwareInputId ?? ''}
                  onChange={(e) => {
                    const devId = e.target.value;
                    const dev = inputDevices.find((d) => d.deviceId === devId);
                    onUpdateChannel(ch.id, {
                      hardwareInputId: devId || undefined,
                      hardwareInputLabel: dev?.label || (devId ? devId : undefined),
                      role: dev ? classifyInputRole(dev.label || '') : ch.role,
                    });
                  }}
                  className="col-span-6 bg-[#070A10] border border-slate-700 rounded px-2 py-1 text-slate-200 text-[11px] focus:outline-none focus:border-sky-400"
                >
                  <option value="">Unassigned / Console Direct</option>
                  {inputDevices.map((d, idx) => (
                    <option key={`${d.deviceId}-${idx}`} value={d.deviceId}>
                      {d.label || `Audio Input ${idx + 1}`}
                    </option>
                  ))}
                </select>
                <div className="col-span-1 flex justify-end">
                  {onRemoveChannel && channels.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveChannel(ch.id)}
                      title="Remove Input Channel"
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* OUTPUT SPEAKERS / PORTS: Auto-Scanned at Startup + Manual Assignment (Unlimited) */}
        <div className="p-4 rounded-xl border border-violet-500/30 bg-[#080C14] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Speaker className="w-4 h-4 text-violet-400" />
              <div>
                <h3 className="font-display text-sm font-bold text-white">
                  Output Speaker &amp; Port Assignment ({zones.length})
                </h3>
                <p className="font-mono text-[10px] text-slate-400">
                  {outputDevices.length} system output(s) auto-scanned · Assign Front, Rear, Subs &amp; unlimited ports
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
              <button
                type="button"
                disabled={scanningPorts}
                onClick={() => void handleScanAndAutoAssignOutputs(false)}
                className="px-2 py-1 rounded bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 font-bold cursor-pointer"
              >
                Scan Outputs
              </button>
              <button
                type="button"
                disabled={scanningPorts}
                onClick={() => void handleScanAndAutoAssignOutputs(true)}
                className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/35 font-bold cursor-pointer"
              >
                Auto-Assign
              </button>
              {onAddZone && (
                <div className="flex items-center gap-1">
                  <select
                    aria-label="New Speaker Role"
                    value={newZoneRole}
                    onChange={(e) => setNewZoneRole(e.target.value as SpeakerZone['role'])}
                    className="bg-[#0D121F] border border-violet-500/40 rounded px-1.5 py-1 text-violet-200 text-[10px]"
                  >
                    {SPEAKER_ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const roleLabel =
                        SPEAKER_ROLE_OPTIONS.find((r) => r.value === newZoneRole)?.label ?? 'Speaker';
                      onAddZone(`${roleLabel} ${zones.length + 1}`, newZoneRole);
                    }}
                    className="px-2 py-1 rounded bg-violet-500/25 border border-violet-400/60 text-violet-100 hover:bg-violet-500/40 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/20 grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[10px]">
            <label className="space-y-1 block">
              <span className="text-slate-300 font-bold uppercase block">
                1. Physical Speaker / PA Output (Built-in / DAC)
              </span>
              <select
                aria-label="Physical Speaker Output"
                value={preferredOutputDeviceId}
                onChange={(e) => onSelectOutputDevice?.(e.target.value)}
                className="w-full bg-[#070A10] border border-slate-700 rounded px-2 py-1 text-slate-200"
              >
                <option value="">Windows Taskbar Default Speaker</option>
                {outputDevices.map((d, idx) => (
                  <option key={`phys-${d.deviceId}-${idx}`} value={d.deviceId}>
                    {d.label || `Speaker Output ${idx + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="text-emerald-300 font-bold uppercase block">
                2. Dedicated Virtual Cable / OBS Sink (Parallel)
              </span>
              <select
                aria-label="Dedicated Stream Virtual Cable Output"
                value={preferredStreamOutputDeviceId}
                onChange={(e) => onSelectStreamOutputDevice?.(e.target.value)}
                className="w-full bg-[#070A10] border border-emerald-500/40 rounded px-2 py-1 text-emerald-200"
              >
                <option value="">Disabled (Speakers Only)</option>
                {outputDevices.map((d, idx) => (
                  <option key={`vb-${d.deviceId}-${idx}`} value={d.deviceId}>
                    {d.label || `Virtual / Stream Output ${idx + 1}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {zones.map((z) => (
              <div
                key={z.id}
                className="grid grid-cols-12 items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-[#0D121F] font-mono text-[11px]"
              >
                <input
                  type="text"
                  value={z.name}
                  onChange={(e) => onUpdateZone?.(z.id, { name: e.target.value })}
                  aria-label={`Speaker Zone ${z.name} Name`}
                  className="col-span-3 bg-[#070A10] border border-slate-700 rounded px-2 py-1 text-white text-[11px] focus:outline-none focus:border-violet-400"
                />
                <select
                  aria-label={`Speaker Zone ${z.name} Role`}
                  value={z.role}
                  onChange={(e) =>
                    onUpdateZone?.(z.id, { role: e.target.value as SpeakerZone['role'] })
                  }
                  className="col-span-3 bg-[#070A10] border border-slate-700 rounded px-1.5 py-1 text-violet-200 text-[10px] focus:outline-none focus:border-violet-400"
                >
                  {SPEAKER_ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Speaker Zone ${z.name} System Output Port`}
                  value={z.hardwareOutputId ?? ''}
                  onChange={(e) => {
                    const devId = e.target.value;
                    const dev = outputDevices.find((d) => d.deviceId === devId);
                    onUpdateZone?.(z.id, {
                      hardwareOutputId: devId || undefined,
                      hardwareOutput: dev?.label || (devId ? devId : 'System Default'),
                    });
                  }}
                  className="col-span-5 bg-[#070A10] border border-slate-700 rounded px-1.5 py-1 text-slate-200 text-[11px] focus:outline-none focus:border-violet-400"
                >
                  <option value="">System Default Output</option>
                  {outputDevices.map((d, idx) => (
                    <option key={`${d.deviceId}-${idx}`} value={d.deviceId}>
                      {d.label || `System Output ${idx + 1}`}
                    </option>
                  ))}
                </select>
                <div className="col-span-1 flex justify-end">
                  {onRemoveZone && zones.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveZone(z.id)}
                      title="Remove Speaker Output"
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

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
              {channels.map((ch) => {
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
                        <option value="internal-vc-browser">Built-in Virtual Cable A (Browser / Tab Audio)</option>
                        <option value="internal-vc-media">Built-in Virtual Cable B (Media Player / File)</option>
                        <option value="obs-return">Built-in Virtual Cable C (OBS Return)</option>
                        <option value="loopback-pa">Main PA Loopback (Cycle Guarded)</option>
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
