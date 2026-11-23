import type { AudioSourceSimulation, InputChannel } from '../types/audio.ts';
import { BUTTERWORTH_Q_DB, calcTimeStats, clamp, dbToLinear } from './audioUtils.ts';

export interface ChannelStripNodes {
  index: number;
  preampGain: GainNode;
  hpfNode: BiquadFilterNode;
  eqLowNode: BiquadFilterNode;
  eqMidNode: BiquadFilterNode;
  eqHighNode: BiquadFilterNode;
  compNode: DynamicsCompressorNode;
  pannerNode: StereoPannerNode;
  faderGain: GainNode;
  analyser: AnalyserNode;
  timeBuf: Float32Array<ArrayBuffer>;
  noiseFloorDb: number;
  connectedToBus: boolean;
}

export interface ChannelStripMetersSnapshot {
  rmsDb: number;
  peakDb: number;
  noiseFloorDb: number;
  compGrDb: number;
}

/**
 * Manages the per-channel console strip DSP bank:
 *   InputSource ─▶ preampGain ─▶ hpf ─▶ eqLow ─▶ eqMid ─▶ eqHigh ─▶ comp ─▶ panner ─▶ faderGain ─▶ busMixSum
 *                       │
 *                       └──▶ analyser (pre-fader meter tap when strip is active)
 */
export class ChannelStripBank {
  private strips: ChannelStripNodes[] = [];
  private ctx: BaseAudioContext | null = null;
  private busMixSum: GainNode | null = null;

  public attachContext(ctx: BaseAudioContext, busMixSum: GainNode): void {
    this.ctx = ctx;
    this.busMixSum = busMixSum;
  }

  public getStripCount(): number {
    return this.strips.length;
  }

  public getStrip(index: number): ChannelStripNodes | undefined {
    return this.strips[index];
  }

  public getStrips(): readonly ChannelStripNodes[] {
    return this.strips;
  }

  public ensureStrips(requiredCount: number): void {
    if (!this.ctx || !this.busMixSum) return;
    const targetCount = Math.max(8, requiredCount);
    const ctx = this.ctx;

    while (this.strips.length < targetCount) {
      const idx = this.strips.length;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.68;

      const preampGain = ctx.createGain();
      preampGain.channelCount = 2;
      preampGain.channelCountMode = 'explicit';
      preampGain.channelInterpretation = 'speakers';

      const hpfNode = ctx.createBiquadFilter();
      hpfNode.type = 'highpass';
      hpfNode.Q.value = BUTTERWORTH_Q_DB;
      hpfNode.frequency.value = 20;

      const eqLowNode = ctx.createBiquadFilter();
      eqLowNode.type = 'lowshelf';
      eqLowNode.frequency.value = 110;
      eqLowNode.gain.value = 0;

      const eqMidNode = ctx.createBiquadFilter();
      eqMidNode.type = 'peaking';
      eqMidNode.frequency.value = 400;
      eqMidNode.Q.value = 1.4;
      eqMidNode.gain.value = 0;

      const eqHighNode = ctx.createBiquadFilter();
      eqHighNode.type = 'highshelf';
      eqHighNode.frequency.value = 8000;
      eqHighNode.gain.value = 0;

      const compNode = ctx.createDynamicsCompressor();
      compNode.knee.value = 6;
      compNode.attack.value = 0.008;
      compNode.release.value = 0.14;

      const pannerNode = ctx.createStereoPanner();
      pannerNode.channelCount = 2;
      pannerNode.channelCountMode = 'explicit';
      pannerNode.channelInterpretation = 'speakers';

      const faderGain = ctx.createGain();
      faderGain.channelCount = 2;
      faderGain.channelCountMode = 'explicit';
      faderGain.channelInterpretation = 'speakers';

      // Complete contiguous strip signal chain
      preampGain.connect(hpfNode);
      hpfNode.connect(eqLowNode);
      eqLowNode.connect(eqMidNode);
      eqMidNode.connect(eqHighNode);
      eqHighNode.connect(compNode);
      compNode.connect(pannerNode);
      pannerNode.connect(faderGain);

      this.strips.push({
        index: idx,
        preampGain,
        hpfNode,
        eqLowNode,
        eqMidNode,
        eqHighNode,
        compNode,
        pannerNode,
        faderGain,
        analyser,
        timeBuf: new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>,
        noiseFloorDb: -96,
        connectedToBus: false,
      });
    }
  }

  public setStripActiveConnection(stripIndex: number, active: boolean): void {
    const strip = this.strips[stripIndex];
    if (!strip || !this.busMixSum || strip.connectedToBus === active) return;

    if (active) {
      strip.preampGain.connect(strip.analyser);
      strip.faderGain.connect(this.busMixSum);
    } else {
      try {
        strip.preampGain.disconnect(strip.analyser);
      } catch {
        // ignore if already disconnected
      }
      try {
        strip.faderGain.disconnect(this.busMixSum);
      } catch {
        // ignore if already disconnected
      }
      strip.timeBuf.fill(0);
      strip.noiseFloorDb = -96;
    }
    strip.connectedToBus = active;
  }

