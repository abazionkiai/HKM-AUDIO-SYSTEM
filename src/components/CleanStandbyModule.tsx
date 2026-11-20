import React from 'react';
import { ShieldCheck, Activity, Zap, VolumeX, Radio, CheckCircle2 } from 'lucide-react';
import type { DspConfig, CleanStandbyConfig, SignalTelemetry } from '../types/audio.ts';
import { ConsolePushButton, RotaryKnob } from './StudioControls.tsx';

interface CleanStandbyModuleProps {
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  telemetry?: SignalTelemetry;
  panelLocked?: boolean;
}

export const CleanStandbyModule: React.FC<CleanStandbyModuleProps> = ({
  dsp,
  onUpdateDsp,
  telemetry,
  panelLocked = false,
}) => {
  const standby: CleanStandbyConfig = dsp.cleanStandby ?? {
    dcBlockerEnabled: true,
    dcBlockerHz: 18,
    mainsHumNotch: '60hz',
    adaptiveStandbyGate: true,
    standbyGateEnabled: true,
    standbyGateThresholdDb: -56,
    standbyGateHoldMs: 1000,
  };

  const updateStandby = (patch: Partial<CleanStandbyConfig>) => {
    if (panelLocked) return;
    onUpdateDsp({
      cleanStandby: {
        ...standby,
        ...patch,
      },
    });
  };

  const humDetected = Boolean(telemetry?.humRisk?.detected);
  const humFreq = telemetry?.humRisk?.fundamentalHz;

  return (
    <div className="space-y-4 rounded-lg border border-slate-800 bg-[#0B0F17] p-4 text-slate-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-emerald-400">CLEAN ENGINE</span>
              <h2 className="font-display text-base font-semibold text-white tracking-tight">
                Zero-Hum Standby &amp; Ultra-Clean Output Conditioning
              </h2>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              Adaptive Standby Gate · 18 Hz DC Offset Blocker · 50/60 Hz Mains Hum &amp; Harmonics Notch Filters
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-950/20 text-emerald-300 font-mono text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>STANDBY HUM PROTECTION ARMED</span>
          </div>
        </div>
      </div>

      {/* 3 Core Conditioning Blocks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Block 1: Adaptive Standby Gate */}
        <div className="rounded-lg border border-slate-800 bg-[#0E131C] p-3 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-bold text-emerald-300 uppercase flex items-center gap-1.5">
              <VolumeX className="w-3.5 h-3.5 text-emerald-400" />
              1. Adaptive Standby Gate
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              {standby.adaptiveStandbyGate || standby.standbyGateEnabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            Eliminates quiescent amplifier hiss and cable idle hum when audio stops. After silence persists for {standby.standbyGateHoldMs ?? 1000} ms, output drops smoothly to complete silence (-96 dB) and snaps active in 5 ms when speech or music begins.
          </p>

          <div className="flex items-center justify-around py-2">
            <RotaryKnob
              label="Threshold"
              value={standby.standbyGateThresholdDb}
              min={-72}
              max={-36}
              step={1}
              defaultValue={-56}
              unit="dB"
              size={48}
              accent="emerald"
              onChange={(v) => updateStandby({ standbyGateThresholdDb: v })}
            />
            <RotaryKnob
              label="Hold Time"
              value={standby.standbyGateHoldMs ?? 1000}
              min={200}
              max={3000}
              step={100}
              defaultValue={1000}
              unit="ms"
              size={48}
              accent="sky"
              onChange={(v) => updateStandby({ standbyGateHoldMs: v })}
            />
          </div>

          <ConsolePushButton
            label={standby.adaptiveStandbyGate || standby.standbyGateEnabled ? 'STANDBY GATE: ACTIVE' : 'STANDBY GATE: OFF'}
            active={Boolean(standby.adaptiveStandbyGate || standby.standbyGateEnabled)}
            tone="emerald"
            onClick={() => {
              const next = !(standby.adaptiveStandbyGate || standby.standbyGateEnabled);
              updateStandby({ adaptiveStandbyGate: next, standbyGateEnabled: next });
            }}
          />
        </div>

        {/* Block 2: Sub-Sonic DC Blocker */}
        <div className="rounded-lg border border-slate-800 bg-[#0E131C] p-3 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-bold text-sky-300 uppercase flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-sky-400" />
              2. Sub-Sonic DC Blocker
            </span>
            <span className="font-mono text-[10px] text-slate-400">18 Hz (24 dB/Oct)</span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            Stops inaudible sub-audible DC drift, stage floor thuds, and HVAC vibrations below 18 Hz from wasting amplifier wattage or heating speaker voice coils, preserving full headroom for clean bass.
          </p>

          <div className="rounded bg-[#070A10] border border-slate-800 p-3 text-center space-y-1">
            <div className="font-mono text-xs text-slate-400">High-Pass Filter Cutoff</div>
            <div className="font-mono text-xl font-bold text-sky-400">18.0 Hz</div>
            <div className="text-[10px] font-mono text-emerald-400">Zero In-Band Phase Distortion</div>
          </div>

          <ConsolePushButton
            label={standby.dcBlockerEnabled !== false ? 'DC BLOCKER: ACTIVE' : 'DC BLOCKER: OFF'}
            active={standby.dcBlockerEnabled !== false}
            tone="sky"
            onClick={() => updateStandby({ dcBlockerEnabled: !standby.dcBlockerEnabled })}
          />
        </div>

        {/* Block 3: Mains Hum Notch Elimination */}
        <div className="rounded-lg border border-slate-800 bg-[#0E131C] p-3 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-bold text-amber-300 uppercase flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-amber-400" />
              3. Mains Hum Notch Trap
            </span>
            <span className={`font-mono text-[10px] ${humDetected ? 'text-red-400 font-bold' : 'text-slate-400'}`}>
              {humDetected ? `HUM DETECTED @ ${humFreq} Hz` : 'SPECTRUM CLEAN'}
            </span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            Surgical high-Q (Q=14) notch filters target 50 Hz or 60 Hz electrical mains hum plus the 2nd and 3rd ground loop harmonics (100/120 Hz and 150/180 Hz) without affecting musical bass response.
          </p>

          <div className="grid grid-cols-3 gap-1 p-1 rounded border border-slate-800 bg-[#070A10]">
            {(['60hz', '50hz', 'off'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={panelLocked}
                onClick={() => updateStandby({ mainsHumNotch: mode })}
                className={`py-1.5 text-xs font-mono font-semibold rounded transition-colors ${
                  standby.mainsHumNotch === mode
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode === '60hz' ? '60 Hz (USA)' : mode === '50hz' ? '50 Hz (EU/UK)' : 'OFF'}
              </button>
            ))}
          </div>

          <div className="text-[11px] font-mono text-slate-400 text-center">
            Harmonics Trapped: {standby.mainsHumNotch === '60hz' ? '60, 120, 180 Hz' : standby.mainsHumNotch === '50hz' ? '50, 100, 150 Hz' : 'None'}
          </div>
        </div>
      </div>
    </div>
  );
};
