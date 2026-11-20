import type { AudioSourceSimulation, DspConfig, SignalTelemetry } from '../types/audio.ts';

export interface SpectrumSnapshot {
  frequencies: Float32Array;
  preDb: Float32Array;
  postDb: Float32Array;
}

/**
 * Real-time Web Audio API DSP + FFT Signal Analysis Engine.
 * Supports both hardware USB/microphone capture (getUserMedia) and deterministic
 * church acoustic/electrical fault simulations so operators can measure, process,
 * A/B bypass, and verify actual sound improvements.
 */
class LiveAudioEngine {
  private ctx: AudioContext | null = null;
  private sourceMode: AudioSourceSimulation = 'preacher-mud';
  private isRunning = false;
  private monitorAudible = false;

  // Source nodes
  private sourceNodes: AudioNode[] = [];
  private simTimer: number | null = null;
  private micStream: MediaStream | null = null;

  // DSP Chain nodes
  private inputGain: GainNode | null = null;
  private hpfNode: BiquadFilterNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private lpfNode: BiquadFilterNode | null = null;
  private compNode: DynamicsCompressorNode | null = null;
  private makeupGain: GainNode | null = null;
  private limiterNode: DynamicsCompressorNode | null = null;
  private delayNode: DelayNode | null = null;
  private monitorGain: GainNode | null = null;

  // Analysers (Pre-DSP vs Post-DSP)
  private preAnalyser: AnalyserNode | null = null;
  private postAnalyser: AnalyserNode | null = null;
  private preFreqBuf = new Float32Array(2048);
  private postFreqBuf = new Float32Array(2048);
  private preTimeBuf = new Float32Array(2048);
  private postTimeBuf = new Float32Array(2048);

  // Temporal persistence tracker for deterministic feedback detection
  private persistentPeakBin = -1;
  private persistentPeakFrames = 0;
  private clippingCount = 0;
  private emergencyMuted = false;
  private lastDsp: DspConfig | null = null;

