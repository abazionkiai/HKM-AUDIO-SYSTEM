import {
  type AudioSourceSimulation,
  type DspConfig,
  type InputChannel,
  type SignalTelemetry,
  type SpeakerZone,
} from '../types/audio.ts';
import { deduplicateMediaDevices } from '../utils/audioNaming.ts';
import { stopRawOutput } from '../utils/nativeDesktopAudio.ts';
import { ChannelStripBank } from './channelStripBank.ts';
import { MasterDspGraph, type SignalGraphReport } from './masterDspGraph.ts';
import { OutputRouter } from './outputRouter.ts';
import { SourceCaptureManager } from './sourceCaptureManager.ts';
import {
  type SpecializedDesktopInterface,
  type SystemAudioBridgeState,
  type SystemAudioCaptureMethod,
} from './systemAudioBridge.ts';
import {
  TelemetryAnalyzer,
  type FastMeterSnapshot,
  type SpectrumSnapshot,
} from './telemetryAnalyzer.ts';

export type {
  FastMeterSnapshot,
  SignalGraphReport,
  SpecializedDesktopInterface,
  SpectrumSnapshot,
  SystemAudioBridgeState,
  SystemAudioCaptureMethod,
};

/**
 * Clean Modular Real-Time Web Audio Engine Orchestrator:
 *
 *   [SourceCaptureManager] (live-mic 1:1 | desktop-audio bridge | pink-noise)
 *            │
 *            ▼
 *   [ChannelStripBank] (Preamp -> HPF -> 3-Band EQ -> Strip Comp -> Pan -> Fader -> Sum)
 *            │
 *            ▼
 *   [MasterDspGraph] (Trim -> PreAnalyser -> SubSonic -> HumNotch -> AGC -> Gate -> Standby ->
 *                     DeEsser -> HPF -> 8-PEQ -> LPF -> SurgicalNotches -> Comp/Lim/Delay ->
 *                     4-Leg StereoWidth -> Eq31 Insert -> LR-24 Crossover -> MasterGain -> SafetyLim -> PostAnalyser)
 *            │
 *            ├─────────────────────────┐
 *            ▼                         ▼
 *   [OutputRouter]            [TelemetryAnalyzer]
 *   (PA MON + Stream + RAW     (50ms Fast Meters +
 *    + Self-Loopback Firewall)  Adaptive DSP Protection)
 */
class LiveAudioEngine {
  private ctx: AudioContext | null = null;
  private sourceMode: AudioSourceSimulation = 'live-mic';
  private isRunning = false;
  private lastChannels: InputChannel[] = [];
  private lastDsp: DspConfig | null = null;
  private onSourceEndedCb: (() => void) | null = null;

  private readonly stripBank = new ChannelStripBank();
  private readonly dspGraph = new MasterDspGraph();
  private readonly sourceCapture = new SourceCaptureManager();
  private readonly outputRouter = new OutputRouter();
  private readonly analyzer = new TelemetryAnalyzer();

  constructor() {
    this.sourceCapture.setOnSourceEnded(() => {
      this.stop();
      this.onSourceEndedCb?.();
    });
  }

  public setOnSourceEnded(cb: (() => void) | null): void {
    this.onSourceEndedCb = cb;
  }

  public getDesktopBridgeState(): SystemAudioBridgeState {
    return this.outputRouter.getDesktopBridgeState();
  }

  public subscribeDesktopBridge(cb: (state: SystemAudioBridgeState) => void): () => void {
    return this.outputRouter.subscribeDesktopBridge(cb);
  }

  public updateOutputDeviceMetadata(devices: MediaDeviceInfo[]): void {
    this.outputRouter.updateOutputDeviceMetadata(devices);
    this.syncOutputsAndSafety();
  }

  public setDesktopCaptureMethod(method: SystemAudioCaptureMethod): void {
    this.outputRouter.setDesktopCaptureMethod(method);
    this.syncOutputsAndSafety();
  }

