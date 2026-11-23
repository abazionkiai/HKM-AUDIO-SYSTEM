import {
  type AudioSourceSimulation,
  type ChannelSignalTelemetry,
  type DspConfig,
  type InputChannel,
  type SignalTelemetry,
  type SpeakerZone,
  ISO_31_FREQUENCIES,
} from '../types/audio.ts';
import { deduplicateMediaDevices, isNativeDesktopInputId } from '../utils/audioNaming.ts';
import {
  parseNativeAppPid,
  pushRawOutputPcm,
  startNativeDesktopCapture,
  startRawOutput,
  stopAllNativeDesktopCaptures,
  stopNativeDesktopCapture,
  stopRawOutput,
} from '../utils/nativeDesktopAudio.ts';

export interface SpectrumSnapshot {
  frequencies: Float32Array;
  preDb: Float32Array;
  postDb: Float32Array;
}

export interface FastMeterSnapshot {
  isRunning: boolean;
  preRmsDb: number;
  postRmsDb: number;
  postLRmsDb: number;
  postRRmsDb: number;
  postPeakDb: number;
  postLPeakDb: number;
  postRPeakDb: number;
  capturedChannels: number;
  channelRmsDb: number[];
  channelPeakDb: number[];
  channelCompGrDb: number[];
  masterGrDb: number;
}

interface ChannelStripNodes {
  preampGain: GainNode;
  hpfNode: BiquadFilterNode;
  eqLowNode: BiquadFilterNode;
  eqMidNode: BiquadFilterNode;
  eqHighNode: BiquadFilterNode;
  compNode: DynamicsCompressorNode;
  pannerNode: StereoPannerNode;
  faderGain: GainNode;
  connectedToBus: boolean;
}

function calcTimeStats(buf: Float32Array): { rmsDb: number; peakDb: number } {
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    sumSq += v * v;
    if (v > peak) peak = v;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, buf.length));
  const rmsDb = Math.max(-96, 20 * Math.log10(Math.max(1.585e-5, rms)));
  const peakDb = Math.max(-96, 20 * Math.log10(Math.max(1.585e-5, peak)));
  return { rmsDb, peakDb };
}

function dbToLinear(db: number): number {
  return Math.pow(10, Math.max(-80, Math.min(36, db)) / 20);
}

/**
 * Real-time Web Audio API DSP + Multichannel Console Strip + Desktop Loopback + Stereo FFT Engine.
 * Supports:
 *  - 'live-mic': Live Microphone / USB Audio Interface via getUserMedia
 *  - 'desktop-audio': Desktop / Media Player / Browser Tab System Audio Loopback via getDisplayMedia
 *  - 'pink-noise': Calibrated -20 dBFS Pink Noise generator for room tuning & RTA checks
 */
class LiveAudioEngine {
  private ctx: AudioContext | null = null;
  private sourceMode: AudioSourceSimulation = 'live-mic';
  private isRunning = false;
  private monitorAudible = false;
  private monitorLevelDb = -9;
  private talkbackActive = false;
  private onSourceEndedCb: (() => void) | null = null;

  // Source & collision-free 1-to-1 per-device capture registry
  private sourceNodes: AudioNode[] = [];
  private activeStream: MediaStream | null = null;
  private deviceStreams: Map<
    string,
    { stream: MediaStream; node: MediaStreamAudioSourceNode; strips: Set<number> }
  > = new Map();
  private nativeStreams: Map<
    string,
    { node: AudioWorkletNode; strips: Set<number>; streamKey: string }
  > = new Map();
  private desktopWorkletPromise: Promise<void> | null = null;
  private rawOutputActive = false;
  private rawOutputEndpointId: string | undefined = undefined;
  private rawTapNode: AudioWorkletNode | null = null;
  private rawTapSilentSink: GainNode | null = null;
  private rawWorkletPromise: Promise<void> | null = null;
  private stripDeviceBindings: Map<number, string> = new Map();
  private syncQueuePromise: Promise<void> = Promise.resolve();
  private activeInputLabel: string | null = null;
  private capturedChannels = 0;
  private busMixSum: GainNode | null = null;
  private channelStrips: ChannelStripNodes[] = [];
  private channelAnalysers: AnalyserNode[] = [];
  private channelTimeBufs: Float32Array<ArrayBuffer>[] = [];
  private channelNoiseFloors: number[] = [];
  private lastChannels: InputChannel[] = [];

  // Master DSP Chain nodes
  private inputGain: GainNode | null = null;
  private agcGainNode: GainNode | null = null;
  private currentAgcGainDb = 0;
  private gateGainNode: GainNode | null = null;
  private gateIsClosed = false;
  private deEsserNode: BiquadFilterNode | null = null;
  private hpfNode: BiquadFilterNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private lpfNode: BiquadFilterNode | null = null;
  private compNode: DynamicsCompressorNode | null = null;
  private autoRumbleHpfNode: BiquadFilterNode | null = null;
  private autoMudCutNode: BiquadFilterNode | null = null;
  private surgicalNotchNodes: BiquadFilterNode[] = [];
  private surgicalNotchMeta: { freqHz: number; cutDb: number; holdFrames: number }[] = [];
  private makeupGain: GainNode | null = null;
  private limiterNode: DynamicsCompressorNode | null = null;
  private delayNode: DelayNode | null = null;
  private masterOutputGainNode: GainNode | null = null;
  private outputSafetyLimiter: DynamicsCompressorNode | null = null;

  // Zero-Hum Standby & Sub-sonic Clean Filters
  private subSonicNode: BiquadFilterNode | null = null;
  private humNotchFundamental: BiquadFilterNode | null = null;
  private humNotchHarmonic1: BiquadFilterNode | null = null;
  private humNotchHarmonic2: BiquadFilterNode | null = null;
  private standbyGateGainNode: GainNode | null = null;
  private standbySilenceFrames = 0;

  // 31-Band ISO 1/3-octave Stereo Graphic Equalizer
  private eq31Nodes: BiquadFilterNode[] = [];

  // Active 3-Way Linkwitz-Riley Crossover & Alignment Delay Network
  private xoverBypassGain: GainNode | null = null;
  private xoverSubHpf: BiquadFilterNode | null = null;
  private xoverSuperBassFilter: BiquadFilterNode | null = null;
  private xoverSubLp1: BiquadFilterNode | null = null;
  private xoverSubLp2: BiquadFilterNode | null = null;
  private xoverSubDelay: DelayNode | null = null;
  private xoverSubGain: GainNode | null = null;

  private xoverMidHp: BiquadFilterNode | null = null;
  private xoverMidLp: BiquadFilterNode | null = null;
  private xoverMidGain: GainNode | null = null;

  private xoverHighHp1: BiquadFilterNode | null = null;
  private xoverHighHp2: BiquadFilterNode | null = null;
  private xoverHighDelay: DelayNode | null = null;
  private xoverHighGain: GainNode | null = null;
  private xoverSumNode: GainNode | null = null;

  // Mid/Side Stereo Width Matrix nodes
  private widthSplitter: ChannelSplitterNode | null = null;
  private widthMerger: ChannelMergerNode | null = null;
  private widthLLGain: GainNode | null = null;
  private widthRLGain: GainNode | null = null;
  private widthRRGain: GainNode | null = null;
  private widthLRGain: GainNode | null = null;

  private monitorGain: GainNode | null = null;
  private preferredOutputDeviceId: string | undefined = undefined;
  private preferredStreamOutputDeviceId: string | undefined = undefined;
  private streamOutputGain: GainNode | null = null;
  private streamMediaDest: MediaStreamAudioDestinationNode | null = null;
  private streamAudioEl: HTMLAudioElement | null = null;
  private standbySilenceTimerSec = 0;
  private standbyGateIsClosed = false;

  // Analysers (Pre-DSP bus sum vs Post-DSP stereo L/R)
  private preAnalyser: AnalyserNode | null = null;
  private postAnalyser: AnalyserNode | null = null;
  private postSplitter: ChannelSplitterNode | null = null;
  private postLAnalyser: AnalyserNode | null = null;
  private postRAnalyser: AnalyserNode | null = null;
  private preFreqBuf = new Float32Array(2048);
  private postFreqBuf = new Float32Array(2048);
  private preTimeBuf = new Float32Array(2048);
  private postTimeBuf = new Float32Array(2048);
  private postLTimeBuf = new Float32Array(1024);
  private postRTimeBuf = new Float32Array(1024);
  private cachedFreqAxis = new Float32Array(2048);
  private cachedFreqSampleRate = 0;
  private eq31InputNode: GainNode | null = null;
  private eq31OutputNode: GainNode | null = null;
  private eq31ChainConnected = false;
  private xoverBranchesConnected = false;
  private lastFastSnapTs = 0;
  private lastFastSnap: FastMeterSnapshot | null = null;
  private telemetryTickCount = 0;
  private lastSpectrumReadTs = 0;
  private latestSpectrum: SpectrumSnapshot = {
    frequencies: new Float32Array(2048),
    preDb: new Float32Array(2048).fill(-96),
    postDb: new Float32Array(2048).fill(-96),
  };

  // Temporal persistence tracker for deterministic feedback detection
  private persistentPeakBin = -1;
  private persistentPeakFrames = 0;
  private clippingCount = 0;
  private noiseFloorDb = -96;
  private emergencyMuted = false;
  private lastDsp: DspConfig | null = null;

  public setOnSourceEnded(cb: (() => void) | null): void {
    this.onSourceEndedCb = cb;
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
      this.buildDspGraph();
    }

    if (this.preferredOutputDeviceId) {
      await this.setOutputDevice(this.preferredOutputDeviceId);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.teardownSource();
    this.lastFastSnap = null;
    this.lastFastSnapTs = 0;
    this.clippingCount = 0;
    this.noiseFloorDb = -96;
    this.gateIsClosed = false;
    this.isRunning = true;
    try {
      await this.setupSource(source);
      this.applyChannels(this.lastChannels);
      this.applyDsp(dsp);
      this.syncMonitorGain();
      if (this.rawOutputActive) {
        await this.setRawOutputEnabled(true, this.rawOutputEndpointId);
      }
    } catch (err) {
      this.teardownSource();
      this.isRunning = false;
      throw err;
    }
  }

  public getActiveInputLabel(): string | null {
    return this.activeInputLabel;
  }

  public async setOutputDevice(deviceId?: string): Promise<boolean> {
    const cleanId = (deviceId || '').split('::')[0];
    this.preferredOutputDeviceId = cleanId || undefined;

    if (this.ctx && 'setSinkId' in this.ctx && typeof (this.ctx as any).setSinkId === 'function') {
      try {
        await (this.ctx as any).setSinkId(cleanId || '');
        return true;
      } catch (err) {
        console.warn('AudioContext.setSinkId failed:', err);
        return false;
      }
    }
    return false;
  }

  public getPreferredOutputDeviceId(): string {
    return this.preferredOutputDeviceId || '';
  }

