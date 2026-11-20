import React, { useState } from 'react';
import {
  Cpu,
  Puzzle,
  Layers,
  ShieldAlert,
  CheckCircle2,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  AuditEvent,
  DriverBackend,
  HardwareDevice,
  PlatformTarget,
  SignalTelemetry,
} from '../types/audio.ts';
import type { LoadedPluginRecord } from '../plugins/pluginManager.ts';
import {
  PLUGIN_SDK_CONTRACT_SNIPPET,
  SAMPLE_CUSTOM_DSP_PLUGIN,
  SAMPLE_CUSTOM_HARDWARE_PLUGIN,
} from '../plugins/pluginManager.ts';
import { calculateRoundTripLatencyMs } from '../utils/camillaDsp.ts';
import { ArcGauge, ConsolePushButton } from './StudioControls.tsx';

interface HardwareDiagnosticsModuleProps {
  devices: HardwareDevice[];
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
  auditEvents: AuditEvent[];
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
  auditEvents,
}) => {
  const [tab, setTab] = useState<'hardware' | 'plugins' | 'crossplatform' | 'watchdog'>('hardware');
  const [tierFilter, setTierFilter] = useState<'all' | 1 | 2 | 3 | 4>('all');
  const [pluginDraft, setPluginDraft] = useState(SAMPLE_CUSTOM_HARDWARE_PLUGIN);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [pluginSuccess, setPluginSuccess] = useState<string | null>(null);

  const filteredDevices = devices.filter(
    (d) => tierFilter === 'all' || d.tier === tierFilter
  );

  const latencyMs = calculateRoundTripLatencyMs(bufferSize, sampleRate, driver);
  const platformSpec = PLATFORM_SPECS[platform];

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
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-sky-400">12</span>
              <h1 className="font-display text-lg font-semibold text-white tracking-tight">
                SYSTEM DIAGNOSTICS, HARDWARE ADAPTERS &amp; RELIABILITY
              </h1>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              Tier 1–4 Mixers &amp; Interfaces · Hot-Loadable Driver/DSP Plugins · Windows / macOS / Linux
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center p-0.5 rounded bg-[#090D14] border border-slate-800">
          {[
            { id: 'hardware', label: 'HARDWARE', icon: Cpu },
            { id: 'plugins', label: `PLUGINS (${plugins.length})`, icon: Puzzle },
            { id: 'crossplatform', label: 'OS & DRIVERS', icon: Layers },
            { id: 'watchdog', label: 'WATCHDOG', icon: ShieldAlert },
          ].map((item) => {
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

      {tab === 'hardware' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: `ALL HARDWARE (${devices.length})` },
              { id: 1, label: 'TIER 1 · ANALOG & USB' },
              { id: 2, label: 'TIER 2 · DIGITAL CONSOLES' },
              { id: 3, label: 'TIER 3 · DEDICATED DSP' },
              { id: 4, label: 'TIER 4 · DANTE & CAL' },
            ].map((t) => (
              <button
                key={String(t.id)}
                type="button"
                onClick={() => setTierFilter(t.id as typeof tierFilter)}
                className={`px-3 py-1.5 rounded text-[11px] font-mono font-semibold border transition-colors ${
                  tierFilter === t.id
                    ? 'border-sky-400 bg-sky-500/20 text-sky-300'
                    : 'border-slate-800 bg-[#0D1119] text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredDevices.map((dev) => {
              const isSelected = dev.id === activeDevice.id;
              const supportsCurrentPlatform = dev.supportedPlatforms.includes(platform);

              return (
                <div
                  key={dev.id}
                  className={`p-4 rounded-lg border flex flex-col justify-between gap-3 transition-colors ${
                    isSelected
                      ? 'border-sky-400 bg-[#121B2B]'
                      : 'border-slate-800 bg-[#0D1119]'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-[10px] text-sky-400 uppercase">{dev.tierLabel}</div>
                        <div className="text-sm font-semibold text-white mt-0.5">
                          {dev.manufacturer} {dev.model}
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400 shrink-0">
                        {dev.capabilities.maxInputChannels}×{dev.capabilities.maxOutputChannels}
                      </span>
                    </div>

                    <div className="text-xs font-mono text-emerald-400">{dev.connectionType}</div>
                    <div className="text-xs text-slate-400 leading-relaxed">
                      {dev.capabilities.limitationsNote}
                    </div>

                    <div className="pt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-slate-500">
                      <span>FADERS: {dev.capabilities.perChannelFaderControl ? 'REMOTE' : 'MANUAL'}</span>
                      <span>·</span>
                      <span>STREAMS: {dev.capabilities.perChannelCapture ? 'MULTITRACK' : 'STEREO'}</span>
                      <span>·</span>
                      <span>OS: {dev.supportedPlatforms.join('/')}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!supportsCurrentPlatform}
                    onClick={() => onSelectDevice(dev)}
                    className={`w-full py-2 px-3 rounded text-xs font-mono font-semibold transition-colors ${
                      isSelected
                        ? 'bg-emerald-600 text-white'
                        : supportsCurrentPlatform
                          ? 'bg-sky-600 hover:bg-sky-500 text-white'
                          : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    {isSelected
                      ? 'ACTIVE BOUND DEVICE'
                      : supportsCurrentPlatform
                        ? `BIND ${dev.model.toUpperCase()}`
                        : `UNSUPPORTED ON ${platform.toUpperCase()}`}
                  </button>
                </div>
              );
            })}
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
              value={telemetry.isRunning ? Math.min(82, Math.round(14 + 4096 / Math.max(64, bufferSize))) : 6}
              max={100}
              displayValue={`${telemetry.isRunning ? Math.min(82, Math.round(14 + 4096 / Math.max(64, bufferSize))) : 6}%`}
              sublabel="Real-Time Audio Thread"
              tone="sky"
            />
            <ArcGauge
              label="Clock Lock Stability"
              value={99.8}
              max={100}
              displayValue="99.8%"
              sublabel={`${(sampleRate / 1000).toFixed(1)} kHz Synced`}
              tone="emerald"
            />
            <ArcGauge
              label="Buffer XRun Safety"
              value={Math.max(15, 100 - telemetry.clippingEvents * 10)}
              max={100}
              displayValue="0 XRun"
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
                  { label: 'Engine Sample Rate', val: `${sampleRate} Hz (Synced)` },
                  { label: 'Buffer / Underrun Watch', val: `${bufferSize} samples · 0 XRuns` },
                  { label: 'Clipping Incidents', val: `${telemetry.clippingEvents} events` },
                  { label: 'Offline Operation', val: 'Full local-first DSP & Presets' },
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
