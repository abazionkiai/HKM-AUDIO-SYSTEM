import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Download, Info, Search } from 'lucide-react';
import type { ModuleId } from '../types/audio.ts';

declare const __APP_VERSION__: string;

export type UpdateCheckBannerState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date' }
  | { status: 'available'; version: string }
  | { status: 'error'; message: string };

interface AppMenuBarProps {
  appVersion?: string;
  isDesktop: boolean;
  engineRunning: boolean;
  monitorAudible: boolean;
  totalBypassed: boolean;
  emergencyMuted: boolean;
  canUndo: boolean;
  navDockPosition: 'left' | 'top' | 'right' | 'bottom';
  updateState: UpdateCheckBannerState;
  onNavigateModule: (mod: ModuleId) => void;
  onChangeDockPosition: (pos: 'left' | 'top' | 'right' | 'bottom') => void;
  onSaveSnapshot: () => void;
  onUndoLastDsp: () => void;
  onResetEqFlat: () => void;
  onClearAllSolos: () => void;
  onOpenShortcuts: () => void;
  onToggleEngine: () => void;
  onToggleMonitor: () => void;
  onToggleTotalBypass: () => void;
  onToggleEmergencyMute: () => void;
  onCheckForUpdates: () => void;
  onOpenUpdateModal: () => void;
  onOpenAbout: () => void;
  onOpenGlobalSearch: () => void;
  onOpenGainStaging: () => void;
  onOpenSignalJourney: () => void;
}

type MenuKey = 'file' | 'edit' | 'view' | 'audio' | 'help';

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.2.2';

