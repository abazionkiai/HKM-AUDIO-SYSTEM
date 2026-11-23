import type { AudioSourceSimulation, SpeakerZone } from '../types/audio.ts';
import { isDesktopApp } from '../utils/appApi.ts';
import { pushRawOutputPcm, startRawOutput, stopRawOutput } from '../utils/nativeDesktopAudio.ts';
import { clamp, dbToLinear } from './audioUtils.ts';
import {
  INITIAL_DESKTOP_BRIDGE_STATE,
  evaluateDesktopLoopbackSafety,
  type LoopbackSafetyResult,
  type SystemAudioBridgeState,
  type SystemAudioCaptureMethod,
} from './systemAudioBridge.ts';

/**
 * Manages all Console Outputs + Desktop Audio Self-Loopback Firewall:
 *   1. Main Monitor / PA Output (`monitorGain -> paZoneDelayNode -> paZoneGainNode -> ctx.destination`)
 *   2. Dedicated Stream / OBS Output (`streamOutputGain -> MediaStreamDestination -> Audio.setSinkId`)
 *   3. Native Windows WASAPI RAW / MFX Output Tap (`rawTapNode -> pushRawOutputPcm`)
 */
export class OutputRouter {
  private ctx: AudioContext | null = null;
  private postAnalyser: AnalyserNode | null = null;

  private monitorGain: GainNode | null = null;
  private paZoneDelayNode: DelayNode | null = null;
  private paZoneGainNode: GainNode | null = null;
  private lastZones: SpeakerZone[] = [];

  private streamOutputGain: GainNode | null = null;
  private streamMediaDest: MediaStreamAudioDestinationNode | null = null;
  private streamAudioEl: HTMLAudioElement | null = null;

  private rawTapNode: AudioWorkletNode | null = null;
  private rawTapSilentSink: GainNode | null = null;
  private rawWorkletPromise: Promise<void> | null = null;
  private rawWorkletCtx: AudioContext | null = null;

  // Gain & routing state
  private monitorAudible = false;
  private monitorLevelDb = -9;
  private talkbackActive = false;
  private emergencyMuted = false;
  private rawOutputActive = false;
  private rawOutputEndpointId: string | undefined = undefined;
  private preferredOutputDeviceId: string | undefined = undefined;
  private preferredStreamOutputDeviceId: string | undefined = undefined;
  private onOutputFallbackCb: ((staleDeviceId: string, reason: string) => void) | null = null;

  // Desktop Audio Bridge safety tracking
  private bridgeState: SystemAudioBridgeState = { ...INITIAL_DESKTOP_BRIDGE_STATE };
  private desktopCaptureMethod: SystemAudioCaptureMethod = isDesktopApp()
    ? 'native-wasapi'
    : 'display-media';
  private specializedDesktopDeviceId: string | null = null;
  private specializedDesktopLabel: string | null = null;
  private specializedDesktopGroupId: string | null = null;
  private tauriSourceIsolationActive = false;
  private outputDeviceMetaCache: MediaDeviceInfo[] = [];
  private bridgeListeners = new Set<(state: SystemAudioBridgeState) => void>();

  public setOnOutputFallback(cb: ((staleDeviceId: string, reason: string) => void) | null): void {
    this.onOutputFallbackCb = cb;
  }

  public attachGraph(ctx: AudioContext, postAnalyser: AnalyserNode): void {
    this.ctx = ctx;
    this.postAnalyser = postAnalyser;

    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 0;
    this.monitorGain.channelCount = 2;
    this.monitorGain.channelCountMode = 'explicit';
    this.monitorGain.channelInterpretation = 'speakers';

    this.paZoneDelayNode = ctx.createDelay(0.5);
    this.paZoneDelayNode.delayTime.value = 0;

    this.paZoneGainNode = ctx.createGain();
    this.paZoneGainNode.gain.value = 1;
    this.paZoneGainNode.channelCount = 2;
    this.paZoneGainNode.channelCountMode = 'explicit';
    this.paZoneGainNode.channelInterpretation = 'speakers';

    this.streamOutputGain = ctx.createGain();
    this.streamOutputGain.gain.value = 0;
    this.streamOutputGain.channelCount = 2;
    this.streamOutputGain.channelCountMode = 'explicit';
    this.streamOutputGain.channelInterpretation = 'speakers';

    this.streamMediaDest = ctx.createMediaStreamDestination();

    // Wire Post-DSP output to PA Monitor + PA Zone Delay/Trim -> Speakers, plus isolated Stream/OBS bus
    this.postAnalyser.connect(this.monitorGain);
    this.monitorGain.connect(this.paZoneDelayNode);
    this.paZoneDelayNode.connect(this.paZoneGainNode);
    this.paZoneGainNode.connect(ctx.destination);

    this.postAnalyser.connect(this.streamOutputGain);
    this.streamOutputGain.connect(this.streamMediaDest);

    if (this.lastZones.length > 0) {
      this.applySpeakerZones(this.lastZones);
    }

    if (this.preferredStreamOutputDeviceId) {
      void this.setStreamOutputDevice(this.preferredStreamOutputDeviceId);
    }
  }