  public async setStreamOutputDevice(deviceId?: string): Promise<boolean> {
    const cleanId = (deviceId || '').split('::')[0];
    this.preferredStreamOutputDeviceId = cleanId || undefined;
    if (!cleanId) {
      if (this.streamAudioEl) {
        this.streamAudioEl.pause();
        this.streamAudioEl.srcObject = null;
      }
      this.syncMonitorGain();
      return true;
    }
    if (!this.ctx || !this.streamMediaDest) {
      this.syncMonitorGain();
      return false;
    }
    try {
      if (!this.streamAudioEl && typeof Audio !== 'undefined') {
        this.streamAudioEl = new Audio();
        this.streamAudioEl.autoplay = true;
      }
      if (this.streamAudioEl) {
        this.streamAudioEl.srcObject = this.streamMediaDest.stream;
        if ('setSinkId' in this.streamAudioEl && typeof (this.streamAudioEl as any).setSinkId === 'function') {
          await (this.streamAudioEl as any).setSinkId(cleanId);
        }
        await this.streamAudioEl.play().catch(() => {});
      }
      this.syncMonitorGain();
      return true;
    } catch (err) {
      console.warn('Stream output setSinkId failed:', err);
      this.syncMonitorGain();
      return false;
    }
  }

  public getPreferredStreamOutputDeviceId(): string {
    return this.preferredStreamOutputDeviceId || '';
  }