export const AppMenuBar: React.FC<AppMenuBarProps> = ({
  appVersion = APP_VERSION,
  isDesktop,
  engineRunning,
  monitorAudible,
  totalBypassed,
  emergencyMuted,
  canUndo,
  navDockPosition,
  updateState,
  onNavigateModule,
  onChangeDockPosition,
  onSaveSnapshot,
  onUndoLastDsp,
  onResetEqFlat,
  onClearAllSolos,
  onOpenShortcuts,
  onToggleEngine,
  onToggleMonitor,
  onToggleTotalBypass,
  onToggleEmergencyMute,
  onCheckForUpdates,
  onOpenUpdateModal,
  onOpenAbout,
  onOpenGlobalSearch,
  onOpenGainStaging,
  onOpenSignalJourney,
}) => {
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenu]);

  const runAction = (fn: () => void) => {
    setOpenMenu(null);
    fn();
  };

  const handleExitApp = async () => {
    setOpenMenu(null);
    if (isDesktop) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
        return;
      } catch {
        // fallback below
      }
    }
    window.close();
  };

  const menus: {
    key: MenuKey;
    label: string;
    items: (
      | { divider: true }
      | {
          divider?: false;
          label: string;
          shortcut?: string;
          checked?: boolean;
          disabled?: boolean;
          danger?: boolean;
          onClick: () => void;
        }
    )[];
  }[] = [
    {
      key: 'file',
      label: 'File',
      items: [
        { label: 'Save Scene Snapshot', shortcut: 'Ctrl+S', onClick: () => runAction(onSaveSnapshot) },
        { label: 'Service Presets…', onClick: () => runAction(() => onNavigateModule('presets')) },
        { divider: true },
        { label: 'Check for Updates…', onClick: () => runAction(onCheckForUpdates) },
        { divider: true },
        { label: 'Exit', shortcut: 'Alt+F4', danger: true, onClick: handleExitApp },
      ],
    },
    {
      key: 'edit',
      label: 'Edit',
      items: [
        {
          label: 'Undo Last DSP Change',
          shortcut: 'Ctrl+Z',
          disabled: !canUndo,
          onClick: () => runAction(onUndoLastDsp),
        },
        { label: 'Reset 4-Band PEQ Flat', onClick: () => runAction(onResetEqFlat) },
        { label: 'Clear All Solos', onClick: () => runAction(onClearAllSolos) },
        { divider: true },
        { label: 'Keyboard Shortcuts…', onClick: () => runAction(onOpenShortcuts) },
        { label: 'MIDI Controller Mapping…', onClick: () => runAction(() => onNavigateModule('midi')) },
      ],
    },
    {
      key: 'view',
      label: 'View',
      items: [
        { label: 'Console Instrument Deck', onClick: () => runAction(() => onNavigateModule('console')) },
        { label: '31-Band GEQ & Crossover', onClick: () => runAction(() => onNavigateModule('dsp')) },
        { label: 'Feedback Analyzer', onClick: () => runAction(() => onNavigateModule('feedback')) },
        { label: 'Room Acoustics', onClick: () => runAction(() => onNavigateModule('acoustics')) },
        { label: 'Hardware & Diagnostics', onClick: () => runAction(() => onNavigateModule('hardware')) },
        { label: 'Universal Bus Matrix…', onClick: () => runAction(() => onNavigateModule('routing')) },
        { label: 'Multitrack Recorder…', onClick: () => runAction(() => onNavigateModule('recorder')) },
        { divider: true },
        { label: 'Quick Patch & Search…', shortcut: 'Ctrl+K', onClick: () => runAction(onOpenGlobalSearch) },
        { label: 'Signal Journey Trace…', onClick: () => runAction(onOpenSignalJourney) },
        { divider: true },
        {
          label: 'Dock Nav: Top',
          checked: navDockPosition === 'top',
          onClick: () => runAction(() => onChangeDockPosition('top')),
        },
        {
          label: 'Dock Nav: Left',
          checked: navDockPosition === 'left',
          onClick: () => runAction(() => onChangeDockPosition('left')),
        },
        {
          label: 'Dock Nav: Right',
          checked: navDockPosition === 'right',
          onClick: () => runAction(() => onChangeDockPosition('right')),
        },
        {
          label: 'Dock Nav: Bottom',
          checked: navDockPosition === 'bottom',
          onClick: () => runAction(() => onChangeDockPosition('bottom')),
        },
      ],
    },
    {
      key: 'audio',
      label: 'Audio',
      items: [
        {
          label: engineRunning ? 'Stop DSP Audio Engine' : 'Start DSP Audio Engine',
          checked: engineRunning,
          onClick: () => runAction(onToggleEngine),
        },
        {
          label: 'Monitor Audition Output',
          checked: monitorAudible,
          onClick: () => runAction(onToggleMonitor),
        },
        {
          label: 'Total DSP Bypass',
          checked: totalBypassed,
          onClick: () => runAction(onToggleTotalBypass),
        },
        { label: 'Gain Staging Assistant…', onClick: () => runAction(onOpenGainStaging) },
        { divider: true },
        {
          label: emergencyMuted ? 'Release Emergency Mute' : 'Emergency Safe Mute',
          shortcut: 'F12',
          danger: true,
          checked: emergencyMuted,
          onClick: () => runAction(onToggleEmergencyMute),
        },
        { divider: true },
        { label: 'Audio Devices & Sample Rate…', onClick: () => runAction(() => onNavigateModule('hardware')) },
      ],
    },
    {
      key: 'help',
      label: 'Help',
      items: [
        { label: 'Check for Updates…', onClick: () => runAction(onCheckForUpdates) },
        { label: 'Automated Soundcheck…', onClick: () => runAction(() => onNavigateModule('soundcheck')) },
        { divider: true },
        {
          label: `About Church Audio Intelligence (v${appVersion})`,
          onClick: () => runAction(onOpenAbout),
        },
      ],
    },
  ];

  return (
    <div
      ref={barRef}
      role="menubar"
      aria-label="Application Menu Bar"
      className="h-7 shrink-0 bg-[#05080E] border-b border-slate-800/90 px-2.5 flex items-center justify-between text-[11px] font-sans select-none z-40"
    >
      {/* Left: Classic Desktop Menu Triggers */}
      <div className="flex items-center gap-0.5">
        {menus.map((menu) => {
          const isOpen = openMenu === menu.key;
          return (
            <div key={menu.key} className="relative">
              <button
                type="button"
                role="menuitem"
                aria-expanded={isOpen}
                onClick={() => setOpenMenu(isOpen ? null : menu.key)}
                onMouseEnter={() => {
                  if (openMenu && openMenu !== menu.key) setOpenMenu(menu.key);
                }}
                className={`px-2.5 py-0.5 rounded-xs transition-colors cursor-pointer ${
                  isOpen
                    ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40'
                    : 'text-slate-300 hover:bg-slate-800/90 hover:text-white border border-transparent'
                }`}
              >
                {menu.label}
              </button>

              {isOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full mt-0.5 w-64 rounded-md border border-slate-700 bg-[#0B101B] shadow-2xl py-1 z-50"
                >
                  {menu.items.map((item, idx) =>
                    item.divider ? (
                      <div key={`div-${idx}`} className="my-1 border-t border-slate-800" />
                    ) : (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        disabled={item.disabled}
                        onClick={item.onClick}
                        className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-[11px] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          item.danger
                            ? 'text-red-300 hover:bg-red-950/60 hover:text-red-200'
                            : 'text-slate-200 hover:bg-sky-600/25 hover:text-white'
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span className="w-3 text-center text-sky-400 font-bold">
                            {item.checked ? '✓' : ''}
                          </span>
                          <span className="truncate">{item.label}</span>
                        </span>
                        {item.shortcut && (
                          <span className="font-mono text-[10px] text-slate-500 shrink-0">
                            {item.shortcut}
                          </span>
                        )}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right: Quick Search + Update Status Pill + App Version Badge */}
      <div className="flex items-center gap-2 font-mono text-[10px]">
        <button
          type="button"
          onClick={onOpenGlobalSearch}
          title="Quick Command & Channel Search (Ctrl+K)"
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-sky-500/50 transition cursor-pointer"
        >
          <Search className="w-2.5 h-2.5 text-sky-400" />
          <span className="hidden sm:inline">Search</span>
          <span className="text-[9px] text-slate-500 hidden md:inline">Ctrl+K</span>
        </button>
        {updateState.status === 'checking' && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-sky-300">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Checking updates…
          </span>
        )}

        {updateState.status === 'available' && (
          <button
            type="button"
            onClick={onOpenUpdateModal}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/25 border border-emerald-400/60 text-emerald-200 hover:bg-emerald-600/40 font-bold cursor-pointer animate-pulse"
          >
            <Download className="w-3 h-3 text-emerald-300" />
            Update v{updateState.version} Ready
          </button>
        )}

        {updateState.status === 'up-to-date' && (
          <button
            type="button"
            onClick={onCheckForUpdates}
            title="Click to check again"
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900/90 border border-slate-800 text-emerald-400 hover:border-slate-700 cursor-pointer"
          >
            <CheckCircle2 className="w-3 h-3" />
            Up to date
          </button>
        )}

        {updateState.status === 'error' && (
          <button
            type="button"
            onClick={onCheckForUpdates}
            title={updateState.message}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/50 border border-amber-500/40 text-amber-300 hover:bg-amber-900/50 cursor-pointer max-w-[240px] truncate"
          >
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span className="truncate">Update check: {updateState.message}</span>
          </button>
        )}

        {updateState.status === 'idle' && (
          <button
            type="button"
            onClick={onCheckForUpdates}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-sky-300 hover:border-slate-700 transition cursor-pointer"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            Check Updates
          </button>
        )}

        <button
          type="button"
          onClick={onOpenAbout}
          title="About Church Audio Intelligence"
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#0E1525] border border-sky-500/35 text-sky-300 hover:bg-sky-950/60 font-bold cursor-pointer"
        >
          <Info className="w-3 h-3 text-sky-400" />
          v{appVersion}
        </button>
      </div>
    </div>
  );
};
