import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import type { SignalTelemetry, SpeakerZone } from '../types/audio.ts';
import { RotaryKnob, SegmentedLedMeter } from './StudioControls.tsx';

interface SpeakerZonesModuleProps {
  zones: SpeakerZone[];
  onUpdateZone: (id: string, patch: Partial<SpeakerZone>) => void;
  onAddZone?: (name?: string, role?: SpeakerZone['role']) => void;
  onRemoveZone?: (id: string) => void;
  outputDevices?: MediaDeviceInfo[];
  onScanAudioDevices?: (requestPermission?: boolean) => Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>;
  telemetry?: SignalTelemetry;
  emergencyMuted?: boolean;
  onToggleEmergencyMute?: () => void;
}

const DISTRIBUTED_ZONES = [
  { id: 'dist-balcony', label: 'BALCONY' },
  { id: 'dist-overflow', label: 'OVERFLOWS' },
  { id: 'dist-nursery', label: 'NURSERY' },
  { id: 'dist-youth', label: 'YOUTH' },
  { id: 'dist-foyer', label: 'FOYER' },
  { id: 'dist-chapel', label: 'CHAPEL' },
];

export const SpeakerZonesModule: React.FC<SpeakerZonesModuleProps> = ({
  zones,
  onUpdateZone,
  onAddZone,
  onRemoveZone,
  outputDevices = [],
  onScanAudioDevices,
  telemetry,
  emergencyMuted = false,
  onToggleEmergencyMute,
}) => {
  const [selectedId, setSelectedId] = useState<string>(zones[0]?.id ?? 'zone-front-main');
  const [topologyTab, setTopologyTab] = useState<'live' | 'signal' | 'system'>('live');
  const [distributedMutes, setDistributedMutes] = useState<Record<string, boolean>>({});
  const selectedZone = zones.find((z) => z.id === selectedId) ?? zones[0];

  const handleDistanceChange = (id: string, meters: number) => {
    const delayMs = Number((meters * 2.915).toFixed(1));
    onUpdateZone(id, { distanceMeters: meters, delayMs });
  };

  const handleAlignAllDelays = () => {
    zones.forEach((z) => {
      const delayMs = Number((z.distanceMeters * 2.915).toFixed(1));
      onUpdateZone(z.id, { delayMs });
    });
  };

  const handleUnmuteAllZones = () => {
    zones.forEach((z) => {
      if (z.mute) onUpdateZone(z.id, { mute: false });
    });
  };

  // Compute health tallies honestly from actual zone state
  const zoneStats = useMemo(() => {
    let normal = 0;
    let caution = 0;
    let critical = 0;
    zones.forEach((z) => {
      if (z.mute || emergencyMuted) {
        critical += 1;
      } else if (z.levelDb > 3 || z.limiterDb < -6) {
        caution += 1;
      } else {
        normal += 1;
      }
    });
    const total = Math.max(1, zones.length);
    const healthPct = Math.round((normal / total) * 100);
    const alertPct = 100 - healthPct;
    return { total: zones.length, normal, caution, critical, healthPct, alertPct };
  }, [zones, emergencyMuted]);

  const systemAlerts = useMemo(() => {
    const items: { id: string; level: 'caution' | 'critical'; title: string; detail: string }[] = [];
    if (emergencyMuted) {
      items.push({
        id: 'alert-emute',
        level: 'critical',
        title: 'Global PA Mute Engaged',
        detail: 'All sanctuary speaker zones silenced by Emergency Stop.',
      });
    }
    zones.forEach((z) => {
      if (z.mute) {
        items.push({
          id: `mute-${z.id}`,
          level: 'critical',
          title: `${z.name} Muted`,
          detail: `${z.hardwareOutput} offline · click rack card to unmute`,
        });
      } else if (z.levelDb > 3) {
        items.push({
          id: `hot-${z.id}`,
          level: 'caution',
          title: `${z.name} High Drive (+${z.levelDb.toFixed(1)} dB)`,
          detail: `High thermal output (${Math.round(54 + Math.max(0, z.levelDb) * 3)}°C est.)`,
        });
      } else if (z.role !== 'sub' && z.crossoverSlope === 'None') {
        items.push({
          id: `xover-${z.id}`,
          level: 'caution',
          title: `${z.name} Full Range`,
          detail: 'Crossover bypassed (None) · verify sub integration',
        });
      }
    });
    return items.slice(0, 4);
  }, [zones, emergencyMuted]);

  const coverageModel = useMemo(() => {
    const activeZones = zones.filter((z) => !z.mute && !emergencyMuted);
    if (zones.length === 0 || activeZones.length === 0) {
      return {
        uniformPct: 0,
        cells: Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => '#EF4444')),
      };
    }
    const avgLevel = activeZones.reduce((acc, z) => acc + z.levelDb, 0) / activeZones.length;
    const avgDelayErr =
      activeZones.reduce(
        (acc, z) => acc + Math.abs(z.delayMs - Number((z.distanceMeters * 2.915).toFixed(1))),
        0
      ) / activeZones.length;
    const avgLevelSpread =
      activeZones.reduce((acc, z) => acc + Math.abs(z.levelDb - avgLevel), 0) / activeZones.length;
    const activeRatio = activeZones.length / zones.length;
    const uniformPct = Math.max(
      12,
      Math.min(99, Math.round(activeRatio * 100 - avgDelayErr * 2.4 - avgLevelSpread * 3.1))
    );

    const rows = 4;
    const cols = 6;
    const cells: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const rowColors: string[] = [];
      for (let c = 0; c < cols; c++) {
        const px = (c + 0.5) * (100 / cols);
        const py = (r + 0.5) * (100 / rows);
        let bestCoverage = 0;
        for (const z of activeZones) {
          const dist = Math.hypot(px - z.x, py - z.y);
          const normDist = Math.max(0.1, 1 - dist / 95);
          const delayPenalty = Math.min(0.35, Math.abs(z.delayMs - z.distanceMeters * 2.915) * 0.04);
          const score = normDist * (1 - delayPenalty) * Math.max(0.35, Math.min(1.2, 1 + z.levelDb / 24));
          if (score > bestCoverage) bestCoverage = score;
        }
        rowColors.push(
          bestCoverage >= 0.65
            ? '#10B981'
            : bestCoverage >= 0.45
              ? '#84CC16'
              : bestCoverage >= 0.28
                ? '#F59E0B'
                : '#EF4444'
        );
      }
      cells.push(rowColors);
    }
    return { uniformPct, cells };
  }, [zones, emergencyMuted]);

  const stageBusMeters = useMemo(() => {
    const dbToBar = (db: number) =>
      telemetry?.isRunning && !emergencyMuted && db > -63.5
        ? Math.max(0, Math.min(100, Math.round(((db + 64) / 64) * 100)))
        : 0;
    const postL = telemetry?.postLRmsDb ?? -96;
    const postR = telemetry?.postRRmsDb ?? -96;
    const centerDb = telemetry?.postRmsDb ?? -96;
    const monZone = zones.find((z) => z.role === 'stage-monitor');
    const auxZone = zones.find((z) => z.role === 'overflow' || z.role === 'rear-fill');
    return [
      { id: 'src-l', label: 'L', levelPct: dbToBar(postL) },
      { id: 'src-r', label: 'R', levelPct: dbToBar(postR) },
      { id: 'src-c', label: 'C', levelPct: dbToBar(centerDb) },
      {
        id: 'src-mon',
        label: 'MONITOR MIX',
        levelPct: monZone?.mute ? 0 : dbToBar(centerDb + (monZone?.levelDb ?? 0)),
      },
      {
        id: 'src-aux',
        label: 'AUX MIX',
        levelPct: auxZone?.mute ? 0 : dbToBar(centerDb + (auxZone?.levelDb ?? 0)),
      },
    ];
  }, [telemetry, emergencyMuted, zones]);

  const estimatedTempC = selectedZone
    ? telemetry?.isRunning && !selectedZone.mute && !emergencyMuted
      ? Math.round(34 + Math.max(0, telemetry.postRmsDb + 60) * 0.45 + Math.max(0, selectedZone.levelDb + 6) * 1.4)
      : 24
    : 24;
  const nominalImpedance = selectedZone?.role === 'sub' ? '4.0 Ω' : '7.8 Ω';

  // Show all configured speaker zones without artificial cap
  const rackZones = zones;

  return (
    <div className="space-y-3">
      {/* Top Beveled Console Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] px-4 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.65)]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-bold text-sky-400">05</span>
              <h1 className="font-display text-lg font-semibold text-white tracking-tight">
                Intelligent Speaker Management
              </h1>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              Live Church Audio System · Acoustic Alignment (343 m/s) · LR24 / BW18 Matrix
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 font-mono text-[11px]">
          <div className="text-slate-400">
            STATUS:{' '}
            <span className={emergencyMuted ? 'text-red-400 font-semibold' : telemetry?.isRunning ? 'text-emerald-400 font-semibold' : 'text-slate-300 font-semibold'}>
              {emergencyMuted ? 'MUTED' : telemetry?.isRunning ? 'ENGINE LIVE' : 'STANDBY'}
            </span>
          </div>
          <div className="text-slate-400">
            ZONES: <span className="text-sky-300 font-semibold">{zoneStats.normal}/{zoneStats.total} LIVE</span>
          </div>
          {onScanAudioDevices && (
            <button
              type="button"
              onClick={() => void onScanAudioDevices(false)}
              className="px-2.5 py-1.5 rounded border border-slate-600 bg-slate-800/80 text-slate-200 hover:bg-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Scan Ports ({outputDevices.length})</span>
            </button>
          )}
          {onAddZone && (
            <button
              type="button"
              onClick={() => onAddZone(`Speaker Zone ${zones.length + 1}`, 'overflow')}
              className="px-2.5 py-1.5 rounded border border-sky-400/50 bg-sky-500/20 text-sky-200 hover:bg-sky-500/35 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Speaker</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleEmergencyMute ?? handleUnmuteAllZones}
            className={`px-3 py-1.5 rounded border font-semibold flex items-center gap-1.5 transition-colors ${
              emergencyMuted
                ? 'bg-red-600 border-red-300 text-white shadow-[0_0_12px_rgba(239,68,68,0.6)]'
                : 'bg-red-950/60 border-red-500/60 text-red-300 hover:bg-red-600/30'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{emergencyMuted ? 'PA STOPPED' : 'EMERGENCY STOP'}</span>
          </button>
        </div>
      </div>

      {/* Main 3-Column Dark Hardware Topology Console */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-stretch">
        {/* LEFT COLUMN (3 cols): Health Summary, Coverage Uniformity, System Overview, Alerts */}
        <div className="xl:col-span-3 flex flex-col gap-3">
          {/* ZONE HEALTH SUMMARY */}
          <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3 space-y-2.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-200">
                Zone Health Summary
              </span>
              <span className="font-mono text-[10px] text-slate-400">{zoneStats.total} ZONES</span>
            </div>

            <div className="grid grid-cols-3 gap-2 font-mono text-center bg-[#080C13] border border-slate-800 rounded p-2">
              <div>
                <div className="text-base font-bold text-white">{zoneStats.total}</div>
                <div className="text-[9px] text-emerald-400 uppercase">{zoneStats.normal} Normal</div>
              </div>
              <div>
                <div className="text-base font-bold text-amber-400">{zoneStats.caution}</div>
                <div className="text-[9px] text-slate-400 uppercase">Caution</div>
              </div>
              <div>
                <div className="text-base font-bold text-red-400">{zoneStats.critical}</div>
                <div className="text-[9px] text-slate-400 uppercase">Muted/Crit</div>
              </div>
            </div>

            {/* Dual Ring Gauges + Zone Legend */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2.5">
                {[
                  { pct: zoneStats.healthPct, color: '#10B981', label: 'OK' },
                  { pct: zoneStats.alertPct, color: '#EF4444', label: 'ALT' },
                ].map((ring) => {
                  const r = 20;
                  const c = 2 * Math.PI * r;
                  const dash = (ring.pct / 100) * c;
                  return (
                    <div key={ring.label} className="relative w-12 h-12 flex items-center justify-center">
                      <svg viewBox="0 0 52 52" className="w-12 h-12 -rotate-90">
                        <circle cx={26} cy={26} r={r} fill="none" stroke="#1E293B" strokeWidth={5} />
                        <circle
                          cx={26}
                          cy={26}
                          r={r}
                          fill="none"
                          stroke={ring.color}
                          strokeWidth={5}
                          strokeDasharray={`${dash} ${c}`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <span className="absolute font-mono text-[10px] font-bold text-white">
                        {ring.pct}%
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-0.5 font-mono text-[10px] flex-1 min-w-0">
                {zones.slice(0, 5).map((z) => (
                  <div key={z.id} className="flex items-center gap-1.5 truncate text-slate-300">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        z.mute || emergencyMuted
                          ? 'bg-red-500'
                          : z.levelDb > 3
                            ? 'bg-amber-400'
                            : 'bg-emerald-400'
                      }`}
                    />
                    <span className="truncate">{z.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* COVERAGE UNIFORMITY HEATMAP */}
          <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-200">
                Coverage Uniformity
              </span>
              <span className="font-mono text-[10px] text-emerald-400">±2.5 dB Target</span>
            </div>

            <div className="bg-[#070A10] border border-slate-800 rounded p-2 space-y-1.5">
              <div className="grid grid-cols-6 gap-1">
                {coverageModel.cells.map((row, rIdx) =>
                  row.map((bg, cIdx) => (
                    <div
                      key={`${rIdx}-${cIdx}`}
                      className="h-3.5 rounded-[2px] opacity-85"
                      style={{ backgroundColor: bg }}
                    />
                  ))
                )}
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-slate-400 pt-1">
                <span>{coverageModel.uniformPct}% Uniform</span>
                <span className="text-emerald-400">● Strong</span>
                <span className="text-amber-400">● Edge</span>
                <span className="text-red-400">● Null/Off</span>
              </div>
            </div>
          </div>

          {/* SYSTEM OVERVIEW TABLE */}
          <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3 space-y-2 flex-1">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-200 border-b border-slate-800 pb-1.5">
              System Overview
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
              {zones.map((z) => {
                const isSel = z.id === selectedId;
                const liveLevelDb = (telemetry?.postRmsDb ?? -96) + z.levelDb;
                const sigBars =
                  !telemetry?.isRunning || z.mute || emergencyMuted || liveLevelDb <= -63.5
                    ? 0
                    : Math.min(5, Math.max(1, Math.round(((liveLevelDb + 64) / 64) * 5)));
                const thermBars =
                  !telemetry?.isRunning || z.mute || emergencyMuted
                    ? 0
                    : Math.min(5, Math.max(1, Math.round((z.levelDb + 16) / 5)));
                return (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => setSelectedId(z.id)}
                    className={`w-full px-2 py-1.5 rounded text-left font-mono text-[10px] flex items-center justify-between gap-2 transition-colors ${
                      isSel
                        ? 'bg-sky-500/15 border border-sky-500/40 text-white'
                        : 'bg-[#080C13] border border-transparent hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate w-28">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          z.mute || emergencyMuted
                            ? 'bg-red-500'
                            : z.levelDb > 3
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'
                        }`}
                      />
                      <span className="truncate">{z.name}</span>
                    </span>
                    <span className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className={`w-1.5 h-2 rounded-[1px] ${
                            n <= sigBars ? 'bg-emerald-400' : 'bg-slate-800'
                          }`}
                        />
                      ))}
                    </span>
                    <span className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className={`w-1.5 h-2 rounded-[1px] ${
                            n <= thermBars
                              ? thermBars >= 4
                                ? 'bg-amber-400'
                                : 'bg-sky-400'
                              : 'bg-slate-800'
                          }`}
                        />
                      ))}
                    </span>
                    <span className="text-[9px] text-slate-400 w-12 text-right truncate">
                      {z.delayMs.toFixed(1)}ms
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SYSTEM ALERTS */}
          <div className="rounded-lg border border-slate-800 bg-[#0D1119] p-3 space-y-2">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-200">
              System Alerts
            </div>
            {systemAlerts.length === 0 ? (
              <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/30 font-mono text-[11px] text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>All speaker arrays nominal.</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {systemAlerts.map((a) => (
                  <div
                    key={a.id}
                    className={`p-2 rounded border font-mono text-[10px] flex items-start gap-2 ${
                      a.level === 'critical'
                        ? 'bg-red-950/50 border-red-500/40 text-red-200'
                        : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">{a.title}</div>
                      <div className="text-[9px] opacity-80">{a.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* CENTER COLUMN (6 cols): STAGE-TO-ROOM SPEAKER TOPOLOGY */}
        <div className="xl:col-span-6 rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-white">
              Stage-to-Room Speaker Topology
            </span>
            <div className="flex items-center gap-1 font-mono text-[10px]">
              {(['live', 'signal', 'system'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTopologyTab(t)}
                  className={`px-2 py-0.5 rounded uppercase border ${
                    topologyTab === t
                      ? 'border-sky-400 bg-sky-500/20 text-sky-300'
                      : 'border-slate-800 bg-[#090D14] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* STAGE SOURCES */}
          <div className="space-y-1.5">
            <div className="font-mono text-[10px] text-slate-400 uppercase tracking-wider">
              Stage Sources
            </div>
            <div className="grid grid-cols-5 gap-2">
              {stageBusMeters.map((src) => (
                <div
                  key={src.id}
                  className="rounded border border-slate-700/80 bg-gradient-to-b from-[#171E2C] to-[#0D121B] p-2 space-y-1.5"
                >
                  <div className="font-mono text-[10px] font-semibold text-slate-200 text-center truncate">
                    {src.label}
                  </div>
                  <div className="h-5 rounded bg-[#070A10] border border-slate-800 px-1.5 flex items-center justify-between gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${src.levelPct > 0 ? 'bg-sky-400' : 'bg-slate-700'}`} />
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-xs overflow-hidden">
                      <div
                        className="h-full bg-sky-400 transition-[width] duration-75"
                        style={{
                          width: `${src.levelPct}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ILLUMINATED MAIN ARRAYS & CENTER CLUSTER SVG TOPOLOGY */}
          <div className="relative rounded-lg border border-slate-800 bg-[#070A10] p-3 overflow-hidden">
            <div className="font-mono text-[10px] text-slate-400 uppercase tracking-wider mb-1">
              Main Arrays (Click cabinet to inspect &amp; tune)
            </div>
            <svg viewBox="0 0 640 215" className="w-full h-52 select-none">
              <defs>
                <filter id="blueGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Glowing cyan signal routing paths from Stage Sources -> Main Arrays -> Rack Bays */}
              <g stroke="#38BDF8" strokeWidth={1.6} fill="none" opacity={emergencyMuted ? 0.25 : 0.85} filter="url(#blueGlow)">
                <path d="M 80 0 L 80 35 L 165 55" />
                <path d="M 200 0 L 200 28 L 285 45" />
                <path d="M 320 0 L 320 45" />
                <path d="M 440 0 L 440 28 L 355 45" />
                <path d="M 560 0 L 560 35 L 475 55" />
                {/* Horizontal interconnect */}
                <path d="M 225 108 L 278 108" />
                <path d="M 362 108 L 415 108" />
                {/* Bottom feeder trunks to 6 Array/Fill Racks */}
                <path d="M 155 162 L 155 182 L 55 182 L 55 215" />
                <path d="M 185 162 L 185 190 L 162 190 L 162 215" />
                <path d="M 300 168 L 300 195 L 268 195 L 268 215" />
                <path d="M 340 168 L 340 195 L 372 195 L 372 215" />
                <path d="M 455 162 L 455 190 L 478 190 L 478 215" />
                <path d="M 485 162 L 485 182 L 585 182 L 585 215" />
              </g>

              {/* LEFT LINE ARRAY CABINETS */}
              <g
                transform="translate(145, 95) rotate(-14)"
                className="cursor-pointer"
                onClick={() => zones[0] && setSelectedId(zones[0].id)}
              >
                {[-36, -12, 12, 36].map((dy, idx) => (
                  <g key={idx}>
                    <rect
                      x={-58}
                      y={dy - 10}
                      width={116}
                      height={20}
                      rx={3}
                      fill="#161D2A"
                      stroke={selectedId === zones[0]?.id ? '#38BDF8' : '#334155'}
                      strokeWidth={1.6}
                    />
                    <rect x={-48} y={dy - 6} width={34} height={12} rx={1.5} fill="#090D14" />
                    <rect x={-8} y={dy - 6} width={16} height={12} rx={1.5} fill="#0B1220" stroke="#1E293B" />
                    <rect x={14} y={dy - 6} width={34} height={12} rx={1.5} fill="#090D14" />
                    <circle cx={42} cy={dy} r={2} fill={zones[0]?.mute || emergencyMuted ? '#EF4444' : '#38BDF8'} />
                  </g>
                ))}
                <text x={0} y={62} fill="#CBD5E1" fontSize="10" fontFamily="JetBrains Mono" textAnchor="middle">
                  MAIN ARRAY L
                </text>
              </g>

              {/* CENTER SUB / CLUSTER MODULE */}
              <g
                transform="translate(320, 108)"
                className="cursor-pointer"
                onClick={() => zones[2] && setSelectedId(zones[2].id)}
              >
                <rect
                  x={-42}
                  y={-54}
                  width={84}
                  height={108}
                  rx={4}
                  fill="#151C28"
                  stroke={selectedId === zones[2]?.id ? '#38BDF8' : '#334155'}
                  strokeWidth={1.8}
                />
                {[-34, 0, 34].map((cy, idx) => (
                  <g key={idx}>
                    <circle cx={-22} cy={cy} r={10} fill="#080B10" stroke="#334155" />
                    <circle cx={22} cy={cy} r={10} fill="#080B10" stroke="#334155" />
                    <rect x={-9} y={cy - 11} width={18} height={22} rx={2} fill="#0D131D" stroke="#334155" />
                    <text x={0} y={cy + 3.5} fill="#E2E8F0" fontSize="10" fontWeight="700" fontFamily="JetBrains Mono" textAnchor="middle">
                      C
                    </text>
                  </g>
                ))}
              </g>

              {/* RIGHT LINE ARRAY CABINETS */}
              <g
                transform="translate(495, 95) rotate(14)"
                className="cursor-pointer"
                onClick={() => zones[1] && setSelectedId(zones[1].id)}
              >
                {[-36, -12, 12, 36].map((dy, idx) => (
                  <g key={idx}>
                    <rect
                      x={-58}
                      y={dy - 10}
                      width={116}
                      height={20}
                      rx={3}
                      fill="#161D2A"
                      stroke={selectedId === zones[1]?.id ? '#38BDF8' : '#334155'}
                      strokeWidth={1.6}
                    />
                    <rect x={-48} y={dy - 6} width={34} height={12} rx={1.5} fill="#090D14" />
                    <rect x={-8} y={dy - 6} width={16} height={12} rx={1.5} fill="#0B1220" stroke="#1E293B" />
                    <rect x={14} y={dy - 6} width={34} height={12} rx={1.5} fill="#090D14" />
                    <circle cx={-42} cy={dy} r={2} fill={zones[1]?.mute || emergencyMuted ? '#EF4444' : '#38BDF8'} />
                  </g>
                ))}
                <text x={0} y={62} fill="#CBD5E1" fontSize="10" fontFamily="JetBrains Mono" textAnchor="middle">
                  MAIN ARRAY R
                </text>
              </g>
            </svg>
          </div>

          {/* 6 HARDWARE AMPLIFIER / ZONE RACKS */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {rackZones.map((z) => {
              const isSel = z.id === selectedId;
              const isMuted = z.mute || emergencyMuted;
              const isCaution = !isMuted && z.levelDb > 3;
              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setSelectedId(z.id)}
                  className={`p-2 rounded border text-left transition-all flex flex-col justify-between gap-2 ${
                    isSel
                      ? 'border-sky-400 bg-[#141E2F] shadow-[0_0_12px_rgba(56,189,248,0.22)]'
                      : 'border-slate-800 bg-[#111723] hover:border-slate-600'
                  }`}
                >
                  <div className="font-mono text-[10px] font-semibold text-white truncate text-center">
                    {z.name}
                  </div>
                  <div className="h-7 rounded bg-[#070A10] border border-slate-800 px-1.5 flex items-center justify-between">
                    <span className="font-mono text-[9px] text-slate-400">
                      {z.levelDb > 0 ? `+${z.levelDb}` : z.levelDb}dB
                    </span>
                    <span className="font-mono text-[9px] text-sky-400">{z.delayMs.toFixed(1)}m</span>
                  </div>
                  <div className="flex items-center justify-center gap-1.5 font-mono text-[9px]">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isMuted ? 'bg-red-500' : isCaution ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                    />
                    <span className={isMuted ? 'text-red-300' : isCaution ? 'text-amber-300' : 'text-emerald-300'}>
                      {isMuted ? 'Muted' : isCaution ? 'Caution' : 'Normal'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* DISTRIBUTED ZONES */}
          <div className="space-y-1.5">
            <div className="font-mono text-[10px] text-slate-400 uppercase tracking-wider">
              Distributed Zones (Click to Toggle Mute)
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {DISTRIBUTED_ZONES.map((dz) => {
                const isMuted = Boolean(distributedMutes[dz.id]) || emergencyMuted;
                return (
                  <button
                    key={dz.id}
                    type="button"
                    onClick={() =>
                      setDistributedMutes((prev) => ({ ...prev, [dz.id]: !prev[dz.id] }))
                    }
                    className="p-2 rounded border border-slate-800 bg-[#111723] hover:border-slate-600 flex flex-col items-center gap-1.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isMuted
                            ? 'bg-red-500'
                            : telemetry?.isRunning
                              ? 'bg-emerald-400'
                              : 'bg-slate-600'
                        }`}
                      />
                      <span className="w-2 h-2 rounded-full bg-slate-700" />
                    </div>
                    <span className="font-mono text-[9px] font-semibold text-slate-200 tracking-wide">
                      {dz.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom Hardware Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 font-mono text-[10px]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAlignAllDelays}
                className="px-2.5 py-1 rounded border border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 font-semibold"
              >
                ALIGN ALL DELAYS (343 m/s)
              </button>
              <button
                type="button"
                onClick={handleUnmuteAllZones}
                className="px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 font-semibold"
              >
                UNMUTE ALL ZONES
              </button>
            </div>
            <span className="text-slate-400 flex items-center gap-1.5">
              <Sliders className="w-3 h-3 text-sky-400" />
              <span>Click any array or rack box to edit DSP parameters</span>
            </span>
          </div>
        </div>

        {/* RIGHT COLUMN (3 cols): SELECTED SPEAKER CONTROLS */}
        {selectedZone && (
          <div className="xl:col-span-3 rounded-lg border border-slate-800 bg-[#0D1119] p-3.5 flex flex-col justify-between gap-3">
            <div className="space-y-2 border-b border-slate-800 pb-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-200">
                  Selected Speaker Controls
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateZone(selectedZone.id, { mute: !selectedZone.mute })}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold border ${
                    selectedZone.mute
                      ? 'border-red-500 bg-red-600/30 text-red-200'
                      : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                  }`}
                >
                  {selectedZone.mute ? 'MUTED' : 'ACTIVE'}
                </button>
              </div>

              <div className="p-2.5 rounded bg-[#080C13] border border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-bold text-white truncate">
                      {selectedZone.name.toUpperCase()}
                    </div>
                    <div className="font-mono text-[10px] text-sky-400 truncate">
                      {selectedZone.hardwareOutputId
                        ? outputDevices.find((d) => d.deviceId === selectedZone.hardwareOutputId)?.label || selectedZone.hardwareOutput
                        : outputDevices[0]?.label || 'System Default Output'}
                    </div>
                  </div>
                  <SegmentedLedMeter
                    levelDb={
                      selectedZone.mute || emergencyMuted || !telemetry?.isRunning
                        ? -96
                        : Math.max(-56, telemetry.postRmsDb + selectedZone.levelDb)
                    }
                    peakDb={selectedZone.limiterDb}
                    muted={selectedZone.mute || emergencyMuted}
                    height={38}
                    segments={8}
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                  <select
                    aria-label="Speaker Role"
                    value={selectedZone.role}
                    onChange={(e) =>
                      onUpdateZone(selectedZone.id, { role: e.target.value as SpeakerZone['role'] })
                    }
                    className="bg-[#0D121F] border border-slate-700 rounded px-1.5 py-1 text-slate-200"
                  >
                    <option value="main-lr">Front Main L/R</option>
                    <option value="rear-fill">Rear Fill</option>
                    <option value="sub">Subwoofer</option>
                    <option value="center">Center</option>
                    <option value="stage-monitor">Stage Monitor</option>
                    <option value="overflow">Overflow / Aux</option>
                  </select>
                  <select
                    aria-label="Assigned System Output Port"
                    value={selectedZone.hardwareOutputId ?? ''}
                    onChange={(e) => {
                      const devId = e.target.value;
                      const dev = outputDevices.find((d) => d.deviceId === devId);
                      onUpdateZone(selectedZone.id, {
                        hardwareOutputId: devId || undefined,
                        hardwareOutput: dev?.label || (devId ? devId : 'System Default'),
                      });
                    }}
                    className="bg-[#0D121F] border border-slate-700 rounded px-1.5 py-1 text-sky-200"
                  >
                    <option value="">System Default</option>
                    {outputDevices.map((d, idx) => (
                      <option key={`${d.deviceId}-${idx}`} value={d.deviceId}>
                        {d.label || `Output Port ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
                {onRemoveZone && zones.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = zones.find((z) => z.id !== selectedZone.id);
                      onRemoveZone(selectedZone.id);
                      if (next) setSelectedId(next.id);
                    }}
                    className="w-full py-1 rounded border border-rose-500/40 bg-rose-950/30 text-rose-300 hover:bg-rose-900/40 font-mono text-[10px]"
                  >
                    Remove Speaker Zone
                  </button>
                )}
              </div>
            </div>

            {/* Level Slider */}
            <div className="space-y-1">
              <div className="flex justify-between font-mono text-[11px]">
                <span className="text-slate-300">Level</span>
                <span className="text-sky-300 font-semibold">
                  {selectedZone.levelDb > 0 ? `+${selectedZone.levelDb.toFixed(1)}` : selectedZone.levelDb.toFixed(1)} dB
                </span>
              </div>
              <input
                type="range"
                min={-24}
                max={6}
                step={0.5}
                value={selectedZone.levelDb}
                onChange={(e) => onUpdateZone(selectedZone.id, { levelDb: Number(e.target.value) })}
                className="w-full studio-slider"
              />
            </div>

            {/* Delay Alignment + Tap Grid */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-mono text-[11px]">
                <span className="text-slate-300">Delay ({selectedZone.distanceMeters} m)</span>
                <span className="text-amber-300 font-semibold">{selectedZone.delayMs.toFixed(1)} ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={45}
                step={0.5}
                value={selectedZone.distanceMeters}
                onChange={(e) => handleDistanceChange(selectedZone.id, Number(e.target.value))}
                className="w-full studio-slider"
              />
            </div>

            {/* Crossover Frequency + Mini Transfer Curve */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center font-mono text-[11px]">
                <span className="text-slate-300">Crossover ({selectedZone.crossoverSlope})</span>
                <span className="text-sky-300 font-semibold">{selectedZone.crossoverHz} Hz</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={40}
                  max={250}
                  step={5}
                  value={selectedZone.crossoverHz}
                  onChange={(e) => onUpdateZone(selectedZone.id, { crossoverHz: Number(e.target.value) })}
                  className="flex-1 studio-slider"
                />
                <select
                  value={selectedZone.crossoverSlope}
                  onChange={(e) =>
                    onUpdateZone(selectedZone.id, {
                      crossoverSlope: e.target.value as SpeakerZone['crossoverSlope'],
                    })
                  }
                  className="px-1.5 py-0.5 rounded border border-slate-700 bg-[#070A10] text-slate-200 font-mono text-[10px]"
                >
                  <option value="LR24">LR24</option>
                  <option value="BW18">BW18</option>
                  <option value="None">Full</option>
                </select>
              </div>
              <div className="rounded bg-[#070A10] border border-slate-800 p-1.5">
                <svg viewBox="0 0 260 54" className="w-full h-12">
                  {(() => {
                    const minL = Math.log10(25);
                    const maxL = Math.log10(600);
                    const order = selectedZone.crossoverSlope === 'LR24' ? 4 : selectedZone.crossoverSlope === 'BW18' ? 3 : 0;
                    const fc = Math.max(40, selectedZone.crossoverHz);
                    const ptsHp: string[] = [];
                    const ptsLp: string[] = [];
                    for (let i = 0; i <= 40; i++) {
                      const f = Math.pow(10, minL + (i / 40) * (maxL - minL));
                      const x = (i / 40) * 260;
                      const hpDb = order === 0 ? 0 : -10 * Math.log10(1 + Math.pow(fc / f, 2 * order));
                      const lpDb = order === 0 ? -24 : -10 * Math.log10(1 + Math.pow(f / fc, 2 * order));
                      ptsHp.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${(8 + (Math.min(24, Math.max(0, -hpDb)) / 24) * 38).toFixed(1)}`);
                      ptsLp.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${(8 + (Math.min(24, Math.max(0, -lpDb)) / 24) * 38).toFixed(1)}`);
                    }
                    const fcX = ((Math.log10(fc) - minL) / (maxL - minL)) * 260;
                    return (
                      <>
                        <line x1={fcX} y1={4} x2={fcX} y2={50} stroke="rgba(245,158,11,0.45)" strokeDasharray="3 2" />
                        <path d={ptsLp.join(' ')} fill="none" stroke="#F59E0B" strokeWidth={1.4} opacity={0.75} />
                        <path d={ptsHp.join(' ')} fill="none" stroke="#10B981" strokeWidth={2} />
                      </>
                    );
                  })()}
                </svg>
              </div>
            </div>

            {/* Polarity Rocker + Limiter */}
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="text-slate-300">Polarity</span>
              <div className="flex rounded border border-slate-700 overflow-hidden text-[10px]">
                <button
                  type="button"
                  onClick={() => onUpdateZone(selectedZone.id, { polarityInverted: false })}
                  className={`px-2.5 py-1 ${!selectedZone.polarityInverted ? 'bg-sky-600 text-white font-semibold' : 'bg-[#070A10] text-slate-400'}`}
                >
                  Normal
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateZone(selectedZone.id, { polarityInverted: true })}
                  className={`px-2.5 py-1 ${selectedZone.polarityInverted ? 'bg-amber-600 text-white font-semibold' : 'bg-[#070A10] text-slate-400'}`}
                >
                  Inverted
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between font-mono text-[11px]">
                <span className="text-slate-300">Limiter Threshold</span>
                <span className="text-red-300 font-semibold">{selectedZone.limiterDb.toFixed(1)} dB</span>
              </div>
              <input
                type="range"
                min={-12}
                max={0}
                step={0.5}
                value={selectedZone.limiterDb}
                onChange={(e) => onUpdateZone(selectedZone.id, { limiterDb: Number(e.target.value) })}
                className="w-full studio-slider"
              />
            </div>

            {/* Thermal Load & Impedance */}
            <div className="space-y-2 pt-1 border-t border-slate-800 font-mono text-[11px]">
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Thermal Load</span>
                  <span className={estimatedTempC > 68 ? 'text-amber-400 font-semibold' : 'text-sky-300'}>
                    {estimatedTempC}°C
                  </span>
                </div>
                <div className="h-2 rounded-xs bg-[#070A10] border border-slate-800 overflow-hidden">
                  <div
                    className={`h-full ${estimatedTempC > 68 ? 'bg-amber-400' : 'bg-sky-400'}`}
                    style={{ width: `${Math.min(100, estimatedTempC)}%` }}
                  />
                </div>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Impedance Load</span>
                <span className="text-slate-200 font-semibold">{nominalImpedance}</span>
              </div>
            </div>

            {/* Fault Protection Checklist */}
            <div className="p-2.5 rounded bg-[#080C13] border border-slate-800 space-y-1 font-mono text-[10px]">
              <div className="text-slate-400 uppercase mb-1">Fault Protection</div>
              {[
                'Overcurrent Protection',
                'Overheat Protection',
                'Short Circuit Protection',
                'Signal Loss Protection',
              ].map((item) => (
                <div key={item} className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Hidden rotary trim bar for floor coordinates (accessible without cluttering main view) */}
      {selectedZone && (
        <div className="rounded-lg border border-slate-800 bg-[#0D1119] px-3.5 py-2 flex flex-wrap items-center justify-between gap-3 font-mono text-[10px]">
          <span className="text-slate-400">
            SELECTED ARRAY GEOMETRY ({selectedZone.name}): X={selectedZone.x}% · Y={selectedZone.y}% · Dispersion {selectedZone.dispersionDeg}°
          </span>
          <div className="flex items-center gap-3">
            <RotaryKnob
              label="X POS"
              value={selectedZone.x}
              min={5}
              max={95}
              step={1}
              defaultValue={50}
              unit="%"
              size={34}
              accent="sky"
              onChange={(next) => onUpdateZone(selectedZone.id, { x: next })}
            />
            <RotaryKnob
              label="Y POS"
              value={selectedZone.y}
              min={5}
              max={95}
              step={1}
              defaultValue={50}
              unit="%"
              size={34}
              accent="emerald"
              onChange={(next) => onUpdateZone(selectedZone.id, { y: next })}
            />
          </div>
        </div>
      )}
    </div>
  );
};