  public applySpeakerZones(zones: SpeakerZone[]): void {
    this.lastZones = zones;
    if (!this.ctx || !this.paZoneDelayNode || !this.paZoneGainNode || zones.length === 0) return;

    const mainZone = zones.find((z) => z.role === 'main-lr') ?? zones[0];
    if (!mainZone) return;

    const now = this.ctx.currentTime;
    const delaySec = clamp((mainZone.delayMs || 0) / 1000, 0, 0.5);
    const sign = mainZone.polarityInverted ? -1 : 1;
    const gainLinear = mainZone.mute ? 0 : dbToLinear(clamp(mainZone.levelDb ?? 0, -48, 12)) * sign;

    this.paZoneDelayNode.delayTime.setTargetAtTime(delaySec, now, 0.015);
    this.paZoneGainNode.gain.setTargetAtTime(gainLinear, now, 0.015);
  }

  public getDesktopBridgeState(): SystemAudioBridgeState {
    return this.bridgeState;
  }

  public getDesktopCaptureMethod(): SystemAudioCaptureMethod {
    return this.desktopCaptureMethod;
  }

  public getSpecializedDesktopDevice(): {
    deviceId: string | null;
    label: string | null;
    groupId: string | null;
  } {
    return {
      deviceId: this.specializedDesktopDeviceId,
      label: this.specializedDesktopLabel,
      groupId: this.specializedDesktopGroupId,
    };
  }

  public subscribeDesktopBridge(cb: (state: SystemAudioBridgeState) => void): () => void {
    this.bridgeListeners.add(cb);
    cb(this.bridgeState);
    return () => {
      this.bridgeListeners.delete(cb);
    };
  }