  public stop(): void {
    this.teardownSource();
    this.isRunning = false;
    this.noiseFloorDb = -96;
    this.gateIsClosed = false;
    this.lastFastSnap = null;
    this.lastFastSnapTs = 0;
    this.syncMonitorGain();
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => {});
    }
  }

  private syncMonitorGain(): void {
    if (!this.ctx) return;
    if (this.monitorGain) {
      const baseLinear = dbToLinear(this.monitorLevelDb);
      const tbFactor = this.talkbackActive ? 0.2 : 1.0; // -14 dB Cue Dim during Talkback
      const target =
        this.monitorAudible && !this.emergencyMuted && !this.rawOutputActive
          ? baseLinear * tbFactor
          : 0;
      this.monitorGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }
    if (this.streamOutputGain) {
      const streamActive = Boolean(this.preferredStreamOutputDeviceId) && !this.emergencyMuted && this.isRunning;
      this.streamOutputGain.gain.setTargetAtTime(streamActive ? 1 : 0, this.ctx.currentTime, 0.02);
    }
  }

  private async ensureDesktopWorklet(): Promise<void> {
    if (!this.ctx) throw new Error('AudioContext not initialized');
    if (!this.desktopWorkletPromise) {
      this.desktopWorkletPromise = this.ctx.audioWorklet.addModule('/desktop-loopback-worklet.js');
    }
    await this.desktopWorkletPromise;
  }

  private async ensureRawTapWorklet(): Promise<void> {
    if (!this.ctx) throw new Error('AudioContext not initialized');
    if (!this.rawWorkletPromise) {
      this.rawWorkletPromise = this.ctx.audioWorklet.addModule('/raw-output-tap-worklet.js');
    }
    await this.rawWorkletPromise;
  }

  private teardownRawTap(): void {
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

  public async setRawOutputEnabled(enabled: boolean, endpointId?: string): Promise<boolean> {
    if (endpointId !== undefined) {
      this.rawOutputEndpointId = endpointId || undefined;
    }
    if (!enabled) {
      this.rawOutputActive = false;
      this.teardownRawTap();
      await stopRawOutput();
      this.syncMonitorGain();
      return true;
    }

    if (!this.isRunning || !this.ctx || !this.postAnalyser) {
      this.rawOutputActive = true;
      return true;
    }

    try {
      await startRawOutput(this.rawOutputEndpointId);
      await this.ensureRawTapWorklet();
      if (!this.ctx || !this.postAnalyser || !this.isRunning) {
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
      this.syncMonitorGain();
      return true;
    } catch (err) {
      console.warn('RAW output activation failed, staying on standard Web Audio output:', err);
      this.rawOutputActive = false;
      this.teardownRawTap();
      await stopRawOutput();
      this.syncMonitorGain();
      return false;
    }
  }

  public setMonitorAudible(audible: boolean): void {
    this.monitorAudible = audible;
    this.syncMonitorGain();
  }

  public setMonitorLevelDb(db: number): void {
    this.monitorLevelDb = Math.max(-48, Math.min(6, db));
    this.syncMonitorGain();
  }

  public setTalkbackActive(active: boolean): void {
    this.talkbackActive = active;
    this.syncMonitorGain();
  }

  public setEmergencyMute(muted: boolean): void {
    this.emergencyMuted = muted;
    this.syncMonitorGain();
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public getSampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  public getLatestSpectrum(): SpectrumSnapshot {
    const nowTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      this.isRunning &&
      this.preAnalyser &&
      this.postAnalyser &&
      nowTs - this.lastSpectrumReadTs > 120
    ) {
      this.preAnalyser.getFloatFrequencyData(this.preFreqBuf);
      this.postAnalyser.getFloatFrequencyData(this.postFreqBuf);
      this.lastSpectrumReadTs = nowTs;
    }
    return this.latestSpectrum;
  }

  public sampleFastLevels(): FastMeterSnapshot {
    if (!this.isRunning || !this.preAnalyser || !this.postAnalyser) {
      return {
        isRunning: false,
        preRmsDb: -96,
        postRmsDb: -96,
        postLRmsDb: -96,
        postRRmsDb: -96,
        postPeakDb: -96,
        postLPeakDb: -96,
        postRPeakDb: -96,
        capturedChannels: 0,
        channelRmsDb: [],
        channelPeakDb: [],
        channelCompGrDb: [],
        masterGrDb: 0,
      };
    }

    const nowTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.lastFastSnap && nowTs - this.lastFastSnapTs < 50) {
      return this.lastFastSnap;
    }

    this.preAnalyser.getFloatTimeDomainData(this.preTimeBuf);
    this.postAnalyser.getFloatTimeDomainData(this.postTimeBuf);

    const preStats = calcTimeStats(this.preTimeBuf);
    const postStats = calcTimeStats(this.postTimeBuf);

    let postLStats = postStats;
    let postRStats = postStats;
    if (this.postLAnalyser && this.postRAnalyser) {
      this.postLAnalyser.getFloatTimeDomainData(this.postLTimeBuf);
      this.postRAnalyser.getFloatTimeDomainData(this.postRTimeBuf);
      postLStats = calcTimeStats(this.postLTimeBuf);
      postRStats = calcTimeStats(this.postRTimeBuf);
    }

    const channelRmsDb: number[] = [];
    const channelPeakDb: number[] = [];
    const channelCompGrDb: number[] = [];
    for (let i = 0; i < this.channelAnalysers.length; i++) {
      const chStrip = this.channelStrips[i];
      if (!chStrip?.connectedToBus) {
        channelRmsDb.push(-96);
        channelPeakDb.push(-96);
        channelCompGrDb.push(0);
        continue;
      }
      const analyser = this.channelAnalysers[i];
      const buf = this.channelTimeBufs[i];
      if (!analyser || !buf) continue;
      analyser.getFloatTimeDomainData(buf);
      const st = calcTimeStats(buf);
      channelRmsDb.push(st.rmsDb);
      channelPeakDb.push(st.peakDb);
      const chGr = Math.abs(chStrip.compNode.reduction);
      channelCompGrDb.push(Number(chGr.toFixed(1)));
    }

    const masterGrDb =
      this.compNode && !this.lastDsp?.bypassed && this.lastDsp?.compressor.enabled
        ? Number(Math.abs(this.compNode.reduction).toFixed(1))
        : 0;

    const snap: FastMeterSnapshot = {
      isRunning: true,
      preRmsDb: preStats.rmsDb,
      postRmsDb: postStats.rmsDb,
      postLRmsDb: postLStats.rmsDb,
      postRRmsDb: postRStats.rmsDb,
      postPeakDb: postStats.peakDb,
      postLPeakDb: postLStats.peakDb,
      postRPeakDb: postRStats.peakDb,
      capturedChannels: this.capturedChannels,
      channelRmsDb,
      channelPeakDb,
      channelCompGrDb,
      masterGrDb,
    };
    this.lastFastSnapTs = nowTs;
    this.lastFastSnap = snap;
    return snap;
  }

  private buildDspGraph(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    this.busMixSum = ctx.createGain();
    this.busMixSum.gain.value = 1;

    this.inputGain = ctx.createGain();
    this.preAnalyser = ctx.createAnalyser();
    this.preAnalyser.fftSize = 4096;
    this.preAnalyser.smoothingTimeConstant = 0.72;

    this.gateGainNode = ctx.createGain();
    this.gateGainNode.gain.value = 1;

    this.agcGainNode = ctx.createGain();
    this.agcGainNode.gain.value = 1;
    this.currentAgcGainDb = 0;

    this.masterOutputGainNode = ctx.createGain();
    this.masterOutputGainNode.gain.value = 1;

    this.outputSafetyLimiter = ctx.createDynamicsCompressor();
    this.outputSafetyLimiter.threshold.value = -0.5;
    this.outputSafetyLimiter.knee.value = 0;
    this.outputSafetyLimiter.ratio.value = 20;
    this.outputSafetyLimiter.attack.value = 0.001;
    this.outputSafetyLimiter.release.value = 0.05;

    // Zero-Hum Clean Standby & Sub-sonic Filter Nodes
    this.subSonicNode = ctx.createBiquadFilter();
    this.subSonicNode.type = 'highpass';
    this.subSonicNode.frequency.value = 18;
    this.subSonicNode.Q.value = 0.707;

    this.humNotchFundamental = ctx.createBiquadFilter();
    this.humNotchFundamental.type = 'notch';
    this.humNotchFundamental.frequency.value = 60;
    this.humNotchFundamental.Q.value = 14;

    this.humNotchHarmonic1 = ctx.createBiquadFilter();
    this.humNotchHarmonic1.type = 'notch';
    this.humNotchHarmonic1.frequency.value = 120;
    this.humNotchHarmonic1.Q.value = 14;

    this.humNotchHarmonic2 = ctx.createBiquadFilter();
    this.humNotchHarmonic2.type = 'notch';
    this.humNotchHarmonic2.frequency.value = 180;
    this.humNotchHarmonic2.Q.value = 14;

    this.standbyGateGainNode = ctx.createGain();
    this.standbyGateGainNode.gain.value = 1;

    this.deEsserNode = ctx.createBiquadFilter();
    this.deEsserNode.type = 'peaking';
    this.deEsserNode.frequency.value = 6200;
    this.deEsserNode.Q.value = 2.8;
    this.deEsserNode.gain.value = 0;

    this.hpfNode = ctx.createBiquadFilter();
    this.hpfNode.type = 'highpass';
    this.hpfNode.Q.value = 0.707;

    this.eqNodes = Array.from({ length: 8 }, () => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking';
      return b;
    });

    this.lpfNode = ctx.createBiquadFilter();
    this.lpfNode.type = 'lowpass';
    this.lpfNode.Q.value = 0.707;

    // Surgical Digital Troubleshooting Filter Bank (Sub-Rumble HPF + Mud Cut + 4x Q=18 Feedback Notches)
    this.autoRumbleHpfNode = ctx.createBiquadFilter();
    this.autoRumbleHpfNode.type = 'highpass';
    this.autoRumbleHpfNode.frequency.value = 18;
    this.autoRumbleHpfNode.Q.value = 0.707;

    this.autoMudCutNode = ctx.createBiquadFilter();
    this.autoMudCutNode.type = 'peaking';
    this.autoMudCutNode.frequency.value = 220;
    this.autoMudCutNode.Q.value = 2.0;
    this.autoMudCutNode.gain.value = 0;

    this.surgicalNotchNodes = Array.from({ length: 4 }, () => {
      const n = ctx.createBiquadFilter();
      n.type = 'peaking';
      n.frequency.value = 1000;
      n.Q.value = 18;
      n.gain.value = 0;
      return n;
    });
    this.surgicalNotchMeta = Array.from({ length: 4 }, () => ({
      freqHz: 0,
      cutDb: 0,
      holdFrames: 0,
    }));

    this.compNode = ctx.createDynamicsCompressor();
    this.makeupGain = ctx.createGain();
    this.limiterNode = ctx.createDynamicsCompressor();
    this.limiterNode.knee.value = 0;
    this.limiterNode.ratio.value = 20;
    this.limiterNode.attack.value = 0.001;

    this.delayNode = ctx.createDelay(0.5);

    // 31-Band ISO 1/3-Octave Graphic EQ Nodes (Constant-Q = 4.31)
    this.eq31Nodes = ISO_31_FREQUENCIES.map((hz) => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = hz;
      f.Q.value = 4.31;
      f.gain.value = 0;
      return f;
    });

    // Active 3-Way Linkwitz-Riley Crossover Network
    this.xoverBypassGain = ctx.createGain();
    this.xoverBypassGain.gain.value = 0;

    // Subwoofer band (LR-24 = cascaded 2nd order Butterworth + Subsonic HPF + SuperBass Booster)
    this.xoverSubHpf = ctx.createBiquadFilter();
    this.xoverSubHpf.type = 'highpass';
    this.xoverSubHpf.frequency.value = 28;
    this.xoverSubHpf.Q.value = 0.707;

    this.xoverSuperBassFilter = ctx.createBiquadFilter();
    this.xoverSuperBassFilter.type = 'peaking';
    this.xoverSuperBassFilter.frequency.value = 45;
    this.xoverSuperBassFilter.Q.value = 2.0;
    this.xoverSuperBassFilter.gain.value = 0;

    this.xoverSubLp1 = ctx.createBiquadFilter();
    this.xoverSubLp1.type = 'lowpass';
    this.xoverSubLp1.frequency.value = 80;
    this.xoverSubLp1.Q.value = 0.707;

    this.xoverSubLp2 = ctx.createBiquadFilter();
    this.xoverSubLp2.type = 'lowpass';
    this.xoverSubLp2.frequency.value = 80;
    this.xoverSubLp2.Q.value = 0.707;

    this.xoverSubDelay = ctx.createDelay(0.05);
    this.xoverSubGain = ctx.createGain();
    this.xoverSubGain.gain.value = 1;

    // Mid band (Band-pass = HPF at sub-crossover, LPF at high-crossover)
    this.xoverMidHp = ctx.createBiquadFilter();
    this.xoverMidHp.type = 'highpass';
    this.xoverMidHp.frequency.value = 80;
    this.xoverMidHp.Q.value = 0.707;

    this.xoverMidLp = ctx.createBiquadFilter();
    this.xoverMidLp.type = 'lowpass';
    this.xoverMidLp.frequency.value = 2500;
    this.xoverMidLp.Q.value = 0.707;

    this.xoverMidGain = ctx.createGain();
    this.xoverMidGain.gain.value = 1;

    // High band (LR-24 highpass = cascaded 2nd order Butterworth)
    this.xoverHighHp1 = ctx.createBiquadFilter();
    this.xoverHighHp1.type = 'highpass';
    this.xoverHighHp1.frequency.value = 2500;
    this.xoverHighHp1.Q.value = 0.707;

    this.xoverHighHp2 = ctx.createBiquadFilter();
    this.xoverHighHp2.type = 'highpass';
    this.xoverHighHp2.frequency.value = 2500;
    this.xoverHighHp2.Q.value = 0.707;

    this.xoverHighDelay = ctx.createDelay(0.02);
    this.xoverHighGain = ctx.createGain();
    this.xoverHighGain.gain.value = 1;

    this.xoverSumNode = ctx.createGain();
    this.xoverSumNode.gain.value = 1;

    // Mid/Side Stereo Width Matrix (L' = same*L + cross*R, R' = same*R + cross*L)
    this.widthSplitter = ctx.createChannelSplitter(2);
    this.widthMerger = ctx.createChannelMerger(2);
    this.widthLLGain = ctx.createGain();
    this.widthRLGain = ctx.createGain();
    this.widthRRGain = ctx.createGain();
    this.widthLRGain = ctx.createGain();
    this.widthLLGain.gain.value = 1;
    this.widthRRGain.gain.value = 1;
    this.widthRLGain.gain.value = 0;
    this.widthLRGain.gain.value = 0;

    this.postAnalyser = ctx.createAnalyser();
    this.postAnalyser.fftSize = 4096;
    this.postAnalyser.smoothingTimeConstant = 0.72;

    this.postSplitter = ctx.createChannelSplitter(2);
    this.postLAnalyser = ctx.createAnalyser();
    this.postLAnalyser.fftSize = 1024;
    this.postLAnalyser.smoothingTimeConstant = 0.65;
    this.postRAnalyser = ctx.createAnalyser();
    this.postRAnalyser.fftSize = 1024;
    this.postRAnalyser.smoothingTimeConstant = 0.65;
    this.postLTimeBuf = new Float32Array(this.postLAnalyser.fftSize);
    this.postRTimeBuf = new Float32Array(this.postRAnalyser.fftSize);

    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 0;

    // Signal flow: busMixSum -> inputGain -> preAnalyser -> subSonicNode -> humNotch -> gateGain -> standbyGateGain -> deEsser -> hpf -> eq0..5 -> lpf -> comp -> makeup -> limiter -> delay -> widthMatrix -> eq31Nodes -> xoverNetwork -> postAnalyser -> outputs
    this.busMixSum.connect(this.inputGain);
    this.inputGain.connect(this.preAnalyser);

    this.preAnalyser.connect(this.subSonicNode);
    this.subSonicNode.connect(this.humNotchFundamental);
    this.humNotchFundamental.connect(this.humNotchHarmonic1);
    this.humNotchHarmonic1.connect(this.humNotchHarmonic2);
    this.humNotchHarmonic2.connect(this.agcGainNode!);
    this.agcGainNode!.connect(this.gateGainNode);
    this.gateGainNode.connect(this.standbyGateGainNode);
    this.standbyGateGainNode.connect(this.deEsserNode);
    this.deEsserNode.connect(this.hpfNode);

    let prev: AudioNode = this.hpfNode;
    for (const eq of this.eqNodes) {
      prev.connect(eq);
      prev = eq;
    }
    prev.connect(this.lpfNode);
    let troubleChain: AudioNode = this.lpfNode;
    if (this.autoRumbleHpfNode) {
      troubleChain.connect(this.autoRumbleHpfNode);
      troubleChain = this.autoRumbleHpfNode;
    }
    if (this.autoMudCutNode) {
      troubleChain.connect(this.autoMudCutNode);
      troubleChain = this.autoMudCutNode;
    }
    for (const notch of this.surgicalNotchNodes) {
      troubleChain.connect(notch);
      troubleChain = notch;
    }
    troubleChain.connect(this.compNode);
    this.compNode.connect(this.makeupGain);
    this.makeupGain.connect(this.limiterNode);
    this.limiterNode.connect(this.delayNode);

    // Stereo Width Matrix wiring
    this.delayNode.connect(this.widthSplitter);
    this.widthSplitter.connect(this.widthLLGain, 0);
    this.widthSplitter.connect(this.widthRLGain, 1);
    this.widthLRGain.connect(this.widthMerger, 0, 1);
    this.widthRLGain.connect(this.widthMerger, 0, 0);
    this.widthLLGain.connect(this.widthMerger, 0, 0);
    this.widthRRGain.connect(this.widthMerger, 0, 1);

    // 31-Band Stereo Graphic EQ Cascade (spliced dynamically only when non-flat bands exist)
    this.eq31InputNode = ctx.createGain();
    this.eq31OutputNode = ctx.createGain();
    this.widthMerger.connect(this.eq31InputNode);
    this.eq31InputNode.connect(this.eq31OutputNode);
    this.eq31ChainConnected = false;

    for (let i = 0; i < this.eq31Nodes.length - 1; i++) {
      this.eq31Nodes[i].connect(this.eq31Nodes[i + 1]);
    }

    // Active 3-Way Linkwitz-Riley Crossover Split & Summing (branches spliced only when enabled)
    const eq31Chain: AudioNode = this.eq31OutputNode;
    // 1. Full-range bypass path
    eq31Chain.connect(this.xoverBypassGain);
    this.xoverBypassGain.connect(this.xoverSumNode);

    // 2. Subwoofer path (4th order LR-24 = cascaded 2nd order Butterworth LPF + Subsonic + SuperBass)
    this.xoverSubHpf.connect(this.xoverSuperBassFilter);
    this.xoverSuperBassFilter.connect(this.xoverSubLp1);
    this.xoverSubLp1.connect(this.xoverSubLp2);
    this.xoverSubLp2.connect(this.xoverSubDelay);
    this.xoverSubDelay.connect(this.xoverSubGain);
    this.xoverSubGain.connect(this.xoverSumNode);

    // 3. Mid path (Band-pass = HPF at sub-cutoff, LPF at high-cutoff)
    this.xoverMidHp.connect(this.xoverMidLp);
    this.xoverMidLp.connect(this.xoverMidGain);
    this.xoverMidGain.connect(this.xoverSumNode);

    // 4. High path (4th order LR-24 = cascaded 2nd order Butterworth HPF)
    this.xoverHighHp1.connect(this.xoverHighHp2);
    this.xoverHighHp2.connect(this.xoverHighDelay);
    this.xoverHighDelay.connect(this.xoverHighGain);
    this.xoverHighGain.connect(this.xoverSumNode);
    this.xoverBranchesConnected = false;

    this.xoverSumNode.connect(this.masterOutputGainNode!);
    this.masterOutputGainNode!.connect(this.outputSafetyLimiter!);
    this.outputSafetyLimiter!.connect(this.postAnalyser);
    this.postAnalyser.connect(this.postSplitter);
    this.postSplitter.connect(this.postLAnalyser, 0);
    this.postSplitter.connect(this.postRAnalyser, 1);

    // Clean standalone stereo main output strictly gated by monitorGain (muted by default -> zero loopback)
    this.postAnalyser.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);

    // Secondary dedicated stream / OBS sink (strictly muted until operator explicitly assigns an output endpoint)
    this.streamOutputGain = ctx.createGain();
    this.streamOutputGain.gain.value = 0;
    this.streamMediaDest = ctx.createMediaStreamDestination();
    this.postAnalyser.connect(this.streamOutputGain);
    this.streamOutputGain.connect(this.streamMediaDest);
    if (this.preferredStreamOutputDeviceId) {
      void this.setStreamOutputDevice(this.preferredStreamOutputDeviceId);
    }

    const binCount = this.preAnalyser.frequencyBinCount;
    this.preFreqBuf = new Float32Array(binCount);
    this.postFreqBuf = new Float32Array(binCount);
    this.preTimeBuf = new Float32Array(binCount);
    this.postTimeBuf = new Float32Array(binCount);
    this.cachedFreqAxis = new Float32Array(binCount);
    this.cachedFreqSampleRate = ctx.sampleRate;
    for (let i = 0; i < binCount; i++) {
      this.cachedFreqAxis[i] = (i * ctx.sampleRate) / 4096;
    }
    this.latestSpectrum = {
      frequencies: this.cachedFreqAxis,
      preDb: this.preFreqBuf,
      postDb: this.postFreqBuf,
    };
  }

  private syncEq31ChainWiring(needed: boolean): void {
    if (!this.eq31InputNode || !this.eq31OutputNode || this.eq31Nodes.length === 0) return;
    if (needed === this.eq31ChainConnected) return;
    const first = this.eq31Nodes[0];
    const last = this.eq31Nodes[this.eq31Nodes.length - 1];
    if (needed) {
      try {
        this.eq31InputNode.disconnect(this.eq31OutputNode);
      } catch {
        // ignore
      }
      this.eq31InputNode.connect(first);
      last.connect(this.eq31OutputNode);
    } else {
      try {
        this.eq31InputNode.disconnect(first);
      } catch {
        // ignore
      }
      try {
        last.disconnect(this.eq31OutputNode);
      } catch {
        // ignore
      }
      this.eq31InputNode.connect(this.eq31OutputNode);
    }
    this.eq31ChainConnected = needed;
  }

  private syncXoverBranchesWiring(needed: boolean): void {
    if (!this.eq31OutputNode || !this.xoverSubHpf || !this.xoverMidHp || !this.xoverHighHp1) return;
    if (needed === this.xoverBranchesConnected) return;
    if (needed) {
      this.eq31OutputNode.connect(this.xoverSubHpf);
      this.eq31OutputNode.connect(this.xoverMidHp);
      this.eq31OutputNode.connect(this.xoverHighHp1);
    } else {
      try {
        this.eq31OutputNode.disconnect(this.xoverSubHpf);
      } catch {
        // ignore
      }
      try {
        this.eq31OutputNode.disconnect(this.xoverMidHp);
      } catch {
        // ignore
      }
      try {
        this.eq31OutputNode.disconnect(this.xoverHighHp1);
      } catch {
        // ignore
      }
    }
    this.xoverBranchesConnected = needed;
  }

  public applySpeakerZones(_zones: SpeakerZone[]): void {
    // Zones are routed through the standalone stereo output bus gated by monitorGain.
  }

  public applyChannels(channels: InputChannel[]): void {
    this.lastChannels = channels;
    if (!this.ctx || this.channelStrips.length === 0) return;

    const now = this.ctx.currentTime;
    const nyquist = this.ctx.sampleRate * 0.48;
    const anySolo = channels.some((c) => c.solo);

    for (let i = 0; i < this.channelStrips.length; i++) {
      const strip = this.channelStrips[i];
      const ch = channels[i];
      if (!strip || !ch) continue;

      const sign = ch.polarityInverted ? -1 : 1;
      const preampDb = (ch.gainDb - 24) + (ch.padDb ? -20 : 0);
      strip.preampGain.gain.setTargetAtTime(dbToLinear(preampDb) * sign, now, 0.015);

      strip.hpfNode.frequency.setTargetAtTime(
        Math.min(nyquist, Math.max(20, ch.hpfHz || 20)),
        now,
        0.015
      );
      strip.eqLowNode.gain.setTargetAtTime(ch.eqLowDb || 0, now, 0.015);
      strip.eqMidNode.frequency.setTargetAtTime(
        Math.min(nyquist, Math.max(80, ch.eqMidFreqHz || 400)),
        now,
        0.015
      );
      strip.eqMidNode.gain.setTargetAtTime(ch.eqMidDb || 0, now, 0.015);
      strip.eqHighNode.gain.setTargetAtTime(ch.eqHighDb || 0, now, 0.015);

      strip.compNode.threshold.setTargetAtTime(
        Math.max(-60, Math.min(0, ch.compThresholdDb ?? -18)),
        now,
        0.02
      );
      strip.compNode.ratio.setTargetAtTime(
        Math.max(1, Math.min(20, ch.compRatio || 3)),
        now,
        0.02
      );

      // Standalone stereo: pan operates as an independent channel balance control (-100 Left to +100 Right, 0 = Center Balance)
      const panVal = Math.max(-1, Math.min(1, (ch.pan || 0) / 100));
      strip.pannerNode.pan.setTargetAtTime(panVal, now, 0.015);

      const isSuppressed = ch.mute || (anySolo && !ch.solo) || ch.faderDb <= -47.5;
      const faderLinear = isSuppressed ? 0 : dbToLinear(ch.faderDb);
      strip.faderGain.gain.setTargetAtTime(faderLinear, now, 0.015);
    }
  }

  public applyDsp(dsp: DspConfig): void {
    this.lastDsp = dsp;
    if (
      !this.ctx ||
      !this.inputGain ||
      !this.hpfNode ||
      !this.lpfNode ||
      !this.compNode ||
      !this.makeupGain ||
      !this.limiterNode ||
      !this.delayNode
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const nyquist = this.ctx.sampleRate * 0.48;

    const polaritySign = dsp.polarityInverted ? -1 : 1;
    const trimLinear = dsp.bypassed ? 1 : dbToLinear(dsp.inputTrimDb) * polaritySign;
    this.inputGain.gain.setTargetAtTime(trimLinear, now, 0.015);

    if (dsp.bypassed) {
      if (this.gateGainNode) this.gateGainNode.gain.setTargetAtTime(1, now, 0.015);
      if (this.deEsserNode) this.deEsserNode.gain.setTargetAtTime(0, now, 0.015);
      this.hpfNode.frequency.setTargetAtTime(10, now, 0.015);
      this.lpfNode.frequency.setTargetAtTime(nyquist, now, 0.015);
      this.eqNodes.forEach((node) => {
        node.gain.setTargetAtTime(0, now, 0.015);
      });
      this.compNode.threshold.setTargetAtTime(0, now, 0.015);
      this.compNode.ratio.setTargetAtTime(1, now, 0.015);
      this.makeupGain.gain.setTargetAtTime(1, now, 0.015);
      this.limiterNode.threshold.setTargetAtTime(0, now, 0.015);
      this.delayNode.delayTime.setTargetAtTime(0, now, 0.015);
      if (this.widthLLGain && this.widthRRGain && this.widthRLGain && this.widthLRGain) {
        this.widthLLGain.gain.setTargetAtTime(1, now, 0.015);
        this.widthRRGain.gain.setTargetAtTime(1, now, 0.015);
        this.widthRLGain.gain.setTargetAtTime(0, now, 0.015);
        this.widthLRGain.gain.setTargetAtTime(0, now, 0.015);
      }
      this.syncEq31ChainWiring(false);
      this.syncXoverBranchesWiring(false);
      if (this.xoverBypassGain && this.xoverSubGain && this.xoverMidGain && this.xoverHighGain) {
        this.xoverBypassGain.gain.setTargetAtTime(1, now, 0.015);
        this.xoverSubGain.gain.setTargetAtTime(0, now, 0.015);
        this.xoverMidGain.gain.setTargetAtTime(0, now, 0.015);
        this.xoverHighGain.gain.setTargetAtTime(0, now, 0.015);
      }
      return;
    }

    if (!dsp.gate.enabled && this.gateGainNode) {
      this.gateIsClosed = false;
      this.gateGainNode.gain.setTargetAtTime(1, now, 0.015);
    }

    if (this.deEsserNode) {
      this.deEsserNode.frequency.setTargetAtTime(
        Math.min(nyquist, Math.max(2000, dsp.deEsser.frequencyHz)),
        now,
        0.015
      );
      if (!dsp.deEsser.enabled) {
        this.deEsserNode.gain.setTargetAtTime(0, now, 0.015);
      }
    }

    this.hpfNode.frequency.setTargetAtTime(dsp.hpfEnabled ? Math.max(20, dsp.hpfHz) : 10, now, 0.015);
    this.lpfNode.frequency.setTargetAtTime(dsp.lpfEnabled ? Math.min(nyquist, dsp.lpfHz) : nyquist, now, 0.015);

    dsp.eqBands.slice(0, this.eqNodes.length).forEach((band, idx) => {
      const node = this.eqNodes[idx];
      if (!node) return;
      node.type = band.type;
      node.frequency.setTargetAtTime(Math.min(nyquist, Math.max(20, band.frequency)), now, 0.015);
      node.Q.setTargetAtTime(Math.max(0.1, Math.min(24, band.q)), now, 0.015);
      node.gain.setTargetAtTime(band.enabled ? band.gainDb : 0, now, 0.015);
    });

    if (dsp.compressor.enabled) {
      this.compNode.threshold.setTargetAtTime(dsp.compressor.thresholdDb, now, 0.02);
      this.compNode.ratio.setTargetAtTime(Math.max(1, Math.min(20, dsp.compressor.ratio)), now, 0.02);
      this.compNode.attack.setTargetAtTime(dsp.compressor.attackMs / 1000, now, 0.02);
      this.compNode.release.setTargetAtTime(dsp.compressor.releaseMs / 1000, now, 0.02);
      this.makeupGain.gain.setTargetAtTime(dbToLinear(dsp.compressor.makeupDb), now, 0.02);
    } else {
      this.compNode.threshold.setTargetAtTime(0, now, 0.02);
      this.compNode.ratio.setTargetAtTime(1, now, 0.02);
      this.makeupGain.gain.setTargetAtTime(1, now, 0.02);
    }

    if (dsp.limiter.enabled) {
      this.limiterNode.threshold.setTargetAtTime(Math.min(0, dsp.limiter.ceilingDb), now, 0.01);
      this.limiterNode.release.setTargetAtTime(dsp.limiter.releaseMs / 1000, now, 0.01);
    } else {
      this.limiterNode.threshold.setTargetAtTime(0, now, 0.01);
    }

    if (this.masterOutputGainNode) {
      const masterDb = dsp.bypassed ? 0 : (dsp.masterOutputGainDb ?? 0);
      this.masterOutputGainNode.gain.setTargetAtTime(
        dbToLinear(Math.max(-36, Math.min(6, masterDb))),
        now,
        0.015
      );
    }

    if (this.outputSafetyLimiter) {
      const safetyCeiling = dsp.limiter.enabled ? Math.min(-0.3, dsp.limiter.ceilingDb) : -0.3;
      this.outputSafetyLimiter.threshold.setTargetAtTime(safetyCeiling, now, 0.01);
    }

    this.delayNode.delayTime.setTargetAtTime(
      Math.max(0, Math.min(0.45, dsp.masterDelayMs / 1000)),
      now,
      0.01
    );

    if (this.widthLLGain && this.widthRRGain && this.widthRLGain && this.widthLRGain) {
      const w = Math.max(0, Math.min(1.5, dsp.stereoWidth));
      const same = (1 + w) / 2;
      const cross = (1 - w) / 2;
      this.widthLLGain.gain.setTargetAtTime(same, now, 0.015);
      this.widthRRGain.gain.setTargetAtTime(same, now, 0.015);
      this.widthRLGain.gain.setTargetAtTime(cross, now, 0.015);
      this.widthLRGain.gain.setTargetAtTime(cross, now, 0.015);
    }

    // Clean Standby & Sub-sonic DC Blocker
    if (this.subSonicNode) {
      const dcActive = !dsp.bypassed && (dsp.cleanStandby?.dcBlockerEnabled !== false);
      this.subSonicNode.frequency.setTargetAtTime(dcActive ? 18 : 5, now, 0.015);
    }

    // Mains Hum Notch Elimination (50 Hz / 60 Hz + Harmonics)
    if (this.humNotchFundamental && this.humNotchHarmonic1 && this.humNotchHarmonic2) {
      const notchMode = dsp.bypassed ? 'off' : (dsp.cleanStandby?.mainsHumNotch ?? '60hz');
      if (notchMode === '50hz') {
        this.humNotchFundamental.frequency.setTargetAtTime(50, now, 0.015);
        this.humNotchFundamental.Q.setTargetAtTime(14, now, 0.015);
        this.humNotchHarmonic1.frequency.setTargetAtTime(100, now, 0.015);
        this.humNotchHarmonic1.Q.setTargetAtTime(14, now, 0.015);
        this.humNotchHarmonic2.frequency.setTargetAtTime(150, now, 0.015);
        this.humNotchHarmonic2.Q.setTargetAtTime(14, now, 0.015);
      } else if (notchMode === '60hz') {
        this.humNotchFundamental.frequency.setTargetAtTime(60, now, 0.015);
        this.humNotchFundamental.Q.setTargetAtTime(14, now, 0.015);
        this.humNotchHarmonic1.frequency.setTargetAtTime(120, now, 0.015);
        this.humNotchHarmonic1.Q.setTargetAtTime(14, now, 0.015);
        this.humNotchHarmonic2.frequency.setTargetAtTime(180, now, 0.015);
        this.humNotchHarmonic2.Q.setTargetAtTime(14, now, 0.015);
      } else {
        this.humNotchFundamental.Q.setTargetAtTime(0.001, now, 0.015);
        this.humNotchHarmonic1.Q.setTargetAtTime(0.001, now, 0.015);
        this.humNotchHarmonic2.Q.setTargetAtTime(0.001, now, 0.015);
      }
    }

    // 31-Band ISO 1/3-Octave Graphic EQ (splice in only when non-flat adjustments exist)
    const eq31Config = dsp.graphicEq31;
    const eq31Active = !dsp.bypassed && (eq31Config?.enabled ?? true);
    const needsEq31 =
      eq31Active && Boolean(eq31Config?.bands?.some((b) => Math.abs(b.gainDb) >= 0.05));
    this.syncEq31ChainWiring(needsEq31);
    if (needsEq31) {
      this.eq31Nodes.forEach((node, idx) => {
        const bandConfig = eq31Config?.bands?.[idx];
        const gainDb = bandConfig ? bandConfig.gainDb : 0;
        node.gain.setTargetAtTime(gainDb, now, 0.015);
      });
    }

    // Active 3-Way Linkwitz-Riley Crossover & Time Alignment
    const xover = dsp.crossover;
    const xoverActive = !dsp.bypassed && (xover?.enabled ?? true);
    if (
      this.xoverBypassGain &&
      this.xoverSubLp1 &&
      this.xoverSubLp2 &&
      this.xoverSubDelay &&
      this.xoverSubGain &&
      this.xoverMidHp &&
      this.xoverMidLp &&
      this.xoverMidGain &&
      this.xoverHighHp1 &&
      this.xoverHighHp2 &&
      this.xoverHighDelay &&
      this.xoverHighGain
    ) {
      this.syncXoverBranchesWiring(xoverActive && Boolean(xover));
      if (xoverActive && xover) {
        this.xoverBypassGain.gain.setTargetAtTime(0, now, 0.015);

        const subToMid = Math.min(nyquist, Math.max(40, xover.subToMidHz || 80));
        const midToHigh = Math.min(nyquist, Math.max(subToMid + 200, xover.midToHighHz || 2500));

        const anySolo = Boolean(xover.sub.solo || xover.mid.solo || xover.high.solo);

        // Subwoofer band (LR-24 + Subsonic Protection + SuperBass Sub Booster)
        if (this.xoverSubHpf && this.xoverSuperBassFilter) {
          const sb = xover.superBass;
          const sbActive = Boolean(sb && sb.enabled);
          const subsonicHz = sb?.subInfrasoundHpfHz ?? 28;
          this.xoverSubHpf.frequency.setTargetAtTime(subsonicHz, now, 0.015);

          if (sbActive && sb) {
            const freq = sb.mode === 'punch-808' ? 63 : sb.mode === 'subharmonic' ? 40 : 45;
            const boostDb = sb.boostDb ?? 4;
            this.xoverSuperBassFilter.frequency.setTargetAtTime(freq, now, 0.015);
            this.xoverSuperBassFilter.Q.setTargetAtTime(sb.mode === 'punch-808' ? 2.5 : 1.8, now, 0.015);
            this.xoverSuperBassFilter.gain.setTargetAtTime(boostDb, now, 0.015);
          } else {
            this.xoverSuperBassFilter.gain.setTargetAtTime(0, now, 0.015);
          }
        }

        this.xoverSubLp1.frequency.setTargetAtTime(subToMid, now, 0.015);
        this.xoverSubLp2.frequency.setTargetAtTime(subToMid, now, 0.015);
        const subDelaySec = Math.max(0, Math.min(0.045, (xover.sub.delayMs || 0) / 1000));
        this.xoverSubDelay.delayTime.setTargetAtTime(subDelaySec, now, 0.015);
        const subSign = xover.sub.polarityInverted ? -1 : 1;
        const subLinear = (xover.sub.mute || (anySolo && !xover.sub.solo)) ? 0 : dbToLinear(xover.sub.gainDb || 0) * subSign;
        this.xoverSubGain.gain.setTargetAtTime(subLinear, now, 0.015);

        // Mid / Vocal band (Band-pass)
        this.xoverMidHp.frequency.setTargetAtTime(subToMid, now, 0.015);
        this.xoverMidLp.frequency.setTargetAtTime(midToHigh, now, 0.015);
        const midSign = xover.mid.polarityInverted ? -1 : 1;
        const midLinear = (xover.mid.mute || (anySolo && !xover.mid.solo)) ? 0 : dbToLinear(xover.mid.gainDb || 0) * midSign;
        this.xoverMidGain.gain.setTargetAtTime(midLinear, now, 0.015);

        // High / Horn band (LR-24)
        this.xoverHighHp1.frequency.setTargetAtTime(midToHigh, now, 0.015);
        this.xoverHighHp2.frequency.setTargetAtTime(midToHigh, now, 0.015);
        const highDelaySec = Math.max(0, Math.min(0.02, (xover.high.delayMs || 0) / 1000));
        this.xoverHighDelay.delayTime.setTargetAtTime(highDelaySec, now, 0.015);
        const highSign = xover.high.polarityInverted ? -1 : 1;
        const highLinear = (xover.high.mute || (anySolo && !xover.high.solo)) ? 0 : dbToLinear(xover.high.gainDb || 0) * highSign;
        this.xoverHighGain.gain.setTargetAtTime(highLinear, now, 0.015);
      } else {
        // Crossover bypassed -> send clean full-range audio
        this.xoverBypassGain.gain.setTargetAtTime(1, now, 0.015);
        this.xoverSubGain.gain.setTargetAtTime(0, now, 0.015);
        this.xoverMidGain.gain.setTargetAtTime(0, now, 0.015);
        this.xoverHighGain.gain.setTargetAtTime(0, now, 0.015);
      }
    }
  }

  private teardownSource(): void {
    for (const node of this.sourceNodes) {
      try {
        node.disconnect();
        if ('stop' in node && typeof (node as AudioBufferSourceNode).stop === 'function') {
          (node as AudioBufferSourceNode).stop();
        }
      } catch {
        // ignore stopped nodes
      }
    }
    this.sourceNodes = [];

    for (const [, entry] of this.deviceStreams) {
      try {
        entry.node.disconnect();
        entry.stream.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
      } catch {
        // ignore
      }
    }
    this.deviceStreams.clear();

    for (const [, entry] of this.nativeStreams) {
      try {
        entry.node.disconnect();
      } catch {
        // ignore
      }
    }
    this.nativeStreams.clear();
    void stopAllNativeDesktopCaptures();

    this.teardownRawTap();
    void stopRawOutput();

    this.stripDeviceBindings.clear();

    for (const strip of this.channelStrips) {
      try {
        strip.preampGain.disconnect();
        strip.hpfNode.disconnect();
        strip.eqLowNode.disconnect();
        strip.eqMidNode.disconnect();
        strip.eqHighNode.disconnect();
        strip.compNode.disconnect();
        strip.pannerNode.disconnect();
        strip.faderGain.disconnect();
      } catch {
        // ignore
      }
    }
    this.channelStrips = [];

    for (const a of this.channelAnalysers) {
      try {
        a.disconnect();
      } catch {
        // ignore
      }
    }
    this.channelAnalysers = [];
    this.channelTimeBufs = [];
    this.channelNoiseFloors = [];
    this.capturedChannels = 0;
    this.activeInputLabel = null;

    if (this.activeStream) {
      this.activeStream.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      this.activeStream = null;
    }
    this.persistentPeakBin = -1;
    this.persistentPeakFrames = 0;
  }

  private ensureChannelStrips(requiredCount: number): void {
    if (!this.ctx || !this.busMixSum) return;
    const ctx = this.ctx;
    const targetCount = Math.max(8, requiredCount);

    while (this.channelStrips.length < targetCount) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.68;
      this.channelAnalysers.push(analyser);
      this.channelTimeBufs.push(new Float32Array(analyser.fftSize));
      this.channelNoiseFloors.push(-96);

      // Per-channel strip DSP: standalone 2-channel stereo signal path
      const preampGain = ctx.createGain();
      preampGain.channelCount = 2;
      preampGain.channelCountMode = 'explicit';
      preampGain.channelInterpretation = 'speakers';

      const hpfNode = ctx.createBiquadFilter();
      hpfNode.type = 'highpass';
      hpfNode.Q.value = 0.707;

      const eqLowNode = ctx.createBiquadFilter();
      eqLowNode.type = 'lowshelf';
      eqLowNode.frequency.value = 110;

      const eqMidNode = ctx.createBiquadFilter();
      eqMidNode.type = 'peaking';
      eqMidNode.frequency.value = 400;
      eqMidNode.Q.value = 1.4;

      const eqHighNode = ctx.createBiquadFilter();
      eqHighNode.type = 'highshelf';
      eqHighNode.frequency.value = 8000;

      const compNode = ctx.createDynamicsCompressor();
      compNode.knee.value = 6;
      compNode.attack.value = 0.008;
      compNode.release.value = 0.14;

      const pannerNode = ctx.createStereoPanner();
      const faderGain = ctx.createGain();
      faderGain.channelCount = 2;
      faderGain.channelCountMode = 'explicit';
      faderGain.channelInterpretation = 'speakers';

      hpfNode.connect(eqLowNode);
      eqLowNode.connect(eqMidNode);
      eqMidNode.connect(eqHighNode);
      eqHighNode.connect(compNode);
      compNode.connect(pannerNode);
      pannerNode.connect(faderGain);

      this.channelStrips.push({
        preampGain,
        hpfNode,
        eqLowNode,
        eqMidNode,
        eqHighNode,
        compNode,
        pannerNode,
        faderGain,
        connectedToBus: false,
      });
    }

    this.capturedChannels = this.channelStrips.length;
  }

  private setStripActiveConnection(stripIndex: number, active: boolean): void {
    const strip = this.channelStrips[stripIndex];
    const analyser = this.channelAnalysers[stripIndex];
    if (!strip || !this.busMixSum || strip.connectedToBus === active) return;
    if (active) {
      if (analyser) {
        strip.preampGain.connect(analyser);
      }
      strip.faderGain.connect(this.busMixSum);
    } else {
      if (analyser) {
        try {
          strip.preampGain.disconnect(analyser);
        } catch {
          // ignore disconnect mismatch
        }
      }
      try {
        strip.faderGain.disconnect(this.busMixSum);
      } catch {
        // ignore disconnect mismatch
      }
    }
    strip.connectedToBus = active;
  }

  private unbindStripDevice(stripIndex: number): void {
    this.setStripActiveConnection(stripIndex, false);
    const prevId = this.stripDeviceBindings.get(stripIndex);
    const strip = this.channelStrips[stripIndex];
    if (!prevId) return;

    this.stripDeviceBindings.delete(stripIndex);

    const nativeEntry = this.nativeStreams.get(prevId);
    if (nativeEntry) {
      nativeEntry.strips.delete(stripIndex);
      if (strip) {
        try {
          nativeEntry.node.disconnect(strip.preampGain);
        } catch {
          // ignore disconnect mismatch
        }
      }
      if (nativeEntry.strips.size === 0) {
        try {
          nativeEntry.node.disconnect();
        } catch {
          // ignore
        }
        this.nativeStreams.delete(prevId);
        void stopNativeDesktopCapture(nativeEntry.streamKey);
      }
      return;
    }

    const entry = this.deviceStreams.get(prevId);
    if (!entry) return;

    entry.strips.delete(stripIndex);
    if (strip) {
      try {
        entry.node.disconnect(strip.preampGain);
      } catch {
        // node may already be disconnected from this target
      }
    }

    if (entry.strips.size === 0) {
      try {
        entry.node.disconnect();
        entry.stream.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
      } catch {
        // ignore track stop cleanup
      }
      this.deviceStreams.delete(prevId);
    }
  }

  public syncChannelHardwareInputs(channels: InputChannel[]): Promise<void> {
    this.syncQueuePromise = this.syncQueuePromise
      .then(() => this.applyChannelHardwareBindings(channels))
      .catch(() => {});
    return this.syncQueuePromise;
  }

  private async applyChannelHardwareBindings(channels: InputChannel[]): Promise<void> {
    if (!this.ctx || !this.isRunning || this.sourceMode !== 'live-mic') return;

    this.ensureChannelStrips(Math.max(8, channels.length));
    this.applyChannels(channels);

    const activeLabels: string[] = [];

    for (let i = 0; i < this.channelStrips.length; i++) {
      const ch = channels[i];
      const rawDevId = ch?.hardwareInputId || '';
      const targetDevId =
        !rawDevId || rawDevId === 'none' || rawDevId === 'default' || rawDevId === 'communications'
          ? ''
          : rawDevId;
      const currentDevId = this.stripDeviceBindings.get(i) || '';

      if (targetDevId !== currentDevId) {
        this.unbindStripDevice(i);

        if (targetDevId) {
          this.stripDeviceBindings.set(i, targetDevId);
          const strip = this.channelStrips[i];

          if (isNativeDesktopInputId(targetDevId)) {
            let nativeEntry = this.nativeStreams.get(targetDevId);
            if (!nativeEntry && strip && this.ctx) {
              try {
                await this.ensureDesktopWorklet();
                if (this.stripDeviceBindings.get(i) !== targetDevId || !this.isRunning || !this.ctx) {
                  continue;
                }
                const workletNode = new AudioWorkletNode(this.ctx, 'desktop-loopback-processor', {
                  numberOfInputs: 0,
                  numberOfOutputs: 1,
                  outputChannelCount: [2],
                });
                const targetPid = parseNativeAppPid(targetDevId);
                await startNativeDesktopCapture(targetDevId, targetPid, (buf) => {
                  try {
                    workletNode.port.postMessage(buf, [buf]);
                  } catch {
                    // ignore if node torn down
                  }
                });

                if (this.stripDeviceBindings.get(i) !== targetDevId || !this.isRunning || !this.ctx) {
                  workletNode.disconnect();
                  void stopNativeDesktopCapture(targetDevId);
                  continue;
                }

                nativeEntry = { node: workletNode, strips: new Set(), streamKey: targetDevId };
                this.nativeStreams.set(targetDevId, nativeEntry);
              } catch (err) {
                this.stripDeviceBindings.delete(i);
                console.warn(`Failed to open native desktop loopback for CH${i + 1}:`, err);
              }
            }

            if (nativeEntry && strip) {
              nativeEntry.node.connect(strip.preampGain);
              nativeEntry.strips.add(i);
              this.setStripActiveConnection(i, true);
            } else {
              this.setStripActiveConnection(i, false);
            }
          } else {
            let entry = this.deviceStreams.get(targetDevId);

            if (!entry && strip) {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({
                  audio: {
                    deviceId: { exact: targetDevId },
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: { ideal: 2 },
                    sampleRate: { ideal: 48000 },
                  },
                });

                // Verify binding did not change while awaiting permission/stream open
                if (this.stripDeviceBindings.get(i) !== targetDevId || !this.isRunning || !this.ctx) {
                  stream.getTracks().forEach((t) => t.stop());
                  continue;
                }

                const node = this.ctx.createMediaStreamSource(stream);
                entry = { stream, node, strips: new Set() };
                this.deviceStreams.set(targetDevId, entry);
              } catch (err) {
                this.stripDeviceBindings.delete(i);
                console.warn(`Failed to open dedicated stereo stream for CH${i + 1}:`, err);
              }
            }

            if (entry && strip) {
              entry.node.connect(strip.preampGain);
              entry.strips.add(i);
              this.setStripActiveConnection(i, true);
            } else {
              this.setStripActiveConnection(i, false);
            }
          }
        } else {
          this.setStripActiveConnection(i, false);
        }
      }

      if (targetDevId && ch?.hardwareInputLabel) {
        activeLabels.push(ch.hardwareInputLabel);
      }
    }

    if (activeLabels.length === 1) {
      this.activeInputLabel = activeLabels[0];
    } else if (activeLabels.length > 1) {
      this.activeInputLabel = `${activeLabels.length} Live Stereo Inputs`;
    } else {
      this.activeInputLabel = 'Ready — Assign or Scan Live Inputs';
    }
  }

  private async setupSource(mode: AudioSourceSimulation): Promise<void> {
    if (!this.ctx || !this.busMixSum) return;
    const ctx = this.ctx;

    if (mode === 'desktop-audio') {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error(
          'Desktop audio loopback (getDisplayMedia) is unavailable in this browser context.'
        );
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1, frameRate: 1 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48000 },
        },
        // Opt-in desktop loopback explicitly requested by operator
        ...({ systemAudio: 'include' } as Record<string, unknown>),
      } as DisplayMediaStreamOptions);

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error(
          'No audio track was shared. Re-click Start Engine and check "Share system audio" or "Share tab audio" in the picker.'
        );
      }

      stream.getVideoTracks().forEach((vt) => {
        vt.enabled = false;
      });

      this.activeStream = stream;
      const audioTrack = audioTracks[0];
      audioTrack.onended = () => {
        this.stop();
        this.onSourceEndedCb?.();
      };

      this.activeInputLabel = audioTrack.label
        ? `Desktop Loopback: ${audioTrack.label}`
        : 'Desktop Audio (System / Browser Loopback)';

      this.ensureChannelStrips(Math.max(8, this.lastChannels.length));
      this.setStripActiveConnection(0, true);
      const desktopNode = ctx.createMediaStreamSource(stream);
      desktopNode.connect(this.channelStrips[0].preampGain);
      this.sourceNodes.push(desktopNode);
      return;
    }

    if (mode === 'live-mic') {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Browser mediaDevices.getUserMedia is unavailable in this environment.');
      }
      this.ensureChannelStrips(Math.max(8, this.lastChannels.length));
      await this.syncChannelHardwareInputs(this.lastChannels);
      return;
    }

    // Calibrated -20 dBFS Pink Noise generator for acoustic alignment & RTA verification
    const noiseLen = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(2, noiseLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const out = noiseBuffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < noiseLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.055;
        b6 = white * 0.115926;
      }
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;

    const calGain = ctx.createGain();
    calGain.gain.value = 0.65;
    noiseSrc.connect(calGain);
    this.activeInputLabel = 'Calibration: Pink Noise (-20 dBFS)';
    this.ensureChannelStrips(Math.max(8, this.lastChannels.length));
    this.setStripActiveConnection(0, true);
    calGain.connect(this.channelStrips[0].preampGain);
    noiseSrc.start();
    this.sourceNodes.push(noiseSrc, calGain);
  }

  public sampleTelemetry(options?: {
    includeSpectrum?: boolean;
  }): { telemetry: SignalTelemetry; spectrum: SpectrumSnapshot } {
    const sampleRate = this.getSampleRate();
    if (this.cachedFreqSampleRate !== sampleRate) {
      this.cachedFreqSampleRate = sampleRate;
      for (let i = 0; i < this.cachedFreqAxis.length; i++) {
        this.cachedFreqAxis[i] = (i * sampleRate) / 4096;
      }
    }

    if (!this.preAnalyser || !this.postAnalyser || !this.isRunning) {
      this.preFreqBuf.fill(-96);
      this.postFreqBuf.fill(-96);
      return {
        telemetry: {
          source: this.sourceMode,
          isRunning: false,
          sampleRate,
          activeInputLabel: null,
          capturedChannels: 0,
          preRmsDb: -96,
          postRmsDb: -96,
          postLRmsDb: -96,
          postRRmsDb: -96,
          prePeakDb: -96,
          postPeakDb: -96,
          postLPeakDb: -96,
          postRPeakDb: -96,
          estimatedLufs: -70,
          gainReductionDb: 0,
          noiseFloorDb: -96,
          channelLevels: [],
          feedbackRisk: {
            detected: false,
            frequencyHz: null,
            prominenceDb: 0,
            persistenceSec: 0,
            confidence: 0,
          },
          humRisk: {
            detected: false,
            fundamentalHz: null,
            harmonic100Db: -96,
            harmonic150Db: -96,
            confidence: 0,
          },
          mudRisk: { detected: false, bandEnergyDb: -96, centerHz: 220 },
          clippingEvents: this.clippingCount,
        },
        spectrum: this.latestSpectrum,
      };
    }

    this.telemetryTickCount += 1;
    const readSpectrumNow = Boolean(options?.includeSpectrum) || this.telemetryTickCount % 2 === 1;
    if (readSpectrumNow) {
      this.preAnalyser.getFloatFrequencyData(this.preFreqBuf);
      this.postAnalyser.getFloatFrequencyData(this.postFreqBuf);
      this.lastSpectrumReadTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
    this.preAnalyser.getFloatTimeDomainData(this.preTimeBuf);
    this.postAnalyser.getFloatTimeDomainData(this.postTimeBuf);

    const preStats = calcTimeStats(this.preTimeBuf);
    const postStats = calcTimeStats(this.postTimeBuf);

    let postLStats = postStats;
    let postRStats = postStats;
    if (this.postLAnalyser && this.postRAnalyser) {
      this.postLAnalyser.getFloatTimeDomainData(this.postLTimeBuf);
      this.postRAnalyser.getFloatTimeDomainData(this.postRTimeBuf);
      postLStats = calcTimeStats(this.postLTimeBuf);
      postRStats = calcTimeStats(this.postRTimeBuf);
    }

    const binHz = sampleRate / 4096;
    const now = this.ctx?.currentTime ?? 0;

    // Live Noise Gate envelope update (with 2 dB hysteresis)
    if (this.gateGainNode && this.lastDsp && !this.lastDsp.bypassed && this.lastDsp.gate.enabled) {
      const thresh = this.lastDsp.gate.thresholdDb;
      if (this.gateIsClosed) {
        if (preStats.rmsDb >= thresh + 2.0) this.gateIsClosed = false;
      } else {
        if (preStats.rmsDb < thresh) this.gateIsClosed = true;
      }
      const gateLinear = this.gateIsClosed
        ? dbToLinear(-Math.abs(this.lastDsp.gate.rangeDb || 24))
        : 1;
      this.gateGainNode.gain.setTargetAtTime(gateLinear, now, this.gateIsClosed ? 0.045 : 0.008);
    } else if (this.gateGainNode) {
      this.gateIsClosed = false;
      this.gateGainNode.gain.setTargetAtTime(1, now, 0.015);
    }

    // Adaptive Standby Gate: Zero Standby Hums, Buzzes, and Cable Noise
    if (this.standbyGateGainNode && this.lastDsp && !this.lastDsp.bypassed) {
      const standbyCfg = this.lastDsp.cleanStandby;
      const standbyEnabled = standbyCfg
        ? ((standbyCfg.standbyGateEnabled ?? standbyCfg.adaptiveStandbyGate) !== false)
        : true;
      const thresholdDb = standbyCfg?.standbyGateThresholdDb ?? -56;
      const holdSec = (standbyCfg?.standbyGateHoldMs ?? 1000) / 1000;

      if (standbyEnabled) {
        if (preStats.rmsDb < thresholdDb) {
          this.standbySilenceTimerSec += 0.05;
          if (this.standbySilenceTimerSec >= holdSec) {
            this.standbyGateIsClosed = true;
          }
        } else if (preStats.rmsDb >= thresholdDb + 1.5) {
          this.standbySilenceTimerSec = 0;
          this.standbyGateIsClosed = false;
        }

        const targetGain = this.standbyGateIsClosed ? 0.00001 : 1.0;
        this.standbyGateGainNode.gain.setTargetAtTime(
          targetGain,
          now,
          this.standbyGateIsClosed ? 0.08 : 0.005
        );
      } else {
        this.standbyGateIsClosed = false;
        this.standbyGateGainNode.gain.setTargetAtTime(1.0, now, 0.015);
      }
    } else if (this.standbyGateGainNode) {
      this.standbyGateIsClosed = false;
      this.standbyGateGainNode.gain.setTargetAtTime(1.0, now, 0.015);
    }

    // Intelligent Adaptive Input Gain Control (Smart AGC) with Gate-Hold Protection
    if (this.agcGainNode) {
      const agc = this.lastDsp?.smartAgc;
      const agcActive = Boolean(agc?.enabled && this.lastDsp && !this.lastDsp.bypassed);
      if (agcActive && agc) {
        const targetRms = agc.targetRmsDb ?? -18;
        const maxBoost = Math.max(0, Math.min(18, agc.maxBoostDb ?? 14));
        const maxCut = Math.max(0, Math.min(24, agc.maxCutDb ?? 18));
        const gateFloor = agc.gateFloorDb ?? -52;

        if (preStats.peakDb > -3.0) {
          // Fast protective attenuation if transient approaches digital clip
          const neededCut = Math.max(-maxCut, -3.0 - preStats.peakDb);
          this.currentAgcGainDb += (neededCut - this.currentAgcGainDb) * 0.45;
          this.agcGainNode.gain.setTargetAtTime(dbToLinear(this.currentAgcGainDb), now, 0.025);
        } else if (preStats.rmsDb > gateFloor) {
          // Active voice/instrument: smoothly ride toward target RMS
          const desiredDelta = Math.max(-maxCut, Math.min(maxBoost, targetRms - preStats.rmsDb));
          const coeff = desiredDelta < this.currentAgcGainDb ? 0.18 : 0.06; // faster cut, gentle natural lift
          this.currentAgcGainDb += (desiredDelta - this.currentAgcGainDb) * coeff;
          this.agcGainNode.gain.setTargetAtTime(dbToLinear(this.currentAgcGainDb), now, 0.08);
        } else {
          // Silence / room noise below gate floor: freeze & gently return toward 0 dB (never pump room hiss)
          this.currentAgcGainDb *= 0.96;
          this.agcGainNode.gain.setTargetAtTime(dbToLinear(this.currentAgcGainDb), now, 0.25);
        }
      } else {
        this.currentAgcGainDb = 0;
        this.agcGainNode.gain.setTargetAtTime(1.0, now, 0.04);
      }
    }

    // Dynamic De-Esser detector & gain cut tracking sibilant band energy
    let deEssCutDb = 0;
    if (this.deEsserNode && this.lastDsp && !this.lastDsp.bypassed && this.lastDsp.deEsser.enabled) {
      const center = Math.max(2500, this.lastDsp.deEsser.frequencyHz);
      const loBin = Math.max(1, Math.floor((center * 0.85) / binHz));
      const hiBin = Math.min(this.preFreqBuf.length - 1, Math.ceil((center * 1.15) / binHz));
      let peakSibDb = -96;
      for (let b = loBin; b <= hiBin; b++) {
        if (this.preFreqBuf[b] > peakSibDb) peakSibDb = this.preFreqBuf[b];
      }
      const over = peakSibDb - this.lastDsp.deEsser.thresholdDb;
      if (over > 0) {
        deEssCutDb = -Math.min(10, over * 0.75);
      }
      this.deEsserNode.gain.setTargetAtTime(deEssCutDb, now, deEssCutDb < 0 ? 0.015 : 0.04);
    } else if (this.deEsserNode) {
      this.deEsserNode.gain.setTargetAtTime(0, now, 0.02);
    }

    if (postStats.peakDb > -0.2) this.clippingCount++;

    const freqs = this.cachedFreqAxis;

    // Feedback persistence detector on post-DSP spectrum (400 Hz - 10 kHz)
    const minBin = Math.floor(400 / binHz);
    const maxBin = Math.min(this.postFreqBuf.length - 6, Math.floor(10000 / binHz));
    let maxProminence = 0;
    let maxPromBin = -1;

    for (let i = minBin; i <= maxBin; i++) {
      const val = this.postFreqBuf[i];
      const neighborAvg =
        (this.postFreqBuf[i - 4] +
          this.postFreqBuf[i - 3] +
          this.postFreqBuf[i + 3] +
          this.postFreqBuf[i + 4]) /
        4;
      const prom = val - neighborAvg;
      if (prom > maxProminence && val > -45) {
        maxProminence = prom;
        maxPromBin = i;
      }
    }

    if (maxProminence > 11 && maxPromBin > 0) {
      if (Math.abs(maxPromBin - this.persistentPeakBin) <= 2) {
        this.persistentPeakFrames++;
      } else {
        this.persistentPeakBin = maxPromBin;
        this.persistentPeakFrames = 1;
      }
    } else {
      this.persistentPeakFrames = Math.max(0, this.persistentPeakFrames - 1);
    }

    const persistenceSec = Number((this.persistentPeakFrames * 0.05).toFixed(1));
    const feedbackDetected = this.persistentPeakFrames >= 12 && maxProminence > 11;

    // 50Hz / 60Hz Mains Hum detector on post-DSP spectrum
    const getBinDb = (hz: number) => {
      const idx = Math.round(hz / binHz);
      return Math.max(
        this.postFreqBuf[Math.max(0, idx - 1)] ?? -96,
        this.postFreqBuf[idx] ?? -96,
        this.postFreqBuf[idx + 1] ?? -96
      );
    };

    const db50 = getBinDb(50);
    const db60 = getBinDb(60);
    const db100 = getBinDb(100);
    const db120 = getBinDb(120);
    const db150 = getBinDb(150);
    const db75Floor = (getBinDb(72) + getBinDb(85)) / 2;
    const hum50 = db50 > -46 && db100 > -52 && db50 - db75Floor > 6;
    const hum60 = db60 > -46 && db120 > -52 && db60 - db75Floor > 6;
    const humDetected = hum50 || hum60;

    // Low-mid mud buildup detector (180-260 Hz vs 500-900 Hz)
    const mudEnergy = (getBinDb(200) + getBinDb(220) + getBinDb(245)) / 3;
    const midRef = (getBinDb(550) + getBinDb(750)) / 2;
    const mudDetected = mudEnergy - midRef > 8 && mudEnergy > -42;

    const compGr =
      this.compNode && !this.lastDsp?.bypassed && this.lastDsp?.compressor.enabled
        ? Math.abs(this.compNode.reduction)
        : 0;
    const limGr =
      this.limiterNode && !this.lastDsp?.bypassed && this.lastDsp?.limiter.enabled
        ? Math.abs(this.limiterNode.reduction)
        : 0;
    const grDb = Number(Math.max(compGr, limGr).toFixed(1));

    // Estimate real broadband quiescent noise floor from quiet speech-band FFT bins
    let quietBinSum = 0;
    let quietBinCount = 0;
    const floorStart = Math.floor(800 / binHz);
    const floorEnd = Math.min(this.preFreqBuf.length - 1, Math.floor(6000 / binHz));
    for (let i = floorStart; i <= floorEnd; i += 4) {
      quietBinSum += Math.max(-96, Math.min(-24, this.preFreqBuf[i]));
      quietBinCount++;
    }
    const instantNoiseEst =
      quietBinCount > 0 ? Math.max(-96, Math.min(-38, quietBinSum / quietBinCount - 6)) : -96;
    if (this.noiseFloorDb <= -95) {
      this.noiseFloorDb = instantNoiseEst;
    } else {
      const floorRate = instantNoiseEst < this.noiseFloorDb ? 0.12 : 0.02;
      this.noiseFloorDb = Number(
        (this.noiseFloorDb + (instantNoiseEst - this.noiseFloorDb) * floorRate).toFixed(1)
      );
    }

    // Per-channel captured levels + real channel-strip compressor gain reduction (skip empty open slots)
    const channelLevels: ChannelSignalTelemetry[] = [];
    for (let i = 0; i < this.channelAnalysers.length; i++) {
      const chStrip = this.channelStrips[i];
      if (!chStrip?.connectedToBus) {
        channelLevels.push({
          rmsDb: -96,
          peakDb: -96,
          noiseFloorDb: -96,
          compGrDb: 0,
        });
        continue;
      }
      const analyser = this.channelAnalysers[i];
      const buf = this.channelTimeBufs[i];
      if (!analyser || !buf) continue;
      analyser.getFloatTimeDomainData(buf);
      const st = calcTimeStats(buf);
      const prevNf = this.channelNoiseFloors[i] ?? -96;
      const chNoiseEst = Math.max(-96, Math.min(-35, st.rmsDb));
      const nextNf =
        prevNf <= -95
          ? chNoiseEst
          : prevNf + (chNoiseEst - prevNf) * (chNoiseEst < prevNf ? 0.18 : 0.025);
      this.channelNoiseFloors[i] = nextNf;

      const compGrDb = Number(Math.abs(chStrip.compNode.reduction).toFixed(1));

      channelLevels.push({
        rmsDb: Number(st.rmsDb.toFixed(1)),
        peakDb: Number(st.peakDb.toFixed(1)),
        noiseFloorDb: Number(nextNf.toFixed(1)),
        compGrDb,
      });
    }

    // Surgical Digital Troubleshooter + Output Quality Gate:
    // Filter harmful frequencies (sub-rumble, mud, feedback rings) instead of shutting down the mix, then auto-normalize!
    const qGate = this.lastDsp?.qualityGate;
    const qGateEnabled = qGate?.enabled ?? true;
    const activeSurgicalFilters: string[] = [];

    if (qGateEnabled && this.lastDsp && !this.lastDsp.bypassed) {
      // 1. Sub-sonic / stage rumble check (< 55 Hz excess eating headroom)
      const subEnergy = (getBinDb(28) + getBinDb(42)) / 2;
      const rumbleExcess = subEnergy - midRef > 6 && subEnergy > -36;
      if (this.autoRumbleHpfNode) {
        this.autoRumbleHpfNode.frequency.setTargetAtTime(rumbleExcess ? 80 : 18, now, 0.06);
        if (rumbleExcess) activeSurgicalFilters.push('Sub-Rumble HPF @ 80 Hz');
      }

      // 2. Low-mid mud buildup check (180-260 Hz)
      if (this.autoMudCutNode) {
        this.autoMudCutNode.gain.setTargetAtTime(mudDetected ? -5.5 : 0, now, mudDetected ? 0.05 : 0.25);
        if (mudDetected) activeSurgicalFilters.push('Mud Cut @ 220 Hz (-5.5 dB)');
      }

      // 3. Surgical Q=18 feedback/ringing frequency notch (4 slots)
      if (this.persistentPeakFrames >= 4 && maxProminence > 9.5 && maxPromBin > 0) {
        const ringHz = Math.round(maxPromBin * binHz);
        const existingIdx = this.surgicalNotchMeta.findIndex(
          (m) => m.freqHz > 0 && Math.abs(m.freqHz - ringHz) <= Math.max(35, ringHz * 0.04)
        );
        if (existingIdx >= 0) {
          this.surgicalNotchMeta[existingIdx].cutDb = Math.max(-14, this.surgicalNotchMeta[existingIdx].cutDb - 1.5);
          this.surgicalNotchMeta[existingIdx].holdFrames = 240; // Hold 12s
        } else {
          const emptyIdx = this.surgicalNotchMeta.findIndex((m) => m.holdFrames <= 0);
          const slot = emptyIdx >= 0 ? emptyIdx : 0;
          this.surgicalNotchMeta[slot] = { freqHz: ringHz, cutDb: -9.0, holdFrames: 240 };
        }
      }

      this.surgicalNotchNodes.forEach((node, idx) => {
        const meta = this.surgicalNotchMeta[idx];
        if (!meta) return;
        if (meta.holdFrames > 0 && meta.freqHz >= 200) {
          meta.holdFrames--;
          node.frequency.setTargetAtTime(Math.min(sampleRate * 0.45, meta.freqHz), now, 0.015);
          node.gain.setTargetAtTime(meta.cutDb, now, 0.02);
          activeSurgicalFilters.push(`Notch ${meta.freqHz} Hz (${meta.cutDb.toFixed(0)} dB)`);
        } else {
          meta.freqHz = 0;
          meta.cutDb = 0;
          node.gain.setTargetAtTime(0, now, 0.15);
        }
      });
    } else {
      this.autoRumbleHpfNode?.frequency.setTargetAtTime(18, now, 0.08);
      this.autoMudCutNode?.gain.setTargetAtTime(0, now, 0.08);
      this.surgicalNotchNodes.forEach((n) => n.gain.setTargetAtTime(0, now, 0.08));
    }

    let qualityScore = 100;
    let qualityReason: string | null = null;
    let qualityGateEngaged = false;

    if (postStats.peakDb > -0.3) {
      qualityScore -= 25;
      qualityReason = 'Peak > -0.3 dBFS (Safety Limiter + Normalize active)';
    }
    if (feedbackDetected) {
      qualityScore -= 25;
      qualityReason = `Auto-Filtering Ring @ ${Math.round(maxPromBin * binHz)} Hz`;
    }
    if (humDetected) {
      qualityScore -= 15;
      if (!qualityReason) qualityReason = `AC Hum @ ${hum50 ? 50 : 60} Hz`;
    }
    if (mudDetected) {
      qualityScore -= 10;
    }
    if (this.lastDsp?.bypassed) {
      qualityScore -= 25;
      if (!qualityReason) qualityReason = 'DSP Bypassed (Unprotected)';
    }
    qualityScore = Math.max(0, Math.min(100, qualityScore));

    if (this.masterOutputGainNode && this.lastDsp) {
      const baseMasterDb = this.lastDsp.bypassed ? 0 : (this.lastDsp.masterOutputGainDb ?? 0);
      if (qGateEnabled && !this.lastDsp.bypassed && postStats.peakDb > -0.15) {
        qualityGateEngaged = true;
        // Gentle -3 dB headroom trim only if residual spike persists after surgical filtering
        this.masterOutputGainNode.gain.setTargetAtTime(
          dbToLinear(Math.max(-36, baseMasterDb - 3)),
          now,
          0.03
        );
      } else {
        this.masterOutputGainNode.gain.setTargetAtTime(
          dbToLinear(Math.max(-36, Math.min(6, baseMasterDb))),
          now,
          0.08
        );
      }
    }

    return {
      telemetry: {
        source: this.sourceMode,
        isRunning: true,
        sampleRate,
        activeInputLabel: this.activeInputLabel,
        capturedChannels: this.capturedChannels,
        preRmsDb: Number(preStats.rmsDb.toFixed(1)),
        postRmsDb: Number(postStats.rmsDb.toFixed(1)),
        postLRmsDb: Number(postLStats.rmsDb.toFixed(1)),
        postRRmsDb: Number(postRStats.rmsDb.toFixed(1)),
        prePeakDb: Number(preStats.peakDb.toFixed(1)),
        postPeakDb: Number(postStats.peakDb.toFixed(1)),
        postLPeakDb: Number(postLStats.peakDb.toFixed(1)),
        postRPeakDb: Number(postRStats.peakDb.toFixed(1)),
        estimatedLufs: Number(Math.max(-70, postStats.rmsDb - 0.6).toFixed(1)),
        gainReductionDb: grDb,
        agcGainDb: Number(this.currentAgcGainDb.toFixed(1)),
        qualityScorePct: qualityScore,
        qualityGateEngaged,
        qualityGateReason: qualityReason,
        activeSurgicalFilters,
        noiseFloorDb: this.noiseFloorDb,
        channelLevels,
        feedbackRisk: {
          detected: feedbackDetected,
          frequencyHz: maxPromBin > 0 ? Math.round(maxPromBin * binHz) : null,
          prominenceDb: Number(maxProminence.toFixed(1)),
          persistenceSec,
          confidence: feedbackDetected ? Math.min(97, Math.round(68 + maxProminence * 1.4)) : 0,
        },
        humRisk: {
          detected: humDetected,
          fundamentalHz: hum50 ? 50 : hum60 ? 60 : null,
          harmonic100Db: Number((hum60 ? db120 : db100).toFixed(1)),
          harmonic150Db: Number(db150.toFixed(1)),
          confidence: humDetected ? 91 : 0,
        },
        mudRisk: {
          detected: mudDetected,
          bandEnergyDb: Number(mudEnergy.toFixed(1)),
          centerHz: 220,
        },
        clippingEvents: this.clippingCount,
      },
      spectrum: {
        frequencies: freqs,
        preDb: options?.includeSpectrum ? new Float32Array(this.preFreqBuf) : this.preFreqBuf,
        postDb: options?.includeSpectrum ? new Float32Array(this.postFreqBuf) : this.postFreqBuf,
      },
    };
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
