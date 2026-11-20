import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sliders,
  Activity,
  AudioWaveform,
  Radio,
  MapPin,
  Mic,
  Music,
  Video,
  CheckSquare,
  Layers,
  Sparkles,
  Cpu,
  Zap,
  Cable,
  PanelLeftClose,
  PanelLeftOpen,
  PanelLeft,
  PanelRight,
  PanelTop,
  PanelBottom,
  LayoutGrid,
  ChevronDown,
  X,
} from 'lucide-react';
import type { ModuleId, NavDockPosition, SignalTelemetry } from '../types/audio.ts';

interface SidebarProps {
  activeModule: ModuleId;
  onSelectModule: (mod: ModuleId) => void;
  telemetry: SignalTelemetry;
  pendingFindingsCount: number;
  dockPosition: NavDockPosition;
  onChangeDockPosition: (pos: NavDockPosition) => void;
}

interface NavItem {
  id: ModuleId;
  num: string;
  title: string;
  icon: React.FC<{ className?: string }>;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'mix',
    label: 'Mix & DSP',
    items: [
      { id: 'console', num: '01', title: 'Live Sound Console', icon: Sliders },
      { id: 'dsp', num: '02', title: 'Audio DSP Engine', icon: AudioWaveform },
      { id: 'feedback', num: '03', title: 'Feedback Detection', icon: Activity },
      { id: 'acoustics', num: '04', title: 'Acoustic & Room Analyzer', icon: Radio },
      { id: 'speakers', num: '05', title: 'Speaker Management', icon: MapPin },
    ],
  },
  {
    id: 'stage',
    label: 'Stage & Sources',
    items: [
      { id: 'microphones', num: '06', title: 'Microphone Intelligence', icon: Mic },
      { id: 'instruments', num: '07', title: 'Instrument & Music', icon: Music },
      { id: 'virtual-di', num: '13', title: 'Virtual DI & Bass', icon: Zap },
    ],
  },
  {
    id: 'ops',
    label: 'Broadcast & Service',
    items: [
      { id: 'livestream', num: '08', title: 'Livestream Studio', icon: Video },
      { id: 'soundcheck', num: '09', title: 'Automated Sound Check', icon: CheckSquare },
      { id: 'presets', num: '10', title: 'Presets & Service Profiles', icon: Layers },
    ],
  },
  {
    id: 'sys',
    label: 'AI & System',
    items: [
      { id: 'ai-engineer', num: '11', title: 'AI Sound Engineer', icon: Sparkles },
      { id: 'hardware', num: '12', title: 'Diagnostics & Hardware', icon: Cpu },
      { id: 'midi', num: 'IO', title: 'MIDI & Key Shortcuts', icon: Cable },
    ],
  },
];

