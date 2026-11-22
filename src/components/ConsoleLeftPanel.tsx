import React, { useEffect, useState } from 'react';
import {
  Mic,
  Volume2,
  RefreshCw,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Headphones,
  Radio,
  Speaker,
  Check,
  ArrowRight,
  Cable,
} from 'lucide-react';
import type { InputChannel, SpeakerZone, SignalTelemetry } from '../types/audio.ts';
import { liveAudioEngine } from '../audio/liveAudioEngine.ts';
import { deriveAutoChannelNameAndRole } from '../utils/audioNaming.ts';
import { RotaryKnob } from './StudioControls.tsx';

interface ConsoleLeftPanelProps {
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  channels: InputChannel[];
  selectedChannelId: string;
  preferredOutputDeviceId: string;
  preferredStreamOutputDeviceId: string;
  zones: SpeakerZone[];
  telemetry: SignalTelemetry;
  engineRunning: boolean;
  locked?: boolean;
  onSelectChannel: (id: string) => void;
  onUpdateChannel: (id: string, patch: Partial<InputChannel>) => void;
  onAddChannel?: (name?: string, role?: string) => void;
  onSelectOutputDevice: (deviceId: string) => void;
  onSelectStreamOutputDevice: (deviceId: string) => void;
  onScanAudioDevices?: (
    requestPermission?: boolean
  ) => Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>;
}

