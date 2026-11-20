import React, { useMemo, useState } from 'react';
import {
  Keyboard,
  RotateCcw,
  CheckCircle2,
  Activity,
  X,
  Play,
  Power,
  AlertTriangle,
  Search,
} from 'lucide-react';
import type {
  KeyboardShortcutBinding,
  ShortcutActionId,
  TapTempoState,
} from '../types/audio.ts';
import { DEFAULT_KEYBOARD_SHORTCUTS } from '../utils/keyboardShortcuts.ts';

interface KeyboardShortcutManagerProps {
  shortcuts: KeyboardShortcutBinding[];
  onUpdateShortcuts: (next: KeyboardShortcutBinding[]) => void;
  globalEnabled: boolean;
  onToggleGlobalEnabled: () => void;
  capturingId: string | null;
  onSetCapturingId: (id: string | null) => void;
  onTriggerAction: (actionId: ShortcutActionId, viaCombo?: string) => void;
  lastTriggered: { actionId: ShortcutActionId; label: string; combo: string; at: string } | null;
  conflictNotice: string | null;
  tapTempo: TapTempoState;
  emergencyMuted: boolean;
  isModal?: boolean;
  onClose?: () => void;
}

const CATEGORY_OPTIONS: Array<'All' | KeyboardShortcutBinding['category']> = [
  'All',
  'Safety',
  'Timing & Snapshots',
  'Console Mix',
  'Navigation',
];

const renderKeyCaps = (combo: string) => {
  if (!combo) {
    return (
      <span className="font-mono text-[10px] text-slate-500 italic">UNBOUND</span>
    );
  }
  const parts = combo.split('+');
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {parts.map((part, idx) => (
        <React.Fragment key={`${part}-${idx}`}>
          {idx > 0 && <span className="text-slate-500 font-mono text-[10px]">+</span>}
          <kbd className="px-1.5 py-0.5 rounded-xs border border-slate-600 bg-[#121824] text-slate-100 font-mono text-[11px] font-semibold shadow-[inset_0_-1px_0_rgba(0,0,0,0.5)]">
            {part}
          </kbd>
        </React.Fragment>
      ))}
    </span>
  );
};

