import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Lock,
  Radio,
  RotateCcw,
  ShieldAlert,
  Sliders,
  VolumeX,
  Wifi,
  WifiOff,
  CheckCircle2,
} from 'lucide-react';
import type {
  DcaGroupName,
  HardwareDevice,
  InputChannel,
  RemoteAccessConfig,
  SignalTelemetry,
} from '../types/audio.ts';
import { HARDWARE_CATALOG } from '../data/hardwareCatalog.ts';

interface RemoteCompanionViewProps {
  token: string;
  onExitRemote?: () => void;
}

type DcaFilter = 'All' | DcaGroupName;

export const RemoteCompanionView: React.FC<RemoteCompanionViewProps> = ({
  token,
  onExitRemote,
}) => {
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>(
    'connecting'
  );
  const [authError, setAuthError] = useState<string | null>(null);
  const [pinRequired, setPinRequired] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [channels, setChannels] = useState<InputChannel[]>([]);
  const [activeDevice, setActiveDevice] = useState<HardwareDevice>(HARDWARE_CATALOG[0]);
  const [venueLabel, setVenueLabel] = useState('FOH Companion');
  const [inputTrimDb, setInputTrimDb] = useState(0);
  const [emergencyMuted, setEmergencyMuted] = useState(false);
  const [permissions, setPermissions] = useState<
    Pick<
      RemoteAccessConfig,
      'allowGainAdjustment' | 'allowMuteControl' | 'allowMasterTrim'
    >
  >({
    allowGainAdjustment: true,
    allowMuteControl: true,
    allowMasterTrim: true,
  });
  const [liveTelemetry, setLiveTelemetry] = useState<SignalTelemetry | null>(null);
  const [dcaFilter, setDcaFilter] = useState<DcaFilter>('All');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let closedByUser = false;

    const connect = () => {
      setWsStatus('connecting');
      setAuthError(null);
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const deviceLabel = encodeURIComponent(
        /iPhone|iPad|Android/i.test(navigator.userAgent)
          ? navigator.platform || 'Mobile FOH'
          : 'Remote Companion Browser'
      );
      const url = `${proto}//${window.location.host}/ws?role=mobile&token=${encodeURIComponent(
        token
      )}&device=${deviceLabel}`;

      const socket = new WebSocket(url);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsStatus('connected');
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.type === 'auth:pin-required') {
            setPinRequired(true);
            return;
          }
          if (msg.type === 'auth:ok') {
            setPinRequired(false);
            setAuthError(null);
            return;
          }
          if (msg.type === 'auth:error') {
            setAuthError(msg.error || 'Pairing rejected.');
            return;
          }
          if (msg.type === 'state:full' && msg.state) {
            const st = msg.state;
            setPinRequired(false);
            if (Array.isArray(st.channels)) setChannels(st.channels);
            if (st.venue) {
              setVenueLabel(`${st.venue.venueName ?? 'FOH'} · ${st.venue.roomName ?? 'Sanctuary'}`);
              const dev =
                HARDWARE_CATALOG.find((d) => d.id === st.venue.activeDeviceId) ??
                HARDWARE_CATALOG[0];
              setActiveDevice(dev);
            }
            if (st.dsp && typeof st.dsp.inputTrimDb === 'number') {
              setInputTrimDb(st.dsp.inputTrimDb);
            }
            if (typeof st.emergencyMuted === 'boolean') {
              setEmergencyMuted(st.emergencyMuted);
            }
            if (st.remoteAccess) {
              setPermissions({
                allowGainAdjustment: Boolean(st.remoteAccess.allowGainAdjustment),
                allowMuteControl: Boolean(st.remoteAccess.allowMuteControl),
                allowMasterTrim: Boolean(st.remoteAccess.allowMasterTrim),
              });
            }
            return;
          }
          if (msg.type === 'state:sync') {
            if (Array.isArray(msg.channels)) setChannels(msg.channels);
            if (msg.dsp && typeof msg.dsp.inputTrimDb === 'number') {
              setInputTrimDb(msg.dsp.inputTrimDb);
            }
            if (typeof msg.emergencyMuted === 'boolean') {
              setEmergencyMuted(msg.emergencyMuted);
            }
            return;
          }
          if (msg.type === 'channel:patch' && msg.channelId && msg.patch) {
            setChannels((prev) =>
              prev.map((ch) => (ch.id === msg.channelId ? { ...ch, ...msg.patch } : ch))
            );
            return;
          }
          if (msg.type === 'master:patch') {
            if (typeof msg.inputTrimDb === 'number') setInputTrimDb(msg.inputTrimDb);
            if (typeof msg.emergencyMuted === 'boolean') setEmergencyMuted(msg.emergencyMuted);
            return;
          }
          if (msg.type === 'remote:config' && msg.remoteAccess) {
            setPermissions({
              allowGainAdjustment: Boolean(msg.remoteAccess.allowGainAdjustment),
              allowMuteControl: Boolean(msg.remoteAccess.allowMuteControl),
              allowMasterTrim: Boolean(msg.remoteAccess.allowMasterTrim),
            });
            return;
          }
          if (msg.type === 'telemetry:frame' && msg.telemetry) {
            setLiveTelemetry(msg.telemetry);
          }
        } catch {
          // ignore malformed packet
        }
      };

      socket.onclose = (ev) => {
        wsRef.current = null;
        if (ev.code === 4001 || ev.code === 4002 || ev.code === 4003) {
          setWsStatus('error');
          setAuthError(ev.reason || 'Remote session closed by FOH console.');
          return;
        }
        setWsStatus('disconnected');
        if (!closedByUser) {
          reconnectTimerRef.current = window.setTimeout(connect, 2000);
        }
      };

      socket.onerror = () => {
        setWsStatus('error');
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [token]);

  const sendChannelPatch = (channelId: string, patch: Partial<InputChannel>) => {
    setChannels((prev) => prev.map((ch) => (ch.id === channelId ? { ...ch, ...patch } : ch)));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'channel:patch', channelId, patch }));
    }
  };

  const sendMasterPatch = (patch: { inputTrimDb?: number; emergencyMuted?: boolean }) => {
    if (typeof patch.inputTrimDb === 'number') setInputTrimDb(patch.inputTrimDb);
    if (typeof patch.emergencyMuted === 'boolean') setEmergencyMuted(patch.emergencyMuted);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'master:patch', ...patch }));
    }
  };

  const handleSubmitPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'auth:verify-pin', pin: pinInput.trim() }));
    }
  };

  const filteredChannels = useMemo(
    () =>
      dcaFilter === 'All'
        ? channels
        : channels.filter((ch) => ch.dcaGroup === dcaFilter),
    [channels, dcaFilter]
  );

  if (pinRequired) {
    return (
      <div className="min-h-screen bg-[#080B10] text-slate-100 flex items-center justify-center p-4">
        <form
          onSubmit={handleSubmitPin}
          className="w-full max-w-sm rounded-xl border border-slate-800 bg-[#0E1524] p-6 space-y-4"
        >
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-sky-400" />
            <h1 className="font-display text-lg font-semibold text-white">
              FOH Companion PIN Required
            </h1>
          </div>
          <p className="text-xs text-slate-400">
            Enter the 4-digit security PIN displayed in Hardware &amp; Diagnostics → Remote Access.
          </p>
          <input
            type="password"
            inputMode="numeric"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder="Enter PIN..."
            className="w-full h-11 px-3 rounded-lg border border-slate-700 bg-[#070A10] font-mono text-center text-lg tracking-widest text-white focus:outline-none focus:border-sky-400"
          />
          {authError && <div className="text-xs text-red-400 font-mono">{authError}</div>}
          <button
            type="submit"
            className="w-full h-11 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-mono text-xs font-semibold uppercase"
          >
            Unlock Remote Console
          </button>
          {onExitRemote && (
            <button
              type="button"
              onClick={onExitRemote}
              className="w-full h-10 rounded-lg border border-slate-700 text-slate-300 font-mono text-xs"
            >
              Return to Desktop Console
            </button>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080B10] text-slate-100 flex flex-col">
      {/* Sticky Compact Mobile FOH Header */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-[#0B101B]/95 backdrop-blur-sm px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="font-display text-sm font-semibold text-white truncate">
              FOH Remote Companion
            </span>
          </div>
          <div className="font-mono text-[11px] text-slate-400 truncate">
            {venueLabel} · {activeDevice.manufacturer} {activeDevice.model}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`px-2 py-1 rounded border font-mono text-[10px] font-semibold flex items-center gap-1 ${
              wsStatus === 'connected'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/40 bg-red-500/10 text-red-300'
            }`}
          >
            {wsStatus === 'connected' ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            <span>{wsStatus.toUpperCase()}</span>
          </span>
          {onExitRemote && (
            <button
              type="button"
              onClick={onExitRemote}
              className="h-9 px-2.5 rounded border border-slate-700 bg-[#121824] font-mono text-[11px] text-slate-200 whitespace-nowrap"
            >
              Desktop UI
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 p-3 sm:p-4 max-w-4xl w-full mx-auto space-y-3">
        {authError && (
          <div className="p-3 rounded-lg border border-red-500/40 bg-red-950/40 text-xs font-mono text-red-200">
            {authError}
          </div>
        )}

        {/* Hardware Capability & Live Bus Telemetry Strip */}
        <div className="rounded-lg border border-slate-800 bg-[#0E1524] p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="font-mono text-[11px] text-slate-400">
              {activeDevice.capabilities.perChannelFaderControl
                ? 'Hardware-Linked Fader & Preamp Sync Active'
                : 'Software DSP Return Sync (Physical mixer faders remain manual)'}
            </div>
            <div className="font-mono text-xs text-slate-200 tabular-nums flex items-center gap-3">
              <span>
                ENGINE:{' '}
                <strong className={liveTelemetry?.isRunning ? 'text-emerald-400' : 'text-slate-400'}>
                  {liveTelemetry?.isRunning ? 'LIVE' : 'STANDBY'}
                </strong>
              </span>
              <span>
                POST RMS:{' '}
                <strong className="text-sky-300">
                  {liveTelemetry?.isRunning ? `${liveTelemetry.postRmsDb.toFixed(1)} dBFS` : '--'}
                </strong>
              </span>
              <span>
                LUFS:{' '}
                <strong className="text-slate-100">
                  {liveTelemetry?.isRunning ? `${liveTelemetry.estimatedLufs.toFixed(1)}` : '--'}
                </strong>
              </span>
            </div>
          </div>

          {permissions.allowMasterTrim && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-slate-800 bg-[#070A10]">
                <span className="font-mono text-[10px] text-slate-400">MASTER TRIM</span>
                <button
                  type="button"
                  onClick={() => sendMasterPatch({ inputTrimDb: Math.max(-18, Number((inputTrimDb - 0.5).toFixed(1))) })}
                  className="w-8 h-8 rounded bg-[#162138] text-slate-100 font-mono text-sm"
                >
                  -
                </button>
                <span className="font-mono text-xs font-bold text-sky-300 w-14 text-center tabular-nums">
                  {inputTrimDb > 0 ? `+${inputTrimDb.toFixed(1)}` : inputTrimDb.toFixed(1)} dB
                </span>
                <button
                  type="button"
                  onClick={() => sendMasterPatch({ inputTrimDb: Math.min(12, Number((inputTrimDb + 0.5).toFixed(1))) })}
                  className="w-8 h-8 rounded bg-[#162138] text-slate-100 font-mono text-sm"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                onClick={() => sendMasterPatch({ emergencyMuted: !emergencyMuted })}
                className={`h-11 px-3 rounded font-mono text-xs font-bold flex items-center gap-1.5 border ${
                  emergencyMuted
                    ? 'bg-red-600 border-red-300 text-white'
                    : 'border-red-500/50 bg-red-950/40 text-red-300'
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
                <span>{emergencyMuted ? 'UNMUTE PA' : 'MUTE PA'}</span>
              </button>
            </div>
          )}
        </div>

        {/* DCA Filter Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {(
            [
              'All',
              'DCA 4 · Speech',
              'DCA 1 · Vox',
              'DCA 2 · Band',
              'DCA 3 · Choir',
            ] as DcaFilter[]
          ).map((grp) => (
            <button
              key={grp}
              type="button"
              onClick={() => setDcaFilter(grp)}
              className={`h-10 px-3 rounded-lg font-mono text-xs font-semibold whitespace-nowrap shrink-0 border ${
                dcaFilter === grp
                  ? 'border-sky-400 bg-sky-500/20 text-white'
                  : 'border-slate-800 bg-[#0E1524] text-slate-400'
              }`}
            >
              {grp === 'All' ? `All Channels (${channels.length})` : grp}
            </button>
          ))}
        </div>

        {/* Touch-Optimized Channel Fader & Preamp Gain Cards */}
        {filteredChannels.length === 0 ? (
          <div className="p-8 rounded-lg border border-slate-800 bg-[#0E1524] text-center font-mono text-xs text-slate-400">
            Waiting for channel sync from FOH host...
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredChannels.map((ch) => (
              <div
                key={ch.id}
                className={`rounded-lg border p-3.5 space-y-3 ${
                  ch.mute
                    ? 'border-red-500/40 bg-[#140E13]'
                    : ch.solo
                      ? 'border-amber-400/50 bg-[#15130D]'
                      : 'border-slate-800 bg-[#0E1524]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-sky-400 tabular-nums">
                        CH {String(ch.index).padStart(2, '0')}
                      </span>
                      <span className="text-sm font-semibold text-white truncate">
                        {ch.name}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-400">
                      {ch.role} · {ch.dcaGroup} · {ch.phantom48v ? '+48V' : 'No Phantom'}
                    </div>
                  </div>

                  {permissions.allowMuteControl && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => sendChannelPatch(ch.id, { solo: !ch.solo })}
                        className={`h-11 min-w-[54px] px-3 rounded-lg font-mono text-xs font-bold border ${
                          ch.solo
                            ? 'bg-amber-500 border-amber-300 text-slate-950'
                            : 'border-slate-700 bg-[#070A10] text-slate-300'
                        }`}
                      >
                        SOLO
                      </button>
                      <button
                        type="button"
                        onClick={() => sendChannelPatch(ch.id, { mute: !ch.mute })}
                        className={`h-11 min-w-[64px] px-3 rounded-lg font-mono text-xs font-bold border flex items-center justify-center gap-1 ${
                          ch.mute
                            ? 'bg-red-600 border-red-300 text-white'
                            : 'border-slate-700 bg-[#070A10] text-slate-300'
                        }`}
                      >
                        {ch.mute ? <VolumeX className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}
                        <span>{ch.mute ? 'MUTED' : 'ON'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Fader Level Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="text-slate-400">FADER LEVEL</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white tabular-nums">
                        {ch.faderDb > 0 ? `+${ch.faderDb.toFixed(1)}` : ch.faderDb.toFixed(1)} dB
                      </span>
                      <button
                        type="button"
                        onClick={() => sendChannelPatch(ch.id, { faderDb: 0 })}
                        className="px-2 py-1 rounded border border-slate-700 bg-[#070A10] text-[10px] text-sky-300 flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>0 dB</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        sendChannelPatch(ch.id, {
                          faderDb: Math.max(-48, Number((ch.faderDb - 1).toFixed(1))),
                        })
                      }
                      className="w-11 h-11 rounded-lg border border-slate-700 bg-[#070A10] font-mono text-base text-slate-200 shrink-0"
                    >
                      -
                    </button>
                    <input
                      type="range"
                      min={-48}
                      max={10}
                      step={0.5}
                      value={ch.faderDb}
                      onChange={(e) =>
                        sendChannelPatch(ch.id, { faderDb: Number(e.target.value) })
                      }
                      className="studio-slider flex-1 h-11"
                      aria-label={`${ch.name} Fader Level`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        sendChannelPatch(ch.id, {
                          faderDb: Math.min(10, Number((ch.faderDb + 1).toFixed(1))),
                        })
                      }
                      className="w-11 h-11 rounded-lg border border-slate-700 bg-[#070A10] font-mono text-base text-slate-200 shrink-0"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Preamp Gain Control */}
                {permissions.allowGainAdjustment && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-slate-400">PREAMP GAIN</span>
                      <span className="font-bold text-amber-300 tabular-nums">
                        +{ch.gainDb} dB
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          sendChannelPatch(ch.id, { gainDb: Math.max(0, ch.gainDb - 1) })
                        }
                        className="w-11 h-11 rounded-lg border border-slate-700 bg-[#070A10] font-mono text-base text-slate-200 shrink-0"
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={60}
                        step={1}
                        value={ch.gainDb}
                        onChange={(e) =>
                          sendChannelPatch(ch.id, { gainDb: Number(e.target.value) })
                        }
                        className="studio-slider flex-1 h-11"
                        aria-label={`${ch.name} Preamp Gain`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          sendChannelPatch(ch.id, { gainDb: Math.min(60, ch.gainDb + 1) })
                        }
                        className="w-11 h-11 rounded-lg border border-slate-700 bg-[#070A10] font-mono text-base text-slate-200 shrink-0"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="py-3 text-center font-mono text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Synced via WebSocket over local port 3000</span>
        </div>
      </main>
    </div>
  );
};
