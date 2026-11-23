import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Cpu,
  Puzzle,
  Layers,
  ShieldAlert,
  CheckCircle2,
  Plus,
  Trash2,
  Smartphone,
  QrCode,
  Copy,
  Check,
  RefreshCw,
  Lock,
  ExternalLink,
  Wifi,
  UserX,
  Usb,
  Radar,
} from 'lucide-react';
import type {
  AudioSourceSimulation,
  AuditEvent,
  DetectedHardwareEndpoint,
  DriverBackend,
  HardwareDevice,
  NetworkInterfaceInfo,
  PlatformTarget,
  RemoteAccessConfig,
  RemoteClientSession,
  SignalTelemetry,
} from '../types/audio.ts';
import type { LoadedPluginRecord } from '../plugins/pluginManager.ts';
import {
  PLUGIN_SDK_CONTRACT_SNIPPET,
  SAMPLE_CUSTOM_DSP_PLUGIN,
  SAMPLE_CUSTOM_HARDWARE_PLUGIN,
} from '../plugins/pluginManager.ts';
import { calculateRoundTripLatencyMs } from '../utils/camillaDsp.ts';
import type {
  ApoSystemStatus,
  DesktopAudioSession,
  DesktopAudioStatus,
} from '../utils/nativeDesktopAudio.ts';
import { ArcGauge, ConsolePushButton } from './StudioControls.tsx';

interface HardwareDiagnosticsModuleProps {
  devices: HardwareDevice[];
  desktopBuild?: boolean;
  activeDevice: HardwareDevice;
  onSelectDevice: (device: HardwareDevice) => void;
  platform: PlatformTarget;
  onSelectPlatform: (p: PlatformTarget) => void;
  driver: DriverBackend;
  onSelectDriver: (d: DriverBackend) => void;
  sampleRate: number;
  onSelectSampleRate: (sr: number) => void;
  bufferSize: number;
  onSelectBufferSize: (bs: number) => void;
  plugins: LoadedPluginRecord[];
  onTogglePlugin: (id: string) => void;
  onLoadCustomPlugin: (jsonText: string) => { ok: boolean; error?: string };
  onUnloadPlugin: (id: string) => void;
  telemetry: SignalTelemetry;
  audioCpuPct: number;
  auditEvents: AuditEvent[];
  remoteAccess: RemoteAccessConfig;
  remoteClients: RemoteClientSession[];
  lanInterfaces: NetworkInterfaceInfo[];
  onUpdateRemoteAccess: (patch: Partial<RemoteAccessConfig>) => void;
  onRotateRemoteToken: () => void;
  onDisconnectRemoteClient: (clientId: string) => void;
  onOpenRemoteCompanion: (token: string) => void;
  detectedEndpoints: DetectedHardwareEndpoint[];
  scanningHardware: boolean;
  onScanHardware: (requestBrowserPermission?: boolean) => void;
  onBindDetectedEndpoint: (endpoint: DetectedHardwareEndpoint) => void;
  onClearHardwareCache?: () => void;
  audioSource?: AudioSourceSimulation;
  onSelectAudioSource?: (src: AudioSourceSimulation) => void;
  engineRunning?: boolean;
  onToggleEngine?: () => void;
  desktopAudioStatus?: DesktopAudioStatus | null;
  desktopAudioSessions?: DesktopAudioSession[];
  apoStatus?: ApoSystemStatus | null;
  singleSpeakerMode?: boolean;
  apoBusy?: boolean;
  apoMessage?: { tone: 'success' | 'error' | 'info'; text: string } | null;
  onRefreshDesktopAudio?: () => void;
  onToggleSingleSpeakerMode?: (enabled: boolean, endpointId?: string) => void;
  onInstallApo?: (endpointId: string) => void;
  onUninstallApo?: (endpointId: string) => void;
}

const PLATFORM_SPECS: Record<
  PlatformTarget,
  {
    title: string;
    role: string;
    backends: DriverBackend[];
    buildTarget: string;
    binaryResolution: string;
    notes: string;
  }
> = {
  windows: {
    title: 'Windows 10 / 11 (x64)',
    role: 'Primary Desktop Target',
    backends: ['ASIO', 'WASAPI Exclusive', 'WASAPI Shared'],
    buildTarget: 'cargo tauri build --target x86_64-pc-windows-msvc',
    binaryResolution: 'resources/bin/win32-x64/camilladsp.exe (Bundled Tauri Sidecar)',
    notes:
      'ASIO 2.3 provides lowest deterministic latency for interfaces like RME, Focusrite, MOTU, and Yamaha Steinberg USB. WASAPI Exclusive bypasses Windows Audio Engine resampling.',
  },
  macos: {
    title: 'macOS 14+ (Apple Silicon & Intel)',
    role: 'Cross-Platform Target',
    backends: ['CoreAudio'],
    buildTarget: 'cargo tauri build --target universal-apple-darwin',
    binaryResolution: 'Contents/Resources/bin/darwin-universal/camilladsp',
    notes:
      'CoreAudio Aggregate Devices allow combining a stereo USB mixer (e.g. MG16XU) with a UMIK-1 measurement mic without clock drift when Drift Correction is enabled.',
  },
  linux: {
    title: 'Linux (Ubuntu / Debian / Arch)',
    role: 'Cross-Platform Target',
    backends: ['PipeWire', 'ALSA'],
    buildTarget: 'cargo tauri build --target x86_64-unknown-linux-gnu',
    binaryResolution: '/usr/lib/church-audio/bin/camilladsp (AppImage / .deb)',
    notes:
      'USB Audio Class 2.0 (UAC2) kernel support works out-of-the-box with class-compliant interfaces (Behringer UMC1820, MOTU, RME CC mode, Focusrite). PipeWire unifies desktop + pro JACK routing.',
  },
};

