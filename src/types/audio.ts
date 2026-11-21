export type PlatformTarget = 'windows' | 'macos' | 'linux';

export type DriverBackend =
  | 'WASAPI Exclusive'
  | 'WASAPI Shared'
  | 'ASIO'
  | 'CoreAudio'
  | 'PipeWire'
  | 'ALSA';

export type OperatingMode = 'simple' | 'professional';

export type ModuleId =
  | 'console'
  | 'dsp'
  | 'feedback'
  | 'acoustics'
  | 'speakers'
  | 'microphones'
  | 'instruments'
  | 'livestream'
  | 'soundcheck'
  | 'presets'
  | 'ai-engineer'
  | 'hardware'
  | 'virtual-di'
  | 'midi'
  | 'routing'
  | 'recorder';

export type HardwareTier = 1 | 2 | 3 | 4;

export interface HardwareCapabilities {
  perChannelFaderControl: boolean;
  perChannelCapture: boolean;
  stereoMixCapture: boolean;
  phantomPowerControl: boolean;
  remoteMuteSolo: boolean;
  networkMatrix: boolean;
  calibratedMeasurement: boolean;
  maxInputChannels: number;
  maxOutputChannels: number;
  controlProtocol: string;
  supportedDrivers: DriverBackend[];
  limitationsNote: string;
}

export interface HardwareDevice {
  id: string;
  manufacturer: string;
  model: string;
  tier: HardwareTier;
  tierLabel: string;
  category:
    | 'Analog Mixer'
    | 'Multitrack Analog Mixer'
    | 'USB Audio Interface'
    | 'Digital Mixer'
    | 'Dedicated DSP'
    | 'Network Audio'
    | 'Measurement Mic'
    | 'Internal Sound Card'
    | 'Virtual Audio Router';
  connectionType: string;
  sampleRates: number[];
  defaultSampleRate: number;
  defaultBufferSize: number;
  supportedPlatforms: PlatformTarget[];
  capabilities: HardwareCapabilities;
}

export type ControlAuthority = 'hardware-linked' | 'software-dsp' | 'observational';

export type DcaGroupName =
  | 'None'
  | 'DCA 1 · Vox'
  | 'DCA 2 · Band'
  | 'DCA 3 · Choir'
  | 'DCA 4 · Speech';

export interface InputChannel {
  id: string;
  index: number;
  name: string;
  role: string;
  authority: ControlAuthority;
  levelDb: number;
  peakDb: number;
  gainDb: number;
  faderDb: number;
  mute: boolean;
  solo: boolean;
  phantom48v: boolean;
  padDb: boolean;
  polarityInverted: boolean;
  hpfHz: number;
  pan: number;
  noiseFloorDb: number;
  gateThresholdDb: number;
  compThresholdDb: number;
  compRatio: number;
  eqLowDb: number;
  eqMidDb: number;
  eqMidFreqHz: number;
  eqHighDb: number;
  auxSends: {
    stageMon1Db: number;
    stageMon2Db: number;
    streamBusDb: number;
    subsDb: number;
  };
  dcaGroup: DcaGroupName;
  stereoLinked: boolean;
}

export type EqFilterType = 'peaking' | 'lowshelf' | 'highshelf' | 'highpass' | 'lowpass';

export interface EqBand {
  id: string;
  label: string;
  enabled: boolean;
  type: EqFilterType;
  frequency: number;
  gainDb: number;
  q: number;
}

export const ISO_31_FREQUENCIES = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
] as const;

export interface GraphicEq31Band {
  hz?: number;
  frequencyHz?: number;
  index?: number;
  gainDb: number;
}

export interface GraphicEq31Config {
  enabled: boolean;
  rangeDb: 6 | 12;
  stereoLinked?: boolean;
  activeChannel?: 'L' | 'R';
  bands: GraphicEq31Band[];
  bandsRight?: GraphicEq31Band[];
  outputAssignment?: string;
}

export interface CrossoverBandConfig {
  name: string;
  enabled: boolean;
  gainDb: number;
  mute: boolean;
  solo: boolean;
  polarityInverted: boolean;
  delayMs: number;
  outputAssignment?: string;
}

export interface SuperBassConfig {
  enabled: boolean;
  mode: 'deep-sub' | 'punch-808' | 'subharmonic';
  boostDb: number;
  subHarmonics: boolean;
  subInfrasoundHpfHz: number;
}

export interface ActiveCrossoverConfig {
  enabled: boolean;
  stereoLinked?: boolean;
  activeChannel?: 'L' | 'R';
  subToMidHz: number;
  midToHighHz: number;
  slope: 'LR24' | 'LR48' | 'BW18';
  slopeDbPerOct?: number;
  sub: CrossoverBandConfig;
  mid: CrossoverBandConfig;
  high: CrossoverBandConfig;
  subRight?: CrossoverBandConfig;
  midRight?: CrossoverBandConfig;
  highRight?: CrossoverBandConfig;
  outputAssignment?: string;
  superBass?: SuperBassConfig;
}