const DOCK_OPTIONS: {
  id: NavDockPosition;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'top', label: 'Dock Top Navigation Bar', icon: PanelTop },
  { id: 'bottom', label: 'Dock Bottom Console Bar', icon: PanelBottom },
  { id: 'left', label: 'Dock Left Sidebar', icon: PanelLeft },
  { id: 'right', label: 'Dock Right Sidebar', icon: PanelRight },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  onSelectModule,
  telemetry,
  pendingFindingsCount,
  dockPosition,
  onChangeDockPosition,
}) => {
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const lastModuleByGroupRef = useRef<Record<string, ModuleId>>({
    mix: 'console',
    stage: 'microphones',
    ops: 'livestream',
    sys: 'ai-engineer',
  });

  const isHorizontal = dockPosition === 'top' || dockPosition === 'bottom';
  const isExpanded = pinnedOpen || hovered;

  const activeGroup = useMemo(
    () =>
      NAV_GROUPS.find((g) => g.items.some((item) => item.id === activeModule)) ?? NAV_GROUPS[0],
    [activeModule]
  );

  useEffect(() => {
    lastModuleByGroupRef.current[activeGroup.id] = activeModule;
  }, [activeGroup.id, activeModule]);

  useEffect(() => {
    if (!directoryOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDirectoryOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [directoryOpen]);

  const handleSelectModule = (mod: ModuleId) => {
    onSelectModule(mod);
    setDirectoryOpen(false);
    if (!pinnedOpen) {
      setHovered(false);
    }
  };

  const handleSelectGroup = (group: NavGroup) => {
    const remembered = lastModuleByGroupRef.current[group.id];
    const target =
      group.items.find((i) => i.id === remembered)?.id ?? group.items[0].id;
    onSelectModule(target);
    setDirectoryOpen(false);
  };

  const getAlertCount = (id: ModuleId) => {
    if (id === 'ai-engineer' && pendingFindingsCount > 0) return pendingFindingsCount;
    if (id === 'feedback' && (telemetry.feedbackRisk.detected || telemetry.humRisk.detected)) return 1;
    return 0;
  };

  const getGroupAlertCount = (group: NavGroup) =>
    group.items.reduce((sum, item) => sum + getAlertCount(item.id), 0);

  const renderDockAllocator = () => (
    <div
      className="flex items-center gap-0.5 p-0.5 rounded border console-nav-pill"
      role="group"
      aria-label="Navigation Dock Position"
    >
      {DOCK_OPTIONS.map((opt) => {
        const DockIcon = opt.icon;
        const selected = dockPosition === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              setDirectoryOpen(false);
              onChangeDockPosition(opt.id);
            }}
            title={opt.label}
            aria-label={opt.label}
            aria-pressed={selected}
            data-active={selected ? 'true' : 'false'}
            className="p-1 rounded-xs console-nav-cat"
          >
            <DockIcon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );

  /* ==========================================================================
     Horizontal 2-Tier Architectural Navigation Bar (Top Default or Bottom)
     Tier 1: 4 Spacious Domain Banks + All-14 Directory Trigger + Dock Allocator
     Tier 2: Active Domain Module Tabs (3–5 full-title tabs, zero wrapping/hiding)
     ========================================================================== */
  if (isHorizontal) {
    const borderClass = dockPosition === 'top' ? 'border-b' : 'border-t';
    const isBottom = dockPosition === 'bottom';

    const tier1Bar = (
      <div className="px-4 py-1.5 flex items-center justify-between gap-3">
        {/* 4 Spacious Primary Domain Banks */}
        <nav
          aria-label="Console Domains"
          className="flex items-center gap-1.5 min-w-0 flex-wrap"
        >
          {NAV_GROUPS.map((group) => {
            const selected = activeGroup.id === group.id;
            const groupAlerts = getGroupAlertCount(group);
            return (
              <button
                key={group.id}
                type="button"
                data-active={selected ? 'true' : 'false'}
                onClick={() => handleSelectGroup(group)}
                className="console-nav-cat h-8 px-3 rounded-md text-xs font-display font-semibold tracking-tight flex items-center gap-2 whitespace-nowrap"
              >
                <span>{group.label}</span>
                <span className="console-nav-num font-mono text-[10px] opacity-85">
                  {group.items.length}
                </span>
                {groupAlerts > 0 && (
                  <span className="px-1.5 py-0.2 rounded-xs bg-amber-500 text-slate-950 font-mono text-[9px] font-bold">
                    {groupAlerts}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right Utility Controls: All Modules Matrix + Engine Status + Dock Allocator */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-active={directoryOpen ? 'true' : 'false'}
            onClick={() => setDirectoryOpen((v) => !v)}
            aria-expanded={directoryOpen}
            className="console-nav-pill h-8 px-2.5 rounded-md font-mono text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>ALL 14 CONSOLES</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-150 ${
                directoryOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          <div className="hidden xl:flex items-center gap-1.5 h-8 px-2.5 rounded-md console-nav-pill font-mono text-[11px]">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                telemetry.isRunning ? 'bg-emerald-400 shadow-[0_0_6px_#10B981]' : 'bg-slate-500'
              }`}
            />
            <span className="font-semibold">
              {telemetry.isRunning ? `${telemetry.postRmsDb.toFixed(1)} dBFS` : 'STANDBY'}
            </span>
          </div>

          {renderDockAllocator()}
        </div>
      </div>
    );

    const tier2SubBar = (
      <div
        className={`console-nav-subbar px-4 flex items-center justify-between gap-3 ${
          isBottom ? 'border-b' : 'border-t'
        }`}
      >
        <nav
          aria-label={`${activeGroup.label} Modules`}
          className="flex items-center gap-1 overflow-x-auto"
        >
          {activeGroup.items.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;
            const alertCount = getAlertCount(item.id);
            return (
              <button
                key={item.id}
                type="button"
                data-active={active ? 'true' : 'false'}
                onClick={() => handleSelectModule(item.id)}
                aria-current={active ? 'page' : undefined}
                className="console-nav-tab h-9 px-3 text-xs font-medium flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <span className="console-nav-num font-mono text-[10px] font-bold tabular-nums">
                  {item.num}
                </span>
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.title}</span>
                {alertCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-xs bg-amber-500 text-slate-950 font-mono text-[9px] font-bold">
                    {alertCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <span className="hidden lg:inline font-mono text-[10px] console-nav-muted uppercase tracking-wider shrink-0">
          {activeGroup.label} · {activeGroup.items.length} Consoles
        </span>
      </div>
    );

    return (
      <aside
        aria-label="Console Navigation Bar"
        data-dock={dockPosition}
        className={`relative w-full shrink-0 ${borderClass} console-nav-shell flex flex-col z-30`}
      >
        {isBottom ? (
          <>
            {tier2SubBar}
            {tier1Bar}
          </>
        ) : (
          <>
            {tier1Bar}
            {tier2SubBar}
          </>
        )}

        {/* Structured All-14 Console Directory Popover (On-demand, zero clutter at rest) */}
        {directoryOpen && (
          <div
            className={`absolute left-0 right-0 ${
              isBottom ? 'bottom-full border-t' : 'top-full border-b'
            } console-nav-shell border-x-0 shadow-2xl px-4 py-3.5 z-40`}
          >
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider console-nav-text">
                Complete Console Directory · All 14 Modules
              </span>
              <button
                type="button"
                onClick={() => setDirectoryOpen(false)}
                className="console-nav-pill px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                <span>ESC</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {NAV_GROUPS.map((group) => (
                <div
                  key={group.id}
                  className="console-nav-subbar rounded-md border p-2.5 space-y-1.5"
                >
                  <div className="font-mono text-[10px] uppercase tracking-wider font-semibold console-nav-muted px-1">
                    {group.label}
                  </div>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = activeModule === item.id;
                      const alertCount = getAlertCount(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-active={active ? 'true' : 'false'}
                          onClick={() => handleSelectModule(item.id)}
                          className="console-nav-cat w-full px-2.5 py-1.5 rounded text-xs font-medium flex items-center justify-between gap-2"
                        >
                          <span className="flex items-center gap-2 truncate">
                            <span className="console-nav-num font-mono text-[10px] font-bold w-4 shrink-0">
                              {item.num}
                            </span>
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{item.title}</span>
                          </span>
                          {alertCount > 0 && (
                            <span className="px-1.5 rounded-xs bg-amber-500 text-slate-950 font-mono text-[9px] font-bold shrink-0">
                              {alertCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    );
  }

  /* ==========================================================================
     Vertical Auto-Collapsing Console Sidebar (Left or Right Dock)
     Shares the same high-contrast contrasting Navigation Dock palette
     ========================================================================== */
  const sideBorderClass = dockPosition === 'right' ? 'border-l' : 'border-r';

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="Console Navigation Sidebar"
      data-dock={dockPosition}
      className={`${
        isExpanded ? 'w-64' : 'w-14'
      } h-full shrink-0 ${sideBorderClass} console-nav-shell flex flex-col justify-between overflow-y-auto overflow-x-hidden transition-[width] duration-200 ease-out`}
    >
      <div>
        {/* Auto-Collapse / Pin Toggle & Dock Allocator Bar */}
        <div
          className={`flex items-center border-b px-2 py-2 gap-1.5 ${
            isExpanded ? 'justify-between' : 'justify-center'
          }`}
          style={{ borderColor: 'var(--nav-border)' }}
        >
          {isExpanded && renderDockAllocator()}
          <button
            type="button"
            onClick={() => setPinnedOpen((p) => !p)}
            title={pinnedOpen ? 'Enable Auto-Collapse Sidebar' : 'Pin Sidebar Open'}
            aria-label={pinnedOpen ? 'Enable Auto-Collapse Sidebar' : 'Pin Sidebar Open'}
            data-active={pinnedOpen ? 'true' : 'false'}
            className="console-nav-pill p-1 rounded flex items-center gap-1"
          >
            {pinnedOpen ? (
              <PanelLeftClose className="w-3.5 h-3.5" />
            ) : (
              <PanelLeftOpen className="w-3.5 h-3.5" />
            )}
            {isExpanded && (
              <span className="font-mono text-[9px] uppercase tracking-wider pr-0.5">
                {pinnedOpen ? 'PINNED' : 'AUTO'}
              </span>
            )}
          </button>
        </div>

        <div className={isExpanded ? 'p-3 space-y-4' : 'p-1.5 space-y-3'}>
          {NAV_GROUPS.map((group) => (
            <div key={group.id}>
              {isExpanded ? (
                <div className="px-2.5 mb-1 font-mono text-[10px] uppercase tracking-wider font-semibold console-nav-muted">
                  {group.label}
                </div>
              ) : (
                <div
                  className="mx-2 mb-1 border-t"
                  style={{ borderColor: 'var(--nav-border)' }}
                />
              )}
              <nav className="space-y-0.5" aria-label={group.label}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeModule === item.id;
                  const alertCount = getAlertCount(item.id);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={`${item.num} · ${item.title}`}
                      data-active={active ? 'true' : 'false'}
                      onClick={() => handleSelectModule(item.id)}
                      className={`console-nav-cat w-full flex items-center ${
                        isExpanded ? 'justify-between px-2.5' : 'justify-center px-1'
                      } py-1.5 rounded text-xs font-medium whitespace-nowrap relative`}
                    >
                      {isExpanded ? (
                        <span className="flex items-center gap-2 truncate">
                          <span className="console-nav-num font-mono text-[10px] font-bold tabular-nums w-4 shrink-0">
                            {item.num}
                          </span>
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{item.title}</span>
                        </span>
                      ) : (
                        <span className="flex flex-col items-center gap-0.5">
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="console-nav-num font-mono text-[8px] font-bold leading-none">
                            {item.num}
                          </span>
                        </span>
                      )}

                      {alertCount > 0 &&
                        (isExpanded ? (
                          <span className="px-1.5 rounded-xs bg-amber-500 text-slate-950 font-mono text-[10px] font-bold shrink-0">
                            {alertCount}
                          </span>
                        ) : (
                          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
                        ))}
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </div>

      {/* Live Engine Metering Summary */}
      {isExpanded ? (
        <div
          className="console-nav-subbar p-3.5 border-t space-y-2 text-[11px] font-mono"
          style={{ borderColor: 'var(--nav-border)' }}
        >
          <div className="flex items-center justify-between">
            <span className="console-nav-muted">DSP ENGINE</span>
            <span className={telemetry.isRunning ? 'text-emerald-400 font-semibold' : 'console-nav-muted'}>
              {telemetry.isRunning ? `${(telemetry.sampleRate / 1000).toFixed(0)} kHz LIVE` : 'STANDBY'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="console-nav-muted">POST OUT</span>
            <span className="tabular-nums console-nav-text">
              {telemetry.isRunning ? `${telemetry.postRmsDb.toFixed(1)} dBFS` : '--'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="console-nav-muted">LOUDNESS</span>
            <span className="tabular-nums console-nav-text">
              {telemetry.isRunning ? `${telemetry.estimatedLufs.toFixed(1)} LUFS` : '--'}
            </span>
          </div>
        </div>
      ) : (
        <div
          className="console-nav-subbar p-2 border-t flex flex-col items-center gap-1 font-mono text-[9px]"
          style={{ borderColor: 'var(--nav-border)' }}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              telemetry.isRunning ? 'bg-emerald-400 shadow-[0_0_6px_#10B981]' : 'bg-slate-500'
            }`}
            title={telemetry.isRunning ? 'DSP Engine Live' : 'DSP Engine Standby'}
          />
          <span className="console-nav-muted tabular-nums">
            {telemetry.isRunning ? `${Math.round(telemetry.postRmsDb)}dB` : 'IDLE'}
          </span>
        </div>
      )}
    </aside>
  );
};
