import type {
  DriverBackend,
  DspConfig,
  EqFilterType,
  HardwareCapabilities,
  HardwareDevice,
  PlatformTarget,
} from '../types/audio.ts';

export type PluginKind = 'hardware-driver' | 'dsp-processor';

export interface PluginLifecycleContext {
  platform: PlatformTarget;
  sampleRate: number;
  registerHardwareDevice: (device: HardwareDevice) => void;
  unregisterHardwareDevice: (deviceId: string) => void;
  logAudit: (action: string, detail: string) => void;
}

export interface DspPluginParameter {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  value: number;
}

export interface DspPluginStageSpec {
  filterType: EqFilterType;
  frequencyHz: number;
  gainDb: number;
  q: number;
  camillaStageType: 'Biquad' | 'Compressor' | 'Limiter' | 'Delay';
}

export interface AudioPluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  kind: PluginKind;
  description: string;
  supportedPlatforms: PlatformTarget[];
  protocols: DriverBackend[];
  entryPoint: string;
  enabled: boolean;
  builtin?: boolean;
  // For hardware-driver plugins:
  hardwareSpec?: {
    manufacturer: string;
    model: string;
    tier: 1 | 2 | 3 | 4;
    tierLabel: string;
    category: HardwareDevice['category'];
    connectionType: string;
    sampleRates: number[];
    defaultSampleRate: number;
    defaultBufferSize: number;
    capabilities: HardwareCapabilities;
  };
  // For dsp-processor plugins:
  dspSpec?: {
    stage: DspPluginStageSpec;
    parameters: DspPluginParameter[];
  };
}

export interface LoadedPluginRecord extends AudioPluginManifest {
  loadedAt: string;
  status: 'active' | 'disabled' | 'error';
  errorMessage?: string;
}

export const BUILTIN_PLUGINS: AudioPluginManifest[] = [
  {
    id: 'plugin-hw-yamaha-mg-usb',
    name: 'Yamaha MG-XU Stereo USB Driver',
    version: '1.2.0',
    author: 'Church Audio Core Team',
    kind: 'hardware-driver',
    description: 'Steinberg ASIO / WASAPI / CoreAudio / ALSA class-compliant adapter for Yamaha MG12XU, MG16XU, and MG20XU.',
    supportedPlatforms: ['windows', 'macos', 'linux'],
    protocols: ['ASIO', 'WASAPI Exclusive', 'CoreAudio', 'ALSA', 'PipeWire'],
    entryPoint: 'integrations/yamaha-mg/driver.ts',
    enabled: true,
    builtin: true,
  },
  {
    id: 'plugin-hw-behringer-osc',
    name: 'Behringer X32 / X Air OSC + USB Adapter',
    version: '2.0.1',
    author: 'Church Audio Core Team',
    kind: 'hardware-driver',
    description: 'Bidirectional UDP OSC control (Ports 10023/10024) + 18x18/32x32 multitrack audio driver.',
    supportedPlatforms: ['windows', 'macos', 'linux'],
    protocols: ['ASIO', 'WASAPI Exclusive', 'CoreAudio', 'ALSA', 'PipeWire'],
    entryPoint: 'integrations/behringer-osc/driver.ts',
    enabled: true,
    builtin: true,
  },
  {
    id: 'plugin-hw-rme-totalmix',
    name: 'RME Fireface / Babyface ASIO & CoreAudio Bridge',
    version: '1.4.0',
    author: 'Church Audio Core Team',
    kind: 'hardware-driver',
    description: 'Ultra-low-latency hardware adapter for RME Fireface UCX II and Babyface Pro FS via ASIO / CoreAudio / OSC TotalMix.',
    supportedPlatforms: ['windows', 'macos', 'linux'],
    protocols: ['ASIO', 'CoreAudio', 'ALSA'],
    entryPoint: 'integrations/rme-totalmix/driver.ts',
    enabled: true,
    builtin: true,
  },
  {
    id: 'plugin-dsp-camilla-peq',
    name: 'CamillaDSP 6-Band Parametric & Dynamics Core',
    version: '2.1.0',
    author: 'CamillaDSP Integration',
    kind: 'dsp-processor',
    description: 'Deterministic biquad IIR filter bank, RMS compressor, and brickwall safety limiter.',
    supportedPlatforms: ['windows', 'macos', 'linux'],
    protocols: ['ASIO', 'WASAPI Exclusive', 'CoreAudio', 'PipeWire', 'ALSA'],
    entryPoint: 'engines/dsp-engine/camilla-core.ts',
    enabled: true,
    builtin: true,
    dspSpec: {
      stage: {
        filterType: 'peaking',
        frequencyHz: 220,
        gainDb: -2.5,
        q: 2.0,
        camillaStageType: 'Biquad',
      },
      parameters: [
        { key: 'frequencyHz', label: 'Center Freq', min: 40, max: 12000, step: 10, unit: 'Hz', value: 220 },
        { key: 'gainDb', label: 'Gain', min: -18, max: 9, step: 0.5, unit: 'dB', value: -2.5 },
        { key: 'q', label: 'Q Factor', min: 0.4, max: 12, step: 0.1, unit: '', value: 2.0 },
      ],
    },
  },
  {
    id: 'plugin-dsp-speech-dereverb',
    name: 'Sanctuary Speech Clarity & Boxiness Filter',
    version: '1.0.3',
    author: 'Church Audio Labs',
    kind: 'dsp-processor',
    description: 'Dynamic-style nasal/boxiness attenuator targeting 380–520 Hz room reflections for spoken sermons.',
    supportedPlatforms: ['windows', 'macos', 'linux'],
    protocols: ['ASIO', 'WASAPI Exclusive', 'CoreAudio', 'PipeWire'],
    entryPoint: 'modules/dsp-plugins/speech-clarity.ts',
    enabled: false,
    builtin: true,
    dspSpec: {
      stage: {
        filterType: 'peaking',
        frequencyHz: 430,
        gainDb: -3.5,
        q: 2.8,
        camillaStageType: 'Biquad',
      },
      parameters: [
        { key: 'frequencyHz', label: 'Resonance Freq', min: 250, max: 900, step: 10, unit: 'Hz', value: 430 },
        { key: 'gainDb', label: 'Attenuation', min: -12, max: 0, step: 0.5, unit: 'dB', value: -3.5 },
        { key: 'q', label: 'Notch Q', min: 1.0, max: 8.0, step: 0.2, unit: '', value: 2.8 },
      ],
    },
  },
];

