import React, { useEffect, useState } from 'react';
import { Lock, Unlock, VolumeX, RotateCcw, Info, AlertTriangle } from 'lucide-react';

interface ConsoleBottomBarProps {
  engineRunning: boolean;
  dspBypassed: boolean;
  onToggleTotalBypass: () => void;
  hasWarning: boolean;
  consoleLocked: boolean;
  onToggleLock: () => void;
  emergencyMuted: boolean;
  onToggleEmergencyMute: () => void;
  onResetAll: () => void;
  onOpenSystemInfo: () => void;
  isLimiting: boolean;
  hasSignal: boolean;
}

export const ConsoleBottomBar: React.FC<ConsoleBottomBarProps> = ({
  engineRunning,
  dspBypassed,
  onToggleTotalBypass,
  hasWarning,
  consoleLocked,
  onToggleLock,
  emergencyMuted,
  onToggleEmergencyMute,
  onResetAll,
  onOpenSystemInfo,
  isLimiting,
  hasSignal,
}) => {
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmReset]);

  const handleResetClick = () => {
    if (consoleLocked) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    onResetAll();
  };

  const activeOk = engineRunning && !dspBypassed && !emergencyMuted;
  const signalOk = engineRunning && hasSignal && !isLimiting && !emergencyMuted;
  const noSignal = !engineRunning || !hasSignal || emergencyMuted;

  return (
    <footer
      aria-label="Console Status & Hardware Safety Footer"
      className="h-11 shrink-0 bg-gradient-to-b from-[#1E2630] to-[#11161D] border-t border-[#46576B] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] px-3 flex items-center justify-between gap-3 select-none z-20"
    >
      {/* Left: SYSTEM STATUS Indicators */}
      <div className="flex flex-col justify-center gap-0.5 min-w-0">
        <span className="font-mono text-[8.5px] font-bold tracking-[0.12em] text-slate-400 uppercase leading-none">
          SYSTEM STATUS
        </span>
        <div className="flex items-center gap-2 font-mono text-[9.5px] font-bold">
          <span
            className={`flex items-center gap-1 ${
              activeOk ? 'text-[#4ADE80]' : 'text-slate-500'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                activeOk ? 'bg-[#4ADE80] shadow-[0_0_6px_rgba(74,222,128,0.85)]' : 'bg-slate-600'
              }`}
            />
            ACTIVE
          </span>

          <button
            type="button"
            disabled={consoleLocked}
            onClick={onToggleTotalBypass}
            title="Toggle Global DSP Bypass"
            className={`flex items-center gap-1 cursor-pointer disabled:opacity-60 ${
              dspBypassed ? 'text-[#22D3EE]' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                dspBypassed ? 'bg-[#22D3EE] shadow-[0_0_6px_rgba(34,211,238,0.85)]' : 'bg-slate-600'
              }`}
            />
            BYPASSED
          </button>

          <span
            className={`flex items-center gap-1 ${
              hasWarning ? 'text-amber-400' : 'text-slate-500'
            }`}
          >
            <AlertTriangle className="w-2.5 h-2.5" />
            WARNING
          </span>

          <span
            className={`hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0E1319] border ${
              consoleLocked
                ? 'border-amber-500/60 text-amber-300'
                : 'border-[#25303D] text-slate-500'
            }`}
          >
            {consoleLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
            {consoleLocked ? 'LOCKED' : 'UNLOCKED'}
          </span>
        </div>
      </div>

      {/* Center: 4 Chamfered 3D Brushed-Metal Console Buttons */}
      <div className="flex items-center gap-2 shrink-0 font-mono text-[10px] font-bold">
        <button
          type="button"
          onClick={onToggleLock}
          className={`h-8 px-4 rounded flex items-center gap-1.5 tracking-wider uppercase cursor-pointer ${
            consoleLocked
              ? 'bg-[#281E12] border border-amber-400 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
              : 'hw-bevel-btn'
          }`}
        >
          {consoleLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          <span>{consoleLocked ? 'UNLOCK' : 'LOCK'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleEmergencyMute}
          className={`h-8 px-4 rounded flex items-center gap-1.5 tracking-wider uppercase cursor-pointer ${
            emergencyMuted
              ? 'bg-red-600 border border-red-300 text-white shadow-[0_0_14px_rgba(239,68,68,0.65)]'
              : 'hw-bevel-btn'
          }`}
        >
          <VolumeX className="w-3 h-3" />
          <span>{emergencyMuted ? 'UNMUTE ALL' : 'MUTE ALL'}</span>
        </button>

        <button
          type="button"
          disabled={consoleLocked}
          onClick={handleResetClick}
          title={consoleLocked ? 'Unlock console before resetting parameters' : '2-click safe reset of DSP & solos'}
          className={`h-8 px-4 rounded flex items-center gap-1.5 tracking-wider uppercase cursor-pointer disabled:opacity-45 ${
            confirmReset
              ? 'bg-amber-500 border border-amber-200 text-slate-950 shadow-[0_0_12px_rgba(245,158,11,0.5)]'
              : 'hw-bevel-btn'
          }`}
        >
          <RotateCcw className="w-3 h-3" />
          <span>{confirmReset ? 'CONFIRM RESET?' : 'RESET ALL'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenSystemInfo}
          className="h-8 px-4 rounded hw-bevel-btn flex items-center gap-1.5 tracking-wider uppercase cursor-pointer"
        >
          <Info className="w-3 h-3" />
          <span>SYSTEM INFO</span>
        </button>
      </div>

      {/* Right: SIGNAL STATUS Indicators */}
      <div className="hidden md:flex flex-col items-end justify-center gap-0.5 min-w-0">
        <span className="font-mono text-[8.5px] font-bold tracking-[0.12em] text-slate-400 uppercase leading-none">
          SIGNAL STATUS
        </span>
        <div className="flex items-center gap-2 font-mono text-[9.5px] font-bold">
          <span
            className={`flex items-center gap-1 ${
              signalOk ? 'text-[#4ADE80]' : 'text-slate-500'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                signalOk ? 'bg-[#4ADE80] shadow-[0_0_6px_rgba(74,222,128,0.85)]' : 'bg-slate-600'
              }`}
            />
            SIGNAL OK
          </span>

          <span
            className={`flex items-center gap-1 ${
              isLimiting ? 'text-amber-400' : 'text-slate-500'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isLimiting ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.85)]' : 'bg-slate-600'
              }`}
            />
            LIMIT
          </span>

          <span
            className={`flex items-center gap-1 ${
              noSignal ? 'text-cyan-300' : 'text-slate-500'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                noSignal ? 'bg-cyan-400/70' : 'bg-slate-600'
              }`}
            />
            NO SIGNAL
          </span>
        </div>
      </div>
    </footer>
  );
};
