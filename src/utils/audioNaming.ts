/**
 * HKM Audio System - Hardware Audio I/O Deduplication, Loopback Filtering & 1-to-1 Auto-Slot Allocator
 * - Guarantees 1 standalone stereo endpoint per physical/virtual device (no L/R splits, no synthetic jack cloning).
 * - Filters out OS loopback / virtual mix-back traps from live input channels by default.
 * - Occupies CH 1..CH N 1-to-1 at startup and auto-slots hot-plugged inputs into the next open slot.
 */

import type { InputChannel } from '../types/audio.ts';

const LEGACY_MOCK_NAMES = new Set([
  'main preacher',
  'assistant pastor',
  'pulpit lectern',
  'worship lead 1',
  'worship lead',
  'backing vocal 2',
  'backing vocal 3',
  'choir overhead l',
  'choir overhead r',
  'bass guitar di',
  'acoustic guitar',
  'keys l',
  'keys r',
  'electric guitar',
  'kick drum',
  'snare / drums oh',
  'playback / media',
  'usb stereo return l',
  'usb stereo return r',
  'usb stereo return',
]);

/**
 * Checks whether a given channel name is an obsolete hardcoded mock name.
 */
export function isLegacyMockName(name?: string): boolean {
  if (!name) return false;
  const lower = name.trim().toLowerCase();
  if (lower.startsWith('usb stereo ret')) return true;
  return LEGACY_MOCK_NAMES.has(lower);
}

/**
 * Strips Windows OS alias prefixes ("Default -", "Communications -") and USB hex IDs
 * so duplicate OS descriptors for the same physical hardware normalize identically.
 */
