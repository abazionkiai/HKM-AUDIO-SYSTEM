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
  idleClass: string;
  activeClass: string;
  railClass: string;
  dotClass: string;
}

const TONE_MAP = {
  sky: {
    idle: 'bg-[#091322] border-sky-500/25 text-sky-300/85 hover:bg-[#0D1C33] hover:text-sky-100 hover:border-sky-400/50',
    active: 'bg-gradient-to-b from-sky-500/35 via-sky-900/60 to-[#081526] border-sky-400 text-white shadow-[0_0_14px_rgba(56,189,248,0.45)]',
    rail: 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.9)]',
    dot: 'bg-sky-400',
  },
  emerald: {
    idle: 'bg-[#081814] border-emerald-500/25 text-emerald-300/85 hover:bg-[#0C241E] hover:text-emerald-100 hover:border-emerald-400/50',
    active: 'bg-gradient-to-b from-emerald-500/35 via-emerald-900/60 to-[#071A15] border-emerald-400 text-white shadow-[0_0_14px_rgba(16,185,129,0.45)]',
    rail: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.9)]',
    dot: 'bg-emerald-400',
  },
  violet: {
    idle: 'bg-[#120D22] border-violet-500/25 text-violet-300/85 hover:bg-[#1B1333] hover:text-violet-100 hover:border-violet-400/50',
    active: 'bg-gradient-to-b from-violet-500/35 via-violet-900/60 to-[#120C24] border-violet-400 text-white shadow-[0_0_14px_rgba(167,139,250,0.45)]',
    rail: 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.9)]',
    dot: 'bg-violet-400',
  },
  amber: {
    idle: 'bg-[#191208] border-amber-500/25 text-amber-300/85 hover:bg-[#261B0B] hover:text-amber-100 hover:border-amber-400/50',
    active: 'bg-gradient-to-b from-amber-500/35 via-amber-900/60 to-[#191107] border-amber-400 text-white shadow-[0_0_14px_rgba(245,158,11,0.45)]',
    rail: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.9)]',
    dot: 'bg-amber-400',
  },
  rose: {
    idle: 'bg-[#1B0A10] border-rose-500/25 text-rose-300/85 hover:bg-[#290F18] hover:text-rose-100 hover:border-rose-400/50',
    active: 'bg-gradient-to-b from-rose-500/35 via-rose-900/60 to-[#1C0910] border-rose-400 text-white shadow-[0_0_14px_rgba(244,63,94,0.45)]',
    rail: 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.9)]',
    dot: 'bg-rose-400',
  },
  fuchsia: {
    idle: 'bg-[#190B21] border-fuchsia-500/25 text-fuchsia-300/85 hover:bg-[#261033] hover:text-fuchsia-100 hover:border-fuchsia-400/50',
    active: 'bg-gradient-to-b from-fuchsia-500/35 via-fuchsia-900/60 to-[#180A21] border-fuchsia-400 text-white shadow-[0_0_14px_rgba(217,70,239,0.45)]',
    rail: 'bg-fuchsia-400 shadow-[0_0_8px_rgba(217,70,239,0.9)]',
    dot: 'bg-fuchsia-400',
  },
  cyan: {
    idle: 'bg-[#08161E] border-cyan-500/25 text-cyan-300/85 hover:bg-[#0D222E] hover:text-cyan-100 hover:border-cyan-400/50',
    active: 'bg-gradient-to-b from-cyan-500/35 via-cyan-900/60 to-[#081720] border-cyan-400 text-white shadow-[0_0_14px_rgba(34,211,238,0.45)]',
    rail: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]',
    dot: 'bg-cyan-400',
  },
};

const makeTab = (
  id: ModuleId,
  label: string,
  fullTitle: string,
  icon: React.FC<{ className?: string }>,
  tone: keyof typeof TONE_MAP
): NavTab => ({
  id,
  label,
  fullTitle,
  icon,
  idleClass: TONE_MAP[tone].idle,
  activeClass: TONE_MAP[tone].active,
  railClass: TONE_MAP[tone].rail,
  dotClass: TONE_MAP[tone].dot,
});

