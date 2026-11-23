import React, { useEffect, useState } from 'react';
import { AppLogo } from './AppLogo.tsx';
import {
  Volume2,
  VolumeX,
  Play,
  Square,
  ShieldAlert,
  GitBranch,
  Palette,
  Cpu,
  AlertTriangle,
  Keyboard,
  Activity,
  Sliders,
  ShieldCheck,
  Mic,
  Lock,
  Unlock,
  Wrench,
  Clock,
  Route,
  Gauge,
} from 'lucide-react';
import type {
  AudioSourceSimulation,
  ConsoleThemeId,
  DriverBackend,
  DspConfig,
  HardwareDevice,
  PlatformTarget,
  ServicePreset,
  TapTempoState,
} from '../types/audio.ts';

interface TopBarProps {
  venueName: string;
  roomName: string;
  activeDevice: HardwareDevice;
  platform: PlatformTarget;
  driver: DriverBackend;
  sampleRate: number;
  bufferSize: number;
  activePreset: ServicePreset;
  presets?: ServicePreset[];
  onSelectPreset?: (preset: ServicePreset) => void;
  consoleLocked?: boolean;
  onToggleLock?: () => void;
  engineRunning: boolean;
  onToggleEngine: () => void;
  monitorAudible: boolean;
  onToggleMonitor: () => void;
  emergencyMuted: boolean;
  onToggleEmergencyMute: () => void;
  totalBypassed: boolean;
  onToggleTotalBypass: () => void;
  consoleTheme: ConsoleThemeId;
  onThemeChange: (theme: ConsoleThemeId) => void;
  audioSource: AudioSourceSimulation;
  onSourceChange: (src: AudioSourceSimulation) => void;
  systemCpuPercent: number | null;
  schedulingRisk: 'low' | 'elevated' | 'critical';
  onOpenDiagnostics?: () => void;
  tapTempo: TapTempoState;
  onTapTempo: () => void;
  onOpenShortcuts: () => void;
  shortcutsArmed: boolean;
  inputDevices?: MediaDeviceInfo[];
  outputDevices?: MediaDeviceInfo[];
  activeOutputDeviceId?: string;
  onSelectOutputDevice?: (deviceId: string) => void;
  dsp?: DspConfig;
  onUpdateDsp?: (patch: Partial<DspConfig>) => void;
  agcGainDb?: number;
  qualityScorePct?: number;
  qualityGateEngaged?: boolean;
  qualityGateReason?: string | null;
  activeSurgicalFilters?: string[];
  onOpenGainStaging?: () => void;
  onOpenSignalJourney?: () => void;
}

const THEME_OPTIONS: { id: ConsoleThemeId; label: string }[] = [
  { id: 'midnight-studio', label: 'Brushed Gunmetal Studio' },
  { id: 'analog-amber', label: 'Warm Analog Console' },
  { id: 'broadcast-emerald', label: 'Broadcast Emerald' },
  { id: 'sanctuary-indigo', label: 'Sanctuary Indigo' },
  { id: 'daylight-foh', label: 'Daylight FOH (Light)' },
  { id: 'warm-daylight', label: 'Warm Daylight (Sand)' },
];

