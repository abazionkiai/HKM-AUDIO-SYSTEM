import React, { useState } from 'react';
import {
  Cable,
  Plus,
  Trash2,
  Radio,
  CheckCircle2,
  RotateCcw,
  Keyboard,
} from 'lucide-react';
import type {
  DspConfig,
  KeyboardShortcutBinding,
  MidiControlMode,
  MidiDeviceInfo,
  MidiMapping,
  MidiPacket,
  MidiTargetParam,
  PlatformTarget,
  ShortcutActionId,
  TapTempoState,
} from '../types/audio.ts';
import {
  CONTROLLER_PRESETS,
  MIDI_TARGET_SPECS,
  midiEngine,
} from '../midi/midiEngine.ts';
import {
  ConsolePushButton,
  RotaryKnob,
  VerticalFader,
} from './StudioControls.tsx';
import { KeyboardShortcutManager } from './KeyboardShortcutManager.tsx';

interface MidiMappingModuleProps {
  platform: PlatformTarget;
  midiDevices: MidiDeviceInfo[];
  midiConnected: boolean;
  midiError: string | null;
  onRequestMidiAccess: () => void;
  mappings: MidiMapping[];
  onUpdateMappings: (next: MidiMapping[]) => void;
  learningId: string | null;
  onSetLearningId: (id: string | null) => void;
  lastPacket: MidiPacket | null;
  dsp: DspConfig;
  emergencyMuted: boolean;
  shortcuts: KeyboardShortcutBinding[];
  onUpdateShortcuts: (next: KeyboardShortcutBinding[]) => void;
  shortcutsGlobalEnabled: boolean;
  onToggleShortcutsGlobalEnabled: () => void;
  capturingShortcutId: string | null;
  onSetCapturingShortcutId: (id: string | null) => void;
  onTriggerShortcutAction: (actionId: ShortcutActionId, viaCombo?: string) => void;
  lastTriggeredShortcut: { actionId: ShortcutActionId; label: string; combo: string; at: string } | null;
  shortcutConflictNotice: string | null;
  tapTempo: TapTempoState;
}