const NAV_TABS: NavTab[] = [
  makeTab('dsp', 'DSP', 'Audio DSP Engine & Signal Graph', AudioWaveform, 'sky'),
  makeTab('console', 'Console', 'Motorized Fader Console Deck', Sliders, 'sky'),
  makeTab('feedback', 'Feedback', 'Feedback Detection & RTA', Activity, 'emerald'),
  makeTab('acoustics', 'Acoustic', 'Acoustic & Room Analyzer', Radio, 'emerald'),
  makeTab('speakers', 'Speakers', 'Speaker Management Zones', MapPin, 'violet'),
  makeTab('routing', 'Matrix', 'Universal Routing & Virtual Patchbay', Cable, 'violet'),
  makeTab('microphones', 'Mics', 'Microphone Intelligence', Mic, 'amber'),
  makeTab('instruments', 'Band', 'Instrument & Music', Music, 'amber'),
  makeTab('virtual-di', 'Virt DI', 'Virtual DI & Bass', Zap, 'amber'),
  makeTab('livestream', 'Stream', 'Livestream Studio & OBS', Video, 'rose'),
  makeTab('recorder', 'Recorder', 'Multitrack Live Service Recorder', Radio, 'rose'),
  makeTab('soundcheck', 'Soundchk', 'Automated Sound Check', CheckSquare, 'fuchsia'),
  makeTab('presets', 'Presets', 'Presets & Service Profiles', Layers, 'fuchsia'),
  makeTab('ai-engineer', 'AI', 'AI Sound Engineer', Sparkles, 'fuchsia'),
  makeTab('hardware', 'Hardware', 'Diagnostics, Hardware & Remote Access', Cpu, 'cyan'),
  makeTab('midi', 'MIDI', 'MIDI & Key Shortcuts', Cable, 'cyan'),
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
     Single-Line Brushed-Gunmetal Console Module Strip (Top or Bottom)
     Clear bordered tabs with restrained teal/cyan active rail & zero glare.
     ========================================================================== */
  if (isHorizontal) {
    const borderClass = dockPosition === 'top' ? 'border-b' : 'border-t';
    return (
      <MotionConfig reducedMotion="user">
        <aside
          aria-label="Console Navigation Bar"
          data-dock={dockPosition}
          className={`w-full shrink-0 ${borderClass} border-[#242E3B] bg-gradient-to-b from-[#141A22] to-[#0E1319] h-8 px-2 flex items-center z-30 shadow-[0_2px_8px_rgba(0,0,0,0.4)]`}
        >
          <nav
            aria-label="Console Modules"
            className="flex items-center gap-1 w-full h-full py-1 overflow-x-auto scrollbar-none"
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
                  whileTap={{ scale: 0.96 }}
                  transition={{ duration: 0.12 }}
                  className={`group relative flex-1 min-w-[54px] h-6 px-1.5 rounded border text-[10px] font-mono flex items-center justify-center gap-1 whitespace-nowrap overflow-hidden transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-teal-400 ${
                    active
                      ? 'bg-[#0B1016] border-[#2DD4BF]/60 text-[#5EEAD4] font-bold shadow-[inset_0_1px_4px_rgba(0,0,0,0.65),0_0_8px_rgba(45,212,191,0.18)]'
                      : 'bg-transparent border-transparent text-slate-400 hover:text-slate-100 hover:bg-[#1B232E] hover:border-[#2C3847] font-medium'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-tab-active-rail"
                      transition={TAB_SPRING}
                      className={`bg-[#2DD4BF] shadow-[0_0_8px_rgba(45,212,191,0.85)] absolute inset-x-1 h-[2px] rounded-full pointer-events-none ${
                        dockPosition === 'bottom' ? 'bottom-0' : 'top-0'
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1 min-w-0">
                    {active && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] shadow-[0_0_5px_rgba(74,222,128,0.85)] animate-pulse shrink-0" />
                    )}
                    <Icon className="w-3 h-3 shrink-0 opacity-90" />
                    <span className="truncate">{tab.label}</span>
                  </span>
                  {alertCount > 0 && (
                    <span
                      className={`ml-0.5 px-1 rounded-full font-mono text-[8px] font-bold tabular-nums leading-tight pointer-events-none shrink-0 ${
                        tab.id === 'feedback'
                          ? 'bg-red-500/25 border border-red-400/60 text-red-200 animate-pulse'
                          : 'bg-amber-500/25 border border-amber-400/50 text-amber-200'
                      }`}
                      aria-label={`${alertCount} active alert`}
                    >
                      {alertCount}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </nav>
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