export const SAMPLE_CUSTOM_HARDWARE_PLUGIN = JSON.stringify(
  {
    id: 'plugin-hw-midas-m32r',
    name: 'Midas M32R Live Console Adapter',
    version: '1.0.0',
    author: 'Community Plugin',
    kind: 'hardware-driver',
    description: 'Adds Midas M32R 32x32 USB + OSC fader/preamp control across Windows ASIO, macOS CoreAudio, and Linux ALSA.',
    supportedPlatforms: ['windows', 'macos', 'linux'],
    protocols: ['ASIO', 'WASAPI Exclusive', 'CoreAudio', 'ALSA'],
    entryPoint: 'custom://midas-m32r-adapter',
    enabled: true,
    hardwareSpec: {
      manufacturer: 'Midas',
      model: 'M32R Live',
      tier: 2,
      tierLabel: 'Tier 2 · Digital Console (Plugin)',
      category: 'Digital Mixer',
      connectionType: 'DN32-Live USB (32x32) + Ethernet OSC',
      sampleRates: [44100, 48000],
      defaultSampleRate: 48000,
      defaultBufferSize: 128,
      capabilities: {
        perChannelFaderControl: true,
        perChannelCapture: true,
        stereoMixCapture: true,
        phantomPowerControl: true,
        remoteMuteSolo: true,
        networkMatrix: true,
        calibratedMeasurement: false,
        maxInputChannels: 32,
        maxOutputChannels: 32,
        controlProtocol: 'UDP OSC (Port 10023) + Midas Pro Preamp Control',
        supportedDrivers: ['ASIO', 'WASAPI Exclusive', 'CoreAudio', 'ALSA'],
        limitationsNote: 'Loaded via dynamic Hardware Driver Plugin. Full 32-channel motorized recall and preamp control enabled.',
      },
    },
  },
  null,
  2
);

