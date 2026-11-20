import type { KeyboardShortcutBinding } from '../types/audio.ts';

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcutBinding[] = [
  {
    id: 'sc-mute-all',
    actionId: 'mute-all',
    label: 'Mute All (Emergency Mute)',
    description: 'Immediately toggle Global Emergency Mute on all live PA and monitor outputs.',
    category: 'Safety',
    keyCombo: 'Shift+M',
    enabled: true,
  },
  {
    id: 'sc-total-bypass',
    actionId: 'total-bypass',
    label: 'Total Signal Bypass',
    description: 'Bypass all EQ, HPF, compression, and limiting for instant dry pass-through.',
    category: 'Safety',
    keyCombo: 'Shift+B',
    enabled: true,
  },
  {
    id: 'sc-tap-tempo',
    actionId: 'tap-tempo',
    label: 'Tap Tempo',
    description: 'Tap repeatedly to compute live worship BPM and quarter/dotted-eighth delay ms.',
    category: 'Timing & Snapshots',
    keyCombo: 'T',
    enabled: true,
  },
  {
    id: 'sc-save-snapshot',
    actionId: 'save-snapshot',
    label: 'Save Snapshot',
    description: 'Store an instant timestamped DSP, channel, and zone configuration snapshot.',
    category: 'Timing & Snapshots',
    keyCombo: 'Shift+S',
    enabled: true,
  },
  {
    id: 'sc-undo-dsp',
    actionId: 'undo-dsp',
    label: 'Undo Last DSP Change',
    description: 'Revert the most recent EQ, dynamics, or bypass adjustment.',
    category: 'Console Mix',
    keyCombo: 'Shift+Z',
    enabled: true,
  },
  {
    id: 'sc-toggle-engine',
    actionId: 'toggle-engine',
    label: 'Start / Stop Audio Engine',
    description: 'Engage or place the live Web Audio DSP engine into standby.',
    category: 'Console Mix',
    keyCombo: 'Shift+E',
    enabled: true,
  },
  {
    id: 'sc-toggle-monitor',
    actionId: 'toggle-monitor',
    label: 'Toggle Studio Monitor',
    description: 'Audition or silence local FOH headphone/monitor output.',
    category: 'Console Mix',
    keyCombo: 'Shift+P',
    enabled: true,
  },
  {
    id: 'sc-mute-band',
    actionId: 'mute-band',
    label: 'Mute / Unmute Worship Band',
    description: 'Toggle mute across band & choir channels while leaving speech mics live.',
    category: 'Console Mix',
    keyCombo: 'Alt+B',
    enabled: true,
  },
  {
    id: 'sc-clear-solos',
    actionId: 'clear-solos',
    label: 'Clear All Channel Solos',
    description: 'Release PFL/AFL solo latching across every input strip.',
    category: 'Console Mix',
    keyCombo: 'Alt+C',
    enabled: true,
  },
  {
    id: 'sc-jump-console',
    actionId: 'jump-console',
    label: 'View: 01 Live Sound Console',
    description: 'Switch immediately to the primary channel fader console.',
    category: 'Navigation',
    keyCombo: 'Alt+1',
    enabled: true,
  },
  {
    id: 'sc-jump-dsp',
    actionId: 'jump-dsp',
    label: 'View: 02 Audio DSP Engine',
    description: 'Switch immediately to the DSP routing and processing rack.',
    category: 'Navigation',
    keyCombo: 'Alt+2',
    enabled: true,
  },
  {
    id: 'sc-jump-feedback',
    actionId: 'jump-feedback',
    label: 'View: 03 Feedback Detection',
    description: 'Switch immediately to the 3D waterfall and notch analyzer.',
    category: 'Navigation',
    keyCombo: 'Alt+3',
    enabled: true,
  },
];

const IGNORED_MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Tab',
]);

const CODE_TO_KEY_LABEL: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/**
 * Converts a browser KeyboardEvent into a canonical, cross-platform combo string
 * (e.g. "Shift+M", "Ctrl+Alt+S", "T", "Space", "F9") using physical `e.code`
 * so Shift+Key combos remain deterministic across keyboard layouts.
 */
export function normalizeKeyEvent(e: KeyboardEvent): string | null {
  if (IGNORED_MODIFIER_KEYS.has(e.key)) {
    return null;
  }

  let primary = '';
  if (e.code.startsWith('Key') && e.code.length === 4) {
    primary = e.code.slice(3).toUpperCase();
  } else if (e.code.startsWith('Digit') && e.code.length === 6) {
    primary = e.code.slice(5);
  } else if (e.code.startsWith('Numpad') && e.code.length === 7) {
    primary = `Num${e.code.slice(6)}`;
  } else if (CODE_TO_KEY_LABEL[e.code]) {
    primary = CODE_TO_KEY_LABEL[e.code];
  } else if (/^F([1-9]|1[0-2])$/.test(e.code)) {
    primary = e.code;
  } else if (e.key.length === 1) {
    primary = e.key === ' ' ? 'Space' : e.key.toUpperCase();
  } else {
    primary = e.key;
  }

  if (!primary) return null;

  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');

  return mods.length > 0 ? `${mods.join('+')}+${primary}` : primary;
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}
