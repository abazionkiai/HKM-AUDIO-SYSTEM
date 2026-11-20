import React, { useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
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
  PanelLeft,
  PanelRight,
  PanelTop,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
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

interface NavTab {
  id: ModuleId;
  label: string;
  fullTitle: string;
  icon: React.FC<{ className?: string }>;
}

const NAV_TABS: NavTab[] = [
  { id: 'console', label: 'Console', fullTitle: 'Live Sound Console', icon: Sliders },
  { id: 'dsp', label: 'DSP', fullTitle: 'Audio DSP Engine', icon: AudioWaveform },
  { id: 'feedback', label: 'Feedback', fullTitle: 'Feedback Detection', icon: Activity },
  { id: 'acoustics', label: 'Acoustics', fullTitle: 'Acoustic & Room Analyzer', icon: Radio },
  { id: 'speakers', label: 'Speakers', fullTitle: 'Speaker Management', icon: MapPin },
  { id: 'microphones', label: 'Mics', fullTitle: 'Microphone Intelligence', icon: Mic },
  { id: 'instruments', label: 'Band', fullTitle: 'Instrument & Music', icon: Music },
  { id: 'virtual-di', label: 'Virtual DI', fullTitle: 'Virtual DI & Bass', icon: Zap },
  { id: 'livestream', label: 'Stream', fullTitle: 'Livestream Studio', icon: Video },
  { id: 'soundcheck', label: 'Soundcheck', fullTitle: 'Automated Sound Check', icon: CheckSquare },
  { id: 'presets', label: 'Presets', fullTitle: 'Presets & Service Profiles', icon: Layers },
  { id: 'ai-engineer', label: 'AI Eng', fullTitle: 'AI Sound Engineer', icon: Sparkles },
  { id: 'hardware', label: 'Hardware', fullTitle: 'Diagnostics, Hardware & Remote Access', icon: Cpu },
  { id: 'midi', label: 'MIDI & Keys', fullTitle: 'MIDI & Key Shortcuts', icon: Cable },
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

const TAB_SPRING = { type: 'spring', stiffness: 520, damping: 36, mass: 0.7 } as const;

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

  const isHorizontal = dockPosition === 'top' || dockPosition === 'bottom';
  const isExpanded = pinnedOpen || hovered;

  const getAlertCount = (id: ModuleId) => {
    if (id === 'ai-engineer' && pendingFindingsCount > 0) return pendingFindingsCount;
    if (id === 'feedback' && (telemetry.feedbackRisk.detected || telemetry.humRisk.detected)) return 1;
    return 0;
  };

  const renderDockAllocator = () => (
    <div
      className="flex items-center gap-1 p-0.5 rounded-md border console-nav-pill shrink-0"
      role="group"
      aria-label="Navigation Dock Position"
    >
      {DOCK_OPTIONS.map((opt) => {
        const DockIcon = opt.icon;
        const selected = dockPosition === opt.id;
        return (
          <motion.button
            key={opt.id}
            type="button"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => onChangeDockPosition(opt.id)}
            title={opt.label}
            aria-label={opt.label}
            aria-pressed={selected}
            data-active={selected ? 'true' : 'false'}
            className="p-1 rounded-xs console-nav-cat focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            <DockIcon className="w-3 h-3" />
          </motion.button>
        );
      })}
    </div>
  );

  /* ==========================================================================
     Single-Line Architectural Console Tab Strip (Top or Bottom)
     Clear bordered tabs with spring-animated shared active surface & rail.
     ========================================================================== */
  if (isHorizontal) {
    const borderClass = dockPosition === 'top' ? 'border-b' : 'border-t';
    return (
      <MotionConfig reducedMotion="user">
        <aside
          aria-label="Console Navigation Bar"
          data-dock={dockPosition}
          className={`w-full shrink-0 ${borderClass} console-nav-shell h-11 px-3 flex items-center justify-between gap-2.5 z-30`}
        >
          <nav
            aria-label="Console Modules"
            className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto overflow-y-hidden h-full py-1.5"
          >
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeModule === tab.id;
              const alertCount = getAlertCount(tab.id);
              return (
                <motion.button
                  key={tab.id}
                  type="button"
                  title={tab.fullTitle}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => onSelectModule(tab.id)}
                  aria-current={active ? 'page' : undefined}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.14 }}
                  className="group console-nav-tab relative h-8 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 overflow-hidden focus-visible:outline-2 focus-visible:outline-sky-500"
                >
                  {active && (
                    <motion.span
                      layoutId="nav-tab-active-surface"
                      transition={TAB_SPRING}
                      className="console-nav-active-surface absolute inset-0 rounded-[5px] pointer-events-none"
                      aria-hidden="true"
                    />
                  )}
                  {active && (
                    <motion.span
                      layoutId="nav-tab-active-rail"
                      transition={TAB_SPRING}
                      className={`console-nav-active-rail absolute inset-x-1.5 h-[2.5px] rounded-full pointer-events-none ${
                        dockPosition === 'bottom' ? 'top-0' : 'bottom-0'
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 shrink-0 opacity-90" />
                    <span>{tab.label}</span>
                  </span>
                  {alertCount > 0 && (
                    <span
                      className="absolute top-0.5 right-1 z-10 font-mono text-[8px] font-bold console-nav-alert tabular-nums leading-none pointer-events-none"
                      aria-label={`${alertCount} active alert`}
                    >
                      {alertCount}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </nav>

          {renderDockAllocator()}
        </aside>
      </MotionConfig>
    );
  }

  /* ==========================================================================
     Clean Vertical Console Sidebar (Optional Left or Right Dock)
     ========================================================================== */
  const sideBorderClass = dockPosition === 'right' ? 'border-l' : 'border-r';

  return (
    <MotionConfig reducedMotion="user">
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label="Console Navigation Sidebar"
        data-dock={dockPosition}
        className={`${
          isExpanded ? 'w-56' : 'w-14'
        } h-full shrink-0 ${sideBorderClass} console-nav-shell flex flex-col justify-between overflow-y-auto overflow-x-hidden transition-[width] duration-200 ease-out`}
      >
        <div>
          <div
            className={`flex items-center border-b px-2 py-2 gap-1.5 ${
              isExpanded ? 'justify-between' : 'justify-center'
            }`}
            style={{ borderColor: 'var(--nav-border)' }}
          >
            {isExpanded && renderDockAllocator()}
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
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
            </motion.button>
          </div>

          <nav className={isExpanded ? 'p-2 space-y-1.5' : 'p-1.5 space-y-1.5'} aria-label="Console Modules">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeModule === tab.id;
              const alertCount = getAlertCount(tab.id);

              return (
                <motion.button
                  key={tab.id}
                  type="button"
                  title={tab.fullTitle}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => onSelectModule(tab.id)}
                  whileHover={{ x: dockPosition === 'right' ? -2 : 2 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.14 }}
                  className={`group console-nav-cat w-full flex items-center ${
                    isExpanded ? 'justify-between px-2.5' : 'justify-center px-1'
                  } py-2 rounded-md text-xs font-medium whitespace-nowrap relative overflow-hidden`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-side-active-bg"
                      transition={TAB_SPRING}
                      className="absolute inset-0 rounded-[5px] pointer-events-none"
                      style={{ backgroundColor: 'var(--nav-active-bg)' }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2 truncate">
                    <Icon className="w-3.5 h-3.5 shrink-0 transition-transform duration-150 group-hover:scale-110" />
                    {isExpanded && <span className="truncate">{tab.fullTitle}</span>}
                  </span>
                  {alertCount > 0 && isExpanded && (
                    <span className="relative z-10 font-mono text-[10px] font-bold console-nav-alert tabular-nums shrink-0">
                      ({alertCount})
                    </span>
                  )}
                </motion.button>
              );
            })}
          </nav>
        </div>
      </aside>
    </MotionConfig>
  );
};

