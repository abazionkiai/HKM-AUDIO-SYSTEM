import type {
  MidiDeviceInfo,
  MidiMapping,
  MidiMessageType,
  MidiPacket,
  MidiTargetParam,
} from '../types/audio.ts';

export interface MidiTargetSpec {
  id: MidiTargetParam;
  label: string;
  category: 'DSP Gain & Filters' | 'Parametric EQ' | 'Dynamics' | 'Master & Channels';
  defaultMode: 'continuous' | 'toggle' | 'momentary';
  minVal: number;
  maxVal: number;
  unit: string;
}

export const MIDI_TARGET_SPECS: MidiTargetSpec[] = [
  { id: 'dsp.inputTrimDb', label: 'DSP Input Gain Trim', category: 'DSP Gain & Filters', defaultMode: 'continuous', minVal: -12, maxVal: 12, unit: 'dB' },
  { id: 'dsp.hpfHz', label: 'High-Pass Filter (HPF) Cutoff', category: 'DSP Gain & Filters', defaultMode: 'continuous', minVal: 20, maxVal: 250, unit: 'Hz' },
  { id: 'dsp.eqBand1.gainDb', label: 'EQ Band 1 (Sub Trim) Gain', category: 'Parametric EQ', defaultMode: 'continuous', minVal: -15, maxVal: 9, unit: 'dB' },
  { id: 'dsp.eqBand2.gainDb', label: 'EQ Band 2 (Mud Cut) Gain', category: 'Parametric EQ', defaultMode: 'continuous', minVal: -15, maxVal: 9, unit: 'dB' },
  { id: 'dsp.eqBand3.gainDb', label: 'EQ Band 3 (Boxiness) Gain', category: 'Parametric EQ', defaultMode: 'continuous', minVal: -15, maxVal: 9, unit: 'dB' },
  { id: 'dsp.eqBand4.gainDb', label: 'EQ Band 4 (Clarity) Gain', category: 'Parametric EQ', defaultMode: 'continuous', minVal: -15, maxVal: 9, unit: 'dB' },
  { id: 'dsp.eqBand5.gainDb', label: 'EQ Band 5 (Presence) Gain', category: 'Parametric EQ', defaultMode: 'continuous', minVal: -15, maxVal: 9, unit: 'dB' },
  { id: 'dsp.eqBand6.gainDb', label: 'EQ Band 6 (Air Shelf) Gain', category: 'Parametric EQ', defaultMode: 'continuous', minVal: -15, maxVal: 9, unit: 'dB' },
  { id: 'dsp.compressor.thresholdDb', label: 'Compressor Threshold', category: 'Dynamics', defaultMode: 'continuous', minVal: -40, maxVal: 0, unit: 'dBFS' },
  { id: 'dsp.limiter.ceilingDb', label: 'Safety Limiter Ceiling', category: 'Dynamics', defaultMode: 'continuous', minVal: -6, maxVal: 0, unit: 'dBFS' },
  { id: 'dsp.bypassed', label: 'DSP Bypass (A/B Toggle)', category: 'Master & Channels', defaultMode: 'toggle', minVal: 0, maxVal: 1, unit: '' },
  { id: 'master.emergencyMute', label: 'Master Safe Mute (PA)', category: 'Master & Channels', defaultMode: 'toggle', minVal: 0, maxVal: 1, unit: '' },
  { id: 'channel.1.faderDb', label: 'Channel 1 Fader', category: 'Master & Channels', defaultMode: 'continuous', minVal: -36, maxVal: 10, unit: 'dB' },
  { id: 'channel.2.faderDb', label: 'Channel 2 Fader', category: 'Master & Channels', defaultMode: 'continuous', minVal: -36, maxVal: 10, unit: 'dB' },
  { id: 'channel.1.mute', label: 'Channel 1 Mute', category: 'Master & Channels', defaultMode: 'toggle', minVal: 0, maxVal: 1, unit: '' },
  { id: 'channel.2.mute', label: 'Channel 2 Mute', category: 'Master & Channels', defaultMode: 'toggle', minVal: 0, maxVal: 1, unit: '' },
];

