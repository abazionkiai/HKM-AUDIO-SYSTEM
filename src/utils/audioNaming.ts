/**
 * HKM Audio System - Dynamic Audio Device Naming & Sanitation System
 * Automatically binds real connected physical & virtual hardware devices to channel strips
 * Eliminates all static/mock placeholder names across the entire audio console.
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
 * Derives a clean, concise, hardware-accurate scribble strip name and audio role
 * from a connected physical or virtual audio device descriptor.
 */
export function deriveAutoChannelNameAndRole(
  deviceLabel?: string,
  channelIndex: number = 1
): { name: string; role: string } {
  if (!deviceLabel || deviceLabel.trim() === '') {
    return {
      name: `Input ${channelIndex}`,
      role: `Live Input ${channelIndex}`,
    };
  }

  // Strip OS prefix noise
  let raw = deviceLabel.replace(/^Default\s*-\s*/i, '').trim();
  // Strip trailing device ID hex patterns e.g. (046d:0825)
  raw = raw.replace(/\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)$/, '').trim();

  const lower = raw.toLowerCase();

  // 1. Determine accurate live signal role
  let role = 'Live Input';
  if (lower.includes('cable') || lower.includes('virtual') || lower.includes('voicemeeter')) {
    role = 'Virtual Ingest';
  } else if (lower.includes('stereo mix') || lower.includes('loopback') || lower.includes('what u hear')) {
    role = 'Loopback In';
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
    role = 'Audio Interface';
  }

  // 2. Synthesize clean, human-readable channel scribble name (max 18 chars)
  let name = raw;

  if (lower.includes('vb-audio') || lower.includes('cable output') || lower.includes('virtual cable')) {
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
  } else if (lower.includes('stereo mix')) {
    name = 'Stereo Mix';
  } else if (lower.includes('realtek')) {
    if (lower.includes('line')) {
      name = 'Realtek Line In';
    } else {
      name = 'Realtek Mic';
    }
  } else if (lower.includes('intel')) {
    name = 'Intel Mic Array';
  } else {
    // If format is "Type (Hardware Model)", flip to "Model Type" for instant glanceability
    // e.g. "Microphone (High Definition Audio Device)" -> "HD Audio Mic"
    const match = raw.match(/^([A-Za-z\s]+)\s*\((.+)\)$/);
    if (match) {
      const type = match[1].trim();
      const hardware = match[2].trim().replace(/\(R\)/gi, '').replace(/\s+/g, ' ');
      const shortType = type.toLowerCase().includes('micro') ? 'Mic' : type;
      name = `${hardware} ${shortType}`;
    } else {
      name = raw;
    }
  }

  // Ensure name is clean, doesn't overflow, and has no repeated whitespace
  name = name.replace(/\s+/g, ' ').trim();
  if (name.length > 18) {
    name = name.slice(0, 17) + '…';
  }

  return { name, role };
}

/**
 * Sanitizes and auto-configures a list of channels against detected hardware inputs.
 * Replaces any legacy mock names with dynamically derived live device labels.
 */
export function sanitizeAndAutoNameChannels(
  channels: InputChannel[],
  inputDevices: MediaDeviceInfo[] = []
): InputChannel[] {
  return channels.map((ch, idx) => {
    // Check if channel has legacy mock name
    const hasMockName = isLegacyMockName(ch.name);

    // Check if channel already has an active hardware input label
    if (ch.hardwareInputLabel && !hasMockName) {
      return ch;
    }

    // Attempt to match with connected device at this index
    const matchedDev = inputDevices[idx];
    if (matchedDev && matchedDev.label) {
      const { name, role } = deriveAutoChannelNameAndRole(matchedDev.label, ch.index);
      return {
        ...ch,
        name,
        role,
        hardwareInputId: matchedDev.deviceId,
        hardwareInputLabel: matchedDev.label,
      };
    }

    // If channel had a mock name or no device, provide clean neutral numbering
    if (hasMockName || !ch.name) {
      return {
        ...ch,
        name: `Input ${ch.index}`,
        role: `Stereo Input ${ch.index}`,
        stereoLinked: false,
      };
    }

    return { ...ch, stereoLinked: false };
  });
}

/**
 * Detects multi-channel audio devices (e.g. PCIe cards or motherboard 5.1/7.1 rear clusters)
 * and expands them into discrete physical rear-panel jack ports for independent zone routing.
 */
export function expandOutputEndpoints(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const result: MediaDeviceInfo[] = [];

  for (const dev of devices) {
    const rawLabel = (dev.label || '').trim();
    const lower = rawLabel.toLowerCase();

    // Check if device represents a multi-channel soundcard or motherboard surround soundcard
    const isMultiChannelCandidate =
      lower.includes('speakers') ||
      lower.includes('realtek') ||
      lower.includes('sound blaster') ||
      lower.includes('audigy') ||
      lower.includes('ae-') ||
      lower.includes('xonar') ||
      lower.includes('high definition audio') ||
      lower.includes('pci') ||
      lower.includes('surround') ||
      lower.includes('7.1') ||
      lower.includes('5.1');

    // Do not expand virtual cables, loopbacks, or explicit headphone devices
    const isVirtualOrHeadphones =
      lower.includes('cable') ||
      lower.includes('virtual') ||
      lower.includes('voicemeeter') ||
      lower.includes('headphone') ||
      lower.includes('buds') ||
      lower.includes('bluetooth') ||
      lower.includes('airpods');

    if (isMultiChannelCandidate && !isVirtualOrHeadphones) {
      const cleanBase = rawLabel
        .replace(/^Default\s*-\s*/i, '')
        .replace(/\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)$/, '')
        .trim();

      // Create synthetic discrete MediaDeviceInfo-compatible representations for each rear jack pair
      result.push({
        deviceId: `${dev.deviceId}::jack-1-2`,
        groupId: dev.groupId,
        kind: 'audiooutput',
        label: `${cleanBase} · Jack 1/2 [Green: Front PA L/R]`,
        toJSON: dev.toJSON ? () => dev.toJSON() : () => ({}),
      } as MediaDeviceInfo);

      result.push({
        deviceId: `${dev.deviceId}::jack-3-4`,
        groupId: dev.groupId,
        kind: 'audiooutput',
        label: `${cleanBase} · Jack 3/4 [Orange: Center / Sub]`,
        toJSON: dev.toJSON ? () => dev.toJSON() : () => ({}),
      } as MediaDeviceInfo);

      result.push({
        deviceId: `${dev.deviceId}::jack-5-6`,
        groupId: dev.groupId,
        kind: 'audiooutput',
        label: `${cleanBase} · Jack 5/6 [Black: Rear / Delay]`,
        toJSON: dev.toJSON ? () => dev.toJSON() : () => ({}),
      } as MediaDeviceInfo);

      result.push({
        deviceId: `${dev.deviceId}::jack-7-8`,
        groupId: dev.groupId,
        kind: 'audiooutput',
        label: `${cleanBase} · Jack 7/8 [Gray: Side / Aux]`,
        toJSON: dev.toJSON ? () => dev.toJSON() : () => ({}),
      } as MediaDeviceInfo);
    } else {
      result.push(dev);
    }
  }

  return result;
}
