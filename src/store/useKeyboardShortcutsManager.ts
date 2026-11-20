import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardShortcutBinding,
  ShortcutActionId,
  TapTempoState,
} from '../types/audio.ts';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  normalizeKeyEvent,
} from '../utils/keyboardShortcuts.ts';
import { appFetch } from '../utils/appApi.ts';

interface UseKeyboardShortcutsProps {
  onToggleEmergencyMute: () => void;
  onToggleTotalBypass: () => void;
  onUndoLastDsp: () => void;
  onToggleEngine: () => void;
  onToggleMonitor: () => void;
  onMuteBand: () => void;
  onClearSolos: () => void;
  onSaveSnapshot: (label: string) => void;
  onNavigateModule: (moduleId: string) => void;
}

export function useKeyboardShortcutsManager({
  onToggleEmergencyMute,
  onToggleTotalBypass,
  onUndoLastDsp,
  onToggleEngine,
  onToggleMonitor,
  onMuteBand,
  onClearSolos,
  onSaveSnapshot,
  onNavigateModule,
}: UseKeyboardShortcutsProps) {
  const [keyboardShortcuts, setKeyboardShortcuts] = useState<KeyboardShortcutBinding[]>(() => {
    try {
      const raw = window.localStorage.getItem('church_audio_keyboard_shortcuts');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return DEFAULT_KEYBOARD_SHORTCUTS;
  });

  const [shortcutsGlobalEnabled, setShortcutsGlobalEnabled] = useState(true);
  const [capturingShortcutId, setCapturingShortcutId] = useState<string | null>(null);
  const [shortcutConflictNotice, setShortcutConflictNotice] = useState<string | null>(null);
  const [lastTriggeredShortcut, setLastTriggeredShortcut] = useState<{
    actionId: ShortcutActionId;
    label: string;
    combo: string;
    at: string;
  } | null>(null);
  const [shortcutToast, setShortcutToast] = useState<{
    label: string;
    combo: string;
  } | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  const [tapTempo, setTapTempo] = useState<TapTempoState>({
    bpm: 120,
    quarterMs: 500,
    dottedEighthMs: 375,
    tapCount: 0,
    lastTapAt: 0,
  });

  const tapTimestampsRef = useRef<number[]>([]);
  const toastTimerRef = useRef<number | null>(null);

  const updateAndPersistShortcuts = useCallback((nextShortcuts: KeyboardShortcutBinding[]) => {
    setKeyboardShortcuts(nextShortcuts);
    try {
      window.localStorage.setItem(
        'church_audio_keyboard_shortcuts',
        JSON.stringify(nextShortcuts)
      );
    } catch {
      // ignore storage error
    }
    appFetch('/api/keyboard-shortcuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shortcuts: nextShortcuts }),
    }).catch(() => {});
  }, []);

  const handleResetDefaultShortcuts = useCallback(() => {
    updateAndPersistShortcuts(DEFAULT_KEYBOARD_SHORTCUTS);
    setShortcutConflictNotice('Keyboard shortcuts restored to factory console defaults.');
    window.setTimeout(() => setShortcutConflictNotice(null), 3000);
  }, [updateAndPersistShortcuts]);

  const handleClearShortcut = useCallback(
    (id: string) => {
      const updated = keyboardShortcuts.map((s) =>
        s.id === id ? { ...s, keyCombo: '', enabled: false } : s
      );
      updateAndPersistShortcuts(updated);
    },
    [keyboardShortcuts, updateAndPersistShortcuts]
  );

  const handleTapTempo = useCallback(() => {
    const now = performance.now();
    const prevTaps = tapTimestampsRef.current;
    const isContinuation = prevTaps.length > 0 && now - prevTaps[prevTaps.length - 1] < 2200;

    const recent = isContinuation ? [...prevTaps, now].slice(-6) : [now];
    tapTimestampsRef.current = recent;

    setTapTempo((prev) => {
      let nextBpm = prev.bpm;
      if (recent.length >= 2) {
        let sumDelta = 0;
        for (let i = 1; i < recent.length; i++) {
          sumDelta += recent[i] - recent[i - 1];
        }
        const avgDeltaMs = sumDelta / (recent.length - 1);
        nextBpm = Math.max(40, Math.min(240, Math.round(60000 / Math.max(200, avgDeltaMs))));
      }
      const quarterMs = Math.round(60000 / nextBpm);
      const dottedEighthMs = Math.round(45000 / nextBpm);
      return {
        bpm: nextBpm,
        quarterMs,
        dottedEighthMs,
        tapCount: recent.length,
        lastTapAt: Date.now(),
      };
    });
  }, []);

  const executeShortcutAction = useCallback(
    (actionId: ShortcutActionId, viaCombo = '') => {
      const binding = keyboardShortcuts.find((s) => s.actionId === actionId);
      const actionLabel = binding?.label ?? actionId;

      if (actionId === 'mute-all') {
        onToggleEmergencyMute();
      } else if (actionId === 'total-bypass') {
        onToggleTotalBypass();
      } else if (actionId === 'tap-tempo') {
        handleTapTempo();
      } else if (actionId === 'save-snapshot') {
        onSaveSnapshot(`Quick Snapshot (${viaCombo || 'Shortcut'})`);
      } else if (actionId === 'undo-dsp') {
        onUndoLastDsp();
      } else if (actionId === 'toggle-engine') {
        onToggleEngine();
      } else if (actionId === 'toggle-monitor') {
        onToggleMonitor();
      } else if (actionId === 'mute-band') {
        onMuteBand();
      } else if (actionId === 'clear-solos') {
        onClearSolos();
      } else if (actionId === 'jump-console') {
        onNavigateModule('console');
      } else if (actionId === 'jump-dsp') {
        onNavigateModule('dsp');
      } else if (actionId === 'jump-feedback') {
        onNavigateModule('feedback');
      }

      setLastTriggeredShortcut({
        actionId,
        label: actionLabel,
        combo: viaCombo || binding?.keyCombo || 'KEY',
        at: new Date().toISOString(),
      });
      setShortcutToast({
        label: actionLabel,
        combo: viaCombo || binding?.keyCombo || 'KEY',
      });
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setShortcutToast(null);
      }, 2200);
    },
    [
      handleTapTempo,
      keyboardShortcuts,
      onClearSolos,
      onMuteBand,
      onNavigateModule,
      onSaveSnapshot,
      onToggleEmergencyMute,
      onToggleEngine,
      onToggleMonitor,
      onToggleTotalBypass,
      onUndoLastDsp,
    ]
  );

  const shortcutRuntimeRef = useRef({
    capturingShortcutId,
    keyboardShortcuts,
    shortcutsGlobalEnabled,
    showShortcutsModal,
    executeShortcutAction,
    updateAndPersistShortcuts,
  });

  shortcutRuntimeRef.current = {
    capturingShortcutId,
    keyboardShortcuts,
    shortcutsGlobalEnabled,
    showShortcutsModal,
    executeShortcutAction,
    updateAndPersistShortcuts,
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const runtime = shortcutRuntimeRef.current;

      // 1. Key Capture Mode
      if (runtime.capturingShortcutId) {
        e.preventDefault();
        e.stopPropagation();

        if (e.code === 'Escape') {
          setCapturingShortcutId(null);
          return;
        }

        const combo = normalizeKeyEvent(e);
        if (!combo) return;

        const targetRow = runtime.keyboardShortcuts.find(
          (s) => s.id === runtime.capturingShortcutId
        );
        const conflictingRow = runtime.keyboardShortcuts.find(
          (s) => s.id !== runtime.capturingShortcutId && s.keyCombo === combo
        );

        const updated = runtime.keyboardShortcuts.map((s) => {
          if (s.id === runtime.capturingShortcutId) {
            return { ...s, keyCombo: combo, enabled: true };
          }
          if (conflictingRow && s.id === conflictingRow.id) {
            return { ...s, keyCombo: '', enabled: false };
          }
          return s;
        });

        runtime.updateAndPersistShortcuts(updated);
        setCapturingShortcutId(null);

        if (conflictingRow && targetRow) {
          setShortcutConflictNotice(
            `Key combo ${combo} was reassigned from "${conflictingRow.label}" to "${targetRow.label}".`
          );
        } else {
          setShortcutConflictNotice(null);
        }
        return;
      }

      // Ignore keystrokes inside text inputs
      const targetTag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const isInput =
        targetTag === 'input' ||
        targetTag === 'textarea' ||
        targetTag === 'select' ||
        (e.target as HTMLElement | null)?.isContentEditable;
      if (isInput) return;

      if (!runtime.shortcutsGlobalEnabled) return;

      const combo = normalizeKeyEvent(e);
      if (!combo) return;

      const matched = runtime.keyboardShortcuts.find(
        (s) => s.enabled && s.keyCombo === combo
      );
      if (!matched) return;

      e.preventDefault();
      runtime.executeShortcutAction(matched.actionId, combo);
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  return {
    keyboardShortcuts,
    setKeyboardShortcuts,
    shortcutsGlobalEnabled,
    setShortcutsGlobalEnabled,
    capturingShortcutId,
    setCapturingShortcutId,
    shortcutConflictNotice,
    lastTriggeredShortcut,
    shortcutToast,
    showShortcutsModal,
    setShowShortcutsModal,
    tapTempo,
    handleTapTempo,
    executeShortcutAction,
    updateAndPersistShortcuts,
    handleResetDefaultShortcuts,
    handleClearShortcut,
  };
}