export const DEFAULT_MIDI_MAPPINGS: MidiMapping[] = [
  {
    id: 'map-gain-trim',
    label: 'Master DSP Gain Trim',
    enabled: true,
    deviceName: 'Any Controller',
    channel: 1,
    messageType: 'cc',
    controller: 7,
    target: 'dsp.inputTrimDb',
    mode: 'continuous',
    minVal: -12,
    maxVal: 12,
    invert: false,
  },
  {
    id: 'map-hpf',
    label: 'Speech HPF Cutoff',
    enabled: true,
    deviceName: 'Any Controller',
    channel: 1,
    messageType: 'cc',
    controller: 16,
    target: 'dsp.hpfHz',
    mode: 'continuous',
    minVal: 20,
    maxVal: 250,
    invert: false,
  },
  {
    id: 'map-eq2-mud',
    label: 'EQ Band 2 (220 Hz Mud Cut)',
    enabled: true,
    deviceName: 'Any Controller',
    channel: 1,
    messageType: 'cc',
    controller: 17,
    target: 'dsp.eqBand2.gainDb',
    mode: 'continuous',
    minVal: -15,
    maxVal: 9,
    invert: false,
  },
  {
    id: 'map-eq4-clarity',
    label: 'EQ Band 4 (2.8 kHz Clarity)',
    enabled: true,
    deviceName: 'Any Controller',
    channel: 1,
    messageType: 'cc',
    controller: 18,
    target: 'dsp.eqBand4.gainDb',
    mode: 'continuous',
    minVal: -15,
    maxVal: 9,
    invert: false,
  },
  {
    id: 'map-master-mute',
    label: 'Emergency PA Safe Mute',
    enabled: true,
    deviceName: 'Any Controller',
    channel: 1,
    messageType: 'note',
    controller: 48,
    target: 'master.emergencyMute',
    mode: 'toggle',
    minVal: 0,
    maxVal: 1,
    invert: false,
  },
  {
    id: 'map-dsp-bypass',
    label: 'DSP Bypass A/B Button',
    enabled: true,
    deviceName: 'Any Controller',
    channel: 1,
    messageType: 'note',
    controller: 49,
    target: 'dsp.bypassed',
    mode: 'toggle',
    minVal: 0,
    maxVal: 1,
    invert: false,
  },
];