export const KeyboardShortcutManager: React.FC<KeyboardShortcutManagerProps> = ({
  shortcuts,
  onUpdateShortcuts,
  globalEnabled,
  onToggleGlobalEnabled,
  capturingId,
  onSetCapturingId,
  onTriggerAction,
  lastTriggered,
  conflictNotice,
  tapTempo,
  emergencyMuted,
  isModal = false,
  onClose,
}) => {
  const [categoryFilter, setCategoryFilter] =
    useState<'All' | KeyboardShortcutBinding['category']>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [tapRecently, setTapRecently] = useState(false);

  React.useEffect(() => {
    if (!tapTempo.lastTapAt) return;
    setTapRecently(true);
    const t = window.setTimeout(() => setTapRecently(false), 320);
    return () => window.clearTimeout(t);
  }, [tapTempo.lastTapAt]);

  const filteredShortcuts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return shortcuts.filter((item) => {
      if (categoryFilter !== 'All' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keyCombo.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [shortcuts, categoryFilter, searchQuery]);

  const toggleBindingEnabled = (id: string) => {
    onUpdateShortcuts(
      shortcuts.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const clearBindingKey = (id: string) => {
    if (capturingId === id) onSetCapturingId(null);
    onUpdateShortcuts(
      shortcuts.map((s) => (s.id === id ? { ...s, keyCombo: '', enabled: false } : s))
    );
  };

  const handleResetDefaults = () => {
    onSetCapturingId(null);
    onUpdateShortcuts(DEFAULT_KEYBOARD_SHORTCUTS);
  };

  return (
    <div className="space-y-4">
      {/* Studio Rack Header */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-8 rounded-xs bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.6)] shrink-0" />
          <div>
            <h2 className="font-display text-base lg:text-lg font-semibold text-white tracking-tight flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-sky-400 shrink-0" />
              <span>GLOBAL KEYBOARD SHORTCUT MANAGER</span>
            </h2>
            <p className="text-[11px] font-mono text-slate-400">
              Global window keydown listener · Physical key capture · Safely ignored inside text inputs
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleGlobalEnabled}
            className={`px-3 py-1.5 rounded text-xs font-mono font-semibold flex items-center gap-1.5 border ${
              globalEnabled
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{globalEnabled ? 'HOTKEYS: ARMED' : 'HOTKEYS: PAUSED'}</span>
          </button>

          <button
            type="button"
            onClick={handleResetDefaults}
            className="px-3 py-1.5 rounded bg-[#121824] border border-slate-700 hover:border-slate-500 text-slate-200 text-xs font-mono font-semibold flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>RESET DEFAULTS</span>
          </button>

          {isModal && onClose && (
            <button
              type="button"
              onClick={() => {
                onSetCapturingId(null);
                onClose();
              }}
              aria-label="Close Keyboard Shortcut Manager"
              className="px-2.5 py-1.5 rounded bg-[#121824] border border-slate-700 hover:border-slate-500 text-slate-200 text-xs font-mono font-semibold flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              <span>CLOSE</span>
            </button>
          )}
        </div>
      </div>

      {/* Live Tap Tempo & Last Trigger Telemetry Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#0D1119] p-3 flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              LIVE TAP TEMPO ENGINE
            </div>
            <div className="flex items-baseline gap-2.5">
              <span className="font-mono text-2xl font-bold text-white tabular-nums">
                {tapTempo.bpm}
              </span>
              <span className="font-mono text-xs text-sky-400 font-semibold">BPM</span>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                1/4: {tapTempo.quarterMs}ms · 1/8d: {tapTempo.dottedEighthMs}ms
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onTriggerAction('tap-tempo', 'CLICK')}
            className={`px-3.5 py-2 rounded border font-mono text-xs font-bold flex items-center gap-1.5 shrink-0 ${
              tapRecently
                ? 'border-sky-400 bg-sky-500 text-slate-950 shadow-[0_0_12px_rgba(56,189,248,0.55)]'
                : 'border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>TAP TEMPO</span>
          </button>
        </div>

        <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#0D1119] p-3 flex flex-col justify-center gap-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
            <span className="text-slate-400 uppercase tracking-wider">LAST KEYDOWN EXECUTION</span>
            <span className={emergencyMuted ? 'text-red-400 font-bold' : 'text-emerald-400 font-semibold'}>
              {emergencyMuted ? 'PA: EMERGENCY MUTED' : 'PA: LIVE / ARMED'}
            </span>
          </div>

          {capturingId ? (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-amber-500/50 bg-amber-500/10 text-amber-200 font-mono text-xs">
              <span>
                KEY CAPTURE ACTIVE — Press any key or modifier combo (Ctrl/Alt/Shift + Key), or Esc to cancel.
              </span>
              <button
                type="button"
                onClick={() => onSetCapturingId(null)}
                className="px-2 py-0.5 rounded border border-amber-400/50 text-[10px] hover:bg-amber-500/20"
              >
                CANCEL
              </button>
            </div>
          ) : conflictNotice ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 font-mono text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{conflictNotice}</span>
            </div>
          ) : lastTriggered ? (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-slate-800 bg-[#080B10] font-mono text-xs">
              <span className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="font-semibold">{lastTriggered.label}</span>
              </span>
              <span className="flex items-center gap-2">
                {renderKeyCaps(lastTriggered.combo)}
                <span className="text-[10px] text-slate-500 tabular-nums">
                  {new Date(lastTriggered.at).toLocaleTimeString()}
                </span>
              </span>
            </div>
          ) : (
            <div className="px-2.5 py-1.5 rounded border border-slate-800 bg-[#080B10] font-mono text-xs text-slate-500">
              Press any bound shortcut (e.g. Shift+M for Mute All, T for Tap Tempo, Shift+S for Save Snapshot).
            </div>
          )}
        </div>
      </div>

      {/* Category Filter & Search Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORY_OPTIONS.map((cat) => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1 rounded border text-[11px] font-mono font-medium ${
                  active
                    ? 'border-sky-400/60 bg-sky-500/15 text-sky-300'
                    : 'border-slate-800 bg-[#0D1119] text-slate-400 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter actions or keys..."
            className="w-full h-8 pl-8 pr-2.5 rounded border border-slate-800 bg-[#080B10] text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/60"
          />
        </div>
      </div>

      {/* Shortcut Binding Matrix */}
      <div className="rounded-lg border border-slate-800 bg-[#0D1119] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-[#090D14] font-mono text-[10px] uppercase tracking-wider text-slate-400">
                <th className="py-2.5 px-3">Active</th>
                <th className="py-2.5 px-3">Console Action</th>
                <th className="py-2.5 px-3 hidden md:table-cell">Category</th>
                <th className="py-2.5 px-3">Bound Key</th>
                <th className="py-2.5 px-3 text-right">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-xs">
              {filteredShortcuts.map((item) => {
                const isCapturing = capturingId === item.id;
                const justTriggered = lastTriggered?.actionId === item.actionId;
                return (
                  <tr
                    key={item.id}
                    className={`transition-colors ${
                      isCapturing
                        ? 'bg-amber-500/10'
                        : justTriggered
                          ? 'bg-sky-500/10'
                          : 'hover:bg-[#111723]'
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => toggleBindingEnabled(item.id)}
                        disabled={!item.keyCombo}
                        aria-label={`Toggle ${item.label}`}
                        className={`px-2 py-0.5 rounded-xs border font-mono text-[10px] font-semibold ${
                          item.enabled && item.keyCombo
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : 'border-slate-700 bg-[#121824] text-slate-500'
                        }`}
                      >
                        {item.enabled && item.keyCombo ? 'ON' : 'OFF'}
                      </button>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-white">{item.label}</div>
                      <div className="text-[11px] text-slate-400">{item.description}</div>
                    </td>

                    <td className="py-2.5 px-3 hidden md:table-cell">
                      <span
                        className={`px-2 py-0.5 rounded-xs border font-mono text-[10px] ${
                          item.category === 'Safety'
                            ? 'border-red-500/40 bg-red-500/10 text-red-300'
                            : item.category === 'Timing & Snapshots'
                              ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                              : item.category === 'Console Mix'
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : 'border-slate-700 bg-[#121824] text-slate-300'
                        }`}
                      >
                        {item.category}
                      </span>
                    </td>

                    <td className="py-2.5 px-3">
                      {isCapturing ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-amber-400 bg-amber-500/20 text-amber-200 font-mono text-[11px] font-bold">
                          PRESS KEY...
                        </span>
                      ) : (
                        renderKeyCaps(item.keyCombo)
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSetCapturingId(isCapturing ? null : item.id)}
                          className={`px-2.5 py-1 rounded border font-mono text-[10px] font-semibold ${
                            isCapturing
                              ? 'border-amber-400 bg-amber-500 text-slate-950'
                              : 'border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
                          }`}
                        >
                          {isCapturing ? 'CANCEL' : 'BIND KEY'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onTriggerAction(item.actionId, item.keyCombo || 'TEST')}
                          title={`Test ${item.label}`}
                          className="px-2 py-1 rounded border border-slate-700 bg-[#121824] text-slate-300 hover:text-white font-mono text-[10px] inline-flex items-center gap-1"
                        >
                          <Play className="w-2.5 h-2.5" />
                          <span>TEST</span>
                        </button>
                        {item.keyCombo && (
                          <button
                            type="button"
                            onClick={() => clearBindingKey(item.id)}
                            title="Unbind key"
                            className="px-2 py-1 rounded border border-slate-800 bg-[#080B10] text-slate-400 hover:text-red-300 font-mono text-[10px]"
                          >
                            CLEAR
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredShortcuts.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center font-mono text-xs text-slate-500">
                    No console shortcuts match &ldquo;{searchQuery}&rdquo;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