export interface CleanStandbyConfig {
  dcBlockerEnabled: boolean;
  dcBlockerHz?: number;
  mainsHumNotch: 'off' | '50hz' | '60hz';
  adaptiveStandbyGate: boolean;
  standbyGateEnabled?: boolean;
  standbyGateThresholdDb: number;
  standbyGateHoldMs?: number;
}

export interface SmartAgcConfig {
  enabled: boolean;
  targetRmsDb: number;
  maxBoostDb: number;
  maxCutDb: number;
  gateFloorDb: number;
}

export interface DspConfig {
  bypassed: boolean;
  inputTrimDb: number;
  hpfEnabled: boolean;
  hpfHz: number;
  lpfEnabled: boolean;
  lpfHz: number;
  eqBands: EqBand[];
  compressor: {
    enabled: boolean;
    thresholdDb: number;
    ratio: number;
    attackMs: number;
    releaseMs: number;
    makeupDb: number;
  };
  limiter: {
    enabled: boolean;
    ceilingDb: number;
    releaseMs: number;
  };
  gate: {
    enabled: boolean;
    thresholdDb: number;
    rangeDb: number;
  };
  deEsser: {
    enabled: boolean;
    frequencyHz: number;
    thresholdDb: number;
  };
  polarityInverted: boolean;
  stereoWidth: number; // 0 to 1.5 (1 = normal)
  masterDelayMs: number;
  masterOutputGainDb?: number;
  smartAgc?: SmartAgcConfig;
  graphicEq31?: GraphicEq31Config;
  crossover?: ActiveCrossoverConfig;
  cleanStandby?: CleanStandbyConfig;
}

export interface BroadcastDspConfig {
  enabled: boolean;
  targetLufs: number;
  speechCompThresholdDb: number;
  speechCompRatio: number;
  limiterCeilingDb: number;
  lowCutHz: number;
  presenceBoostDb: number;
  monoSum: boolean;
  avSyncOffsetMs: number;
}

export interface SpeakerZone {
  id: string;
  name: string;
  role: 'main-lr' | 'center' | 'sub' | 'rear-fill' | 'stage-monitor' | 'overflow';
  x: number; // 0-100 on floor plan
  y: number; // 0-100 on floor plan
  rotationDeg: number;
  dispersionDeg: number;
  distanceMeters: number;
  delayMs: number;
  levelDb: number;
  mute: boolean;
  polarityInverted: boolean;
  crossoverHz: number;
  crossoverSlope: 'LR24' | 'BW18' | 'None';
  limiterDb: number;
  hardwareOutput: string;
}

export interface ServicePreset {
  id: string;
  name: string;
  category: string;
  description: string;
  version: string;
  updatedAt: string;
  dsp: DspConfig;
  broadcastDsp: BroadcastDspConfig;
}

export interface ConfigurationVersion {
  id: string;
  version: string;
  presetName: string;
  timestamp: string;
  author: string;
  summary: string;
  deviceId: string;
  platform: PlatformTarget;
  dsp: DspConfig;
  broadcastDsp: BroadcastDspConfig;
  zones: SpeakerZone[];
}

export interface MicrophoneProfile {
  id: string;
  role: string;
  makeModel: string;
  pickupPattern: 'Cardioid' | 'Supercardioid' | 'Omnidirectional' | 'Shotgun';
  sensitivityMvPa: number;
  requiresPhantom: boolean;
  recommendedGainDb: number;
  hpfHz: number;
  eqHints: EqBand[];
  compThresholdDb: number;
  compRatio: number;
  feedbackNote: string;
}

export interface InstrumentProfile {
  id: string;
  instrument: string;
  sourceType: string;
  diRequired: boolean;
  hpfHz: number;
  eqHints: EqBand[];
  compThresholdDb: number;
  compRatio: number;
  diagnosticNotes: string[];
}

export type AudioSourceSimulation = 'live-mic' | 'desktop-audio' | 'pink-noise';

export interface ChannelSignalTelemetry {
  rmsDb: number;
  peakDb: number;
  noiseFloorDb: number;
  compGrDb?: number;
}