export const TopBar: React.FC<TopBarProps> = ({
  venueName,
  roomName,
  driver,
  sampleRate,
  bufferSize,
  activePreset,
  presets = [],
  onSelectPreset,
  consoleLocked = false,
  onToggleLock,
  engineRunning,
  onToggleEngine,
  monitorAudible,
  onToggleMonitor,
  emergencyMuted,
  onToggleEmergencyMute,
  totalBypassed,
  onToggleTotalBypass,
  consoleTheme,
  onThemeChange,
  audioSource,
  onSourceChange,
  systemCpuPercent,
  schedulingRisk,
  onOpenDiagnostics,
  tapTempo,
  onTapTempo,
  onOpenShortcuts,
  shortcutsArmed,
  inputDevices = [],
  outputDevices = [],
  activeOutputDeviceId = '',
  onSelectOutputDevice,
  dsp,
  onUpdateDsp,
  agcGainDb = 0,
  qualityScorePct = 100,
  qualityGateEngaged = false,
  qualityGateReason = null,
  activeSurgicalFilters = [],
  onOpenGainStaging,
  onOpenSignalJourney,
}) => {
  const [showToolsPopover, setShowToolsPopover] = useState(false);
  const toolsRef = React.useRef<HTMLDivElement | null>(null);
  const [tapFlash, setTapFlash] = useState(false);
  const [clockStr, setClockStr] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );

  useEffect(() => {
    if (!showToolsPopover) return;
    const onPointerDown = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setShowToolsPopover(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowToolsPopover(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showToolsPopover]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setClockStr(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!tapTempo.lastTapAt) return;
    setTapFlash(true);
    const t = window.setTimeout(() => setTapFlash(false), 320);
    return () => window.clearTimeout(t);
  }, [tapTempo.lastTapAt]);

  return (
    <header className="h-11 shrink-0 border-b border-[#26303D] bg-gradient-to-b from-[#1A212A] to-[#11161D] px-3 flex items-center justify-between gap-2 select-none relative z-40">
      {/* Left Zone: Brushed Console Identity */}
      <div
        className="flex items-center gap-2.5 min-w-0 shrink"
        title={`${venueName} · ${roomName} · ${driver} · ${(sampleRate / 1000).toFixed(1)} kHz (${bufferSize} smp)`}
      >
        <AppLogo className="w-7 h-7 shrink-0 rounded-md border border-[#324050] shadow-[0_0_12px_rgba(45,212,191,0.28)]" />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="font-display font-bold text-sm tracking-[0.06em] text-slate-100 whitespace-nowrap truncate">
            AUDIO DSP ENGINE
          </span>
          <span className="text-[10px] font-sans text-slate-400 tracking-wide whitespace-nowrap truncate">
            Live Church Sound System
          </span>
        </div>
      </div>

      {/* Right Zone: Engine Transport, Tools Popover, Lock Pill, Service Mode & Live Clock */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Live Audio Engine Start/Stop */}
        <button
          type="button"
          onClick={onToggleEngine}
          title={engineRunning ? 'Stop Live Audio Engine' : 'Start Live Audio Engine'}
          className={`h-7 px-2.5 rounded border font-mono text-[10px] font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            engineRunning
              ? 'bg-emerald-500/20 border-emerald-400/70 text-emerald-300 shadow-[0_0_10px_rgba(34,197,94,0.3)]'
              : 'hw-bevel-btn text-slate-200 hover:text-white'
          }`}
        >
          {engineRunning ? (
            <Square className="w-3 h-3 fill-current" />
          ) : (
            <Play className="w-3 h-3 fill-current text-emerald-400" />
          )}
          <span>{engineRunning ? 'ENGINE ON' : 'START'}</span>
        </button>

        {/* Audition Monitor Switch */}
        <button
          type="button"
          onClick={onToggleMonitor}
          disabled={!engineRunning}
          title="Audition processed console mix in local monitor speakers/headphones"
          className={`h-7 px-2 rounded border font-mono text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap disabled:opacity-40 cursor-pointer ${
            monitorAudible && !emergencyMuted
              ? 'bg-teal-500/20 border-teal-400/70 text-teal-200'
              : 'bg-[#10151C] border-[#293442] text-slate-300 hover:border-[#3D4D61]'
          }`}
        >
          {monitorAudible && !emergencyMuted ? (
            <Volume2 className="w-3.5 h-3.5 text-teal-300" />
          ) : (
            <VolumeX className="w-3.5 h-3.5 text-slate-400" />
          )}
          <span className="hidden lg:inline">MON</span>
        </button>

        {/* System CPU and telemetry scheduling status (opens Hardware Diagnostics) */}
        <button
          type="button"
          onClick={onOpenDiagnostics}
          title={`System CPU: ${systemCpuPercent === null ? 'unavailable' : `${systemCpuPercent}%`} · Telemetry scheduling risk: ${schedulingRisk.toUpperCase()} (Click for details)`}
          className={`hidden md:flex h-7 px-2 rounded border font-mono text-[10px] items-center gap-1.5 cursor-pointer ${
            schedulingRisk === 'critical'
              ? 'border-red-500/70 bg-red-950/60 text-red-200'
              : schedulingRisk === 'elevated'
                ? 'border-amber-500/70 bg-amber-950/50 text-amber-200'
                : 'bg-[#0D1218] border-[#26313E] text-slate-300 hover:border-[#3A4A5E]'
          }`}
        >
          <Cpu className={`w-3 h-3 ${engineRunning ? 'text-emerald-400' : 'text-slate-500'}`} />
          <span className="tabular-nums font-bold">
            {systemCpuPercent === null ? '—' : `${systemCpuPercent}%`}
          </span>
        </button>

        {/* Compact TOOLS & OUTPUTS Popover Trigger (preserves 100% of secondary TopBar tools) */}
        <div className="relative" ref={toolsRef}>
          <button
            type="button"
            onClick={() => setShowToolsPopover((v) => !v)}
            title="Console Tools: Theme, Tap Tempo, Input/Output Devices, Master Gain, Limiter, Quality Gate & Shortcuts"
            className={`h-7 px-2.5 rounded border font-mono text-[10px] font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              showToolsPopover || qualityGateEngaged || emergencyMuted || totalBypassed
                ? 'border-teal-400/70 bg-[#14232A] text-teal-200'
                : 'hw-bevel-btn'
            }`}
          >
            <Wrench className="w-3 h-3 text-teal-300" />
            <span className="tabular-nums hidden sm:inline">TOOLS · {tapTempo.bpm} BPM</span>
            <span className="sm:hidden">TOOLS</span>
          </button>

          {showToolsPopover && (
            <div className="fixed right-3 top-[68px] z-50 w-80 max-h-[82vh] overflow-y-auto rounded-lg border border-[#324152] bg-[#10161D] p-3.5 shadow-2xl space-y-3 font-mono text-[11px] text-slate-200">
              <div className="flex items-center justify-between border-b border-[#25303D] pb-2">
                <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                  Console Tools &amp; I/O Quick Strip
                </span>
                <button
                  type="button"
                  onClick={() => setShowToolsPopover(false)}
                  className="text-slate-400 hover:text-white text-[10px] px-1.5 py-0.5 rounded bg-[#18202B] border border-[#2C3949] cursor-pointer"
                >
                  CLOSE
                </button>
              </div>

              {/* Quick Source Mode & Master Output Selectors */}
              <div className="space-y-2">
                <div>
                  <label className="flex items-center gap-1.5 text-[10px] text-slate-400 uppercase mb-1">
                    <Mic className="w-3 h-3 text-teal-400" />
                    <span>Audio Engine Source Mode ({inputDevices.length} Live In)</span>
                  </label>
                  <select
                    aria-label="Audio Engine Source Mode"
                    value={audioSource}
                    onChange={(e) => {
                      onSourceChange(e.target.value as AudioSourceSimulation);
                    }}
                    className="w-full h-8 px-2 rounded border border-[#293544] bg-[#090D12] text-slate-200 text-[11px] focus:outline-none focus:border-teal-400"
                  >
                    <option value="live-mic">Live Console Inputs (Auto-Slotted CH1–CH{Math.max(1, inputDevices.length)})</option>
                    <option value="desktop-audio">Desktop Audio Loopback (Manual Opt-In)</option>
                    <option value="pink-noise">Calibration Pink Noise (-20 dBFS)</option>
                  </select>
                </div>

                {outputDevices && outputDevices.length > 0 && onSelectOutputDevice && (
                  <div>
                    <label className="flex items-center gap-1.5 text-[10px] text-slate-400 uppercase mb-1">
                      <Volume2 className="w-3 h-3 text-emerald-400" />
                      <span>Master PA Speaker Destination</span>
                    </label>
                    <select
                      aria-label="Master Speaker Destination (Front PA)"
                      value={activeOutputDeviceId || ''}
                      onChange={(e) => onSelectOutputDevice(e.target.value)}
                      className="w-full h-8 px-2 rounded border border-[#293544] bg-[#090D12] text-slate-200 text-[11px] focus:outline-none focus:border-teal-400"
                    >
                      <option value="">Default System Output</option>
                      {outputDevices.map((d, idx) => (
                        <option key={`out-pop-${d.deviceId}-${idx}`} value={d.deviceId}>
                          {d.label || `Output Port (${d.deviceId.slice(0, 6)})`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Theme, Tap Tempo & Keyboard Shortcuts */}
              <div className="space-y-2 pt-2 border-t border-[#25303D]">
                <div>
                  <label className="flex items-center gap-1.5 text-[10px] text-slate-400 uppercase mb-1">
                    <Palette className="w-3 h-3 text-teal-400" />
                    <span>Console Theme</span>
                  </label>
                  <select
                    aria-label="Console Color Theme"
                    value={consoleTheme}
                    onChange={(e) => onThemeChange(e.target.value as ConsoleThemeId)}
                    className="w-full h-8 px-2 rounded border border-[#293544] bg-[#090D12] text-slate-200 text-[11px] focus:outline-none focus:border-teal-400"
                  >
                    {THEME_OPTIONS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={onTapTempo}
                    className={`h-8 px-2 rounded border flex items-center justify-center gap-1.5 cursor-pointer ${
                      tapFlash
                        ? 'border-teal-400 bg-teal-500/25 text-teal-200'
                        : 'border-[#293544] bg-[#0B1016] text-slate-200 hover:border-slate-500'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5 text-teal-400" />
                    <span>TAP {tapTempo.bpm} BPM</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsPopover(false);
                      onOpenShortcuts();
                    }}
                    className={`h-8 px-2 rounded border flex items-center justify-center gap-1.5 cursor-pointer ${
                      shortcutsArmed
                        ? 'border-[#293544] bg-[#0B1016] text-slate-200 hover:border-slate-500'
                        : 'border-amber-500/50 bg-amber-950/40 text-amber-200'
                    }`}
                  >
                    <Keyboard className="w-3.5 h-3.5 text-teal-400" />
                    <span>SHORTCUTS</span>
                  </button>
                </div>

                {(onOpenGainStaging || onOpenSignalJourney) && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {onOpenGainStaging && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsPopover(false);
                          onOpenGainStaging();
                        }}
                        className="h-8 px-2 rounded border border-[#293544] bg-[#0B1016] text-slate-300 hover:text-white flex items-center justify-center gap-1 cursor-pointer text-[10px]"
                      >
                        <Gauge className="w-3 h-3 text-emerald-400" />
                        <span>GAIN STAGE</span>
                      </button>
                    )}
                    {onOpenSignalJourney && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsPopover(false);
                          onOpenSignalJourney();
                        }}
                        className="h-8 px-2 rounded border border-[#293544] bg-[#0B1016] text-slate-300 hover:text-white flex items-center justify-center gap-1 cursor-pointer text-[10px]"
                      >
                        <Route className="w-3 h-3 text-cyan-400" />
                        <span>SIGNAL TRACE</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Master Output, Limiter, Smart AGC & Quality Gate */}
              {dsp && onUpdateDsp && (
                <div className="space-y-2.5 pt-2 border-t border-[#25303D]">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-400 flex items-center gap-1">
                        <Sliders className="w-3 h-3 text-teal-400" />
                        Master Output Gain
                      </span>
                      <span className="text-teal-300 font-bold tabular-nums">
                        {(dsp.masterOutputGainDb ?? 0) >= 0 ? '+' : ''}
                        {(dsp.masterOutputGainDb ?? 0).toFixed(1)} dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-36}
                      max={6}
                      step={0.5}
                      disabled={consoleLocked}
                      value={dsp.masterOutputGainDb ?? 0}
                      onChange={(e) =>
                        onUpdateDsp({ masterOutputGainDb: parseFloat(e.target.value) })
                      }
                      className="w-full accent-teal-400 cursor-pointer disabled:opacity-40"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-400">Safety Limiter Ceiling</span>
                      <button
                        type="button"
                        disabled={consoleLocked}
                        onClick={() =>
                          onUpdateDsp({ limiter: { ...dsp.limiter, enabled: !dsp.limiter.enabled } })
                        }
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border cursor-pointer disabled:opacity-40 ${
                          dsp.limiter.enabled
                            ? 'bg-amber-500 text-slate-950 border-amber-300'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {dsp.limiter.enabled ? `${dsp.limiter.ceilingDb.toFixed(1)} dBFS` : 'OPEN'}
                      </button>
                    </div>
                    <input
                      type="range"
                      min={-12}
                      max={0}
                      step={0.5}
                      disabled={consoleLocked}
                      value={dsp.limiter.ceilingDb}
                      onChange={(e) =>
                        onUpdateDsp({
                          limiter: { ...dsp.limiter, ceilingDb: parseFloat(e.target.value), enabled: true },
                        })
                      }
                      className="w-full accent-amber-400 cursor-pointer disabled:opacity-40"
                    />
                  </div>

                  <div className="space-y-1.5 pt-1 border-t border-[#222B37]">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-400">Smart AGC Target RMS</span>
                      <span className="text-emerald-300 font-bold tabular-nums">
                        {dsp.smartAgc?.targetRmsDb ?? -18} dBFS ({agcGainDb >= 0 ? '+' : ''}
                        {agcGainDb.toFixed(1)} dB)
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[-20, -18, -14].map((t) => (
                        <button
                          key={t}
                          type="button"
                          disabled={consoleLocked}
                          onClick={() =>
                            onUpdateDsp({
                              smartAgc: {
                                enabled: true,
                                targetRmsDb: t,
                                maxBoostDb: dsp.smartAgc?.maxBoostDb ?? 14,
                                maxCutDb: dsp.smartAgc?.maxCutDb ?? 18,
                                gateFloorDb: dsp.smartAgc?.gateFloorDb ?? -52,
                              },
                            })
                          }
                          className={`py-1 rounded border text-[9px] font-bold cursor-pointer disabled:opacity-40 ${
                            (dsp.smartAgc?.targetRmsDb ?? -18) === t
                              ? 'bg-emerald-500 text-slate-950 border-emerald-300'
                              : 'bg-[#090E13] border-[#26313E] text-slate-400'
                          }`}
                        >
                          {t} dBFS
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1.5 border-t border-[#222B37]">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-400 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        Quality Gate ({qualityScorePct}%)
                      </span>
                      <button
                        type="button"
                        disabled={consoleLocked}
                        onClick={() =>
                          onUpdateDsp({
                            qualityGate: {
                              enabled: !(dsp.qualityGate?.enabled ?? true),
                              minQualityScorePct: dsp.qualityGate?.minQualityScorePct ?? 80,
                              autoProtectOnFeedback: true,
                              autoProtectOnClip: true,
                            },
                          })
                        }
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border cursor-pointer disabled:opacity-40 ${
                          (dsp.qualityGate?.enabled ?? true)
                            ? 'bg-emerald-500 text-slate-950 border-emerald-300'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {(dsp.qualityGate?.enabled ?? true) ? 'ENFORCED' : 'OFF'}
                      </button>
                    </div>
                    {qualityGateReason && (
                      <div className="text-[9px] text-amber-300 bg-amber-950/40 px-2 py-1 rounded border border-amber-500/30 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>{qualityGateReason}</span>
                      </div>
                    )}
                    {activeSurgicalFilters.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {activeSurgicalFilters.map((f) => (
                          <span
                            key={f}
                            className="px-1.5 py-0.5 rounded bg-teal-500/20 border border-teal-400/40 text-teal-200 text-[9px]"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={onToggleTotalBypass}
                      className={`h-7 rounded border text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                        totalBypassed
                          ? 'bg-amber-500 text-slate-950 border-amber-300'
                          : 'bg-[#0C1219] border-[#2A3646] text-amber-300 hover:border-amber-500/50'
                      }`}
                    >
                      <GitBranch className="w-3 h-3" />
                      <span>{totalBypassed ? 'BYP ON' : 'BYPASS'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={onToggleEmergencyMute}
                      className={`h-7 rounded border text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                        emergencyMuted
                          ? 'bg-red-600 text-white border-red-300'
                          : 'bg-red-950/40 border-red-500/50 text-red-300 hover:bg-red-600/25'
                      }`}
                    >
                      <ShieldAlert className="w-3 h-3" />
                      <span>{emergencyMuted ? 'MUTED' : 'SAFE MUTE'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Reference-Styled Hardware LOCKED / UNLOCKED Status Pill */}
        {onToggleLock && (
          <button
            type="button"
            onClick={onToggleLock}
            title={consoleLocked ? 'Console Controls Locked (Click to unlock)' : 'Console Unlocked (Click to lock controls against accidental edits)'}
            className={`h-7 px-2.5 rounded border font-mono text-[10px] font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              consoleLocked
                ? 'bg-[#211C13] border-amber-500/70 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                : 'bg-[#10151C] border-[#2D3846] text-slate-300 hover:border-slate-500 hover:text-white'
            }`}
          >
            {consoleLocked ? (
              <Lock className="w-3 h-3 text-amber-400" />
            ) : (
              <Unlock className="w-3 h-3 text-teal-400" />
            )}
            <span>{consoleLocked ? 'LOCKED' : 'UNLOCKED'}</span>
          </button>
        )}

        {/* SERVICE MODE Preset Quick Pill */}
        <div className="hidden sm:flex items-center gap-1.5 pl-1">
          <span className="font-mono text-[10px] tracking-[0.1em] text-slate-400 uppercase hidden lg:inline">
            SERVICE MODE
          </span>
          {presets.length > 0 && onSelectPreset ? (
            <select
              id="service-mode-preset-select"
              name="servicePreset"
              aria-label="Active Service Preset"
              disabled={consoleLocked}
              value={activePreset.id}
              onChange={(e) => {
                const found = presets.find((p) => p.id === e.target.value);
                if (found) onSelectPreset(found);
              }}
              className="h-7 px-2 rounded border border-[#2C3847] bg-[#0E1319] font-mono text-[10px] text-teal-300 font-semibold focus:outline-none focus:border-teal-400 max-w-[185px] truncate cursor-pointer disabled:opacity-50"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#0E1319] text-slate-100">
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="h-7 px-2 rounded border border-[#2C3847] bg-[#0E1319] font-mono text-[10px] text-teal-300 flex items-center max-w-[130px] truncate">
              {activePreset.name}
            </span>
          )}
        </div>

        {/* Live Tabular Clock */}
        <div className="hidden sm:flex items-center gap-1.5 pl-2 border-l border-[#283340] font-mono text-xs font-semibold text-slate-200 tabular-nums whitespace-nowrap">
          <Clock className="w-3 h-3 text-slate-400 hidden xl:inline" />
          <span>{clockStr}</span>
        </div>
      </div>
    </header>
  );
};