export const SAMPLE_CUSTOM_DSP_PLUGIN = JSON.stringify(
  {
    id: 'plugin-dsp-vocal-air',
    name: 'Warm Choir Air & Sibilance Guard',
    version: '1.0.0',
    author: 'Community Plugin',
    kind: 'dsp-processor',
    description: 'High-shelf presence lift above 8.5 kHz to restore vocal articulation in carpeted sanctuaries.',
    supportedPlatforms: ['windows', 'macos', 'linux'],
    protocols: ['ASIO', 'WASAPI Exclusive', 'CoreAudio', 'PipeWire'],
    entryPoint: 'custom://choir-air-shelf',
    enabled: true,
    dspSpec: {
      stage: {
        filterType: 'highshelf',
        frequencyHz: 8500,
        gainDb: 2.5,
        q: 0.7,
        camillaStageType: 'Biquad',
      },
      parameters: [
        { key: 'frequencyHz', label: 'Shelf Freq', min: 4000, max: 14000, step: 250, unit: 'Hz', value: 8500 },
        { key: 'gainDb', label: 'Air Gain', min: -6, max: 6, step: 0.5, unit: 'dB', value: 2.5 },
      ],
    },
  },
  null,
  2
);

export function validatePluginManifest(raw: unknown): { valid: boolean; manifest?: AudioPluginManifest; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Plugin manifest must be a JSON object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.id || typeof obj.id !== 'string') return { valid: false, error: 'Missing string "id".' };
  if (!obj.name || typeof obj.name !== 'string') return { valid: false, error: 'Missing string "name".' };
  if (obj.kind !== 'hardware-driver' && obj.kind !== 'dsp-processor') {
    return { valid: false, error: 'Field "kind" must be "hardware-driver" or "dsp-processor".' };
  }
  if (!Array.isArray(obj.supportedPlatforms) || obj.supportedPlatforms.length === 0) {
    return { valid: false, error: 'Field "supportedPlatforms" must include at least one OS target.' };
  }
  if (obj.kind === 'hardware-driver' && !obj.hardwareSpec) {
    return { valid: false, error: 'Hardware driver plugins require a "hardwareSpec" object.' };
  }
  if (obj.kind === 'dsp-processor' && !obj.dspSpec) {
    return { valid: false, error: 'DSP processor plugins require a "dspSpec" object.' };
  }
  return { valid: true, manifest: obj as unknown as AudioPluginManifest };
}

export function applyDspPluginToConfig(dsp: DspConfig, plugin: LoadedPluginRecord): DspConfig {
  if (plugin.kind !== 'dsp-processor' || !plugin.dspSpec || plugin.status !== 'active') {
    return dsp;
  }
  const { stage } = plugin.dspSpec;
  const updatedBands = dsp.eqBands.map((b, idx) => {
    // Inject plugin parameters onto band 6 (or matching frequency band) safely without mutating others
    if (idx === 5) {
      return {
        ...b,
        label: plugin.name.slice(0, 16),
        enabled: true,
        type: stage.filterType,
        frequency: stage.frequencyHz,
        gainDb: stage.gainDb,
        q: stage.q,
      };
    }
    return b;
  });
  return {
    ...dsp,
    eqBands: updatedBands,
  };
}

export const PLUGIN_SDK_CONTRACT_SNIPPET = `// packages/plugin-contracts/src/index.ts
export interface AudioPlugin {
  readonly id: string;
  readonly version: string;
  readonly kind: 'hardware-driver' | 'dsp-processor';
  readonly supportedPlatforms: ('windows' | 'macos' | 'linux')[];
  readonly protocols: ('ASIO' | 'WASAPI Exclusive' | 'CoreAudio' | 'PipeWire' | 'ALSA')[];

  onLoad(host: PluginHostContext): Promise<void>;
  onUnload(): Promise<void>;
}

export interface HardwareDriverPlugin extends AudioPlugin {
  kind: 'hardware-driver';
  discoverDevices(): Promise<HardwareDevice[]>;
  getCapabilities(deviceId: string): HardwareCapabilities;
  setChannelGain?(channel: number, gainDb: number): Promise<void>;
  setChannelMute?(channel: number, muted: boolean): Promise<void>;
}

export interface DspProcessorPlugin extends AudioPlugin {
  kind: 'dsp-processor';
  getParameters(): DspPluginParameter[];
  setParameter(key: string, value: number): void;
  toCamillaDspStage(): CamillaFilterSpec;
}`;
