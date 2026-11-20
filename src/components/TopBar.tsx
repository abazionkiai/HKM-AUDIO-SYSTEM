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
} from 'lucide-react';
import type {
  AudioSourceSimulation,
  ConsoleThemeId,
  DriverBackend,
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
  audioCpuPct: number;
  underrunRisk: 'low' | 'elevated' | 'critical';
  onOpenDiagnostics?: () => void;
  tapTempo: TapTempoState;
  onTapTempo: () => void;
  onOpenShortcuts: () => void;
  shortcutsArmed: boolean;
  outputDevices?: MediaDeviceInfo[];
  activeOutputDeviceId?: string;
  onSelectOutputDevice?: (deviceId: string) => void;
}

const THEME_OPTIONS: { id: ConsoleThemeId; label: string }[] = [
  { id: 'midnight-studio', label: 'Theme: Midnight Studio' },
  { id: 'analog-amber', label: 'Theme: Warm Analog Console' },
  { id: 'broadcast-emerald', label: 'Theme: Broadcast Emerald' },
  { id: 'sanctuary-indigo', label: 'Theme: Sanctuary Indigo' },
  { id: 'daylight-foh', label: 'Theme: Daylight FOH (Light)' },
  { id: 'warm-daylight', label: 'Theme: Warm Daylight (Sand)' },
];