  public setSpecializedDesktopDevice(device: {
    deviceId: string | null;
    label?: string | null;
    groupId?: string | null;
  }): void {
    this.outputRouter.setSpecializedDesktopDevice(device);
    this.syncOutputsAndSafety();
  }

  public setTauriSourceIsolationActive(active: boolean): void {
    this.outputRouter.setTauriSourceIsolationActive(active);
    this.syncOutputsAndSafety();
  }

  private syncOutputsAndSafety(): void {
    this.outputRouter.syncOutputGains({
      isRunning: this.isRunning,
      sourceMode: this.sourceMode,
      displaySurface: this.sourceCapture.getActiveDisplaySurface(),
      suppressLocalPlayback: this.sourceCapture.getActiveSuppressLocalPlayback(),
      inputLabel: this.sourceCapture.getActiveInputLabel(),
      sampleRate: this.getSampleRate(),
    });
  }

  public async start(
    source: AudioSourceSimulation,
    dsp: DspConfig,
    channels?: InputChannel[]
  ): Promise<void> {
    this.sourceMode = source;
    this.lastDsp = dsp;
    if (channels) {
      this.lastChannels = channels;
    }

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'balanced' });
      this.dspGraph.build(this.ctx);
      this.stripBank.attachContext(this.ctx, this.dspGraph.busMixSum);
      this.outputRouter.attachGraph(this.ctx, this.dspGraph.postAnalyser);
      this.analyzer.initBuffers(this.dspGraph, this.ctx.sampleRate);
    }

    const preferredOut = this.outputRouter.getPreferredOutputDeviceId();
    if (preferredOut) {
      const applied = await this.outputRouter.setOutputDevice(preferredOut);
      if (!applied) {
        throw new Error(
          'The selected audio output could not be applied. Choose System Default or another available output.'
        );
      }
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.sourceCapture.teardown(this.stripBank);
    this.outputRouter.teardownRawTap();
    void stopRawOutput();

    this.analyzer.reset();
    this.isRunning = true;

    try {
      const { methodUsed } = await this.sourceCapture.setupSource({
        ctx: this.ctx,
        mode: source,
        channels: this.lastChannels,
        stripBank: this.stripBank,
        desktopCaptureMethod: this.outputRouter.getDesktopCaptureMethod(),
        specializedDesktopDeviceId: this.outputRouter.getSpecializedDesktopDevice().deviceId,
        specializedDesktopLabel: this.outputRouter.getSpecializedDesktopDevice().label,
      });

      if (methodUsed) {
        this.outputRouter.setDesktopCaptureMethod(methodUsed);
      }

      this.stripBank.applyChannels(this.lastChannels, this.sourceMode);
      this.dspGraph.applyDsp(dsp);
      this.syncOutputsAndSafety();

      if (this.outputRouter.isRawOutputActive()) {
        await this.outputRouter.setRawOutputEnabled(
          true,
          this.isRunning,
          this.outputRouter.getRawOutputEndpointId()
        );
        this.syncOutputsAndSafety();
      }
    } catch (err) {
      this.sourceCapture.teardown(this.stripBank);
      this.isRunning = false;
      this.syncOutputsAndSafety();
      throw err;
    }
  }

  public stop(): void {
    this.sourceCapture.teardown(this.stripBank);
    this.outputRouter.teardownRawTap();
    void stopRawOutput();

    this.isRunning = false;
    this.analyzer.reset();
    this.syncOutputsAndSafety();

    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => {});
    }
  }

  public async syncChannelHardwareInputs(channels: InputChannel[]): Promise<void> {
    this.lastChannels = channels;
    await this.sourceCapture.syncChannelHardwareInputs(
      this.ctx,
      this.isRunning,
      this.sourceMode,
      channels,
      this.stripBank
    );
  }

  public applyChannels(channels: InputChannel[]): void {
    this.lastChannels = channels;
    this.stripBank.applyChannels(channels, this.sourceMode);
  }

  public applyDsp(dsp: DspConfig): void {
    this.lastDsp = dsp;
    this.dspGraph.applyDsp(dsp);
  }

  public applySpeakerZones(_zones: SpeakerZone[]): void {
    // Master PA stereo bus routes through OutputRouter gated by monitorGain
  }

  public async setOutputDevice(deviceId?: string): Promise<boolean> {
    const ok = await this.outputRouter.setOutputDevice(deviceId);
    this.syncOutputsAndSafety();
    return ok;
  }

  public getPreferredOutputDeviceId(): string {
    return this.outputRouter.getPreferredOutputDeviceId();
  }

  public async setStreamOutputDevice(deviceId?: string): Promise<boolean> {
    const ok = await this.outputRouter.setStreamOutputDevice(deviceId);
    this.syncOutputsAndSafety();
    return ok;
  }

  public getPreferredStreamOutputDeviceId(): string {
    return this.outputRouter.getPreferredStreamOutputDeviceId();
  }

  public async setRawOutputEnabled(enabled: boolean, endpointId?: string): Promise<boolean> {
    const ok = await this.outputRouter.setRawOutputEnabled(enabled, this.isRunning, endpointId);
    this.syncOutputsAndSafety();
    return ok;
  }

  public setMonitorAudible(audible: boolean): void {
    this.outputRouter.setMonitorAudible(audible);
    this.syncOutputsAndSafety();
  }

  public setMonitorLevelDb(db: number): void {
    this.outputRouter.setMonitorLevelDb(db);
    this.syncOutputsAndSafety();
  }

  public setTalkbackActive(active: boolean): void {
    this.outputRouter.setTalkbackActive(active);
    this.syncOutputsAndSafety();
  }

  public setEmergencyMute(muted: boolean): void {
    this.outputRouter.setEmergencyMute(muted);
    this.syncOutputsAndSafety();
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public getSampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  public getActiveInputLabel(): string | null {
    return this.sourceCapture.getActiveInputLabel();
  }

  public getLatestSpectrum(): SpectrumSnapshot {
    return this.analyzer.getLatestSpectrum(
      this.isRunning ? this.dspGraph : null,
      this.isRunning
    );
  }

  public sampleFastLevels(): FastMeterSnapshot {
    return this.analyzer.sampleFastLevels({
      isRunning: this.isRunning,
      graph: this.dspGraph,
      stripBank: this.stripBank,
      dsp: this.lastDsp,
    });
  }

  public sampleTelemetry(options?: {
    includeSpectrum?: boolean;
  }): { telemetry: SignalTelemetry; spectrum: SpectrumSnapshot } {
    return this.analyzer.sampleTelemetry({
      ctx: this.ctx,
      isRunning: this.isRunning,
      sourceMode: this.sourceMode,
      activeInputLabel: this.sourceCapture.getActiveInputLabel(),
      graph: this.dspGraph,
      stripBank: this.stripBank,
      dsp: this.lastDsp,
      includeSpectrum: options?.includeSpectrum,
    });
  }

  public getSignalGraphReport(): SignalGraphReport {
    return this.dspGraph.getReport();
  }
}

export const liveAudioEngine = new LiveAudioEngine();

export function subscribeHardwareChanges(cb: () => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) {
    return () => {};
  }
  navigator.mediaDevices.addEventListener('devicechange', cb);
  return () => {
    navigator.mediaDevices.removeEventListener('devicechange', cb);
  };
}

async function enumerateAudioDevicesByKind(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (kind === 'audioinput') {
      return deduplicateMediaDevices(devices, 'audioinput', { excludeLoopbacks: true });
    }
    if (kind === 'audiooutput') {
      return deduplicateMediaDevices(devices, 'audiooutput');
    }
    return devices.filter((d) => d.kind === kind);
  } catch (err) {
    console.warn(`enumerateAudioDevices(${kind}) failed:`, err);
    return [];
  }
}

export function enumerateAudioInputs(): Promise<MediaDeviceInfo[]> {
  return enumerateAudioDevicesByKind('audioinput');
}

export function enumerateAudioOutputs(): Promise<MediaDeviceInfo[]> {
  return enumerateAudioDevicesByKind('audiooutput');
}