  private emitBridgeState(): void {
    for (const cb of this.bridgeListeners) {
      try {
        cb(this.bridgeState);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  public setDesktopCaptureMethod(method: SystemAudioCaptureMethod): void {
    this.desktopCaptureMethod = method;
  }

  public setSpecializedDesktopDevice(device: {
    deviceId: string | null;
    label?: string | null;
    groupId?: string | null;
  }): void {
    this.specializedDesktopDeviceId = device.deviceId || null;
    this.specializedDesktopLabel = device.label || null;
    this.specializedDesktopGroupId = device.groupId || null;
    if (device.deviceId) {
      this.desktopCaptureMethod =
        device.deviceId === 'native-desktop-audio' ? 'native-wasapi' : 'specialized-interface';
    }
  }

  public setTauriSourceIsolationActive(active: boolean): void {
    this.tauriSourceIsolationActive = active;
  }

  public updateOutputDeviceMetadata(devices: MediaDeviceInfo[]): void {
    this.outputDeviceMetaCache = devices;
  }

  private findOutputMeta(deviceId?: string): MediaDeviceInfo | undefined {
    if (!deviceId) return undefined;
    return this.outputDeviceMetaCache.find((d) => d.deviceId === deviceId);
  }

  public refreshBridgeSafety(params: {
    isRunning: boolean;
    sourceMode: AudioSourceSimulation;
    displaySurface: string | null;
    suppressLocalPlayback: boolean;
    inputLabel: string | null;
    sampleRate: number;
  }): LoopbackSafetyResult {
    const defaultMeta =
      this.outputDeviceMetaCache.find((d) => d.deviceId === 'default') ??
      this.outputDeviceMetaCache[0];
    const preferredOutMeta = this.findOutputMeta(this.preferredOutputDeviceId);
    const preferredStreamMeta = this.findOutputMeta(this.preferredStreamOutputDeviceId);

    const isDesktopActive = params.isRunning && params.sourceMode === 'desktop-audio';
    const safety = evaluateDesktopLoopbackSafety({
      active: isDesktopActive,
      method: this.desktopCaptureMethod,
      displaySurface: params.displaySurface,
      suppressLocalAudioPlayback: params.suppressLocalPlayback,
      specializedDeviceId: this.specializedDesktopDeviceId,
      specializedInputLabel: this.specializedDesktopLabel,
      specializedInputGroupId: this.specializedDesktopGroupId,
      preferredOutputDeviceId: this.preferredOutputDeviceId,
      preferredOutputLabel: preferredOutMeta?.label,
      preferredOutputGroupId: preferredOutMeta?.groupId,
      defaultOutputDeviceId: defaultMeta?.deviceId,
      defaultOutputGroupId: defaultMeta?.groupId,
      defaultOutputLabel: defaultMeta?.label,
      preferredStreamOutputDeviceId: this.preferredStreamOutputDeviceId,
      preferredStreamOutputLabel: preferredStreamMeta?.label,
      preferredStreamOutputGroupId: preferredStreamMeta?.groupId,
      tauriSourceIsolationActive: this.tauriSourceIsolationActive,
      tauriRawOutputActive: this.rawOutputActive,
    });

    const nextState: SystemAudioBridgeState = {
      active: isDesktopActive,
      method: this.desktopCaptureMethod,
      displaySurface: isDesktopActive ? params.displaySurface : null,
      inputLabel: isDesktopActive ? params.inputLabel : null,
      specializedDeviceId: this.specializedDesktopDeviceId,
      loopbackRisk: safety.loopbackRisk,
      selfLoopbackBlocked: safety.selfLoopbackBlocked,
      streamLoopbackBlocked: safety.streamLoopbackBlocked,
      safetyReason: safety.safetyReason,
      sampleRate: isDesktopActive ? params.sampleRate : null,
    };

    const changed =
      nextState.active !== this.bridgeState.active ||
      nextState.method !== this.bridgeState.method ||
      nextState.displaySurface !== this.bridgeState.displaySurface ||
      nextState.inputLabel !== this.bridgeState.inputLabel ||
      nextState.specializedDeviceId !== this.bridgeState.specializedDeviceId ||
      nextState.loopbackRisk !== this.bridgeState.loopbackRisk ||
      nextState.selfLoopbackBlocked !== this.bridgeState.selfLoopbackBlocked ||
      nextState.streamLoopbackBlocked !== this.bridgeState.streamLoopbackBlocked ||
      nextState.safetyReason !== this.bridgeState.safetyReason ||
      nextState.sampleRate !== this.bridgeState.sampleRate;

    this.bridgeState = nextState;
    if (changed) {
      this.emitBridgeState();
    }
    return safety;
  }

  public syncOutputGains(params: {
    isRunning: boolean;
    sourceMode: AudioSourceSimulation;
    displaySurface: string | null;
    suppressLocalPlayback: boolean;
    inputLabel: string | null;
    sampleRate: number;
  }): void {
    const safety = this.refreshBridgeSafety(params);
    if (!this.ctx) return;

    const monBlocked = params.sourceMode === 'desktop-audio' && safety.selfLoopbackBlocked;
    const streamBlocked = params.sourceMode === 'desktop-audio' && safety.streamLoopbackBlocked;

    if (this.monitorGain) {
      const baseLinear = dbToLinear(this.monitorLevelDb);
      const tbFactor = this.talkbackActive ? 0.2 : 1.0; // -14 dB cue dim during Talkback
      const target =
        this.monitorAudible &&
        !this.emergencyMuted &&
        !this.rawOutputActive &&
        !monBlocked
          ? baseLinear * tbFactor
          : 0;
      this.monitorGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }

    if (this.streamOutputGain) {
      const streamActive =
        Boolean(this.preferredStreamOutputDeviceId) &&
        !this.emergencyMuted &&
        params.isRunning &&
        !streamBlocked;
      this.streamOutputGain.gain.setTargetAtTime(streamActive ? 1 : 0, this.ctx.currentTime, 0.02);

      if (streamActive && this.streamAudioEl) {
        if (!this.streamAudioEl.srcObject && this.streamMediaDest) {
          this.streamAudioEl.srcObject = this.streamMediaDest.stream;
        }
        if (this.streamAudioEl.paused) {
          void this.streamAudioEl.play().catch(() => {});
        }
      }
    }
  }

  public setMonitorAudible(audible: boolean): void {
    this.monitorAudible = audible;
  }

  public isMonitorAudible(): boolean {
    return this.monitorAudible;
  }

  public setMonitorLevelDb(db: number): void {
    this.monitorLevelDb = clamp(db, -48, 6);
  }

  public setTalkbackActive(active: boolean): void {
    this.talkbackActive = active;
  }

  public setEmergencyMute(muted: boolean): void {
    this.emergencyMuted = muted;
  }

  public getPreferredOutputDeviceId(): string {
    return this.preferredOutputDeviceId || '';
  }

  public getPreferredStreamOutputDeviceId(): string {
    return this.preferredStreamOutputDeviceId || '';
  }

  public isRawOutputActive(): boolean {
    return this.rawOutputActive;
  }

  public getRawOutputEndpointId(): string | undefined {
    return this.rawOutputEndpointId;
  }

  public async setOutputDevice(
    deviceId?: string,
    options?: { allowFallbackToDefault?: boolean }
  ): Promise<boolean> {
    const cleanId = (deviceId || '').split('::')[0];
    this.preferredOutputDeviceId = cleanId || undefined;
    if (!this.ctx) return true;

    const ctxWithSink = this.ctx as unknown as { setSinkId?: (id: string) => Promise<void> };
    const hasSetSinkId = 'setSinkId' in this.ctx && typeof ctxWithSink.setSinkId === 'function';

    if (hasSetSinkId && ctxWithSink.setSinkId) {
      try {
        await ctxWithSink.setSinkId(cleanId || '');
        return true;
      } catch (err) {
        console.warn('AudioContext.setSinkId failed:', err);
        if (cleanId && options?.allowFallbackToDefault) {
          this.preferredOutputDeviceId = undefined;
          try {
            await ctxWithSink.setSinkId('');
          } catch {
            // ignore fallback sink reset failure
          }
          this.onOutputFallbackCb?.(
            cleanId,
            'Saved audio output device is unavailable; routed safely to System Default Output.'
          );
          return true;
        }
        return false;
      }
    }

    if (!cleanId || cleanId === 'default') return true;

    if (options?.allowFallbackToDefault) {
      this.preferredOutputDeviceId = undefined;
      this.onOutputFallbackCb?.(
        cleanId,
        'AudioContext output selection is unsupported in this browser; using System Default Output.'
      );
      return true;
    }

    return false;
  }

  public async setStreamOutputDevice(deviceId?: string): Promise<boolean> {
    const cleanId = (deviceId || '').split('::')[0];
    this.preferredStreamOutputDeviceId = cleanId || undefined;
    if (!cleanId) {
      if (this.streamAudioEl) {
        this.streamAudioEl.pause();
        this.streamAudioEl.srcObject = null;
      }
      return true;
    }
    if (!this.ctx || !this.streamMediaDest) {
      // Stored in preferredStreamOutputDeviceId; attachGraph() will wire it when engine starts
      return true;
    }
    try {
      if (!this.streamAudioEl && typeof Audio !== 'undefined') {
        this.streamAudioEl = new Audio();
        this.streamAudioEl.autoplay = true;
      }
      if (this.streamAudioEl) {
        this.streamAudioEl.srcObject = this.streamMediaDest.stream;
        if ('setSinkId' in this.streamAudioEl && typeof (this.streamAudioEl as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId === 'function') {
          await (this.streamAudioEl as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(cleanId);
        }
        await this.streamAudioEl.play().catch(() => {});
      }
      return true;
    } catch (err) {
      console.warn('Stream output setSinkId failed:', err);
      return false;
    }
  }

  private async ensureRawTapWorklet(): Promise<void> {
    if (!this.ctx) throw new Error('AudioContext not initialized');
    if (this.rawWorkletCtx !== this.ctx || !this.rawWorkletPromise) {
      this.rawWorkletCtx = this.ctx;
      this.rawWorkletPromise = this.ctx.audioWorklet.addModule('/raw-output-tap-worklet.js');
    }
    await this.rawWorkletPromise;
  }

  public teardownRawTap(): void {
    if (this.rawTapNode) {
      try {
        this.rawTapNode.port.onmessage = null;
        this.rawTapNode.disconnect();
      } catch {
        // ignore
      }
      this.rawTapNode = null;
    }
    if (this.rawTapSilentSink) {
      try {
        this.rawTapSilentSink.disconnect();
      } catch {
        // ignore
      }
      this.rawTapSilentSink = null;
    }
  }

  public async setRawOutputEnabled(
    enabled: boolean,
    isRunning: boolean,
    endpointId?: string
  ): Promise<boolean> {
    if (endpointId !== undefined) {
      this.rawOutputEndpointId = endpointId || undefined;
    }
    if (!enabled) {
      this.rawOutputActive = false;
      this.teardownRawTap();
      await stopRawOutput();
      return true;
    }

    if (!isRunning || !this.ctx || !this.postAnalyser) {
      this.rawOutputActive = true;
      return true;
    }

    try {
      await startRawOutput(this.rawOutputEndpointId);
      await this.ensureRawTapWorklet();
      if (!this.ctx || !this.postAnalyser || !isRunning) {
        await stopRawOutput();
        return false;
      }

      this.teardownRawTap();
      const tapNode = new AudioWorkletNode(this.ctx, 'raw-output-tap-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        outputChannelCount: [2],
      });
      const silentSink = this.ctx.createGain();
      silentSink.gain.value = 0;

      tapNode.port.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer && !this.emergencyMuted && this.monitorAudible) {
          void pushRawOutputPcm(ev.data);
        }
      };

      this.postAnalyser.connect(tapNode);
      tapNode.connect(silentSink);
      silentSink.connect(this.ctx.destination);

      this.rawTapNode = tapNode;
      this.rawTapSilentSink = silentSink;
      this.rawOutputActive = true;
      return true;
    } catch (err) {
      console.warn('RAW output activation failed, staying on standard Web Audio output:', err);
      this.rawOutputActive = false;
      this.teardownRawTap();
      await stopRawOutput();
      return false;
    }
  }
}