export interface SignalTelemetry {
  source: AudioSourceSimulation;
  isRunning: boolean;
  sampleRate: number;
  activeInputLabel: string | null;
  capturedChannels: number;
  preRmsDb: number;
  postRmsDb: number;
  postLRmsDb: number;
  postRRmsDb: number;
  prePeakDb: number;
  postPeakDb: number;
  postLPeakDb: number;
  postRPeakDb: number;
  estimatedLufs: number;
  gainReductionDb: number;
  agcGainDb?: number;
  noiseFloorDb: number;
  channelLevels: ChannelSignalTelemetry[];
  feedbackRisk: {
    detected: boolean;
    frequencyHz: number | null;
    prominenceDb: number;
    persistenceSec: number;
    confidence: number;
  };
  humRisk: {
    detected: boolean;
    fundamentalHz: number | null;
    harmonic100Db: number;
    harmonic150Db: number;
    confidence: number;
  };
  mudRisk: {
    detected: boolean;
    bandEnergyDb: number;
    centerHz: number;
  };
  clippingEvents: number;
}

export interface ProposedDspPatch {
  description: string;
  hpfHz?: number;
  hpfEnabled?: boolean;
  eqBandUpdate?: Partial<EqBand> & { index?: number };
  compressorUpdate?: Partial<DspConfig['compressor']>;
  limiterUpdate?: Partial<DspConfig['limiter']>;
}

export interface DiagnosticFinding {
  id: string;
  timestamp: string;
  severity: 'nominal' | 'advisory' | 'warning' | 'critical';
  category: 'feedback' | 'hum' | 'acoustics' | 'gain-staging' | 'broadcast' | 'hardware';
  title: string;
  evidence: string;
  confidence: number;
  explanation: string;
  physicalChecks: string[];
  proposedPatch?: ProposedDspPatch;
  status: 'pending' | 'approved' | 'verified' | 'dismissed';
  beforeSnapshot?: {
    rmsDb: number;
    peakDb: number;
    problemMetricDb?: number;
  };
  afterSnapshot?: {
    rmsDb: number;
    peakDb: number;
    problemMetricDb?: number;
  };
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
  authority: 'operator' | 'system' | 'ai-approved';
}

export type AuditAuthority = AuditEvent['authority'];

export interface AcousticMeasurement {
  id: string;
  name: string;
  position: string;
  calibratedMic: boolean;
  micModel: string;
  splC: number;
  rt60AvgSec: number;
  octaveRt60: { bandHz: number; seconds: number }[];
  frequencyResponse: { freqHz: number; db: number; targetDb: number }[];
  notes: string;
}

export interface ObsStatus {
  connected: boolean;
  websocketUrl: string;
  activeScene: string;
  scenes: string[];
  streaming: boolean;
  recording: boolean;
  bitrateKbps: number;
  droppedFrames: number;
  cpuUsagePct: number;
  audioMonitorMode: 'Monitor Off' | 'Monitor Only' | 'Monitor and Output';
  syncWarning: boolean;
}

export type MidiMessageType = 'cc' | 'note' | 'pitchbend';

export type MidiControlMode = 'continuous' | 'toggle' | 'momentary';

export type MidiTargetParam =
  | 'dsp.inputTrimDb'
  | 'dsp.hpfHz'
  | 'dsp.eqBand1.gainDb'
  | 'dsp.eqBand2.gainDb'
  | 'dsp.eqBand3.gainDb'
  | 'dsp.eqBand4.gainDb'
  | 'dsp.eqBand5.gainDb'
  | 'dsp.eqBand6.gainDb'
  | 'dsp.compressor.thresholdDb'
  | 'dsp.limiter.ceilingDb'
  | 'dsp.bypassed'
  | 'master.emergencyMute'
  | 'channel.1.faderDb'
  | 'channel.2.faderDb'
  | 'channel.1.mute'
  | 'channel.2.mute';

export interface MidiMapping {
  id: string;
  label: string;
  enabled: boolean;
  deviceName: string;
  channel: number; // 1-16
  messageType: MidiMessageType;
  controller: number; // CC# or Note# (0-127)
  target: MidiTargetParam;
  mode: MidiControlMode;
  minVal: number;
  maxVal: number;
  invert: boolean;
  lastRawValue?: number;
  lastUpdatedAt?: string;
}

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  direction: 'input' | 'output';
  state: 'connected' | 'disconnected';
}

export interface MidiPacket {
  deviceName: string;
  channel: number;
  messageType: MidiMessageType;
  controller: number;
  rawValue: number; // 0-127 for CC/Note, 0-16383 for PitchBend
  timestamp: string;
}

export type ServiceSegmentName =
  | 'Prelude'
  | 'Worship'
  | 'Sermon'
  | 'Altar Call'
  | 'Communion'
  | 'Benediction';

export interface AutomationEvent {
  id: string;
  offsetMs: number;
  targetType: 'channel' | 'master';
  channelId?: string;
  channelIndex?: number;
  channelName?: string;
  param: 'faderDb' | 'mute' | 'masterTrimDb' | 'emergencyMute';
  value: number | boolean;
}

