import React, { useMemo, useState } from 'react';
import { Search, GitBranch, ArrowRight, X } from 'lucide-react';
import type { InputChannel, ModuleId, SpeakerZone } from '../types/audio.ts';

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  channels: InputChannel[];
  zones: SpeakerZone[];
  onNavigateModule: (mod: ModuleId) => void;
  onOpenSignalJourney: (channelId: string) => void;
}

const WORKSPACE_LIST: { id: ModuleId; label: string; group: string }[] = [
  { id: 'console', label: 'Console Instrument Deck', group: 'Live Mixing' },
  { id: 'dsp', label: '31-Band GEQ & Crossover', group: 'DSP Processing' },
  { id: 'feedback', label: 'Feedback Analyzer & Ring-Out', group: 'DSP Processing' },
  { id: 'acoustics', label: 'Room Acoustics & RT60', group: 'Analysis' },
  { id: 'speakers', label: 'Speaker Zones & Matrix', group: 'Output Routing' },
  { id: 'microphones', label: 'Microphone Intelligence', group: 'Inputs' },
  { id: 'instruments', label: 'Band & Instrument Profiles', group: 'Inputs' },
  { id: 'virtual-di', label: 'Virtual DI & Bass Rig', group: 'Inputs' },
  { id: 'livestream', label: 'Livestream & OBS Sync', group: 'Broadcast' },
  { id: 'soundcheck', label: 'Automated Soundcheck', group: 'Operations' },
  { id: 'presets', label: 'Service Presets & Snapshots', group: 'Operations' },
  { id: 'ai-engineer', label: 'AI Sound Engineer', group: 'Intelligence' },
  { id: 'midi', label: 'MIDI & Keyboard Mapping', group: 'Hardware' },
  { id: 'hardware', label: 'Hardware & Audio Diagnostics', group: 'Hardware' },
];

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  open,
  onClose,
  channels,
  zones,
  onNavigateModule,
  onOpenSignalJourney,
}) => {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: {
      id: string;
      kind: string;
      title: string;
      subtitle: string;
      onOpen: () => void;
      onTrace?: () => void;
    }[] = [];

    WORKSPACE_LIST.forEach((ws) => {
      items.push({
        id: `ws-${ws.id}`,
        kind: 'Module',
        title: ws.label,
        subtitle: ws.group,
        onOpen: () => {
          onNavigateModule(ws.id);
          onClose();
        },
      });
    });

    channels.forEach((ch) => {
      items.push({
        id: ch.id,
        kind: 'Channel',
        title: `CH ${String(ch.index).padStart(2, '0')} · ${ch.name}`,
        subtitle: `${ch.role} · Gain +${ch.gainDb}dB · Fader ${ch.faderDb.toFixed(1)}dB`,
        onOpen: () => {
          onNavigateModule('console');
          onClose();
        },
        onTrace: () => {
          onClose();
          onOpenSignalJourney(ch.id);
        },
      });
    });

    zones.forEach((z) => {
      items.push({
        id: z.id,
        kind: 'Speaker Zone',
        title: z.name,
        subtitle: `Delay ${z.delayMs.toFixed(1)} ms · Level ${z.levelDb.toFixed(1)} dB`,
        onOpen: () => {
          onNavigateModule('speakers');
          onClose();
        },
      });
    });

    if (!q) return items.slice(0, 14);
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.subtitle.toLowerCase().includes(q) ||
        i.kind.toLowerCase().includes(q)
    );
  }, [query, channels, zones, onNavigateModule, onOpenSignalJourney, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-start justify-center pt-16 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Global Command & Patch Search"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-sky-500/40 bg-[#0A0F18] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 bg-[#0D1320] border-b border-slate-800 flex items-center gap-3">
          <Search className="w-4 h-4 text-sky-400 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search channels, modules, speaker zones, or signal paths… (Ctrl+K)"
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-slate-800/70">
          {results.length === 0 ? (
            <div className="p-6 text-center text-xs font-mono text-slate-500">
              No matching channels, modules, or speaker zones.
            </div>
          ) : (
            results.map((item) => (
              <div
                key={item.id}
                className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-sky-500/10 transition"
              >
                <button
                  type="button"
                  onClick={item.onOpen}
                  className="flex-1 text-left min-w-0 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[9px] font-bold uppercase">
                      {item.kind}
                    </span>
                    <span className="text-xs font-semibold text-white truncate">{item.title}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                    {item.subtitle}
                  </div>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.onTrace && (
                    <button
                      type="button"
                      onClick={item.onTrace}
                      className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 font-mono text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <GitBranch className="w-3 h-3" />
                      Trace
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={item.onOpen}
                    className="p-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