const SEGMENTS_10 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export const ConsoleLeftPanel: React.FC<ConsoleLeftPanelProps> = ({
  inputDevices = [],
  outputDevices = [],
  channels = [],
  selectedChannelId,
  preferredOutputDeviceId = '',
  preferredStreamOutputDeviceId = '',
  zones = [],
  telemetry,
  engineRunning,
  locked = false,
  onSelectChannel,
  onUpdateChannel,
  onAddChannel,
  onSelectOutputDevice,
  onSelectStreamOutputDevice,
  onScanAudioDevices,
}) => {
  const [activeTab, setActiveTab] = useState<'inputs' | 'outputs'>('inputs');
  const [collapsed, setCollapsed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [bankIdx, setBankIdx] = useState(0);
  const [patchTrayOpen, setPatchTrayOpen] = useState(true);
  const [fastChRms, setFastChRms] = useState<number[]>([]);
  const [fastChPeak, setFastChPeak] = useState<number[]>([]);
  const [fastPostDb, setFastPostDb] = useState(-96);

  // Throttled ~30fps live hardware level meter sampling
  useEffect(() => {
    if (!engineRunning) {
      setFastChRms([]);
      setFastChPeak([]);
      setFastPostDb(-96);
      return;
    }
    let rafId = 0;
    let lastTick = 0;
    const tick = (now: number) => {
      if (now - lastTick >= 33) {
        lastTick = now;
        const snap = liveAudioEngine.sampleFastLevels();
        if (snap.isRunning) {
          setFastChRms(snap.channelRmsDb);
          setFastChPeak(snap.channelPeakDb);
          setFastPostDb(snap.postRmsDb);
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [engineRunning]);

  const totalBanks = Math.max(1, Math.ceil(channels.length / 8));
  const safeBankIdx = Math.min(bankIdx, totalBanks - 1);
  const bankStart = safeBankIdx * 8;
  const bankChannels = channels.slice(bankStart, bankStart + 8);
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0];

  const handleScan = async () => {
    setScanning(true);
    try {
      if (onScanAudioDevices) {
        await onScanAudioDevices(true);
      }
    } finally {
      setScanning(false);
    }
  };

  const classifyInput = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes('cable') || l.includes('virtual') || l.includes('loopback')) {
      return { kind: 'Virtual', dot: 'bg-emerald-400', badge: 'text-emerald-300 border-emerald-500/35 bg-emerald-950/40' };
    }
    if (
      l.includes('usb') ||
      l.includes('focusrite') ||
      l.includes('behringer') ||
      l.includes('yamaha') ||
      l.includes('scarlett') ||
      l.includes('mg')
    ) {
      return { kind: 'USB Audio', dot: 'bg-sky-400', badge: 'text-sky-300 border-sky-500/35 bg-sky-950/40' };
    }
    if (l.includes('line') || l.includes('aux')) {
      return { kind: 'Line In', dot: 'bg-violet-400', badge: 'text-violet-300 border-violet-500/35 bg-violet-950/40' };
    }
    return { kind: 'Mic In', dot: 'bg-amber-400', badge: 'text-amber-300 border-amber-500/35 bg-amber-950/40' };
  };

  const classifyOutput = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes('cable') || l.includes('virtual') || l.includes('voicemeeter') || l.includes('obs')) {
      return { kind: 'Virtual / OBS Bus', color: 'text-violet-300 bg-violet-950/40 border-violet-500/35', icon: Radio };
    }
    if (l.includes('headphone') || l.includes('earphone') || l.includes('bluetooth') || l.includes('buds')) {
      return { kind: 'Headphones / Cue', color: 'text-sky-300 bg-sky-950/40 border-sky-500/35', icon: Headphones };
    }
    if (l.includes('jack 3/4') || l.includes('center / sub')) {
      return { kind: 'Subwoofer Jack 3/4', color: 'text-amber-300 bg-amber-950/40 border-amber-500/35', icon: Speaker };
    }
    if (l.includes('jack 5/6') || l.includes('rear / delay')) {
      return { kind: 'Delay Jack 5/6', color: 'text-fuchsia-300 bg-fuchsia-950/40 border-fuchsia-500/35', icon: Speaker };
    }
    if (l.includes('jack 7/8') || l.includes('side / aux')) {
      return { kind: 'Monitor Jack 7/8', color: 'text-cyan-300 bg-cyan-950/40 border-cyan-500/35', icon: Speaker };
    }
    return { kind: 'Main PA Out', color: 'text-emerald-300 bg-emerald-950/40 border-emerald-500/35', icon: Speaker };
  };

  const meterWidth = Math.max(0, Math.min(100, (((engineRunning ? fastPostDb : telemetry.postRmsDb) + 60) / 60) * 100));

  if (collapsed) {
    return (
      <aside
        aria-label="Collapsed Input & Output Panel"
        className="w-10 shrink-0 h-full hw-panel rounded-lg flex flex-col items-center justify-between py-2.5 select-none"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand Inputs / Outputs Panel"
          className="p-1.5 rounded bg-[#0E141A] border border-[#2A3646] text-teal-300 hover:text-white cursor-pointer"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setActiveTab('inputs');
              setCollapsed(false);
            }}
            title={`Inputs (${channels.length} channels)`}
            className={`p-1.5 rounded border cursor-pointer ${
              activeTab === 'inputs'
                ? 'bg-teal-500/20 border-teal-400/60 text-teal-300'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('outputs');
              setCollapsed(false);
            }}
            title={`Outputs (${outputDevices.length} endpoints)`}
            className={`p-1.5 rounded border cursor-pointer ${
              activeTab === 'outputs'
                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <span
          className={`w-2 h-2 rounded-full ${
            engineRunning ? 'bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.85)]' : 'bg-slate-600'
          }`}
        />
      </aside>
    );
  }

  return (
    <aside
      aria-label="Live Console Inputs & Outputs Rack"
      className="w-[236px] xl:w-[248px] shrink-0 h-full hw-panel rounded-lg flex flex-col overflow-hidden select-none"
    >
      {/* Top Interchangeable Tab Header */}
      <div className="h-8 shrink-0 px-1.5 border-b border-[#25303D] bg-[#141B23] flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 flex-1 min-w-0 font-mono text-[9.5px] font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('inputs')}
            className={`flex-1 h-6 px-1.5 rounded border flex items-center justify-center gap-1 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'inputs'
                ? 'bg-[#0C1418] border-[#2DD4BF]/70 text-[#5EEAD4] shadow-[0_0_8px_rgba(45,212,191,0.22)]'
                : 'bg-[#10161D] border-[#26303D] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mic className="w-2.5 h-2.5 shrink-0" />
            <span>INPUTS</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('outputs')}
            className={`flex-1 h-6 px-1.5 rounded border flex items-center justify-center gap-1 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'outputs'
                ? 'bg-[#0C1513] border-emerald-400/70 text-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.22)]'
                : 'bg-[#10161D] border-[#26303D] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Volume2 className="w-2.5 h-2.5 shrink-0" />
            <span>OUT ({outputDevices.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 pl-0.5">
          <button
            type="button"
            disabled={scanning}
            onClick={() => void handleScan()}
            title="Re-Scan Live Audio Hardware & Virtual Ports"
            className="p-1 rounded text-slate-400 hover:text-teal-300 hover:bg-[#1E2733] cursor-pointer disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${scanning ? 'animate-spin text-teal-400' : ''}`} />
          </button>
          {activeTab === 'inputs' && onAddChannel && (
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                onAddChannel();
                setBankIdx(Math.floor(channels.length / 8));
              }}
              title="Add New Standalone Stereo Input Strip"
              className="p-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-[#1E2733] cursor-pointer disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Collapse Left Panel"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1E2733] cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* =========================================================================
          TAB 1: STANDALONE STEREO INPUT CHANNEL RACK + HARDWARE PATCH TRAY
          ========================================================================= */}
      {activeTab === 'inputs' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {totalBanks > 1 && (
            <div className="shrink-0 px-1.5 pt-1.5 flex items-center gap-1 overflow-x-auto scrollbar-none font-mono text-[9px]">
              {Array.from({ length: totalBanks }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setBankIdx(i)}
                  className={`px-2 py-0.5 rounded border font-bold cursor-pointer whitespace-nowrap ${
                    safeBankIdx === i
                      ? 'bg-teal-500/20 border-teal-400/70 text-teal-200'
                      : 'bg-[#0F141A] border-[#25303D] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  CH {i * 8 + 1}–{Math.min(channels.length, (i + 1) * 8)}
                </button>
              ))}
            </div>
          )}

          {/* Stacked 8 Machined Input Channel Cards */}
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-1.5">
            {bankChannels.map((ch, idx) => {
              const globalIdx = bankStart + idx;
              const isSelected = ch.id === selectedChannel?.id;
              const rmsDb =
                engineRunning && !ch.mute
                  ? fastChRms[globalIdx] ?? telemetry.channelLevels?.[globalIdx]?.rmsDb ?? ch.levelDb
                  : -96;
              const peakDb =
                engineRunning && !ch.mute
                  ? fastChPeak[globalIdx] ?? telemetry.channelLevels?.[globalIdx]?.peakDb ?? ch.peakDb
                  : -96;
              const isHot = (engineRunning && !ch.mute && peakDb > -2.5) || ch.faderDb > 4.5 || ch.gainDb > 46;
              const normMeter = engineRunning && !ch.mute ? Math.max(0, Math.min(1, (rmsDb + 54) / 54)) : 0;
              const litSegments = engineRunning && !ch.mute && rmsDb > -53 ? Math.max(1, Math.round(normMeter * 10)) : 0;
              const faderPct = Math.max(0, Math.min(100, ((ch.faderDb + 48) / 58) * 100));

              return (
                <div
                  key={ch.id}
                  onClick={() => onSelectChannel(ch.id)}
                  className={`rounded-md border px-1.5 py-1 flex items-center gap-1.5 cursor-pointer transition-all shrink-0 ${
                    isHot
                      ? 'border-amber-500/85 bg-gradient-to-b from-[#271E14] to-[#1A130D] shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                      : isSelected
                        ? 'border-[#2DD4BF] bg-gradient-to-b from-[#17282D] to-[#111D22] shadow-[0_0_12px_rgba(45,212,191,0.28)]'
                        : 'border-[#26303D] bg-gradient-to-b from-[#192029] to-[#12171E] hover:border-[#3B495B]'
                  }`}
                >
                  {/* Column 1: Channel Number & Peak/Limit Indicator */}
                  <div className="w-4 shrink-0 flex flex-col items-center justify-between self-stretch py-0.5 font-mono">
                    <span className={`text-[10px] font-bold ${isSelected ? 'text-[#5EEAD4]' : 'text-slate-400'}`}>
                      {ch.index}
                    </span>
                    {isHot ? (
                      <AlertTriangle className="w-3 h-3 text-amber-400 animate-pulse" />
                    ) : (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          ch.mute
                            ? 'bg-rose-500'
                            : engineRunning && rmsDb > -52
                              ? 'bg-[#4ADE80] shadow-[0_0_5px_rgba(74,222,128,0.85)]'
                              : 'bg-slate-600'
                        }`}
                      />
                    )}
                  </div>

                  {/* Column 2: Vertical 10-Segment Live LED Meter */}
                  <div
                    className="w-2 h-11 rounded-[2px] bg-[#080C10] border border-[#1E2733] p-[1px] flex flex-col justify-between shrink-0"
                    aria-label={`Channel ${ch.index} Level`}
                  >
                    {SEGMENTS_10.slice()
                      .reverse()
                      .map((segIdx) => {
                        const lit = segIdx < litSegments;
                        const color =
                          segIdx >= 8
                            ? lit
                              ? isHot
                                ? 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.9)]'
                                : 'bg-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.85)]'
                              : 'bg-[#1D161A]'
                            : segIdx >= 6
                              ? lit
                                ? 'bg-amber-400'
                                : 'bg-[#1C1E1B]'
                              : lit
                                ? 'bg-[#4ADE80] shadow-[0_0_4px_rgba(74,222,128,0.65)]'
                                : 'bg-[#101C18]';
                        return <div key={segIdx} className={`w-full h-[3px] rounded-[0.5px] ${color}`} />;
                      })}
                  </div>

                  {/* Column 3: Channel Label, Micro Controls & Horizontal Level Slider */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between gap-1 py-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className="text-[11px] font-semibold text-slate-100 truncate leading-none"
                        title={`${ch.name} (${ch.hardwareInputLabel || ch.role})`}
                      >
                        {ch.name}
                      </span>
                      <div
                        className="flex items-center gap-0.5 shrink-0 font-mono text-[8px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => onUpdateChannel(ch.id, { mute: !ch.mute })}
                          title={ch.mute ? 'Unmute Channel' : 'Mute Channel'}
                          className={`w-3.5 h-3.5 rounded-[2px] border font-bold leading-none flex items-center justify-center cursor-pointer disabled:opacity-50 ${
                            ch.mute
                              ? 'bg-rose-600 border-rose-300 text-white'
                              : 'bg-[#0F141B] border-[#2C3746] text-slate-400 hover:text-white'
                          }`}
                        >
                          M
                        </button>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => onUpdateChannel(ch.id, { solo: !ch.solo })}
                          title={ch.solo ? 'Clear Solo' : 'Solo Channel'}
                          className={`w-3.5 h-3.5 rounded-[2px] border font-bold leading-none flex items-center justify-center cursor-pointer disabled:opacity-50 ${
                            ch.solo
                              ? 'bg-amber-400 border-amber-200 text-slate-950'
                              : 'bg-[#0F141B] border-[#2C3746] text-slate-400 hover:text-white'
                          }`}
                        >
                          S
                        </button>
                      </div>
                    </div>

                    {/* Sleek Horizontal Fader Bar Matching Reference Image */}
                    <div
                      className="relative h-2.5 flex items-center"
                      onClick={(e) => e.stopPropagation()}
                      title={`Channel ${ch.index} Fader: ${ch.faderDb > 0 ? `+${ch.faderDb.toFixed(1)}` : ch.faderDb.toFixed(1)} dB`}
                    >
                      <div className="w-full h-1.5 rounded-full bg-[#090D12] border border-[#222C38] overflow-hidden relative">
                        <div
                          className={`h-full transition-all duration-75 ${
                            ch.mute
                              ? 'bg-slate-600'
                              : isHot
                                ? 'bg-amber-400'
                                : isSelected
                                  ? 'bg-[#2DD4BF]'
                                  : 'bg-[#4ADE80]'
                          }`}
                          style={{ width: `${faderPct}%` }}
                        />
                      </div>
                      <input
                        type="range"
                        aria-label={`Channel ${ch.index} Fader Level`}
                        min={-48}
                        max={10}
                        step={0.5}
                        disabled={locked}
                        value={ch.faderDb}
                        onChange={(e) => onUpdateChannel(ch.id, { faderDb: parseFloat(e.target.value) })}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize disabled:cursor-not-allowed"
                      />
                    </div>

                    {/* Subline: LIMIT badge or standalone stereo + dB */}
                    <div className="flex items-center justify-between font-mono text-[8.5px] leading-none">
                      {isHot ? (
                        <span className="text-amber-400 font-bold tracking-wider">LIMIT</span>
                      ) : (
                        <span className="text-slate-400 truncate max-w-[78px]">
                          {ch.hardwareInputLabel
                            ? ch.role
                            : ch.role.startsWith('Stereo')
                              ? ch.role
                              : `ST · ${ch.role}`}
                        </span>
                      )}
                      <span className="text-slate-300 tabular-nums font-semibold">
                        {ch.faderDb > 0 ? `+${ch.faderDb.toFixed(1)}` : ch.faderDb.toFixed(1)} dB
                      </span>
                    </div>
                  </div>

                  {/* Column 4: Compact Brushed-Metal Gain Knob */}
                  <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <RotaryKnob
                      label=""
                      value={ch.gainDb}
                      min={0}
                      max={60}
                      step={1}
                      defaultValue={24}
                      unit="dB"
                      size={32}
                      disabled={locked}
                      accent={isHot ? 'amber' : isSelected ? 'sky' : 'emerald'}
                      onChange={(next) => onUpdateChannel(ch.id, { gainDb: next })}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Collapsible Live Hardware Input Patch Tray (1-Click Route to Focused Channel) */}
          <div className="shrink-0 border-t border-[#25303D] bg-[#10151B]">
            <button
              type="button"
              onClick={() => setPatchTrayOpen((v) => !v)}
              className="w-full px-2.5 py-1.5 flex items-center justify-between font-mono text-[9.5px] font-bold text-slate-300 hover:text-white cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Cable className="w-3 h-3 text-teal-400" />
                <span>HARDWARE INPUTS ({inputDevices.length})</span>
              </span>
              {patchTrayOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>

            {patchTrayOpen && (
              <div className="max-h-[124px] overflow-y-auto px-1.5 pb-1.5 space-y-1">
                {inputDevices.length === 0 ? (
                  <div className="p-2 rounded border border-dashed border-[#273240] bg-[#0B1015] text-center font-mono text-[9px] text-slate-500">
                    No inputs detected. Click refresh to scan USB / soundcard inputs.
                  </div>
                ) : (
                  inputDevices.map((dev, idx) => {
                    const cls = classifyInput(dev.label || '');
                    const label = dev.label || `Audio Input ${idx + 1}`;
                    const boundToSelected = selectedChannel?.hardwareInputId === dev.deviceId;
                    return (
                      <div
                        key={`patch-in-${dev.deviceId}-${idx}`}
                        className={`px-2 py-1 rounded border flex items-center justify-between gap-1.5 font-mono text-[9px] ${
                          boundToSelected
                            ? 'border-teal-400/70 bg-[#122226]'
                            : 'border-[#232D3A] bg-[#0C1117]'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cls.dot}`} />
                          <span className="truncate text-slate-200" title={label}>
                            {label}
                          </span>
                        </div>
                        {selectedChannel && (
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => {
                              const auto = deriveAutoChannelNameAndRole(label, selectedChannel.index);
                              onUpdateChannel(selectedChannel.id, {
                                hardwareInputId: dev.deviceId,
                                hardwareInputLabel: label,
                                name: auto.name,
                                role: auto.role,
                              });
                            }}
                            title={`Assign "${label}" to CH${selectedChannel.index} (${selectedChannel.name}) as standalone stereo`}
                            className={`px-1.5 py-0.5 rounded border text-[8.5px] font-bold shrink-0 flex items-center gap-0.5 cursor-pointer disabled:opacity-45 ${
                              boundToSelected
                                ? 'bg-teal-500 text-slate-950 border-teal-300'
                                : 'bg-[#17202B] border-[#2E3C4D] text-teal-300 hover:border-teal-400'
                            }`}
                          >
                            <span>CH{selectedChannel.index}</span>
                            <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: LIVE OUTPUT DESTINATIONS & DISCRETE PCIE JACK ASSIGNMENTS
          ========================================================================= */}
      {activeTab === 'outputs' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1.5">
            {outputDevices.length === 0 ? (
              <div className="p-3 rounded border border-dashed border-[#273240] bg-[#0B1015] text-center font-mono text-[10px] text-slate-500">
                No audio output endpoints detected. Click refresh or plug in speakers/headphones.
              </div>
            ) : (
              outputDevices.map((dev, idx) => {
                const { kind, color, icon: DeviceIcon } = classifyOutput(dev.label || '');
                const isMasterOut = preferredOutputDeviceId
                  ? dev.deviceId === preferredOutputDeviceId
                  : idx === 0;
                const isStreamOut = dev.deviceId === preferredStreamOutputDeviceId;
                const assignedZones = zones.filter((z) => z.hardwareOutputId === dev.deviceId);
                const devLabel = dev.label || `Audio Output ${idx + 1}`;

                return (
                  <div
                    key={`out-card-${dev.deviceId}-${idx}`}
                    className={`p-2 rounded-md border space-y-1.5 transition ${
                      isMasterOut
                        ? 'border-emerald-500/70 bg-gradient-to-b from-[#13241F] to-[#0E1916]'
                        : isStreamOut
                          ? 'border-violet-500/70 bg-gradient-to-b from-[#1C1628] to-[#13101B]'
                          : 'border-[#26303D] bg-gradient-to-b from-[#181F28] to-[#12171E] hover:border-[#394759]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 ${color}`}
                      >
                        <DeviceIcon className="w-2.5 h-2.5" />
                        <span>{kind}</span>
                      </span>
                      <span className="font-mono text-[8.5px] text-emerald-400 font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        LIVE
                      </span>
                    </div>

                    <div className="font-mono text-[10.5px] font-bold text-white truncate" title={devLabel}>
                      {devLabel}
                    </div>

                    <div className="flex items-center gap-1 flex-wrap font-mono text-[8.5px]">
                      {isMasterOut && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold flex items-center gap-0.5">
                          <Check className="w-2.5 h-2.5" /> Master PA
                        </span>
                      )}
                      {isStreamOut && (
                        <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 font-bold flex items-center gap-0.5">
                          <Radio className="w-2.5 h-2.5" /> Stream OBS
                        </span>
                      )}
                      {assignedZones.map((z) => (
                        <span
                          key={z.id}
                          className="px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-500/35 truncate max-w-[120px]"
                        >
                          {z.name}
                        </span>
                      ))}
                      {!isMasterOut && !isStreamOut && assignedZones.length === 0 && (
                        <span className="text-slate-500 italic">Available port</span>
                      )}
                    </div>

                    {(isMasterOut || isStreamOut) && (
                      <div className="space-y-0.5 pt-0.5">
                        <div className="flex justify-between text-[8px] font-mono text-slate-400">
                          <span>BUS LEVEL</span>
                          <span className="text-emerald-400 font-bold tabular-nums">
                            {engineRunning ? `${fastPostDb.toFixed(1)} dBFS` : 'IDLE'}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[#090D12] border border-[#1E2833] overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[#4ADE80] via-amber-400 to-rose-500 transition-all duration-75"
                            style={{ width: `${meterWidth}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-1 pt-0.5">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => onSelectOutputDevice(dev.deviceId)}
                        className={`py-1 rounded font-mono text-[8.5px] font-bold border cursor-pointer disabled:opacity-45 ${
                          isMasterOut
                            ? 'bg-emerald-600 text-white border-emerald-400'
                            : 'bg-[#121820] border-[#2C3746] text-slate-300 hover:text-white hover:border-emerald-500/50'
                        }`}
                      >
                        {isMasterOut ? '✓ Master PA' : 'Set Master PA'}
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => onSelectStreamOutputDevice(dev.deviceId)}
                        className={`py-1 rounded font-mono text-[8.5px] font-bold border cursor-pointer disabled:opacity-45 ${
                          isStreamOut
                            ? 'bg-violet-600 text-white border-violet-400'
                            : 'bg-[#121820] border-[#2C3746] text-slate-300 hover:text-white hover:border-violet-500/50'
                        }`}
                      >
                        {isStreamOut ? '✓ Stream OBS' : 'Set Stream OBS'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="shrink-0 px-2.5 py-1.5 border-t border-[#25303D] bg-[#10151B] font-mono text-[9px] text-slate-400 flex items-center justify-between">
            <span>PCIe Multi-Jack Ports</span>
            <span className="text-emerald-400 font-bold">DISCRETE L/R</span>
          </div>
        </div>
      )}
    </aside>
  );
};