export interface AutomationInitialState {
  channels: Record<string, { faderDb: number; mute: boolean }>;
  masterTrimDb: number;
  emergencyMuted: boolean;
}

export interface AutomationSnapshot {
  id: string;
  name: string;
  segment: ServiceSegmentName;
  createdAt: string;
  durationMs: number;
  loop: boolean;
  deviceId: string;
  initialState: AutomationInitialState;
  events: AutomationEvent[];
}

export interface BassDiConfig {
  bypassed: boolean;
  inputPadDb: boolean;
  groundLift: boolean;
  polarityInverted: boolean;
  inputTrimDb: number;
  subsonicHpfHz: number;
  humNotch50Hz: boolean;
  humNotch60Hz: boolean;
  crossoverHz: number;
  lowBandComp: {
    enabled: boolean;
    thresholdDb: number;
    ratio: number;
  };
  highBandDrive: {
    enabled: boolean;
    drivePct: number;
    presenceDb: number;
    cabinetVoicing: 'DI Clean' | 'Ampeg SVT 8x10' | 'B-15 Vintage Tube' | 'Modern Punch';
  };
  blendPct: number;
  outputLevelDb: number;
  tunerRefHz: number;
}

export type ConsoleThemeId =
  | 'midnight-studio'
  | 'analog-amber'
  | 'broadcast-emerald'
  | 'sanctuary-indigo'
  | 'daylight-foh'
  | 'warm-daylight';

export type NavDockPosition = 'left' | 'right' | 'top' | 'bottom';

export type ShortcutActionId =
  | 'mute-all'
  | 'tap-tempo'
  | 'save-snapshot'
  | 'total-bypass'
  | 'toggle-engine'
  | 'toggle-monitor'
  | 'undo-dsp'
  | 'mute-band'
  | 'clear-solos'
  | 'jump-console'
  | 'jump-dsp'
  | 'jump-feedback';

export interface KeyboardShortcutBinding {
  id: string;
  actionId: ShortcutActionId;
  label: string;
  description: string;
  category: 'Safety' | 'Timing & Snapshots' | 'Console Mix' | 'Navigation';
  keyCombo: string;
  enabled: boolean;
}

export interface TapTempoState {
  bpm: number;
  quarterMs: number;
  dottedEighthMs: number;
  tapCount: number;
  lastTapAt: number;
}

export interface RemoteAccessConfig {
  sessionToken: string;
  pinEnabled: boolean;
  pinCode: string;
  allowGainAdjustment: boolean;
  allowMuteControl: boolean;
  allowMasterTrim: boolean;
  lanHostOverride: string;
  createdAt: string;
}

export interface RemoteClientSession {
  clientId: string;
  role: 'desktop' | 'mobile';
  deviceName: string;
  ip: string;
  connectedAt: string;
  lastSeenAt: string;
}

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  url: string;
}

export interface SyncedConsoleState {
  venue: {
    organization: string;
    venueName: string;
    roomName: string;
    targetPlatform: PlatformTarget;
    driver: DriverBackend;
    sampleRate: number;
    bufferSize: number;
    activeDeviceId: string;
  };
  channels: InputChannel[];
  dsp: DspConfig;
  activePresetId: string;
  broadcastDsp: BroadcastDspConfig;
  zones: SpeakerZone[];
  obsStatus: ObsStatus;
  measurement: AcousticMeasurement;
  bassDi: BassDiConfig;
  emergencyMuted: boolean;
  findings: DiagnosticFinding[];
  remoteAccess: RemoteAccessConfig;
}

export interface DetectedHardwareEndpoint {
  id: string;
  browserDeviceId?: string;
  name: string;
  direction: 'input' | 'output' | 'duplex';
  kind: 'internal' | 'usb-audio' | 'thunderbolt' | 'bluetooth' | 'virtual' | 'network-console' | 'unknown';
  source: 'browser-media' | 'os-probe' | 'lan-discovery';
  vendorId?: string;
  productId?: string;
  manufacturer?: string;
  estimatedInputChannels: number;
  estimatedOutputChannels: number;
  matchedDeviceId: string;
  matchedLabel: string;
  confidence: 'exact-usb-id' | 'model-match' | 'vendor-match' | 'auto-synthesized';
  recommendedDriver: DriverBackend;
  recommendedSampleRate: number;
  asioDriverName?: string;
  isDefault?: boolean;
  hostAddress?: string;
  detectedAt: string;
  cachedFromIndexedDb?: boolean;
  lastSeenAt?: string;
  seenCount?: number;
  synthesizedDevice?: HardwareDevice;
}




