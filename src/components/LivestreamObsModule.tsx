import React, { useState } from 'react';
import { Radio, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import type {
  BroadcastDspConfig,
  HardwareDevice,
  ObsStatus,
  SignalTelemetry,
} from '../types/audio.ts';
import {
  ArcGauge,
  ConsolePushButton,
  RotaryKnob,
  SegmentedLedMeter,
} from './StudioControls.tsx';

interface LivestreamObsModuleProps {
  broadcastDsp: BroadcastDspConfig;
  onUpdateBroadcastDsp: (patch: Partial<BroadcastDspConfig>) => void;
  obsStatus: ObsStatus;
  onUpdateObs: (patch: Partial<ObsStatus>) => void;
  telemetry: SignalTelemetry;
  device: HardwareDevice;
}

export const LivestreamObsModule: React.FC<LivestreamObsModuleProps> = ({
  broadcastDsp,
  onUpdateBroadcastDsp,
  obsStatus,
  onUpdateObs,
  telemetry,
  device,
}) => {
  const [obsProbeError, setObsProbeError] = useState<string | null>(null);
  const [speechStemDb, setSpeechStemDb] = useState<number>(0);
  const [bandStemDb, setBandStemDb] = useState<number>(-2.5);
  const [roomAmbiencePct, setRoomAmbiencePct] = useState<number>(18);

  const roomLufs = telemetry.isRunning ? telemetry.estimatedLufs : -70;
  const broadcastLufs = telemetry.isRunning
    ? Math.max(-36, Math.min(-11.5, roomLufs + (broadcastDsp.enabled ? 3.2 : 0)))
    : -70;
  const lufsDelta = telemetry.isRunning
    ? Number((broadcastLufs - broadcastDsp.targetLufs).toFixed(1))
    : 0;

  const handleToggleObsConnection = () => {
    setObsProbeError(null);
    if (obsStatus.connected) {
      onUpdateObs({ connected: false, streaming: false, bitrateKbps: 0, cpuUsagePct: 0 });
      return;
    }
    try {
      const ws = new WebSocket(obsStatus.websocketUrl);
      const timeout = window.setTimeout(() => {
        ws.close();
        setObsProbeError(`No OBS WebSocket v5 server responded at ${obsStatus.websocketUrl}. Start OBS Studio with WebSocket Server enabled on port 4455.`);
      }, 2200);
      ws.onopen = () => {
        window.clearTimeout(timeout);
        onUpdateObs({ connected: true });
        ws.close();
      };
      ws.onerror = () => {
        window.clearTimeout(timeout);
        onUpdateObs({ connected: false, streaming: false });
        setObsProbeError(`Unable to reach OBS Studio at ${obsStatus.websocketUrl}. Verify OBS WebSocket v5 is running locally.`);
      };
    } catch {
      setObsProbeError(`Invalid OBS WebSocket URL: ${obsStatus.websocketUrl}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Studio Broadcast Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-2.5 h-8 rounded-xs ${
              obsStatus.streaming
                ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]'
                : 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]'
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-sky-400">08</span>
              <h1 className="font-display text-lg font-semibold text-white tracking-tight">
                LIVESTREAM BROADCAST &amp; OBS STUDIO CONSOLE
              </h1>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              {telemetry.isRunning
                ? `Dedicated Stream Bus (${broadcastDsp.targetLufs} LUFS · Δ ${lufsDelta > 0 ? `+${lufsDelta}` : lufsDelta}) · A/V Sync Offset · Loop Guard`
                : `Stream Bus Standby (Target ${broadcastDsp.targetLufs} LUFS) · A/V Sync Offset · Loop Guard`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ConsolePushButton
            label={obsStatus.connected ? 'OBS WS CONNECTED' : 'CONNECT OBS WS'}
            active={obsStatus.connected}
            tone="emerald"
            onClick={handleToggleObsConnection}
          />
          <ConsolePushButton
            label={obsStatus.streaming ? 'ON AIR · STOP STREAM' : 'GO LIVE (OBS)'}
            active={obsStatus.streaming}
            tone="red"
            disabled={!obsStatus.connected}
            onClick={() => onUpdateObs({ streaming: !obsStatus.streaming })}
          />
        </div>
      </div>

      {obsProbeError && (
        <div className="p-3 rounded-lg border border-amber-500/35 bg-amber-500/10 text-xs font-mono text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{obsProbeError}</span>
        </div>
      )}

      {!device.capabilities.perChannelCapture && (
        <div className="p-3 rounded-lg border border-amber-500/35 bg-amber-500/10 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold font-mono">STEREO BUS NOTE ({device.model}): </span>
            This mixer exposes a 2-channel USB stereo bus. Broadcast EQ/limiting processes the summed stereo bus; route AUX/GROUP outputs to a 4+ channel interface or digital mixer for separate stream stems.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Left Broadcast DSP Processor */}
        <div className="xl:col-span-6 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold text-white uppercase">
              Broadcast Mastering &amp; Sync Rack
            </span>
            <div className="flex items-center gap-1.5">
              <ConsolePushButton
                label={broadcastDsp.monoSum ? 'MONO SUM' : 'STEREO'}
                active={broadcastDsp.monoSum}
                tone="amber"
                onClick={() => onUpdateBroadcastDsp({ monoSum: !broadcastDsp.monoSum })}
              />
              <ConsolePushButton
                label={broadcastDsp.enabled ? 'DSP ACTIVE' : 'BYPASS'}
                active={broadcastDsp.enabled}
                tone="emerald"
                onClick={() => onUpdateBroadcastDsp({ enabled: !broadcastDsp.enabled })}
              />
            </div>
          </div>

          {/* Twin Room vs Stream Arc Gauges + LED Bars */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            <div className="sm:col-span-4">
              <ArcGauge
                label="Sanctuary PA"
                value={telemetry.isRunning ? Math.max(0, 40 + roomLufs) : 0}
                max={40}
                displayValue={telemetry.isRunning ? `${roomLufs.toFixed(1)}` : '--'}
                sublabel="LUFS Room"
                tone="sky"
              />
            </div>
            <div className="sm:col-span-4 flex items-center justify-around py-2 bg-[#070A10] border border-slate-800 rounded">
              <div className="flex flex-col items-center gap-1">
                <SegmentedLedMeter
                  levelDb={telemetry.isRunning ? telemetry.postRmsDb : -96}
                  peakDb={telemetry.isRunning ? telemetry.postPeakDb : -96}
                  height={98}
                  segments={14}
                />
                <span className="font-mono text-[9px] text-slate-400">ROOM</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <SegmentedLedMeter
                  levelDb={telemetry.isRunning ? Math.min(-1, telemetry.postRmsDb + 3.5) : -96}
                  peakDb={telemetry.isRunning ? broadcastDsp.limiterCeilingDb : -96}
                  muted={!broadcastDsp.enabled}
                  height={98}
                  segments={14}
                />
                <span className="font-mono text-[9px] text-emerald-400">STREAM</span>
              </div>
            </div>
            <div className="sm:col-span-4">
              <ArcGauge
                label="Broadcast Bus"
                value={telemetry.isRunning ? Math.max(0, 40 + broadcastLufs) : 0}
                max={40}
                displayValue={telemetry.isRunning ? `${broadcastLufs.toFixed(1)}` : '--'}
                sublabel={`Target ${broadcastDsp.targetLufs} LUFS`}
                tone="emerald"
              />
            </div>
          </div>

          {/* Broadcast Rotary Encoders */}
          <div className="grid grid-cols-5 gap-2 py-2.5 bg-[#070A10] border border-slate-800 rounded place-items-center">
            <RotaryKnob
              label="COMP THR"
              value={broadcastDsp.speechCompThresholdDb}
              min={-32}
              max={-8}
              step={1}
              defaultValue={-20}
              unit="dB"
              size={48}
              accent="sky"
              onChange={(next) => onUpdateBroadcastDsp({ speechCompThresholdDb: next })}
            />
            <RotaryKnob
              label="LOW-CUT"
              value={broadcastDsp.lowCutHz}
              min={40}
              max={160}
              step={5}
              defaultValue={90}
              unit="Hz"
              size={48}
              accent="amber"
              onChange={(next) => onUpdateBroadcastDsp({ lowCutHz: next })}
            />
            <RotaryKnob
              label="PRESENCE"
              value={broadcastDsp.presenceBoostDb}
              min={-3}
              max={6}
              step={0.5}
              defaultValue={1.5}
              unit="dB"
              size={48}
              accent="emerald"
              onChange={(next) => onUpdateBroadcastDsp({ presenceBoostDb: next })}
            />
            <RotaryKnob
              label="CEILING"
              value={broadcastDsp.limiterCeilingDb}
              min={-3}
              max={0}
              step={0.1}
              defaultValue={-1.0}
              unit="dB"
              size={48}
              accent="red"
              onChange={(next) => onUpdateBroadcastDsp({ limiterCeilingDb: next })}
            />
            <RotaryKnob
              label="A/V SYNC"
              value={broadcastDsp.avSyncOffsetMs}
              min={0}
              max={250}
              step={2}
              defaultValue={42}
              unit="ms"
              size={48}
              accent="sky"
              onChange={(next) => onUpdateBroadcastDsp({ avSyncOffsetMs: next })}
            />
          </div>

          {/* Broadcast Stem Balance & Loudness Drift */}
          <div className="p-3 rounded bg-[#070A10] border border-slate-800 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            <div className="sm:col-span-7 grid grid-cols-3 gap-2 place-items-center">
              <RotaryKnob
                label="SPEECH BUS"
                value={speechStemDb}
                min={-12}
                max={6}
                step={0.5}
                defaultValue={0}
                unit="dB"
                size={44}
                accent="emerald"
                onChange={setSpeechStemDb}
              />
              <RotaryKnob
                label="BAND MIX"
                value={bandStemDb}
                min={-18}
                max={3}
                step={0.5}
                defaultValue={-2.5}
                unit="dB"
                size={44}
                accent="sky"
                onChange={setBandStemDb}
              />
              <RotaryKnob
                label="ROOM MIC"
                value={roomAmbiencePct}
                min={0}
                max={60}
                step={2}
                defaultValue={18}
                unit="%"
                size={44}
                accent="amber"
                onChange={setRoomAmbiencePct}
              />
            </div>
            <div className="sm:col-span-5 font-mono text-[10px] space-y-1.5 border-t sm:border-t-0 sm:border-l border-slate-800 pt-2 sm:pt-0 sm:pl-3">
              <div className="flex justify-between text-slate-400">
                <span>LUFS TARGET DRIFT</span>
                <span className={Math.abs(lufsDelta) <= 1.5 ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                  {lufsDelta > 0 ? `+${lufsDelta}` : lufsDelta} LU
                </span>
              </div>
              <div className="h-2 rounded-xs bg-[#0D1119] border border-slate-800 relative overflow-hidden">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600" />
                <div
                  className={`absolute top-0.5 bottom-0.5 w-2 rounded-xs ${Math.abs(lufsDelta) <= 1.5 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  style={{ left: `${Math.max(6, Math.min(88, 50 + lufsDelta * 6))}%` }}
                />
              </div>
              <div className="text-[9px] text-slate-500">
                YouTube/Facebook Target: {broadcastDsp.targetLufs} LUFS
              </div>
            </div>
          </div>
        </div>

        {/* Right OBS Studio Scene Matrix & Telemetry */}
        <div className="xl:col-span-6 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold text-white uppercase flex items-center gap-2">
              <Radio className="w-4 h-4 text-sky-400" />
              <span>OBS Studio v5 WebSocket Switcher</span>
            </span>
            <span className="font-mono text-[11px] text-slate-400">{obsStatus.websocketUrl}</span>
          </div>

          <div className="space-y-2">
            <div className="font-mono text-[10px] text-slate-400 uppercase">Program Scene Pads</div>
            <div className="grid grid-cols-2 gap-2.5">
              {obsStatus.scenes.map((scene) => {
                const active = obsStatus.activeScene === scene;
                return (
                  <button
                    key={scene}
                    type="button"
                    onClick={() => onUpdateObs({ activeScene: scene })}
                    className={`px-3 py-2.5 rounded border font-mono text-xs text-left transition-all flex items-center justify-between ${
                      active
                        ? 'border-sky-400 bg-sky-500/20 text-white shadow-[0_0_12px_rgba(56,189,248,0.25)]'
                        : 'border-slate-800 bg-[#090D14] text-slate-400 hover:border-slate-600 hover:text-slate-200'
                    }`}
                  >
                    <span className="truncate">{scene}</span>
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        active ? 'bg-sky-400 shadow-[0_0_6px_#38BDF8]' : 'bg-slate-700'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Feedback Loop Guard */}
          <div className="p-3 rounded border border-slate-800 bg-[#090D14] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono font-semibold text-slate-200">
                OBS AUDIO MONITORING (FEEDBACK GUARD)
              </span>
              {obsStatus.audioMonitorMode === 'Monitor Off' ? (
                <span className="flex items-center gap-1 text-emerald-400 font-mono text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>LOOP SAFE</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-400 font-mono text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>LOOP RISK</span>
                </span>
              )}
            </div>
            <select
              value={obsStatus.audioMonitorMode}
              onChange={(e) =>
                onUpdateObs({
                  audioMonitorMode: e.target.value as ObsStatus['audioMonitorMode'],
                })
              }
              className="w-full px-2.5 py-1.5 rounded border border-slate-700 bg-[#121824] text-slate-200 text-xs font-mono"
            >
              <option value="Monitor Off">Monitor Off (Recommended — prevents PA feedback loop)</option>
              <option value="Monitor Only">Monitor Only (Mute Output)</option>
              <option value="Monitor and Output">Monitor and Output (Caution)</option>
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3 p-2.5 rounded bg-[#070A10] border border-slate-800 font-mono text-xs items-center">
            <div>
              <div className="text-[10px] text-slate-500">BITRATE</div>
              <div className="text-slate-100 tabular-nums">
                {obsStatus.streaming ? `${obsStatus.bitrateKbps} kbps` : 'IDLE'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">DROPPED</div>
              <div className="text-emerald-400 tabular-nums">{obsStatus.droppedFrames} frames</div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onUpdateObs({ syncWarning: false })}
                className="px-2.5 py-1.5 rounded border border-slate-700 bg-[#121824] text-[11px] text-slate-200 hover:border-sky-500/50 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3 text-sky-400" />
                <span>SYNC CHECK</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