  public applyChannels(channels: InputChannel[], sourceMode: AudioSourceSimulation): void {
    if (!this.ctx || this.strips.length === 0) return;
    const now = this.ctx.currentTime;
    const nyquist = this.ctx.sampleRate * 0.48;
    const anySolo = channels.some((c) => c.solo);

    for (let i = 0; i < this.strips.length; i++) {
      const strip = this.strips[i];
      const ch = channels[i];
      if (!strip || !ch) continue;

      const sign = ch.polarityInverted ? -1 : 1;
      const isDesktopBridgeStrip = sourceMode === 'desktop-audio' && i === 0;
      const isPinkBridgeStrip = sourceMode === 'pink-noise' && i === 0;
      const isBridgeStrip = isDesktopBridgeStrip || isPinkBridgeStrip;

      // In desktop-audio & calibration pink-noise bridge modes, CH1 defaults to unity 0 dB gain
      // (only applying PAD if requested) so streams/test tones maintain true reference level.
      const preampDb = isBridgeStrip
        ? (ch.padDb ? -20 : 0)
        : (ch.gainDb - 24) + (ch.padDb ? -20 : 0);
      strip.preampGain.gain.setTargetAtTime(dbToLinear(preampDb) * sign, now, 0.015);

      strip.hpfNode.frequency.setTargetAtTime(
        clamp(ch.hpfHz || 20, 20, nyquist),
        now,
        0.015
      );
      strip.eqLowNode.gain.setTargetAtTime(ch.eqLowDb || 0, now, 0.015);
      strip.eqMidNode.frequency.setTargetAtTime(
        clamp(ch.eqMidFreqHz || 400, 80, nyquist),
        now,
        0.015
      );
      strip.eqMidNode.gain.setTargetAtTime(ch.eqMidDb || 0, now, 0.015);
      strip.eqHighNode.gain.setTargetAtTime(ch.eqHighDb || 0, now, 0.015);

      strip.compNode.threshold.setTargetAtTime(
        clamp(ch.compThresholdDb ?? -18, -60, 0),
        now,
        0.02
      );
      strip.compNode.ratio.setTargetAtTime(
        clamp(ch.compRatio || 3, 1, 20),
        now,
        0.02
      );

      strip.pannerNode.pan.setTargetAtTime(clamp((ch.pan || 0) / 100, -1, 1), now, 0.015);

      const isSuppressed =
        ch.mute ||
        (anySolo && !ch.solo) ||
        ch.faderDb <= -47.5;
      const faderLinear = isSuppressed ? 0 : dbToLinear(ch.faderDb);

      strip.faderGain.gain.setTargetAtTime(faderLinear, now, 0.015);
    }
  }

  public sampleFastMeters(): {
    channelRmsDb: number[];
    channelPeakDb: number[];
    channelCompGrDb: number[];
  } {
    const channelRmsDb: number[] = [];
    const channelPeakDb: number[] = [];
    const channelCompGrDb: number[] = [];

    for (let i = 0; i < this.strips.length; i++) {
      const strip = this.strips[i];
      if (!strip.connectedToBus) {
        channelRmsDb.push(-96);
        channelPeakDb.push(-96);
        channelCompGrDb.push(0);
        continue;
      }
      strip.analyser.getFloatTimeDomainData(strip.timeBuf);
      const stats = calcTimeStats(strip.timeBuf);
      channelRmsDb.push(stats.rmsDb);
      channelPeakDb.push(stats.peakDb);
      channelCompGrDb.push(Number(Math.abs(strip.compNode.reduction).toFixed(1)));
    }

    return { channelRmsDb, channelPeakDb, channelCompGrDb };
  }

  public sampleFullTelemetry(): ChannelStripMetersSnapshot[] {
    const levels: ChannelStripMetersSnapshot[] = [];

    for (let i = 0; i < this.strips.length; i++) {
      const strip = this.strips[i];
      if (!strip.connectedToBus) {
        levels.push({ rmsDb: -96, peakDb: -96, noiseFloorDb: -96, compGrDb: 0 });
        continue;
      }
      strip.analyser.getFloatTimeDomainData(strip.timeBuf);
      const stats = calcTimeStats(strip.timeBuf);
      const prevNf = strip.noiseFloorDb;
      const est = clamp(stats.rmsDb, -96, -35);
      const nextNf =
        prevNf <= -95
          ? est
          : prevNf + (est - prevNf) * (est < prevNf ? 0.18 : 0.025);
      strip.noiseFloorDb = nextNf;

      levels.push({
        rmsDb: Number(stats.rmsDb.toFixed(1)),
        peakDb: Number(stats.peakDb.toFixed(1)),
        noiseFloorDb: Number(nextNf.toFixed(1)),
        compGrDb: Number(Math.abs(strip.compNode.reduction).toFixed(1)),
      });
    }

    return levels;
  }

  public dispose(): void {
    for (const strip of this.strips) {
      try {
        strip.preampGain.disconnect();
        strip.hpfNode.disconnect();
        strip.eqLowNode.disconnect();
        strip.eqMidNode.disconnect();
        strip.eqHighNode.disconnect();
        strip.compNode.disconnect();
        strip.pannerNode.disconnect();
        strip.faderGain.disconnect();
        strip.analyser.disconnect();
      } catch {
        // ignore cleanup errors
      }
    }
    this.strips = [];
    this.busMixSum = null;
    this.ctx = null;
  }
}