export const MidiMappingModule: React.FC<MidiMappingModuleProps> = ({
  platform,
  midiDevices,
  midiConnected,
  midiError,
  onRequestMidiAccess,
  mappings,
  onUpdateMappings,
  learningId,
  onSetLearningId,
  lastPacket,
  dsp,
  emergencyMuted,
  shortcuts,
  onUpdateShortcuts,
  shortcutsGlobalEnabled,
  onToggleShortcutsGlobalEnabled,
  capturingShortcutId,
  onSetCapturingShortcutId,
  onTriggerShortcutAction,
  lastTriggeredShortcut,
  shortcutConflictNotice,
  tapTempo,
}) => {
  const [surfaceTab, setSurfaceTab] = useState<'midi' | 'keyboard'>('midi');
  const [simFaders, setSimFaders] = useState<Record<number, number>>({
    7: 64,
    16: 46,
    17: 64,
    18: 88,
  });

  const osMidiStack =
    platform === 'windows'
      ? 'Windows WinMM / Windows MIDI Services (USB MIDI Class-Compliant)'
      : platform === 'macos'
        ? 'macOS CoreMIDI (USB & Network RTP-MIDI)'
        : 'Linux ALSA Sequencer / PipeWire MIDI Bridge';

  const handleAddMapping = () => {
    const spec = MIDI_TARGET_SPECS[0];
    const newMap: MidiMapping = {
      id: `map-${Date.now()}`,
      label: `Custom · ${spec.label}`,
      enabled: true,
      deviceName: 'Any Controller',
      channel: 1,
      messageType: 'cc',
      controller: 20 + (mappings.length % 20),
      target: spec.id,
      mode: spec.defaultMode,
      minVal: spec.minVal,
      maxVal: spec.maxVal,
      invert: false,
    };
    onUpdateMappings([newMap, ...mappings]);
    onSetLearningId(newMap.id);
  };

  const updateRow = (id: string, patch: Partial<MidiMapping>) => {
    onUpdateMappings(mappings.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const handleTargetChange = (id: string, targetId: MidiTargetParam) => {
    const spec = MIDI_TARGET_SPECS.find((s) => s.id === targetId);
    if (!spec) return;
    updateRow(id, {
      target: spec.id,
      label: spec.label,
      mode: spec.defaultMode,
      minVal: spec.minVal,
      maxVal: spec.maxVal,
    });
  };

  const loadControllerPreset = (presetKey: string) => {
    const preset = CONTROLLER_PRESETS[presetKey];
    if (!preset) return;
    onUpdateMappings(preset.mappings);
    onSetLearningId(null);
  };

  const triggerSimFader = (cc: number, val: number) => {
    const clamped = Math.max(0, Math.min(127, Math.round(val)));
    setSimFaders((prev) => ({ ...prev, [cc]: clamped }));
    midiEngine.injectSimulatedPacket('Virtual MIDI Surface', 1, 'cc', cc, clamped);
  };

  const triggerSimButton = (note: number) => {
    midiEngine.injectSimulatedPacket('Virtual MIDI Surface', 1, 'note', note, 127);
  };

  return (
    <div className="space-y-4">
      {/* Unified Control Surface Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#0B0F17] p-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSurfaceTab('midi')}
            className={`px-3 py-1.5 rounded text-xs font-mono font-semibold flex items-center gap-1.5 border ${
              surfaceTab === 'midi'
                ? 'border-sky-400/60 bg-sky-500/15 text-sky-300'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Cable className="w-3.5 h-3.5" />
            <span>HARDWARE MIDI SURFACE</span>
          </button>
          <button
            type="button"
            onClick={() => setSurfaceTab('keyboard')}
            className={`px-3 py-1.5 rounded text-xs font-mono font-semibold flex items-center gap-1.5 border ${
              surfaceTab === 'keyboard'
                ? 'border-sky-400/60 bg-sky-500/15 text-sky-300'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>KEYBOARD SHORTCUTS ({shortcuts.filter((s) => s.enabled && s.keyCombo).length})</span>
          </button>
        </div>
        <span className="text-[11px] font-mono text-slate-400 px-2">
          {surfaceTab === 'midi'
            ? 'Physical USB / RTP-MIDI Controller Matrix'
            : 'Global Window Keydown Listener & Action Bindings'}
        </span>
      </div>

      {surfaceTab === 'keyboard' ? (
        <KeyboardShortcutManager
          shortcuts={shortcuts}
          onUpdateShortcuts={onUpdateShortcuts}
          globalEnabled={shortcutsGlobalEnabled}
          onToggleGlobalEnabled={onToggleShortcutsGlobalEnabled}
          capturingId={capturingShortcutId}
          onSetCapturingId={onSetCapturingShortcutId}
          onTriggerAction={onTriggerShortcutAction}
          lastTriggered={lastTriggeredShortcut}
          conflictNotice={shortcutConflictNotice}
          tapTempo={tapTempo}
          emergencyMuted={emergencyMuted}
        />
      ) : (
        <>
      {/* Studio Rack Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]" />
          <div>
            <h1 className="font-display text-lg font-semibold text-white tracking-tight">
              HARDWARE MIDI CONTROL SURFACE &amp; BINDING MATRIX
            </h1>
            <p className="text-[11px] font-mono text-slate-400">
              {osMidiStack} · MIDI Learn · Bidirectional LED Feedback
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRequestMidiAccess}
            className={`px-3 py-1.5 rounded text-xs font-mono font-semibold flex items-center gap-1.5 border transition-colors ${
              midiConnected
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'bg-sky-600 border-sky-400/50 text-white hover:bg-sky-500'
            }`}
          >
            <Cable className="w-3.5 h-3.5" />
            <span>{midiConnected ? `WEB MIDI (${midiDevices.length} PORTS)` : 'CONNECT USB MIDI'}</span>
          </button>
          <button
            type="button"
            onClick={handleAddMapping}
            className="px-3 py-1.5 rounded bg-[#121824] border border-slate-700 hover:border-sky-500/60 text-white text-xs font-mono font-semibold flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            <span>NEW BINDING + LEARN</span>
          </button>
        </div>
      </div>

      {midiError && (
        <div className="p-3 rounded border border-amber-500/40 bg-amber-500/10 text-xs text-amber-300">
          {midiError}
        </div>
      )}

      {/* Virtual Hardware MIDI Surface (True Fader + Rotary Knobs + Tactile Pads) */}
      <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div>
            <div className="font-mono text-xs font-semibold text-white uppercase">
              Virtual Hardware MIDI Control Surface (Live Test &amp; Learn Bench)
            </div>
            <div className="text-[11px] text-slate-400">
              Drag the hardware fader, twist encoders, or hit transport pads to test live MIDI Learn and DSP bindings.
            </div>
          </div>
          <div className="font-mono text-[11px] text-sky-400 shrink-0">
            TRIM {dsp.inputTrimDb.toFixed(1)} dB · HPF {dsp.hpfHz} Hz · MUD {dsp.eqBands[1]?.gainDb.toFixed(1)} dB
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-3 flex items-center justify-center p-3 rounded border border-slate-800 bg-[#070A10]">
            <div className="flex items-center gap-4">
              <VerticalFader
                label="CC 7 Master Trim"
                value={simFaders[7] ?? 64}
                min={0}
                max={127}
                step={1}
                defaultValue={64}
                height={144}
                accent="sky"
                onChange={(val) => triggerSimFader(7, val)}
              />
              <div className="font-mono text-[10px] space-y-1 text-slate-400">
                <div className="text-sky-400 font-semibold">FADER 1</div>
                <div>CC #7 · CH 1</div>
                <div className="text-white">VAL: {simFaders[7] ?? 64}</div>
                <div className="text-slate-500">DSP Gain Trim</div>
              </div>
            </div>
          </div>

          <div className="md:col-span-6 grid grid-cols-3 gap-3 p-3.5 rounded border border-slate-800 bg-[#070A10] place-items-center">
            <RotaryKnob
              label="ENC 1 · CC16"
              value={simFaders[16] ?? 46}
              min={0}
              max={127}
              step={1}
              defaultValue={46}
              size={58}
              accent="amber"
              formatValue={(v) => `CC ${Math.round(v)}`}
              onChange={(val) => triggerSimFader(16, val)}
            />
            <RotaryKnob
              label="ENC 2 · CC17"
              value={simFaders[17] ?? 64}
              min={0}
              max={127}
              step={1}
              defaultValue={64}
              size={58}
              accent="sky"
              formatValue={(v) => `CC ${Math.round(v)}`}
              onChange={(val) => triggerSimFader(17, val)}
            />
            <RotaryKnob
              label="ENC 3 · CC18"
              value={simFaders[18] ?? 88}
              min={0}
              max={127}
              step={1}
              defaultValue={88}
              size={58}
              accent="emerald"
              formatValue={(v) => `CC ${Math.round(v)}`}
              onChange={(val) => triggerSimFader(18, val)}
            />
          </div>

          <div className="md:col-span-3 flex flex-col gap-2.5 p-3 rounded border border-slate-800 bg-[#070A10]">
            <div className="font-mono text-[10px] text-slate-400 uppercase">Transport &amp; Mute Pads</div>
            <ConsolePushButton
              label={emergencyMuted ? 'PAD 1 (N48) · PA MUTED' : 'PAD 1 (N48) · SAFE MUTE'}
              active={emergencyMuted}
              tone="red"
              onClick={() => triggerSimButton(48)}
            />
            <ConsolePushButton
              label={dsp.bypassed ? 'PAD 2 (N49) · DSP BYPASS' : 'PAD 2 (N49) · DSP ON'}
              active={dsp.bypassed}
              tone="amber"
              onClick={() => triggerSimButton(49)}
            />
          </div>
        </div>
      </div>

      {/* MIDI Ports + Controller Presets */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-white uppercase">
              Detected MIDI Ports &amp; Monitor
            </span>
            <span className="font-mono text-[11px] text-emerald-400">
              {midiConnected ? 'LISTENING' : 'STANDBY'}
            </span>
          </div>

          {midiDevices.length === 0 ? (
            <div className="p-3 rounded bg-[#070A10] border border-slate-800 text-xs text-slate-400">
              No physical USB MIDI ports enumerated yet. Connect a MIDI controller or use the Virtual Hardware MIDI Surface above.
            </div>
          ) : (
            <div className="divide-y divide-slate-800 text-xs max-h-32 overflow-y-auto">
              {midiDevices.map((d) => (
                <div key={d.id} className="py-1.5 flex items-center justify-between">
                  <span className="font-mono text-slate-200 truncate">
                    {d.name} ({d.direction.toUpperCase()})
                  </span>
                  <span className="font-mono text-[11px] text-emerald-400 flex items-center gap-1 shrink-0">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{d.state}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="p-2.5 rounded bg-[#070A10] border border-slate-800 font-mono text-[11px] flex items-center justify-between">
            <span className="text-slate-500">LAST PACKET:</span>
            {lastPacket ? (
              <span className="text-sky-400">
                {lastPacket.deviceName} · CH{lastPacket.channel} · {lastPacket.messageType.toUpperCase()} #{lastPacket.controller} = {lastPacket.rawValue}
              </span>
            ) : (
              <span className="text-slate-500">Waiting for MIDI event...</span>
            )}
          </div>
        </div>

        <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-white uppercase">
              Hardware Control Surface Templates
            </span>
            <button
              type="button"
              onClick={() => loadControllerPreset('nanokontrol2')}
              className="text-xs font-mono text-sky-400 hover:underline flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>RESET DEFAULT</span>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {Object.entries(CONTROLLER_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                onClick={() => loadControllerPreset(key)}
                className="p-3 rounded border border-slate-800 hover:border-sky-500/60 bg-[#090D14] text-left transition-colors"
              >
                <div className="text-xs font-semibold text-white">{preset.name}</div>
                <div className="text-[11px] text-slate-400 mt-1 leading-snug">{preset.subtitle}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MIDI Learn & Mapping Matrix */}
      <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-3 overflow-x-auto">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-semibold text-white uppercase">
            Active Parameter Bindings ({mappings.length})
          </span>
          {learningId && (
            <span className="text-xs font-mono text-amber-400 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5" />
              <span>MIDI LEARN ARMED — Move any fader, knob, or pad now</span>
            </span>
          )}
        </div>

        <table className="w-full text-left border-collapse min-w-[820px]">
          <thead>
            <tr className="border-b border-slate-800 font-mono text-[10px] uppercase text-slate-400">
              <th className="py-2 pr-3">On</th>
              <th className="py-2 pr-3">MIDI Source (Ch · Type · #)</th>
              <th className="py-2 pr-3">Target DSP / Console Parameter</th>
              <th className="py-2 pr-3">Mode</th>
              <th className="py-2 pr-3">Range</th>
              <th className="py-2 pr-3">Raw</th>
              <th className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 text-xs">
            {mappings.map((m) => {
              const isLearning = learningId === m.id;
              return (
                <tr key={m.id} className={isLearning ? 'bg-amber-500/10' : ''}>
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={(e) => updateRow(m.id, { enabled: e.target.checked })}
                      className="accent-sky-500"
                      aria-label={`Enable ${m.label}`}
                    />
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">CH</span>
                      <input
                        type="number"
                        min={1}
                        max={16}
                        value={m.channel}
                        onChange={(e) => updateRow(m.id, { channel: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })}
                        className="w-11 px-1.5 py-1 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs text-center"
                      />
                      <select
                        value={m.messageType}
                        onChange={(e) => updateRow(m.id, { messageType: e.target.value as MidiMapping['messageType'] })}
                        className="px-1.5 py-1 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs"
                      >
                        <option value="cc">CC</option>
                        <option value="note">Note</option>
                        <option value="pitchbend">PitchBend</option>
                      </select>
                      <input
                        type="number"
                        min={0}
                        max={127}
                        value={m.controller}
                        onChange={(e) => updateRow(m.id, { controller: Math.max(0, Math.min(127, Number(e.target.value) || 0)) })}
                        className="w-13 px-1.5 py-1 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs text-center"
                      />
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={m.target}
                      onChange={(e) => handleTargetChange(m.id, e.target.value as MidiTargetParam)}
                      className="w-full max-w-xs px-2 py-1 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs"
                    >
                      {MIDI_TARGET_SPECS.map((spec) => (
                        <option key={spec.id} value={spec.id}>
                          {spec.category} — {spec.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={m.mode}
                      onChange={(e) => updateRow(m.id, { mode: e.target.value as MidiControlMode })}
                      className="px-2 py-1 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs"
                    >
                      <option value="continuous">Continuous</option>
                      <option value="toggle">Toggle</option>
                      <option value="momentary">Momentary</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={m.minVal}
                        onChange={(e) => updateRow(m.id, { minVal: Number(e.target.value) })}
                        className="w-14 px-1.5 py-1 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs text-right"
                      />
                      <span className="text-slate-500">..</span>
                      <input
                        type="number"
                        value={m.maxVal}
                        onChange={(e) => updateRow(m.id, { maxVal: Number(e.target.value) })}
                        className="w-14 px-1.5 py-1 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs text-right"
                      />
                    </div>
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums text-sky-400">
                    {m.lastRawValue !== undefined ? m.lastRawValue : '--'}
                  </td>
                  <td className="py-2 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSetLearningId(isLearning ? null : m.id)}
                        className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold transition-colors ${
                          isLearning
                            ? 'bg-amber-500 text-slate-950'
                            : 'border border-slate-700 bg-[#121824] text-slate-200 hover:border-sky-500/60'
                        }`}
                      >
                        {isLearning ? 'LISTENING...' : 'LEARN'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateMappings(mappings.filter((x) => x.id !== m.id))}
                        aria-label={`Delete ${m.label}`}
                        className="p-1 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
        </>
      )}
    </div>
  );
};