export const CONTROLLER_PRESETS: Record<string, { name: string; subtitle: string; mappings: MidiMapping[] }> = {
  'xtouch-compact': {
    name: 'Behringer X-Touch Compact',
    subtitle: 'Motorized Faders (CC 1–8) + Encoders (CC 10–17) + Mute Buttons (Note 0–7)',
    mappings: [
      { id: 'xt-1', label: 'Fader 1 → DSP Gain Trim', enabled: true, deviceName: 'X-TOUCH COMPACT', channel: 1, messageType: 'cc', controller: 1, target: 'dsp.inputTrimDb', mode: 'continuous', minVal: -12, maxVal: 12, invert: false },
      { id: 'xt-2', label: 'Fader 2 → CH 1 Fader', enabled: true, deviceName: 'X-TOUCH COMPACT', channel: 1, messageType: 'cc', controller: 2, target: 'channel.1.faderDb', mode: 'continuous', minVal: -36, maxVal: 10, invert: false },
      { id: 'xt-3', label: 'Fader 3 → CH 2 Fader', enabled: true, deviceName: 'X-TOUCH COMPACT', channel: 1, messageType: 'cc', controller: 3, target: 'channel.2.faderDb', mode: 'continuous', minVal: -36, maxVal: 10, invert: false },
      { id: 'xt-4', label: 'Encoder 1 → HPF Cutoff', enabled: true, deviceName: 'X-TOUCH COMPACT', channel: 1, messageType: 'cc', controller: 10, target: 'dsp.hpfHz', mode: 'continuous', minVal: 20, maxVal: 250, invert: false },
      { id: 'xt-5', label: 'Encoder 2 → EQ Mud Cut', enabled: true, deviceName: 'X-TOUCH COMPACT', channel: 1, messageType: 'cc', controller: 11, target: 'dsp.eqBand2.gainDb', mode: 'continuous', minVal: -15, maxVal: 9, invert: false },
      { id: 'xt-6', label: 'Main Mute → Master Safe Mute', enabled: true, deviceName: 'X-TOUCH COMPACT', channel: 1, messageType: 'note', controller: 48, target: 'master.emergencyMute', mode: 'toggle', minVal: 0, maxVal: 1, invert: false },
    ],
  },
  nanokontrol2: {
    name: 'Korg nanoKONTROL2',
    subtitle: 'Compact Volunteer Desk (CC 0–7 Faders · CC 16–23 Knobs · CC 48–55 Mute)',
    mappings: DEFAULT_MIDI_MAPPINGS.map((m) => ({ ...m, deviceName: 'nanoKONTROL2' })),
  },
  'akai-midimix': {
    name: 'Akai Professional MIDImix',
    subtitle: '8-Channel Volunteer Faders + 24 EQ Knobs + Master Fader (CC 62)',
    mappings: [
      { id: 'ak-1', label: 'Master Fader (CC 62) → DSP Gain Trim', enabled: true, deviceName: 'MIDI Mix', channel: 1, messageType: 'cc', controller: 62, target: 'dsp.inputTrimDb', mode: 'continuous', minVal: -12, maxVal: 12, invert: false },
      { id: 'ak-2', label: 'Knob 1 (CC 16) → HPF Cutoff', enabled: true, deviceName: 'MIDI Mix', channel: 1, messageType: 'cc', controller: 16, target: 'dsp.hpfHz', mode: 'continuous', minVal: 20, maxVal: 250, invert: false },
      { id: 'ak-3', label: 'Knob 2 (CC 17) → EQ Band 2 Gain', enabled: true, deviceName: 'MIDI Mix', channel: 1, messageType: 'cc', controller: 17, target: 'dsp.eqBand2.gainDb', mode: 'continuous', minVal: -15, maxVal: 9, invert: false },
      { id: 'ak-4', label: 'Knob 3 (CC 18) → EQ Band 4 Gain', enabled: true, deviceName: 'MIDI Mix', channel: 1, messageType: 'cc', controller: 18, target: 'dsp.eqBand4.gainDb', mode: 'continuous', minVal: -15, maxVal: 9, invert: false },
      { id: 'ak-5', label: 'Solo/Mute (Note 27) → Safe Mute', enabled: true, deviceName: 'MIDI Mix', channel: 1, messageType: 'note', controller: 27, target: 'master.emergencyMute', mode: 'toggle', minVal: 0, maxVal: 1, invert: false },
    ],
  },
};

export function scaleMidiValue(rawValue: number, mapping: MidiMapping): number {
  const maxRaw = mapping.messageType === 'pitchbend' ? 16383 : 127;
  let norm = Math.max(0, Math.min(1, rawValue / maxRaw));
  if (mapping.invert) norm = 1 - norm;
  const scaled = mapping.minVal + norm * (mapping.maxVal - mapping.minVal);
  return Number(scaled.toFixed(2));
}

type PacketListener = (packet: MidiPacket) => void;
type DeviceListener = (devices: MidiDeviceInfo[]) => void;

class WebMidiEngine {
  private midiAccess: MIDIAccess | null = null;
  private packetListeners = new Set<PacketListener>();
  private deviceListeners = new Set<DeviceListener>();
  private supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

  public isSupported(): boolean {
    return this.supported;
  }

  public isConnected(): boolean {
    return this.midiAccess !== null;
  }