  public async start(source: AudioSourceSimulation, dsp: DspConfig): Promise<void> {
    this.sourceMode = source;
    this.lastDsp = dsp;

    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });
      this.buildDspGraph();
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.teardownSource();
    await this.setupSource(source);
    this.applyDsp(dsp);
    this.isRunning = true;
  }

  public stop(): void {
    this.teardownSource();
    this.isRunning = false;
  }

  public setMonitorAudible(audible: boolean): void {
    this.monitorAudible = audible;
    if (this.monitorGain && this.ctx) {
      const target = audible && !this.emergencyMuted ? 0.35 : 0;
      this.monitorGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }
  }

  public setEmergencyMute(muted: boolean): void {
    this.emergencyMuted = muted;
    if (this.monitorGain && this.ctx) {
      const target = !muted && this.monitorAudible ? 0.35 : 0;
      this.monitorGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
    }
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public getSampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  public sampleFastLevels(): {
    isRunning: boolean;
    preRmsDb: number;
    postRmsDb: number;
    postPeakDb: number;
  } {
    if (!this.isRunning || !this.preAnalyser || !this.postAnalyser) {
      return { isRunning: false, preRmsDb: -96, postRmsDb: -96, postPeakDb: -96 };
    }
    this.preAnalyser.getFloatTimeDomainData(this.preTimeBuf);
    this.postAnalyser.getFloatTimeDomainData(this.postTimeBuf);

    let preSum = 0;
    for (let i = 0; i < this.preTimeBuf.length; i += 2) {
      const v = this.preTimeBuf[i];
      preSum += v * v;
    }
    let postSum = 0;
    let postPeak = 0;
    for (let i = 0; i < this.postTimeBuf.length; i += 2) {
      const v = Math.abs(this.postTimeBuf[i]);
      postSum += v * v;
      if (v > postPeak) postPeak = v;
    }

    const count = Math.ceil(this.preTimeBuf.length / 2);
    const preRmsDb = 20 * Math.log10(Math.max(1e-5, Math.sqrt(preSum / count)));
    const postRmsDb = 20 * Math.log10(Math.max(1e-5, Math.sqrt(postSum / count)));
    const postPeakDb = 20 * Math.log10(Math.max(1e-5, postPeak));
    return { isRunning: true, preRmsDb, postRmsDb, postPeakDb };
  }

  private buildDspGraph(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    this.inputGain = ctx.createGain();
    this.preAnalyser = ctx.createAnalyser();
    this.preAnalyser.fftSize = 4096;
    this.preAnalyser.smoothingTimeConstant = 0.72;

    this.hpfNode = ctx.createBiquadFilter();
    this.hpfNode.type = 'highpass';
    this.hpfNode.Q.value = 0.707;

    this.eqNodes = Array.from({ length: 6 }, () => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking';
      return b;
    });

    this.lpfNode = ctx.createBiquadFilter();
    this.lpfNode.type = 'lowpass';
    this.lpfNode.Q.value = 0.707;

    this.compNode = ctx.createDynamicsCompressor();
    this.makeupGain = ctx.createGain();
    this.limiterNode = ctx.createDynamicsCompressor();
    this.limiterNode.knee.value = 0;
    this.limiterNode.ratio.value = 20;
    this.limiterNode.attack.value = 0.001;

    this.delayNode = ctx.createDelay(0.5);

    this.postAnalyser = ctx.createAnalyser();
    this.postAnalyser.fftSize = 4096;
    this.postAnalyser.smoothingTimeConstant = 0.72;

    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 0;

    // Connect graph
    this.inputGain.connect(this.preAnalyser);
    this.preAnalyser.connect(this.hpfNode);

    let prev: AudioNode = this.hpfNode;
    for (const eq of this.eqNodes) {
      prev.connect(eq);
      prev = eq;
    }
    prev.connect(this.lpfNode);
    this.lpfNode.connect(this.compNode);
    this.compNode.connect(this.makeupGain);
    this.makeupGain.connect(this.limiterNode);
    this.limiterNode.connect(this.delayNode);
    this.delayNode.connect(this.postAnalyser);
    this.postAnalyser.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);

    const binCount = this.preAnalyser.frequencyBinCount;
    this.preFreqBuf = new Float32Array(binCount);
    this.postFreqBuf = new Float32Array(binCount);
    this.preTimeBuf = new Float32Array(binCount);
    this.postTimeBuf = new Float32Array(binCount);
  }

  public applyDsp(dsp: DspConfig): void {
    this.lastDsp = dsp;
    if (!this.ctx || !this.inputGain || !this.hpfNode || !this.lpfNode || !this.compNode || !this.makeupGain || !this.limiterNode || !this.delayNode) {
      return;
    }
    const now = this.ctx.currentTime;
    const nyquist = this.ctx.sampleRate * 0.48;

    const polaritySign = dsp.polarityInverted ? -1 : 1;
    const trimLinear = dsp.bypassed ? 1 : Math.pow(10, dsp.inputTrimDb / 20) * polaritySign;
    this.inputGain.gain.setTargetAtTime(trimLinear, now, 0.015);

    if (dsp.bypassed) {
      // Bypass all DSP filters smoothly
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
      return;
    }

    this.hpfNode.frequency.setTargetAtTime(dsp.hpfEnabled ? Math.max(20, dsp.hpfHz) : 10, now, 0.015);
    this.lpfNode.frequency.setTargetAtTime(dsp.lpfEnabled ? Math.min(nyquist, dsp.lpfHz) : nyquist, now, 0.015);

    dsp.eqBands.slice(0, 6).forEach((band, idx) => {
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
      this.makeupGain.gain.setTargetAtTime(Math.pow(10, dsp.compressor.makeupDb / 20), now, 0.02);
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

    this.delayNode.delayTime.setTargetAtTime(Math.max(0, Math.min(0.45, dsp.masterDelayMs / 1000)), now, 0.01);
  }

  private teardownSource(): void {
    if (this.simTimer !== null) {
      window.clearInterval(this.simTimer);
      this.simTimer = null;
    }
    for (const node of this.sourceNodes) {
      try {
        node.disconnect();
        if ('stop' in node && typeof (node as OscillatorNode).stop === 'function') {
          (node as OscillatorNode).stop();
        }
      } catch {
        // ignore stopped nodes
      }
    }
    this.sourceNodes = [];
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.persistentPeakBin = -1;
    this.persistentPeakFrames = 0;
  }

  private async setupSource(mode: AudioSourceSimulation): Promise<void> {
    if (!this.ctx || !this.inputGain) return;
    const ctx = this.ctx;

    if (mode === 'live-mic') {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.micStream = stream;
      const micNode = ctx.createMediaStreamSource(stream);
      micNode.connect(this.inputGain);
      this.sourceNodes.push(micNode);
      return;
    }

    // Create pink/white noise buffer shared by realistic acoustic simulations
    const noiseLen = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const out = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < noiseLen; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.06;
      b6 = white * 0.115926;
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;

    const sumBus = ctx.createGain();
    sumBus.gain.value = 0.7;
    sumBus.connect(this.inputGain);
    this.sourceNodes.push(noiseSrc, sumBus);

    if (mode === 'pink-noise') {
      const g = ctx.createGain();
      g.gain.value = 0.85;
      noiseSrc.connect(g);
      g.connect(sumBus);
      noiseSrc.start();
      this.sourceNodes.push(g);
      return;
    }

    if (mode === 'preacher-mud' || mode === 'preacher-feedback') {
      // Speech synthesis via vocal formant pulse + consonant noise + 220Hz mud & 63Hz room mode
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 128;

      const mudBump = ctx.createBiquadFilter();
      mudBump.type = 'peaking';
      mudBump.frequency.value = 220;
      mudBump.Q.value = 1.8;
      mudBump.gain.value = 9.5; // noticeable 220Hz buildup

      const roomMode = ctx.createBiquadFilter();
      roomMode.type = 'peaking';
      roomMode.frequency.value = 68;
      roomMode.Q.value = 3.0;
      roomMode.gain.value = 7.5;

      const speechEnv = ctx.createGain();
      speechEnv.gain.value = 0.3;

      const noiseGateGain = ctx.createGain();
      noiseGateGain.gain.value = 0.08;

      osc.connect(mudBump);
      mudBump.connect(roomMode);
      roomMode.connect(speechEnv);
      speechEnv.connect(sumBus);

      noiseSrc.connect(noiseGateGain);
      noiseGateGain.connect(sumBus);

      osc.start();
      noiseSrc.start();
      this.sourceNodes.push(osc, mudBump, roomMode, speechEnv, noiseGateGain);

      if (mode === 'preacher-feedback') {
        const ringOsc = ctx.createOscillator();
        ringOsc.type = 'sine';
        ringOsc.frequency.value = 2420;
        const ringGain = ctx.createGain();
        ringGain.gain.value = 0.16;
        ringOsc.connect(ringGain);
        ringGain.connect(sumBus);
        ringOsc.start();
        this.sourceNodes.push(ringOsc, ringGain);
      }

      // Speech cadence modulation
      let step = 0;
      this.simTimer = window.setInterval(() => {
        if (!this.ctx) return;
        step++;
        const syllable = step % 5 !== 0;
        const t = this.ctx.currentTime;
        osc.frequency.setTargetAtTime(syllable ? 118 + (step % 4) * 14 : 98, t, 0.04);
        speechEnv.gain.setTargetAtTime(syllable ? 0.34 : 0.04, t, 0.03);
      }, 210);
      return;
    }

    if (mode === 'bass-hum') {
      // Bass guitar fundamental + 50Hz/100Hz/150Hz electrical mains hum harmonics
      const bassOsc = ctx.createOscillator();
      bassOsc.type = 'triangle';
      bassOsc.frequency.value = 55; // A1 note
      const bassGain = ctx.createGain();
      bassGain.gain.value = 0.35;

      const hum50 = ctx.createOscillator();
      hum50.type = 'sine';
      hum50.frequency.value = 50;
      const hum50Gain = ctx.createGain();
      hum50Gain.gain.value = 0.14;

      const hum100 = ctx.createOscillator();
      hum100.type = 'sine';
      hum100.frequency.value = 100;
      const hum100Gain = ctx.createGain();
      hum100Gain.gain.value = 0.10;

      const hum150 = ctx.createOscillator();
      hum150.type = 'sine';
      hum150.frequency.value = 150;
      const hum150Gain = ctx.createGain();
      hum150Gain.gain.value = 0.05;

      bassOsc.connect(bassGain);
      bassGain.connect(sumBus);
      hum50.connect(hum50Gain);
      hum50Gain.connect(sumBus);
      hum100.connect(hum100Gain);
      hum100Gain.connect(sumBus);
      hum150.connect(hum150Gain);
      hum150Gain.connect(sumBus);

      const nG = ctx.createGain();
      nG.gain.value = 0.05;
      noiseSrc.connect(nG);
      nG.connect(sumBus);

      bassOsc.start();
      hum50.start();
      hum100.start();
      hum150.start();
      noiseSrc.start();
      this.sourceNodes.push(
        bassOsc,
        bassGain,
        hum50,
        hum50Gain,
        hum100,
        hum100Gain,
        hum150,
        hum150Gain,
        nG
      );

      const notes = [55, 65.41, 73.42, 82.41];
      let idx = 0;
      this.simTimer = window.setInterval(() => {
        if (!this.ctx) return;
        idx = (idx + 1) % notes.length;
        const t = this.ctx.currentTime;
        bassOsc.frequency.setTargetAtTime(notes[idx], t, 0.02);
        bassGain.gain.setTargetAtTime(idx % 2 === 0 ? 0.38 : 0.18, t, 0.04);
      }, 480);
      return;
    }

    // Worship Band or Choir Rehearsal rich harmonic pad
    const chord = mode === 'worship-band' ? [65.41, 130.81, 196.0, 261.63, 329.63, 392.0] : [220, 277.18, 329.63, 440, 659.25];
    chord.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 && mode === 'worship-band' ? 'triangle' : 'sawtooth';
      osc.frequency.value = f;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = mode === 'worship-band' ? 2400 : 3200;
      const g = ctx.createGain();
      g.gain.value = 0.075;
      osc.connect(filt);
      filt.connect(g);
      g.connect(sumBus);
      osc.start();
      this.sourceNodes.push(osc, filt, g);
    });

    const nG = ctx.createGain();
    nG.gain.value = 0.14;
    noiseSrc.connect(nG);
    nG.connect(sumBus);
    noiseSrc.start();
    this.sourceNodes.push(nG);
  }

  public sampleTelemetry(): { telemetry: SignalTelemetry; spectrum: SpectrumSnapshot } {
    const sampleRate = this.getSampleRate();

    if (!this.preAnalyser || !this.postAnalyser || !this.isRunning) {
      const emptyBins = new Float32Array(2048).fill(-96);
      const freqs = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) freqs[i] = (i * sampleRate) / 4096;
      return {
        telemetry: {
          source: this.sourceMode,
          isRunning: false,
          sampleRate,
          preRmsDb: -96,
          postRmsDb: -96,
          prePeakDb: -96,
          postPeakDb: -96,
          estimatedLufs: -70,
          gainReductionDb: 0,
          noiseFloorDb: -80,
          feedbackRisk: { detected: false, frequencyHz: null, prominenceDb: 0, persistenceSec: 0, confidence: 0 },
          humRisk: { detected: false, fundamentalHz: null, harmonic100Db: -96, harmonic150Db: -96, confidence: 0 },
          mudRisk: { detected: false, bandEnergyDb: -96, centerHz: 220 },
          clippingEvents: this.clippingCount,
        },
        spectrum: { frequencies: freqs, preDb: emptyBins, postDb: emptyBins },
      };
    }

    this.preAnalyser.getFloatFrequencyData(this.preFreqBuf);
    this.postAnalyser.getFloatFrequencyData(this.postFreqBuf);
    this.preAnalyser.getFloatTimeDomainData(this.preTimeBuf);
    this.postAnalyser.getFloatTimeDomainData(this.postTimeBuf);

    const calcTimeStats = (buf: Float32Array) => {
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        sumSq += v * v;
        if (v > peak) peak = v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      const rmsDb = 20 * Math.log10(Math.max(1e-5, rms));
      const peakDb = 20 * Math.log10(Math.max(1e-5, peak));
      return { rmsDb, peakDb };
    };

    const preStats = calcTimeStats(this.preTimeBuf);
    const postStats = calcTimeStats(this.postTimeBuf);
    if (postStats.peakDb > -0.2) this.clippingCount++;

    const binHz = sampleRate / 4096;
    const freqs = new Float32Array(this.preFreqBuf.length);
    for (let i = 0; i < freqs.length; i++) freqs[i] = i * binHz;

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
    const db100 = getBinDb(100);
    const db150 = getBinDb(150);
    const db70Floor = (getBinDb(68) + getBinDb(85)) / 2;
    const humDetected = db50 > -46 && db100 > -52 && db50 - db70Floor > 6;

    // Low-mid mud buildup detector (180-260 Hz vs 500-900 Hz)
    const mudEnergy = (getBinDb(200) + getBinDb(220) + getBinDb(245)) / 3;
    const midRef = (getBinDb(550) + getBinDb(750)) / 2;
    const mudDetected = mudEnergy - midRef > 8 && mudEnergy > -42;

    const grDb = this.compNode ? Number(Math.abs(this.compNode.reduction).toFixed(1)) : 0;

    return {
      telemetry: {
        source: this.sourceMode,
        isRunning: true,
        sampleRate,
        preRmsDb: Number(preStats.rmsDb.toFixed(1)),
        postRmsDb: Number(postStats.rmsDb.toFixed(1)),
        prePeakDb: Number(preStats.peakDb.toFixed(1)),
        postPeakDb: Number(postStats.peakDb.toFixed(1)),
        estimatedLufs: Number((postStats.rmsDb - 0.6).toFixed(1)),
        gainReductionDb: grDb,
        noiseFloorDb: Number(Math.min(-45, getBinDb(3500) - 18).toFixed(1)),
        feedbackRisk: {
          detected: feedbackDetected,
          frequencyHz: maxPromBin > 0 ? Math.round(maxPromBin * binHz) : null,
          prominenceDb: Number(maxProminence.toFixed(1)),
          persistenceSec,
          confidence: feedbackDetected ? Math.min(97, Math.round(68 + maxProminence * 1.4)) : 12,
        },
        humRisk: {
          detected: humDetected,
          fundamentalHz: humDetected ? 50 : null,
          harmonic100Db: Number(db100.toFixed(1)),
          harmonic150Db: Number(db150.toFixed(1)),
          confidence: humDetected ? 91 : 8,
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
        preDb: new Float32Array(this.preFreqBuf),
        postDb: new Float32Array(this.postFreqBuf),
      },
    };
  }
}

export const liveAudioEngine = new LiveAudioEngine();