export function normalizeDeviceLabel(label?: string): string {
  if (!label) return '';
  return label
    .replace(/^(?:Default|Communications)\s*-\s*/i, '')
    .replace(/\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identifies OS loopback / system mix-back capture endpoints that cause audio feedback loops
 * when automatically mounted as live console inputs.
 */
export function isLoopbackInputLabel(label?: string): boolean {
  if (!label) return false;
  return /\b(stereo\s*mix|what\s*u\s*hear|wave\s*out\s*mix|loopback|cable\s*output|voicemeeter\s*(?:out|output|aux\s*out|vaio\s*out)|monitor\s+of)\b/i.test(
    label
  );
}

function isAliasEntry(dev: MediaDeviceInfo): boolean {
  if (dev.deviceId === 'default' || dev.deviceId === 'communications') return true;
  const raw = (dev.label || '').trim();
  return /^(?:Default|Communications)\s*-/i.test(raw);
}

/**
 * Deduplicates MediaDeviceInfo lists by stripping OS Default/Communications aliases when real endpoints exist,
 * excluding loopback capture traps for live inputs, and keeping 1 standalone stereo endpoint per hardware port.
 */
export function deduplicateMediaDevices(
  raw: MediaDeviceInfo[],
  kind: 'audioinput' | 'audiooutput',
  options?: { excludeLoopbacks?: boolean }
): MediaDeviceInfo[] {
  const byKind = raw.filter((d) => d.kind === kind);
  const excludeLoopbacks = kind === 'audioinput' && options?.excludeLoopbacks !== false;

  const filtered = excludeLoopbacks
    ? byKind.filter((d) => !isLoopbackInputLabel(d.label))
    : byKind;

  const concrete = filtered.filter((d) => !isAliasEntry(d));
  const pool =
    concrete.length > 0
      ? concrete
      : filtered.filter((d) => d.deviceId !== 'communications').slice(0, 1);

  const hasAnyLabel = pool.some((d) => normalizeDeviceLabel(d.label).length > 0);
  const effectivePool = hasAnyLabel
    ? pool.filter((d) => normalizeDeviceLabel(d.label).length > 0)
    : pool.slice(0, 1);

  const seenDeviceIds = new Set<string>();
  const seenCanonKeys = new Set<string>();
  const result: MediaDeviceInfo[] = [];

  for (const dev of effectivePool) {
    if (dev.deviceId && seenDeviceIds.has(dev.deviceId)) continue;
    const normLabel = normalizeDeviceLabel(dev.label).toLowerCase();
    const canonKey = normLabel
      ? dev.groupId
        ? `${normLabel}::${dev.groupId}`
        : normLabel
      : `id::${dev.deviceId || result.length}`;
    if (seenCanonKeys.has(canonKey)) continue;

    if (dev.deviceId) seenDeviceIds.add(dev.deviceId);
    seenCanonKeys.add(canonKey);

    const cleanLabel = normalizeDeviceLabel(dev.label);
    result.push(
      cleanLabel && cleanLabel !== dev.label
        ? ({
            deviceId: dev.deviceId,
            groupId: dev.groupId,
            kind: dev.kind,
            label: cleanLabel,
            toJSON: dev.toJSON ? () => dev.toJSON() : () => ({}),
          } as MediaDeviceInfo)
        : dev
    );
  }

  return result;
}

/**
 * Derives a clean, concise, hardware-accurate scribble strip name and audio role
 * from a connected physical or virtual audio device descriptor.
 */
export function deriveAutoChannelNameAndRole(
  deviceLabel?: string,
  channelIndex: number = 1
): { name: string; role: string } {
  const cleanLabel = normalizeDeviceLabel(deviceLabel);
  if (!cleanLabel) {
    return {
      name: `Input ${channelIndex}`,
      role: 'Open Slot',
    };
  }

  const lower = cleanLabel.toLowerCase();

  let role = 'Live Stereo';
  if (lower.includes('cable') || lower.includes('virtual') || lower.includes('voicemeeter')) {
    role = 'Virtual In';
  } else if (lower.includes('line in') || lower.includes('line-in')) {
    role = 'Line In';
  } else if (lower.includes('mic array') || lower.includes('microphone array')) {
    role = 'Mic Array';
  } else if (lower.includes('mic') || lower.includes('microphone') || lower.includes('headset')) {
    role = 'Microphone';
  } else if (
    lower.includes('usb') ||
    lower.includes('focusrite') ||
    lower.includes('scarlett') ||
    lower.includes('behringer') ||
    lower.includes('mg16') ||
    lower.includes('yamaha') ||
    lower.includes('motu') ||
    lower.includes('presonus') ||
    lower.includes('interface')
  ) {
    role = 'Interface';
  }

  let name = cleanLabel;
  if (lower.includes('vb-audio') || lower.includes('virtual cable')) {
    name = 'VB-Audio Cable';
  } else if (lower.includes('voicemeeter')) {
    name = lower.includes('aux') ? 'VoiceMeeter AUX' : 'VoiceMeeter VAIO';
  } else if (lower.includes('mg16xu') || lower.includes('mg-xu') || lower.includes('mg16')) {
    name = 'MG16XU USB In';
  } else if (lower.includes('scarlett')) {
    name = 'Scarlett USB In';
  } else if (lower.includes('focusrite')) {
    name = 'Focusrite In';
  } else if (lower.includes('umc')) {
    name = 'Behringer UMC';
  } else if (lower.includes('x32') || lower.includes('m32')) {
    name = 'X32 USB In';
  } else if (lower.includes('realtek')) {
    name = lower.includes('line') ? 'Realtek Line In' : 'Realtek Mic';
  } else if (lower.includes('intel')) {
    name = 'Intel Mic Array';
  } else {
    const match = cleanLabel.match(/^([A-Za-z\s]+)\s*\((.+)\)$/);
    if (match) {
      const type = match[1].trim();
      const hardware = match[2].trim().replace(/\(R\)/gi, '').replace(/\s+/g, ' ');
      const shortType = type.toLowerCase().includes('micro') ? 'Mic' : type;
      name = `${hardware} ${shortType}`;
    }
  }

  name = name.replace(/\s+/g, ' ').trim();
  if (name.length > 18) {
    name = name.slice(0, 17) + '…';
  }

  return { name, role };
}

/**
 * Creates a clean unoccupied standalone stereo input slot.
 */
export function createOpenChannelSlot(index: number, authority: InputChannel['authority'] = 'software-dsp'): InputChannel {
  return {
    id: `ch-${index}`,
    index,
    name: `Input ${index}`,
    role: 'Open Slot',
    authority,
    levelDb: -96,
    peakDb: -96,
    gainDb: 0,
    faderDb: -48,
    mute: false,
    solo: false,
    phantom48v: false,
    padDb: false,
    polarityInverted: false,
    hpfHz: 80,
    pan: 0,
    noiseFloorDb: -96,
    gateThresholdDb: -48,
    compThresholdDb: -18,
    compRatio: 3.0,
    eqLowDb: 0,
    eqMidDb: 0,
    eqMidFreqHz: 1200,
    eqHighDb: 0,
    auxSends: {
      stageMon1Db: -12,
      stageMon2Db: -12,
      streamBusDb: 0,
      subsDb: -48,
    },
    dcaGroup: 'None',
    stereoLinked: false,
    mainPaAssign: true,
    streamAssign: true,
    subAssign: false,
    hardwareInputId: undefined,
    hardwareInputLabel: undefined,
  };
}

function isUsableHardwareInput(dev: MediaDeviceInfo): boolean {
  if (dev.deviceId === 'default' || dev.deviceId === 'communications') return false;
  if (isLoopbackInputLabel(dev.label)) return false;
  return Boolean(dev.deviceId || normalizeDeviceLabel(dev.label));
}

function channelsMatchSignature(a: InputChannel[], b: InputChannel[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.index !== y.index ||
      x.name !== y.name ||
      x.role !== y.role ||
      (x.hardwareInputId || '') !== (y.hardwareInputId || '') ||
      (x.hardwareInputLabel || '') !== (y.hardwareInputLabel || '') ||
      Boolean(x.stereoLinked) !== Boolean(y.stereoLinked) ||
      ((!x.hardwareInputId || !y.hardwareInputId) &&
        (x.faderDb !== y.faderDb || x.gainDb !== y.gainDb || x.mute !== y.mute))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Sanitizes persisted or legacy channels: strips mock names, removes loopback/alias bindings,
 * clears duplicate physical bindings so each live input owns at most one standalone stereo strip.
 */
export function sanitizeAndAutoNameChannels(
  channels: InputChannel[],
  _inputDevices: MediaDeviceInfo[] = []
): InputChannel[] {
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();

  return channels.map((ch, idx) => {
    const chNum = ch.index || idx + 1;
    const rawDevId = ch.hardwareInputId;
    const rawLabel = normalizeDeviceLabel(ch.hardwareInputLabel);
    const labelKey = rawLabel.toLowerCase();

    const invalidOrDuplicate =
      !rawDevId ||
      rawDevId === 'default' ||
      rawDevId === 'communications' ||
      isLoopbackInputLabel(rawLabel) ||
      seenIds.has(rawDevId) ||
      (labelKey.length > 0 && seenLabels.has(labelKey));

    if (invalidOrDuplicate) {
      return {
        ...ch,
        index: chNum,
        name: `Input ${chNum}`,
        role: 'Open Slot',
        gainDb: 0,
        faderDb: -48,
        mute: false,
        solo: false,
        levelDb: -96,
        peakDb: -96,
        phantom48v: false,
        padDb: false,
        polarityInverted: false,
        stereoLinked: false,
        pan: 0,
        hardwareInputId: undefined,
        hardwareInputLabel: undefined,
      };
    }

    seenIds.add(rawDevId);
    if (labelKey) seenLabels.add(labelKey);

    const hasMockName = isLegacyMockName(ch.name);
    if (rawLabel) {
      const derived = deriveAutoChannelNameAndRole(rawLabel, chNum);
      return {
        ...ch,
        index: chNum,
        name: hasMockName || !ch.name || /^Input \d+$/i.test(ch.name) ? derived.name : ch.name,
        role: hasMockName || !ch.role || ch.role === 'Open Slot' ? derived.role : ch.role,
        hardwareInputLabel: rawLabel,
        stereoLinked: false,
      };
    }

    return {
      ...ch,
      index: chNum,
      name: hasMockName || !ch.name ? `Input ${chNum}` : ch.name,
      stereoLinked: false,
    };
  });
}

export interface ReconcileInputsResult {
  channels: InputChannel[];
  newlyAssigned: Array<{ channelId: string; channelIndex: number; deviceId: string; label: string }>;
  changed: boolean;
}

/**
 * Single authoritative 1-to-1 slot allocator:
 * - isStartupSync=true: occupies CH 1..CH N sequentially with the N detected live inputs; clears open tail slots.
 * - isStartupSync=false: preserves existing occupied slots and inserts newly plugged-in inputs into the lowest open slot
 *   (appending a new channel only if all existing slots are full).
 */
export function reconcileLiveInputsToChannels(
  existingChannels: InputChannel[],
  liveInputs: MediaDeviceInfo[],
  options: { isStartupSync: boolean; minSlots?: number }
): ReconcileInputsResult {
  const minSlots = options.minSlots ?? 8;
  const usableInputs = deduplicateMediaDevices(liveInputs, 'audioinput', {
    excludeLoopbacks: true,
  }).filter(isUsableHardwareInput);

  const newlyAssigned: ReconcileInputsResult['newlyAssigned'] = [];

  if (options.isStartupSync) {
    const slotCount = Math.max(minSlots, usableInputs.length);
    const nextChannels: InputChannel[] = [];

    for (let i = 0; i < slotCount; i++) {
      const chNum = i + 1;
      const dev = usableInputs[i];

      if (dev) {
        const cleanLabel = normalizeDeviceLabel(dev.label) || `Live Audio Input ${chNum}`;
        const canonKey = cleanLabel.toLowerCase();
        const donor =
          existingChannels.find((c) => c.hardwareInputId && c.hardwareInputId === dev.deviceId) ??
          existingChannels.find(
            (c) => c.hardwareInputLabel && normalizeDeviceLabel(c.hardwareInputLabel).toLowerCase() === canonKey
          ) ??
          (existingChannels[i] && !existingChannels[i].hardwareInputId ? existingChannels[i] : undefined);

        const base = donor
          ? { ...donor, id: existingChannels[i]?.id || `ch-${chNum}`, index: chNum }
          : createOpenChannelSlot(chNum);
        const hadExistingHardware = Boolean(donor?.hardwareInputId);
        const derived = deriveAutoChannelNameAndRole(cleanLabel, chNum);
        const keepCustomName =
          Boolean(donor?.hardwareInputId === dev.deviceId && donor?.name) &&
          !isLegacyMockName(donor?.name) &&
          !/^Input \d+$/i.test(donor?.name || '');

        const slotted: InputChannel = {
          ...base,
          id: existingChannels[i]?.id || `ch-${chNum}`,
          index: chNum,
          name: keepCustomName ? base.name : derived.name,
          role: derived.role,
          gainDb: hadExistingHardware ? base.gainDb : 24,
          faderDb: hadExistingHardware ? base.faderDb : 0,
          mute: hadExistingHardware ? base.mute : false,
          solo: hadExistingHardware ? base.solo : false,
          stereoLinked: false,
          hardwareInputId: dev.deviceId || cleanLabel,
          hardwareInputLabel: cleanLabel,
        };
        nextChannels.push(slotted);
        newlyAssigned.push({
          channelId: slotted.id,
          channelIndex: chNum,
          deviceId: slotted.hardwareInputId!,
          label: cleanLabel,
        });
      } else {
        const template = existingChannels[i];
        const cleanOpen = template
          ? {
              ...template,
              id: template.id || `ch-${chNum}`,
              index: chNum,
              name: `Input ${chNum}`,
              role: 'Open Slot',
              gainDb: 0,
              faderDb: -48,
              mute: false,
              solo: false,
              levelDb: -96,
              peakDb: -96,
              phantom48v: false,
              padDb: false,
              polarityInverted: false,
              stereoLinked: false,
              pan: 0,
              hardwareInputId: undefined,
              hardwareInputLabel: undefined,
            }
          : createOpenChannelSlot(chNum);
        nextChannels.push(cleanOpen);
      }
    }

    return {
      channels: nextChannels,
      newlyAssigned,
      changed: !channelsMatchSignature(existingChannels, nextChannels),
    };
  }

  // Post-startup hot-plug / manual scan: clean existing duplicates first, then place new inputs into open slots
  const cleaned = sanitizeAndAutoNameChannels(existingChannels);
  const nextChannels: InputChannel[] = cleaned.map((c, idx) => ({
    ...c,
    index: idx + 1,
  }));

  while (nextChannels.length < minSlots) {
    nextChannels.push(createOpenChannelSlot(nextChannels.length + 1));
  }

  const occupiedIds = new Set<string>();
  const occupiedLabels = new Set<string>();

  for (let i = 0; i < nextChannels.length; i++) {
    const ch = nextChannels[i];
    if (ch.hardwareInputId) {
      occupiedIds.add(ch.hardwareInputId);
      const norm = normalizeDeviceLabel(ch.hardwareInputLabel).toLowerCase();
      if (norm) occupiedLabels.add(norm);
    }
  }

  for (const dev of usableInputs) {
    const cleanLabel = normalizeDeviceLabel(dev.label) || dev.deviceId;
    const normKey = cleanLabel.toLowerCase();

    if (dev.deviceId && occupiedIds.has(dev.deviceId)) continue;

    // Refresh rotating OS deviceId in-place if the exact same physical input label already occupies a strip
    if (normKey && occupiedLabels.has(normKey)) {
      const matchIdx = nextChannels.findIndex(
        (c) => c.hardwareInputLabel && normalizeDeviceLabel(c.hardwareInputLabel).toLowerCase() === normKey
      );
      if (matchIdx >= 0 && dev.deviceId && nextChannels[matchIdx].hardwareInputId !== dev.deviceId) {
        occupiedIds.add(dev.deviceId);
        nextChannels[matchIdx] = {
          ...nextChannels[matchIdx],
          hardwareInputId: dev.deviceId,
        };
      }
      continue;
    }

    let openIdx = nextChannels.findIndex((c) => !c.hardwareInputId);
    if (openIdx < 0) {
      const nextNum = nextChannels.length + 1;
      nextChannels.push(createOpenChannelSlot(nextNum));
      openIdx = nextChannels.length - 1;
    }

    const slot = nextChannels[openIdx];
    const derived = deriveAutoChannelNameAndRole(cleanLabel, slot.index);
    const assignedId = dev.deviceId || cleanLabel;
    nextChannels[openIdx] = {
      ...slot,
      name: derived.name,
      role: derived.role,
      gainDb: 24,
      faderDb: 0,
      mute: false,
      solo: false,
      stereoLinked: false,
      hardwareInputId: assignedId,
      hardwareInputLabel: cleanLabel,
    };

    occupiedIds.add(assignedId);
    if (normKey) occupiedLabels.add(normKey);
    newlyAssigned.push({
      channelId: slot.id,
      channelIndex: slot.index,
      deviceId: assignedId,
      label: cleanLabel,
    });
  }

  return {
    channels: nextChannels,
    newlyAssigned,
    changed: !channelsMatchSignature(existingChannels, nextChannels),
  };
}