  public async requestAccess(): Promise<{ ok: boolean; devices: MidiDeviceInfo[]; error?: string }> {
    if (!this.supported) {
      return {
        ok: false,
        devices: [],
        error: 'Web MIDI API is not available in this browser context. Use Chrome/Edge/Desktop Tauri or test with the Virtual MIDI Surface.',
      };
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.attachPortListeners();
      this.midiAccess.onstatechange = () => {
        this.attachPortListeners();
        this.emitDevices();
      };
      const list = this.getDevices();
      this.emitDevices();
      return { ok: true, devices: list };
    } catch (err) {
      return {
        ok: false,
        devices: [],
        error: err instanceof Error ? err.message : 'MIDI permission denied.',
      };
    }
  }

  public getDevices(): MidiDeviceInfo[] {
    if (!this.midiAccess) return [];
    const list: MidiDeviceInfo[] = [];
    this.midiAccess.inputs.forEach((inp) => {
      list.push({
        id: inp.id,
        name: inp.name || 'MIDI Input Device',
        manufacturer: inp.manufacturer || 'Generic USB MIDI',
        direction: 'input',
        state: inp.state === 'connected' ? 'connected' : 'disconnected',
      });
    });
    this.midiAccess.outputs.forEach((out) => {
      list.push({
        id: out.id,
        name: out.name || 'MIDI Output Device',
        manufacturer: out.manufacturer || 'Generic USB MIDI',
        direction: 'output',
        state: out.state === 'connected' ? 'connected' : 'disconnected',
      });
    });
    return list;
  }

  public subscribePackets(cb: PacketListener): () => void {
    this.packetListeners.add(cb);
    return () => this.packetListeners.delete(cb);
  }

  public subscribeDevices(cb: DeviceListener): () => void {
    this.deviceListeners.add(cb);
    return () => this.deviceListeners.delete(cb);
  }

  public injectSimulatedPacket(
    deviceName: string,
    channel: number,
    messageType: MidiMessageType,
    controller: number,
    rawValue: number
  ): void {
    const packet: MidiPacket = {
      deviceName,
      channel,
      messageType,
      controller,
      rawValue,
      timestamp: new Date().toISOString(),
    };
    this.packetListeners.forEach((cb) => cb(packet));
  }

  public sendFeedback(channel: number, messageType: MidiMessageType, controller: number, value0to127: number): void {
    if (!this.midiAccess) return;
    const chOffset = Math.max(0, Math.min(15, channel - 1));
    const clamped = Math.max(0, Math.min(127, Math.round(value0to127)));
    const status = (messageType === 'note' ? 0x90 : 0xb0) + chOffset;
    this.midiAccess.outputs.forEach((out) => {
      if (out.state === 'connected') {
        try {
          out.send([status, controller & 0x7f, clamped]);
        } catch {
          // ignore disconnected output
        }
      }
    });
  }

  private emitDevices(): void {
    const list = this.getDevices();
    this.deviceListeners.forEach((cb) => cb(list));
  }

  private attachPortListeners(): void {
    if (!this.midiAccess) return;
    this.midiAccess.inputs.forEach((input) => {
      input.onmidimessage = (event: MIDIMessageEvent) => {
        if (!event.data || event.data.length < 2) return;
        const status = event.data[0];
        const data1 = event.data[1];
        const data2 = event.data.length > 2 ? event.data[2] : 0;
        const cmd = status & 0xf0;
        const channel = (status & 0x0f) + 1;

        let messageType: MidiMessageType | null = null;
        let controller = data1;
        let rawValue = data2;

        if (cmd === 0xb0) {
          messageType = 'cc';
        } else if (cmd === 0x90 && data2 > 0) {
          messageType = 'note';
        } else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) {
          messageType = 'note';
          rawValue = 0;
        } else if (cmd === 0xe0) {
          messageType = 'pitchbend';
          controller = 0;
          rawValue = (data2 << 7) | data1;
        }

        if (!messageType) return;
        const packet: MidiPacket = {
          deviceName: input.name || 'USB MIDI Controller',
          channel,
          messageType,
          controller,
          rawValue,
          timestamp: new Date().toISOString(),
        };
        this.packetListeners.forEach((cb) => cb(packet));
      };
    });
  }
}

export const midiEngine = new WebMidiEngine();