export const TopBar: React.FC<TopBarProps> = ({
  venueName,
  roomName,
  activeDevice,
  platform,
  driver,
  sampleRate,
  bufferSize,
  activePreset,
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
  audioCpuPct,
  underrunRisk,
  onOpenDiagnostics,
  tapTempo,
  onTapTempo,
  onOpenShortcuts,
  shortcutsArmed,
  outputDevices = [],
  activeOutputDeviceId = '',
  onSelectOutputDevice,
}) => {
  const platformLabel =
    platform === 'windows' ? 'Windows' : platform === 'macos' ? 'macOS' : 'Linux';
  const quantumMs = ((bufferSize / Math.max(8000, sampleRate)) * 1000).toFixed(1);
  const activeSegments = Math.max(1, Math.min(8, Math.round((audioCpuPct / 100) * 8)));
  const [tapFlash, setTapFlash] = useState(false);

  useEffect(() => {
    if (!tapTempo.lastTapAt) return;
    setTapFlash(true);
    const t = window.setTimeout(() => setTapFlash(false), 320);
    return () => window.clearTimeout(t);
  }, [tapTempo.lastTapAt]);

  return (
    <header className="h-14 shrink-0 border-b border-slate-800/90 bg-[#0B0F17] px-4 flex items-center justify-between gap-2.5 overflow-x-auto overflow-y-hidden">
      {/* Zone 1: Brand & Hardware Context */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
        <AppLogo className="w-6 h-6 shrink-0 shadow-[0_0_12px_rgba(56,189,248,0.4)]" />
        <span className="font-display font-semibold text-sm tracking-tight text-white whitespace-nowrap shrink-0">
          Church Audio Intelligence
        </span>
        <span className="text-slate-700 hidden 2xl:inline shrink-0" aria-hidden="true">
          /
        </span>
        <span className="text-xs text-slate-400 truncate hidden 2xl:inline">
          {venueName} · {roomName}
        </span>
        <span className="text-slate-700 hidden 2xl:inline shrink-0" aria-hidden="true">
          ·
        </span>
        <span className="text-xs font-mono text-sky-400 truncate hidden 2xl:inline">
          {activeDevice.manufacturer} {activeDevice.model} ({platformLabel} · {driver} · {(sampleRate / 1000).toFixed(1)}k) · {activePreset.name}
        </span>
      </div>

      {/* Zone 2: Real-Time Audio CPU Monitor, Tap Tempo, Hotkeys, Theme & Signal Source */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Real-Time Audio Engine DSP & Buffer Underrun Monitor (Fixed Width - Zero Jitter) */}
        <button
          type="button"
          onClick={onOpenDiagnostics}
          title={`Audio Engine DSP Load: ${audioCpuPct}% · Buffer ${bufferSize} samples @ ${(sampleRate / 1000).toFixed(1)} kHz (${quantumMs} ms quantum) · Underrun Risk: ${underrunRisk.toUpperCase()} · Host OS CPU: <2% (Click for Audio Diagnostics)`}
          className={`h-8 w-[184px] sm:w-[228px] px-2.5 rounded border font-mono text-[11px] flex items-center justify-between gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
            underrunRisk === 'critical'
              ? 'border-red-500/80 bg-red-950/60 text-red-200 shadow-[0_0_12px_rgba(239,68,68,0.35)]'
              : underrunRisk === 'elevated'
                ? 'border-amber-500/70 bg-amber-950/40 text-amber-200'
                : 'border-slate-700 bg-[#121824] text-slate-200 hover:border-slate-500'
          }`}
        >
          <span className="flex items-center gap-1.5">
            {underrunRisk === 'low' ? (
              <Cpu className={`w-3.5 h-3.5 shrink-0 ${engineRunning ? 'text-emerald-400' : 'text-slate-400'}`} />
            ) : (
              <AlertTriangle
                className={`w-3.5 h-3.5 shrink-0 ${
                  underrunRisk === 'critical' ? 'text-red-400' : 'text-amber-400'
                }`}
              />
            )}
            <span className="w-[7.2ch] text-left tabular-nums font-semibold">
              DSP {audioCpuPct}%
            </span>
          </span>

          {/* 8-segment miniature CPU load meter */}
          <span className="hidden sm:flex items-center gap-0.5 shrink-0" aria-hidden="true">
            {Array.from({ length: 8 }, (_, idx) => {
              const lit = engineRunning && idx < activeSegments;
              const segColor =
                idx >= 6
                  ? lit
                    ? 'bg-red-500'
                    : 'bg-red-950/40'
                  : idx >= 4
                    ? lit
                      ? 'bg-amber-400'
                      : 'bg-amber-950/40'
                    : lit
                      ? 'bg-emerald-400'
                      : 'bg-emerald-950/30';
              return <span key={idx} className={`w-1 h-3 rounded-[1px] ${segColor}`} />;
            })}
          </span>

          {/* Reserved fixed-width status slot so label transitions never resize the bar */}
          <span
            className={`w-[4.5ch] text-right text-[10px] font-bold tracking-tight shrink-0 ${
              underrunRisk === 'critical'
                ? 'text-red-300'
                : underrunRisk === 'elevated'
                  ? 'text-amber-300'
                  : engineRunning
                    ? 'text-emerald-400'
                    : 'text-slate-500'
            }`}
          >
            {underrunRisk === 'critical'
              ? 'XRUN'
              : underrunRisk === 'elevated'
                ? 'RISK'
                : engineRunning
                  ? 'LIVE'
                  : 'IDLE'}
          </span>
        </button>

        {/* Live Tap Tempo Trigger (Fixed Width) */}
        <button
          type="button"
          onClick={onTapTempo}
          title={`Tap Tempo (Quarter: ${tapTempo.quarterMs} ms · Dotted 1/8: ${tapTempo.dottedEighthMs} ms) — Click or press bound shortcut`}
          className={`h-8 w-[88px] px-2 rounded border font-mono text-[11px] flex items-center justify-between gap-1 whitespace-nowrap shrink-0 ${
            tapFlash
              ? 'border-sky-400 bg-sky-500/25 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.4)]'
              : 'border-slate-700 bg-[#121824] text-slate-200 hover:border-slate-500'
          }`}
        >
          <Activity className={`w-3.5 h-3.5 shrink-0 ${tapFlash ? 'text-sky-300' : 'text-sky-400'}`} />
          <span className="tabular-nums font-semibold text-right flex-1">{tapTempo.bpm} BPM</span>
        </button>

        {/* Global Keyboard Shortcuts Modal Trigger */}
        <button
          type="button"
          onClick={onOpenShortcuts}
          title="Configure Global Keyboard Shortcuts (Mute All, Tap Tempo, Save Snapshot, etc.)"
          className={`h-8 px-2 rounded border font-mono text-[11px] flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            shortcutsArmed
              ? 'border-slate-700 bg-[#121824] text-slate-200 hover:border-sky-500/50'
              : 'border-amber-500/50 bg-amber-950/30 text-amber-300'
          }`}
        >
          <Keyboard className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="hidden md:inline">KEYS</span>
        </button>

        <div className="flex items-center gap-1.5 h-8 px-2 rounded border border-slate-700 bg-[#121824] shrink-0">
          <Palette className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <select
            aria-label="Console Color Theme"
            value={consoleTheme}
            onChange={(e) => onThemeChange(e.target.value as ConsoleThemeId)}
            className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none cursor-pointer w-[178px]"
          >
            {THEME_OPTIONS.map((t) => (
              <option key={t.id} value={t.id} className="bg-[#0E131C] text-slate-100">
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <select
          aria-label="Audio Input Source"
          value={audioSource}
          onChange={(e) => onSourceChange(e.target.value as AudioSourceSimulation)}
          className="hidden lg:block h-8 px-2 text-xs font-mono rounded border border-slate-700 bg-[#121824] text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500 w-[236px] shrink-0"
        >
          <option value="live-mic">
            Hardware Input: {activeDevice.model} (Live)
          </option>
          <option value="desktop-audio">
            Desktop Audio: System / Browser Loopback
          </option>
          <option value="pink-noise">Calibration: Pink Noise (-20 dBFS)</option>
        </select>

        {outputDevices && outputDevices.length > 0 && onSelectOutputDevice && (
          <div className="hidden xl:flex items-center gap-1.5 h-8 px-2 rounded border border-slate-700 bg-[#121824] shrink-0">
            <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <select
              aria-label="Audio Output Destination"
              value={activeOutputDeviceId || ''}
              onChange={(e) => onSelectOutputDevice(e.target.value)}
              className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none cursor-pointer w-[190px] truncate"
            >
              <option value="" className="bg-[#0E131C] text-slate-100">
                Out: System Default
              </option>
              {outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId} className="bg-[#0E131C] text-slate-100">
                  Out: {d.label || `Speaker (${d.deviceId.slice(0, 6)})`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Zone 3: Engine Transport & High-Priority Live Safety Controls */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onToggleEngine}
          className={`h-8 w-[116px] px-2.5 rounded text-xs font-mono font-semibold flex items-center justify-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
            engineRunning
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
              : 'bg-sky-600 border-sky-400/50 text-white hover:bg-sky-500'
          }`}
        >
          {engineRunning ? <Square className="w-3.5 h-3.5 shrink-0" /> : <Play className="w-3.5 h-3.5 shrink-0" />}
          <span>{engineRunning ? 'STOP' : 'START ENGINE'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleMonitor}
          disabled={!engineRunning}
          title="Audition processed console output in local speakers/headphones"
          className={`h-8 px-2.5 rounded text-xs font-mono font-medium flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
            monitorAudible && !emergencyMuted
              ? 'bg-sky-500/20 border-sky-400/60 text-sky-300'
              : 'border-slate-700 bg-[#121824] text-slate-300 hover:bg-slate-800'
          }`}
        >
          {monitorAudible && !emergencyMuted ? (
            <Volume2 className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <VolumeX className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="hidden 2xl:inline">MONITOR</span>
        </button>

        {/* Total Signal Bypass Toggle (Fixed Width) */}
        <button
          type="button"
          role="switch"
          aria-checked={totalBypassed}
          onClick={onToggleTotalBypass}
          title="Bypass all software EQ, HPF, compression, and limiting immediately (passes dry signal)"
          className={`h-8 w-[160px] px-2.5 rounded text-xs font-mono font-semibold flex items-center justify-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
            totalBypassed
              ? 'bg-amber-500/25 border-amber-400 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.35)]'
              : 'border-amber-500/40 bg-[#121824] text-amber-300 hover:bg-amber-500/10'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5 shrink-0" />
          <span>{totalBypassed ? 'TOTAL BYPASS: ON' : 'TOTAL SIGNAL BYPASS'}</span>
        </button>

        {/* Dedicated Global Emergency Mute (Fixed Width) */}
        <button
          type="button"
          aria-pressed={emergencyMuted}
          onClick={onToggleEmergencyMute}
          title="Immediate global emergency mute for all live PA & monitor outputs"
          className={`h-8 w-[178px] px-3 rounded text-xs font-mono font-bold flex items-center justify-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
            emergencyMuted
              ? 'bg-red-600 border-red-300 text-white shadow-[0_0_16px_rgba(239,68,68,0.65)]'
              : 'border-red-500/60 bg-red-950/40 text-red-300 hover:bg-red-600/25'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span>{emergencyMuted ? 'EMERGENCY MUTE ACTIVE' : 'GLOBAL EMERGENCY MUTE'}</span>
        </button>
      </div>
    </header>
  );
};