export const HardwareDiagnosticsModule: React.FC<HardwareDiagnosticsModuleProps> = ({
  devices,
  desktopBuild = false,
  activeDevice,
  onSelectDevice,
  platform,
  onSelectPlatform,
  driver,
  onSelectDriver,
  sampleRate,
  onSelectSampleRate,
  bufferSize,
  onSelectBufferSize,
  plugins,
  onTogglePlugin,
  onLoadCustomPlugin,
  onUnloadPlugin,
  telemetry,
  audioCpuPct,
  auditEvents,
  remoteAccess,
  remoteClients,
  lanInterfaces,
  onUpdateRemoteAccess,
  onRotateRemoteToken,
  onDisconnectRemoteClient,
  onOpenRemoteCompanion,
  detectedEndpoints,
  scanningHardware,
  onScanHardware,
  onBindDetectedEndpoint,
  onClearHardwareCache,
  audioSource = 'live-mic',
  onSelectAudioSource,
  engineRunning = false,
  onToggleEngine,
  desktopAudioStatus = null,
  desktopAudioSessions = [],
  apoStatus = null,
  singleSpeakerMode = false,
  apoBusy = false,
  apoMessage = null,
  onRefreshDesktopAudio,
  onToggleSingleSpeakerMode,
  onInstallApo,
  onUninstallApo,
}) => {
  const [tab, setTab] = useState<'hardware' | 'remote' | 'plugins' | 'crossplatform' | 'watchdog'>(
    'hardware'
  );
  const [selectedApoEndpointId, setSelectedApoEndpointId] = useState<string>('');
  const [pluginDraft, setPluginDraft] = useState(SAMPLE_CUSTOM_HARDWARE_PLUGIN);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [pluginSuccess, setPluginSuccess] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedUrl, setCopiedUrl] = useState(false);

  const latencyMs = calculateRoundTripLatencyMs(bufferSize, sampleRate, driver);
  const platformSpec = PLATFORM_SPECS[platform];

  const baseHostUrl = useMemo(() => {
    if (remoteAccess.lanHostOverride.trim()) {
      return remoteAccess.lanHostOverride.trim().replace(/\/+$/, '');
    }
    const isLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost && lanInterfaces.length > 0) {
      return lanInterfaces[0].url;
    }
    return window.location.origin;
  }, [remoteAccess.lanHostOverride, lanInterfaces]);

  const pairingUrl = useMemo(() => {
    return `${baseHostUrl}/?mode=remote&token=${encodeURIComponent(remoteAccess.sessionToken)}`;
  }, [baseHostUrl, remoteAccess.sessionToken]);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(pairingUrl, {
      width: 240,
      margin: 2,
      color: {
        dark: '#0B101B',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [pairingUrl]);

  const handleCopyPairingUrl = () => {
    navigator.clipboard.writeText(pairingUrl);
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 1800);
  };

  const handleInstallPlugin = () => {
    setPluginError(null);
    setPluginSuccess(null);
    const res = onLoadCustomPlugin(pluginDraft);
    if (!res.ok) {
      setPluginError(res.error || 'Failed to register plugin manifest.');
    } else {
      setPluginSuccess('Plugin registered and hot-loaded into active runtime.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Studio Rack Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]" />
          <div>
            <h1 className="font-display text-lg font-semibold text-white tracking-tight">
              System Diagnostics, Hardware Adapters &amp; Remote Access
            </h1>
            <p className="text-[11px] font-mono text-slate-400">
              {desktopBuild
                ? 'Windows desktop foundation · Browser-visible devices · Native audio adapters in progress'
                : 'Tier 1–4 Mixers &amp; Interfaces · QR Mobile FOH Control · Hot-Loadable Plugins · Windows / macOS / Linux'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center p-0.5 rounded bg-[#090D14] border border-slate-800">
          {[
            { id: 'hardware', label: 'HARDWARE', icon: Cpu },
            {
              id: 'remote',
              label: remoteClients.length > 0 ? `REMOTE ACCESS (${remoteClients.length})` : 'REMOTE ACCESS',
              icon: Smartphone,
            },
            { id: 'plugins', label: `PLUGINS (${plugins.length})`, icon: Puzzle },
            { id: 'crossplatform', label: 'OS & DRIVERS', icon: Layers },
            { id: 'watchdog', label: 'WATCHDOG', icon: ShieldAlert },
          ].filter((item) => !desktopBuild || item.id !== 'remote').map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id as typeof tab)}
                className={`px-3 py-1.5 text-[11px] font-mono font-semibold rounded-xs flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  tab === item.id
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* OS Driver & Latency Strip */}
      <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
        <div className="md:col-span-9 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block font-mono text-[10px] text-slate-400 uppercase mb-1">
              Target OS Platform
            </label>
            <select
              value={platform}
              onChange={(e) => {
                const nextP = e.target.value as PlatformTarget;
                onSelectPlatform(nextP);
                onSelectDriver(PLATFORM_SPECS[nextP].backends[0]);
              }}
              className="w-full h-9 px-2.5 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs font-mono"
            >
              <option value="windows">Windows 10/11 (Primary)</option>
              <option value="macos">macOS (CoreAudio)</option>
              <option value="linux">Linux (PipeWire / ALSA)</option>
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] text-slate-400 uppercase mb-1">
              Audio Driver
            </label>
            <select
              value={driver}
              onChange={(e) => onSelectDriver(e.target.value as DriverBackend)}
              className="w-full h-9 px-2.5 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs font-mono"
            >
              {platformSpec.backends.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] text-slate-400 uppercase mb-1">
              Sample Rate
            </label>
            <select
              value={sampleRate}
              onChange={(e) => onSelectSampleRate(Number(e.target.value))}
              className="w-full h-9 px-2.5 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs font-mono"
            >
              {activeDevice.sampleRates.map((sr) => (
                <option key={sr} value={sr}>
                  {(sr / 1000).toFixed(1)} kHz
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] text-slate-400 uppercase mb-1">
              Buffer Size
            </label>
            <select
              value={bufferSize}
              onChange={(e) => onSelectBufferSize(Number(e.target.value))}
              className="w-full h-9 px-2.5 rounded border border-slate-700 bg-[#070A10] text-slate-100 text-xs font-mono"
            >
              {[64, 128, 256, 512, 1024].map((bs) => (
                <option key={bs} value={bs}>
                  {bs} samples
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="md:col-span-3">
          <ArcGauge
            label="Round-Trip Latency"
            value={latencyMs}
            max={30}
            displayValue={`${latencyMs}ms`}
            sublabel={`${driver} · ${bufferSize} smp`}
            tone={latencyMs < 10 ? 'emerald' : latencyMs < 18 ? 'sky' : 'amber'}
          />
        </div>
      </div>

      {tab === 'remote' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: QR Pairing Card */}
          <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#0D1119] p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-sky-400" />
                <span className="font-mono text-xs font-semibold text-white uppercase">
                  FOH Mobile Companion QR Pairing
                </span>
              </div>
              <button
                type="button"
                onClick={onRotateRemoteToken}
                className="px-2.5 py-1 rounded border border-slate-700 bg-[#121824] hover:border-sky-500/50 text-[11px] font-mono text-slate-200 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3 text-sky-400" />
                <span>ROTATE TOKEN</span>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="p-3 rounded-lg bg-white border border-slate-300 shrink-0">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Scan to pair mobile FOH companion"
                    className="w-44 h-44 block"
                  />
                ) : (
                  <div className="w-44 h-44 flex items-center justify-center text-xs font-mono text-slate-600">
                    Generating QR...
                  </div>
                )}
              </div>

              <div className="space-y-2.5 text-xs min-w-0 flex-1">
                <div className="font-semibold text-white">
                  Walk the sanctuary with live fader &amp; gain control
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Scan this QR code on a phone or tablet on the same sanctuary Wi-Fi network (or
                  current session URL) to adjust channel faders, preamp gain, mutes, and master
                  trim in real time over WebSocket.
                </p>
                <div className="font-mono text-[11px] text-sky-400 break-all bg-[#070A10] border border-slate-800 rounded p-2">
                  {pairingUrl}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCopyPairingUrl}
                    className="px-3 py-1.5 rounded border border-slate-700 bg-[#121824] hover:border-sky-500/50 text-[11px] font-mono text-slate-200 flex items-center gap-1.5"
                  >
                    {copiedUrl ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-sky-400" />
                    )}
                    <span>{copiedUrl ? 'COPIED LINK' : 'COPY LINK'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenRemoteCompanion(remoteAccess.sessionToken)}
                    className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-mono font-semibold flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>OPEN MOBILE VIEW</span>
                  </button>
                </div>
              </div>
            </div>

            {/* LAN Host Selection for Offline Windows Wi-Fi */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <label className="block font-mono text-[10px] text-slate-400 uppercase">
                Sanctuary LAN Host / URL Override (Offline Windows Wi-Fi)
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpdateRemoteAccess({ lanHostOverride: '' })}
                  className={`px-2.5 py-1 rounded border text-[10px] font-mono ${
                    !remoteAccess.lanHostOverride
                      ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                      : 'border-slate-800 bg-[#070A10] text-slate-400'
                  }`}
                >
                  Auto ({window.location.host})
                </button>
                {lanInterfaces.map((iface) => (
                  <button
                    key={`${iface.name}-${iface.address}`}
                    type="button"
                    onClick={() => onUpdateRemoteAccess({ lanHostOverride: iface.url })}
                    className={`px-2.5 py-1 rounded border text-[10px] font-mono ${
                      remoteAccess.lanHostOverride === iface.url
                        ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                        : 'border-slate-800 bg-[#070A10] text-slate-400'
                    }`}
                  >
                    {iface.name}: {iface.address}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={remoteAccess.lanHostOverride}
                onChange={(e) => onUpdateRemoteAccess({ lanHostOverride: e.target.value })}
                placeholder="Optional custom host e.g. http://192.168.1.50:3000"
                className="w-full h-9 px-2.5 rounded border border-slate-700 bg-[#070A10] text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          {/* Right: Security Permissions + Connected Mobile Clients */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-mono text-xs font-semibold text-white uppercase flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-sky-400" />
                  <span>FOH Companion Permissions &amp; PIN Guard</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  {activeDevice.capabilities.perChannelFaderControl
                    ? `Hardware Link: ${activeDevice.model}`
                    : `Software DSP Return: ${activeDevice.model}`}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded border border-slate-800 bg-[#070A10] flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-100">Require 4-Digit PIN</div>
                    <div className="text-[11px] text-slate-400">
                      Prompts mobile devices before unlocking faders
                    </div>
                  </div>
                  <ConsolePushButton
                    label={remoteAccess.pinEnabled ? 'PIN ON' : 'PIN OFF'}
                    active={remoteAccess.pinEnabled}
                    tone="amber"
                    onClick={() => onUpdateRemoteAccess({ pinEnabled: !remoteAccess.pinEnabled })}
                  />
                </div>

                <div className="p-3 rounded border border-slate-800 bg-[#070A10] flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-100">Session Security PIN</div>
                    <div className="text-[11px] text-slate-400">4–8 digit FOH passcode</div>
                  </div>
                  <input
                    type="text"
                    maxLength={8}
                    value={remoteAccess.pinCode}
                    onChange={(e) => onUpdateRemoteAccess({ pinCode: e.target.value })}
                    className="w-24 h-8 px-2 rounded border border-slate-700 bg-[#0E1524] font-mono text-center text-xs text-white"
                  />
                </div>

                <div className="p-3 rounded border border-slate-800 bg-[#070A10] flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-100">Preamp Gain Adjustment</div>
                    <div className="text-[11px] text-slate-400">
                      Allow mobile gain &amp; +48V trim control
                    </div>
                  </div>
                  <ConsolePushButton
                    label={remoteAccess.allowGainAdjustment ? 'ALLOWED' : 'LOCKED'}
                    active={remoteAccess.allowGainAdjustment}
                    tone="emerald"
                    onClick={() =>
                      onUpdateRemoteAccess({
                        allowGainAdjustment: !remoteAccess.allowGainAdjustment,
                      })
                    }
                  />
                </div>

                <div className="p-3 rounded border border-slate-800 bg-[#070A10] flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-100">Mute / Solo &amp; Master</div>
                    <div className="text-[11px] text-slate-400">
                      Allow channel mutes &amp; master trim
                    </div>
                  </div>
                  <ConsolePushButton
                    label={remoteAccess.allowMuteControl ? 'ALLOWED' : 'LOCKED'}
                    active={remoteAccess.allowMuteControl}
                    tone="emerald"
                    onClick={() =>
                      onUpdateRemoteAccess({
                        allowMuteControl: !remoteAccess.allowMuteControl,
                        allowMasterTrim: !remoteAccess.allowMuteControl,
                      })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Active Connected Mobile Companions */}
            <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-mono text-xs font-semibold text-white uppercase flex items-center gap-2">
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Linked Companion Devices ({remoteClients.length})</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  Real-Time WebSocket Sync (/ws)
                </span>
              </div>

              {remoteClients.length === 0 ? (
                <div className="p-5 rounded border border-slate-800 bg-[#070A10] text-center space-y-1.5">
                  <div className="text-xs font-semibold text-slate-200">
                    No companion devices currently linked
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Scan the QR code on a phone/tablet or click Open Mobile View to verify live
                    fader and gain synchronization.
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-800">
                  {remoteClients.map((cli) => (
                    <div
                      key={cli.clientId}
                      className="py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-white flex items-center gap-2">
                          <span>{cli.deviceName}</span>
                          <span className="font-mono text-[10px] text-emerald-400">LIVE</span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                          IP: {cli.ip} · Connected {new Date(cli.connectedAt).toLocaleTimeString()}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onDisconnectRemoteClient(cli.clientId)}
                        className="px-2.5 py-1 rounded border border-red-500/40 bg-red-950/30 hover:bg-red-950/60 text-red-300 font-mono text-[11px] flex items-center gap-1 shrink-0"
                      >
                        <UserX className="w-3.5 h-3.5" />
                        <span>REVOKE</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'hardware' && (
        <div className="space-y-4">
          {/* Dual-Engine Hassle-Free Desktop Audio Card (Option 1 Process Loopback + Option 2 MFX APO RAW) */}
          <div className="rounded-lg border border-cyan-500/45 bg-gradient-to-b from-[#091821] to-[#070E14] text-slate-100 p-4 space-y-3.5 shadow-lg shadow-cyan-950/30">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-cyan-500/20 pb-3">
              <div className="space-y-1">
                <div className="font-mono text-xs font-bold text-cyan-300 uppercase tracking-wide flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      desktopBuild && desktopAudioStatus?.supported
                        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse'
                        : 'bg-sky-400'
                    }`}
                  />
                  <span>Hassle-Free Desktop Audio Capture (Dual Engine · Zero Virtual Cable)</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">
                  {desktopBuild
                    ? 'Engine 1 (WASAPI Process-Exclusion Loopback) runs automatically out of the box—capturing Chrome, Edge, Spotify, VLC, and all desktop audio while excluding this console (zero feedback) and auto-assigning to the next open channel.'
                    : 'Running in web preview mode. Install or launch the Windows Desktop App for driverless WASAPI Process-Exclusion Loopback & APO single-speaker routing.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {desktopBuild && onRefreshDesktopAudio && (
                  <button
                    type="button"
                    onClick={onRefreshDesktopAudio}
                    className="px-2.5 py-1.5 rounded border border-cyan-500/40 bg-[#0B1720] hover:border-cyan-400 text-cyan-200 font-mono text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>REFRESH APPS &amp; APO</span>
                  </button>
                )}
                {!desktopBuild && onSelectAudioSource && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectAudioSource('desktop-audio');
                      if (!engineRunning && onToggleEngine) {
                        onToggleEngine();
                      }
                    }}
                    className={`px-3 py-1.5 rounded font-mono text-[11px] font-semibold border transition-colors cursor-pointer ${
                      audioSource === 'desktop-audio'
                        ? 'bg-emerald-600 border-emerald-400 text-white'
                        : 'bg-[#091015] border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/15'
                    }`}
                  >
                    {audioSource === 'desktop-audio' && engineRunning
                      ? 'WEB DESKTOP LOOPBACK ACTIVE'
                      : 'SHARE BROWSER / SYSTEM AUDIO'}
                  </button>
                )}
              </div>
            </div>

            {desktopBuild && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                {/* Engine 1 Panel */}
                <div className="lg:col-span-5 rounded-md border border-slate-800 bg-[#070B11] p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold text-cyan-300 uppercase">
                      Engine 1 · Driverless Process Loopback
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                        desktopAudioStatus?.supported
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                          : 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                      }`}
                    >
                      {desktopAudioStatus?.supported
                        ? `READY (BUILD ${desktopAudioStatus.osBuild || 'WIN11'})`
                        : 'UNAVAILABLE'}
                    </span>
                  </div>

                  <div className="font-mono text-[10px] text-slate-400 space-y-1">
                    <div>• No VB-Audio Virtual Cable, zero picker dialogs, zero Admin needed</div>
                    <div>• Auto-slotted to CH N+1 after connected hardware microphones</div>
                    <div>• Clean with zero doubling on any PA / USB interface / secondary speaker</div>
                  </div>

                  <div className="pt-1 border-t border-slate-800/90 space-y-1">
                    <div className="font-mono text-[9.5px] text-slate-400 uppercase font-semibold">
                      Detected Active Audio Apps ({desktopAudioSessions.length})
                    </div>
                    {desktopAudioSessions.length === 0 ? (
                      <div className="text-[10px] font-mono text-slate-500 italic">
                        Start playing audio in Chrome, Edge, Spotify, or VLC to see individual app sessions here or in the left patch tray.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {desktopAudioSessions.map((s) => (
                          <span
                            key={`diag-sess-${s.pid}`}
                            className="px-2 py-0.5 rounded border border-cyan-500/35 bg-cyan-950/30 font-mono text-[10px] text-cyan-200 flex items-center gap-1"
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                s.state === 'active' ? 'bg-emerald-400' : 'bg-slate-500'
                              }`}
                            />
                            {s.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Engine 2 Panel */}
                <div className="lg:col-span-7 rounded-md border border-slate-800 bg-[#070B11] p-3 space-y-2.5">
                  {(() => {
                    const endpoints = apoStatus?.endpoints ?? [];
                    const effectiveEpId =
                      selectedApoEndpointId ||
                      apoStatus?.selectedEndpointId ||
                      endpoints.find((e) => e.isDefault)?.id ||
                      endpoints[0]?.id ||
                      '';
                    const activeEp = endpoints.find((e) => e.id === effectiveEpId);

                    return (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-[11px] font-bold text-amber-300 uppercase">
                            Engine 2 · Opt-In System APO (Single-Speaker Zero-Doubling)
                          </span>
                          <div className="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                            <span
                              className={`px-1.5 py-0.5 rounded border ${
                                apoStatus?.dllBundled
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                  : 'border-slate-700 bg-slate-900 text-slate-400'
                              }`}
                            >
                              {apoStatus?.dllBundled ? 'DLL BUNDLED' : 'DLL MISSING'}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded border ${
                                apoStatus?.apoLoadedInAudiodg
                                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                                  : apoStatus?.apoRegisteredAny
                                    ? 'border-amber-500/45 bg-amber-500/15 text-amber-300'
                                    : 'border-slate-700 bg-slate-900 text-slate-400'
                              }`}
                            >
                              {apoStatus?.apoLoadedInAudiodg
                                ? 'LIVE IN AUDIODG'
                                : apoStatus?.apoRegisteredAny
                                  ? 'REGISTERED (PPL PENDING)'
                                  : 'NOT INSTALLED'}
                            </span>
                            <span className="px-1.5 py-0.5 rounded border border-sky-500/35 bg-sky-950/30 text-sky-300">
                              500MS FAIL-SAFE
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                          <div className="sm:col-span-7">
                            <label className="block font-mono text-[9.5px] text-slate-400 uppercase mb-1">
                              Target Physical Speaker ({activeEp?.rawSupported ? 'WASAPI RAW Supported' : 'Check RAW Support'})
                            </label>
                            <select
                              value={effectiveEpId}
                              onChange={(e) => setSelectedApoEndpointId(e.target.value)}
                              className="w-full h-8 px-2 rounded border border-slate-700 bg-[#0B1018] text-slate-100 text-[11px] font-mono"
                            >
                              {endpoints.length === 0 ? (
                                <option value="">Default System Render Endpoint</option>
                              ) : (
                                endpoints.map((ep) => (
                                  <option key={ep.id} value={ep.id}>
                                    {ep.name} {ep.isDefault ? '(Default)' : ''} ·{' '}
                                    {ep.rawSupported ? 'RAW OK' : 'No RAW'}
                                    {ep.apoRegistered ? ' · APO Installed' : ''}
                                  </option>
                                ))
                              )}
                            </select>
                          </div>

                          <div className="sm:col-span-5 flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={!effectiveEpId || apoBusy || !onInstallApo}
                              onClick={() => effectiveEpId && onInstallApo?.(effectiveEpId)}
                              className="flex-1 h-8 px-2 rounded border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 font-mono text-[10px] font-bold disabled:opacity-40 cursor-pointer"
                            >
                              {apoBusy ? 'WORKING...' : 'INSTALL APO (ADMIN)'}
                            </button>
                            <button
                              type="button"
                              disabled={!effectiveEpId || apoBusy || !onUninstallApo}
                              onClick={() => effectiveEpId && onUninstallApo?.(effectiveEpId)}
                              className="h-8 px-2 rounded border border-slate-700 bg-[#0D131D] hover:border-slate-500 text-slate-300 font-mono text-[10px] font-bold disabled:opacity-40 cursor-pointer"
                            >
                              UNINSTALL
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                          <span className="font-mono text-[10px] text-slate-400">
                            {apoStatus?.note}
                          </span>
                          {onToggleSingleSpeakerMode && (
                            <button
                              type="button"
                              onClick={() =>
                                onToggleSingleSpeakerMode(!singleSpeakerMode, effectiveEpId || undefined)
                              }
                              className={`px-3 py-1 rounded border font-mono text-[10px] font-bold shrink-0 cursor-pointer ${
                                singleSpeakerMode
                                  ? 'bg-emerald-600 border-emerald-400 text-white'
                                  : 'bg-[#0F1722] border-cyan-500/50 text-cyan-200 hover:bg-cyan-500/15'
                              }`}
                            >
                              {singleSpeakerMode
                                ? '✓ ZERO-DOUBLING ACTIVE (RAW OUT)'
                                : 'ENABLE SINGLE-SPEAKER ZERO-DOUBLING'}
                            </button>
                          )}
                        </div>

                        {apoMessage && (
                          <div
                            className={`p-2 rounded border font-mono text-[10px] ${
                              apoMessage.tone === 'success'
                                ? 'border-emerald-500/45 bg-emerald-950/35 text-emerald-200'
                                : apoMessage.tone === 'error'
                                  ? 'border-red-500/45 bg-red-950/35 text-red-200'
                                  : 'border-sky-500/45 bg-sky-950/35 text-sky-200'
                            }`}
                          >
                            {apoMessage.text}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Auto-Recognized Connected Hardware Panel */}
          <div className="rounded-lg border border-sky-500/35 bg-[#0D131F] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Radar className="w-4 h-4 text-sky-400" />
                <div>
                  <div className="font-mono text-xs font-semibold text-white uppercase">
                    Auto-Recognized Connected Hardware (Internal &amp; External)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Automatic USB VID:PID fingerprinting, internal sound card profiling, LAN OSC console discovery &amp; hot-plug listener
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {detectedEndpoints.length > 0 && onClearHardwareCache && (
                  <button
                    type="button"
                    onClick={onClearHardwareCache}
                    className="px-2.5 py-1.5 rounded border border-slate-700 bg-[#090D14] hover:border-slate-500 text-slate-300 font-mono text-[11px]"
                  >
                    CLEAR CACHE
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onScanHardware(true)}
                  disabled={scanningHardware}
                  className="px-3 py-1.5 rounded border border-sky-400/50 bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 font-mono text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${scanningHardware ? 'animate-spin' : ''}`} />
                  <span>{scanningHardware ? 'SCANNING BUS...' : 'RE-SCAN HARDWARE'}</span>
                </button>
              </div>
            </div>

            {detectedEndpoints.length === 0 ? (
              <div className="p-4 rounded border border-slate-800 bg-[#070A10] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-200">
                    No OS audio endpoints enumerated in sandbox yet
                  </div>
                  <div className="text-slate-400">
                    Plug in any USB mixer or audio interface on Windows/macOS/Linux, or click Re-Scan Hardware to unlock browser MediaDevices labels and probe local cards. Remembered devices persist in IndexedDB for instant offline recall.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onScanHardware(true)}
                  className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-mono text-[11px] font-semibold shrink-0"
                >
                  GRANT &amp; SCAN INTERFACES
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {detectedEndpoints.map((ep) => {
                  const isBound = activeDevice.id === ep.matchedDeviceId;
                  const kindLabel =
                    ep.kind === 'internal'
                      ? 'INTERNAL CARD'
                      : ep.kind === 'usb-audio'
                        ? 'USB INTERFACE'
                        : ep.kind === 'network-console'
                          ? 'LAN CONSOLE'
                          : ep.kind === 'virtual'
                            ? 'VIRTUAL BUS'
                            : ep.kind.toUpperCase();

                  return (
                    <div
                      key={ep.id}
                      className={`p-3 rounded border flex flex-col justify-between gap-2.5 ${
                        isBound
                          ? 'border-emerald-400/70 bg-emerald-950/20'
                          : 'border-slate-800 bg-[#070A10]'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] font-bold text-sky-300 uppercase flex items-center gap-1">
                            <Usb className="w-3 h-3" />
                            {kindLabel}
                            {ep.isDefault ? ' · DEFAULT' : ''}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                            {ep.cachedFromIndexedDb ? 'IndexedDB Cached' : 'Live on Bus'}
                          </span>
                        </div>

                        <div className="text-xs font-semibold text-white truncate" title={ep.name}>
                          {ep.name}
                        </div>

                        <div className="font-mono text-[11px] text-slate-400 space-y-0.5 tabular-nums">
                          <div>
                            Profile: {ep.matchedLabel} ·{' '}
                            {ep.confidence === 'auto-synthesized'
                              ? 'Universal Auto-Profile'
                              : ep.confidence}
                          </div>
                          <div>
                            {ep.estimatedInputChannels}×{ep.estimatedOutputChannels} ch · {ep.recommendedDriver} · {(ep.recommendedSampleRate / 1000).toFixed(1)} kHz
                          </div>
                          {(ep.vendorId || ep.hostAddress || ep.lastSeenAt) && (
                            <div className="text-slate-500">
                              {ep.vendorId
                                ? `USB VID:${ep.vendorId.toUpperCase()} PID:${(ep.productId || '----').toUpperCase()}`
                                : ep.hostAddress
                                  ? `Host IP: ${ep.hostAddress}`
                                  : 'System Audio'}
                              {ep.seenCount ? ` · Seen ${ep.seenCount}×` : ''}
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onBindDetectedEndpoint(ep)}
                        className={`w-full py-1.5 px-2.5 rounded font-mono text-[11px] font-semibold transition-colors ${
                          isBound
                            ? 'bg-emerald-600 text-white'
                            : 'bg-sky-600 hover:bg-sky-500 text-white'
                        }`}
                      >
                        {isBound ? 'BOUND & PROFILE RECALLED' : 'AUTO-BIND & RECALL MIX'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'plugins' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-6 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-3">
            <div className="font-mono text-xs font-semibold text-white uppercase border-b border-slate-800 pb-2">
              Registered Hardware Driver &amp; DSP Modules
            </div>
            <div className="divide-y divide-slate-800/80">
              {plugins.map((pl) => (
                <div key={pl.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">{pl.name}</span>
                      <span className="font-mono text-[10px] text-slate-500">v{pl.version}</span>
                    </div>
                    <div className="font-mono text-[11px] text-sky-400">
                      {pl.kind} · {pl.supportedPlatforms.join(' / ')} · {pl.entryPoint}
                    </div>
                    <p className="text-xs text-slate-400">{pl.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ConsolePushButton
                      label={pl.status === 'active' ? 'ENABLED' : 'DISABLED'}
                      active={pl.status === 'active'}
                      tone="emerald"
                      onClick={() => onTogglePlugin(pl.id)}
                    />
                    {!pl.builtin && (
                      <button
                        type="button"
                        onClick={() => onUnloadPlugin(pl.id)}
                        aria-label={`Unload ${pl.name}`}
                        className="p-1 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6 space-y-4">
            <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-white uppercase">
                  Hot-Load Plugin Manifest (JSON)
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPluginDraft(SAMPLE_CUSTOM_HARDWARE_PLUGIN)}
                    className="text-[11px] font-mono px-2 py-1 rounded border border-slate-700 bg-[#070A10] text-slate-300 hover:border-sky-500/50"
                  >
                    Midas M32R Sample
                  </button>
                  <button
                    type="button"
                    onClick={() => setPluginDraft(SAMPLE_CUSTOM_DSP_PLUGIN)}
                    className="text-[11px] font-mono px-2 py-1 rounded border border-slate-700 bg-[#070A10] text-slate-300 hover:border-sky-500/50"
                  >
                    Choir Air Sample
                  </button>
                </div>
              </div>

              <textarea
                value={pluginDraft}
                onChange={(e) => setPluginDraft(e.target.value)}
                rows={9}
                className="w-full p-2.5 rounded bg-[#070A10] border border-slate-800 font-mono text-[11px] text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />

              {pluginError && <div className="text-xs text-red-400">{pluginError}</div>}
              {pluginSuccess && <div className="text-xs text-emerald-400">{pluginSuccess}</div>}

              <button
                type="button"
                onClick={handleInstallPlugin}
                className="w-full py-2 px-3 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-mono font-semibold flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>REGISTER &amp; HOT-LOAD PLUGIN</span>
              </button>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-2">
              <div className="font-mono text-xs font-semibold text-white uppercase">
                Plugin Authoring SDK Contract
              </div>
              <pre className="p-3 rounded bg-[#070A10] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                {PLUGIN_SDK_CONTRACT_SNIPPET}
              </pre>
            </div>
          </div>
        </div>
      )}

      {tab === 'crossplatform' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {(['windows', 'macos', 'linux'] as PlatformTarget[]).map((osKey) => {
            const spec = PLATFORM_SPECS[osKey];
            const active = platform === osKey;
            return (
              <div
                key={osKey}
                className={`p-4 rounded-lg border space-y-3 ${
                  active ? 'border-sky-400 bg-[#121B2B]' : 'border-slate-800 bg-[#0D1119]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-white">{spec.title}</div>
                    <div className="font-mono text-[10px] text-sky-400 uppercase">{spec.role}</div>
                  </div>
                  <ConsolePushButton
                    label={active ? 'ACTIVE' : 'SELECT'}
                    active={active}
                    tone="sky"
                    onClick={() => {
                      onSelectPlatform(osKey);
                      onSelectDriver(spec.backends[0]);
                    }}
                  />
                </div>

                <div className="space-y-1 text-xs">
                  <div className="font-mono text-[10px] text-slate-500 uppercase">Audio Backends</div>
                  <div className="font-mono text-emerald-400">{spec.backends.join(' · ')}</div>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="font-mono text-[10px] text-slate-500 uppercase">Sidecar Binary</div>
                  <div className="font-mono text-[11px] text-slate-300 break-all">
                    {spec.binaryResolution}
                  </div>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="font-mono text-[10px] text-slate-500 uppercase">Tauri 2 Build</div>
                  <pre className="p-2 rounded bg-[#070A10] border border-slate-800 font-mono text-[10px] text-sky-300 overflow-x-auto">
                    {spec.buildTarget}
                  </pre>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">{spec.notes}</p>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'watchdog' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5">
            <ArcGauge
              label="DSP Engine Load"
              value={audioCpuPct}
              max={100}
              displayValue={`${audioCpuPct}%`}
              sublabel={telemetry.isRunning ? 'Real-Time Audio Thread' : 'Engine Standby'}
              tone={audioCpuPct >= 80 ? 'red' : audioCpuPct >= 60 ? 'amber' : 'sky'}
            />
            <ArcGauge
              label="Sample Clock State"
              value={telemetry.isRunning ? 100 : 0}
              max={100}
              displayValue={telemetry.isRunning ? 'LOCKED' : 'IDLE'}
              sublabel={
                telemetry.isRunning
                  ? `${(telemetry.sampleRate / 1000).toFixed(1)} kHz Active`
                  : `${(sampleRate / 1000).toFixed(1)} kHz Configured`
              }
              tone={telemetry.isRunning ? 'emerald' : 'sky'}
            />
            <ArcGauge
              label="Clip / Headroom Guard"
              value={Math.max(10, 100 - telemetry.clippingEvents * 10)}
              max={100}
              displayValue={`${telemetry.clippingEvents} Clips`}
              sublabel={`${bufferSize} smp · ${driver}`}
              tone={telemetry.clippingEvents > 0 ? 'amber' : 'emerald'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-3">
              <div className="font-mono text-xs font-semibold text-white uppercase border-b border-slate-800 pb-2">
                Engine Watchdog Telemetry
              </div>
              <div className="divide-y divide-slate-800 text-xs">
                {[
                  { label: 'Supervision Architecture', val: 'Decoupled Audio Core + UI' },
                  {
                    label: 'Engine Sample Rate',
                    val: telemetry.isRunning
                      ? `${telemetry.sampleRate} Hz (Running)`
                      : `${sampleRate} Hz (Standby)`,
                  },
                  { label: 'Buffer Quantum', val: `${bufferSize} samples (${latencyMs} ms)` },
                  { label: 'Clipping Incidents', val: `${telemetry.clippingEvents} events` },
                  { label: 'Local Persistence', val: 'SQLite WAL + JSON Backup + WS Sync' },
                ].map((row) => (
                  <div key={row.label} className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-400">{row.label}</span>
                    <span className="font-mono text-slate-100 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      {row.val}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 space-y-3">
              <div className="font-mono text-xs font-semibold text-white uppercase border-b border-slate-800 pb-2">
                Configuration &amp; System Audit Trail
              </div>
              <div className="divide-y divide-slate-800 max-h-72 overflow-y-auto">
                {auditEvents.map((evt) => (
                  <div key={evt.id} className="py-2.5 flex items-start justify-between gap-4 text-xs">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-white">{evt.action}</div>
                      <div className="text-slate-400">{evt.detail}</div>
                    </div>
                    <div className="text-right font-mono text-[10px] text-slate-500 shrink-0">
                      <div>{evt.actor}</div>
                      <div>{new Date(evt.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
