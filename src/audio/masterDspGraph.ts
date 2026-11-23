import { ISO_31_FREQUENCIES, type DspConfig } from '../types/audio.ts';
import {
  BUTTERWORTH_Q_DB,
  clamp,
  computeWidthMatrixCoefficients,
  dbToLinear,
} from './audioUtils.ts';

export interface SignalGraphReport {
  built: boolean;
  sampleRate: number;
  stages: {
    name: string;
    active: boolean;
    channels: number;
  }[];
  eq31Spliced: boolean;
  crossoverSpliced: boolean;
  widthMatrixFourLegsWired: boolean;
}

/**
 * Stereo Master DSP Signal Graph:
 *   busMixSum ─▶ inputGain ─▶ preAnalyser
 *     ─▶ subSonicHpf ─▶ humNotchBank (50/60Hz x3) ─▶ agcGain ─▶ gateGain ─▶ standbyGateGain ─▶ deEsser
 *     ─▶ masterHpf ─▶ eqBands[0..7] ─▶ masterLpf
 *     ─▶ autoRumbleHpf ─▶ autoMudCut ─▶ surgicalNotches[0..3]
 *     ─▶ masterComp ─▶ makeupGain ─▶ masterLimiter ─▶ masterDelay
 *     ─▶ stereoWidthMatrix (L->L, L->R, R->R, R->L)
 *     ─▶ eq31Insert (direct bypass wire when flat)
 *     ─▶ lr24Crossover (full-range bypass OR 4th-order LR-24 Sub + LR-24 Mid + LR-24 High)
 *     ─▶ masterOutputGain ─▶ outputSafetyLimiter (-0.3 dBFS brickwall) ─▶ postAnalyser
 *          ├──▶ postSplitter ─▶ postLAnalyser / postRAnalyser
 *          └──▶ [output node consumed by OutputRouter]
 */
export class MasterDspGraph {
  private ctx: BaseAudioContext | null = null;
  private built = false;

  public busMixSum!: GainNode;
  public inputGain!: GainNode;
  public preAnalyser!: AnalyserNode;
  public postAnalyser!: AnalyserNode;
  public postLAnalyser!: AnalyserNode;
  public postRAnalyser!: AnalyserNode;

  // Dynamic & Troubleshooting controllable nodes
  public subSonicNode!: BiquadFilterNode;
  public humNotchFundamental!: BiquadFilterNode;
  public humNotchHarmonic1!: BiquadFilterNode;
  public humNotchHarmonic2!: BiquadFilterNode;
  public agcGainNode!: GainNode;
  public gateGainNode!: GainNode;
  public standbyGateGainNode!: GainNode;
  public deEsserNode!: BiquadFilterNode;

  public hpfNode!: BiquadFilterNode;
  public eqNodes: BiquadFilterNode[] = [];
  public lpfNode!: BiquadFilterNode;

  public autoRumbleHpfNode!: BiquadFilterNode;
  public autoMudCutNode!: BiquadFilterNode;
  public surgicalNotchNodes: BiquadFilterNode[] = [];

  public compNode!: DynamicsCompressorNode;
  public makeupGain!: GainNode;
  public limiterNode!: DynamicsCompressorNode;
  public delayNode!: DelayNode;

  // Stereo Width Matrix (all 4 matrix paths verified wired)
  private widthSplitter!: ChannelSplitterNode;
  private widthMerger!: ChannelMergerNode;
  public widthLLGain!: GainNode;
  public widthRLGain!: GainNode;
  public widthRRGain!: GainNode;
  public widthLRGain!: GainNode;

  // 31-Band Graphic EQ Insert
  private eq31InputNode!: GainNode;
  private eq31OutputNode!: GainNode;
  public eq31Nodes: BiquadFilterNode[] = [];
  private eq31ChainConnected = false;
  private humNotchConnected = false;

  // True 4th-Order Linkwitz-Riley (LR-24) 3-Way Crossover
  public xoverBypassGain!: GainNode;
  public xoverSubHpf!: BiquadFilterNode;
  public xoverSuperBassFilter!: BiquadFilterNode;
  public xoverSubLp1!: BiquadFilterNode;
  public xoverSubLp2!: BiquadFilterNode;
  public xoverSubDelay!: DelayNode;
  public xoverSubGain!: GainNode;

  public xoverMidHp1!: BiquadFilterNode;
  public xoverMidHp2!: BiquadFilterNode;
  public xoverMidLp1!: BiquadFilterNode;
  public xoverMidLp2!: BiquadFilterNode;
  public xoverMidDelay!: DelayNode;
  public xoverMidGain!: GainNode;

  public xoverHighHp1!: BiquadFilterNode;
  public xoverHighHp2!: BiquadFilterNode;
  public xoverHighDelay!: DelayNode;
  public xoverHighGain!: GainNode;
  public xoverSumNode!: GainNode;
  private xoverBranchesConnected = false;

  // Clean Dynamics splice nodes (avoid Web Audio DynamicsCompressorNode emphasis/knee coloration when bypassed/disabled)
  private dynInputNode!: GainNode;
  private dynCompWired = false;
  private dynLimiterWired = false;

  public masterOutputGainNode!: GainNode;
  public outputSafetyLimiter!: DynamicsCompressorNode;
  private postSplitter!: ChannelSplitterNode;

  private enforceStereoBus(node: AudioNode): void {
    node.channelCount = 2;
    node.channelCountMode = 'explicit';
    node.channelInterpretation = 'speakers';
  }

  public build(ctx: BaseAudioContext): void {
    this.ctx = ctx;

    this.busMixSum = ctx.createGain();
    this.busMixSum.gain.value = 1;
    this.enforceStereoBus(this.busMixSum);

    this.inputGain = ctx.createGain();
    this.inputGain.gain.value = 1;
    this.enforceStereoBus(this.inputGain);

    this.preAnalyser = ctx.createAnalyser();
    this.preAnalyser.fftSize = 4096;
    this.preAnalyser.smoothingTimeConstant = 0.72;

    this.subSonicNode = ctx.createBiquadFilter();
    this.subSonicNode.type = 'highpass';
    this.subSonicNode.frequency.value = 18;
    this.subSonicNode.Q.value = BUTTERWORTH_Q_DB;

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

    this.agcGainNode = ctx.createGain();
    this.agcGainNode.gain.value = 1;
    this.enforceStereoBus(this.agcGainNode);

    this.gateGainNode = ctx.createGain();
    this.gateGainNode.gain.value = 1;
    this.enforceStereoBus(this.gateGainNode);

    this.standbyGateGainNode = ctx.createGain();
    this.standbyGateGainNode.gain.value = 1;
    this.enforceStereoBus(this.standbyGateGainNode);

    this.deEsserNode = ctx.createBiquadFilter();
    this.deEsserNode.type = 'peaking';
    this.deEsserNode.frequency.value = 6200;
    this.deEsserNode.Q.value = 2.8;
    this.deEsserNode.gain.value = 0;

    this.hpfNode = ctx.createBiquadFilter();
    this.hpfNode.type = 'highpass';
    this.hpfNode.frequency.value = 20;
    this.hpfNode.Q.value = BUTTERWORTH_Q_DB;

    this.eqNodes = Array.from({ length: 8 }, () => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking';
      b.gain.value = 0;
      return b;
    });

    this.lpfNode = ctx.createBiquadFilter();
    this.lpfNode.type = 'lowpass';
    this.lpfNode.frequency.value = ctx.sampleRate * 0.48;
    this.lpfNode.Q.value = BUTTERWORTH_Q_DB;

    this.autoRumbleHpfNode = ctx.createBiquadFilter();
    this.autoRumbleHpfNode.type = 'highpass';
    this.autoRumbleHpfNode.frequency.value = 18;
    this.autoRumbleHpfNode.Q.value = BUTTERWORTH_Q_DB;

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

    this.dynInputNode = ctx.createGain();
    this.dynInputNode.gain.value = 1;
    this.enforceStereoBus(this.dynInputNode);

    this.compNode = ctx.createDynamicsCompressor();
    this.compNode.threshold.value = -18;
    this.compNode.ratio.value = 3.2;
    this.makeupGain = ctx.createGain();
    this.enforceStereoBus(this.makeupGain);

    this.limiterNode = ctx.createDynamicsCompressor();
    this.limiterNode.threshold.value = -1;
    this.limiterNode.knee.value = 0;
    this.limiterNode.ratio.value = 20;
    this.limiterNode.attack.value = 0.001;

    this.delayNode = ctx.createDelay(0.5);
    this.enforceStereoBus(this.delayNode);

    // Stereo Width Matrix — ALL FOUR LEGS EXPLICITLY CONNECTED
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

    // 31-Band Graphic EQ Insert
    this.eq31InputNode = ctx.createGain();
    this.eq31OutputNode = ctx.createGain();
    this.enforceStereoBus(this.eq31InputNode);
    this.enforceStereoBus(this.eq31OutputNode);
    this.eq31Nodes = ISO_31_FREQUENCIES.map((hz) => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = hz;
      f.Q.value = 4.31;
      f.gain.value = 0;
      return f;
    });

    // True LR-24 3-Way Crossover
    this.xoverBypassGain = ctx.createGain();
    this.enforceStereoBus(this.xoverBypassGain);
    this.xoverBypassGain.gain.value = 1;

    this.xoverSubHpf = ctx.createBiquadFilter();
    this.xoverSubHpf.type = 'highpass';
    this.xoverSubHpf.frequency.value = 28;
    this.xoverSubHpf.Q.value = BUTTERWORTH_Q_DB;

    this.xoverSuperBassFilter = ctx.createBiquadFilter();
    this.xoverSuperBassFilter.type = 'peaking';
    this.xoverSuperBassFilter.frequency.value = 45;
    this.xoverSuperBassFilter.Q.value = 2.0;
    this.xoverSuperBassFilter.gain.value = 0;

    this.xoverSubLp1 = ctx.createBiquadFilter();
    this.xoverSubLp1.type = 'lowpass';
    this.xoverSubLp1.frequency.value = 80;
    this.xoverSubLp1.Q.value = BUTTERWORTH_Q_DB;

    this.xoverSubLp2 = ctx.createBiquadFilter();
    this.xoverSubLp2.type = 'lowpass';
    this.xoverSubLp2.frequency.value = 80;
    this.xoverSubLp2.Q.value = BUTTERWORTH_Q_DB;

    this.xoverSubDelay = ctx.createDelay(0.05);
    this.xoverSubGain = ctx.createGain();
    this.enforceStereoBus(this.xoverSubGain);

    // Mid band LR-24 bandpass (2x HPF + 2x LPF) for 0 dB in-phase summation
    this.xoverMidHp1 = ctx.createBiquadFilter();
    this.xoverMidHp1.type = 'highpass';
    this.xoverMidHp1.frequency.value = 80;
    this.xoverMidHp1.Q.value = BUTTERWORTH_Q_DB;

    this.xoverMidHp2 = ctx.createBiquadFilter();
    this.xoverMidHp2.type = 'highpass';
    this.xoverMidHp2.frequency.value = 80;
    this.xoverMidHp2.Q.value = BUTTERWORTH_Q_DB;

    this.xoverMidLp1 = ctx.createBiquadFilter();
    this.xoverMidLp1.type = 'lowpass';
    this.xoverMidLp1.frequency.value = 2500;
    this.xoverMidLp1.Q.value = BUTTERWORTH_Q_DB;

    this.xoverMidLp2 = ctx.createBiquadFilter();
    this.xoverMidLp2.type = 'lowpass';
    this.xoverMidLp2.frequency.value = 2500;
    this.xoverMidLp2.Q.value = BUTTERWORTH_Q_DB;

    this.xoverMidDelay = ctx.createDelay(0.05);
    this.xoverMidGain = ctx.createGain();
    this.enforceStereoBus(this.xoverMidGain);

    // High band LR-24
    this.xoverHighHp1 = ctx.createBiquadFilter();
    this.xoverHighHp1.type = 'highpass';
    this.xoverHighHp1.frequency.value = 2500;
    this.xoverHighHp1.Q.value = BUTTERWORTH_Q_DB;

    this.xoverHighHp2 = ctx.createBiquadFilter();
    this.xoverHighHp2.type = 'highpass';
    this.xoverHighHp2.frequency.value = 2500;
    this.xoverHighHp2.Q.value = BUTTERWORTH_Q_DB;

    this.xoverHighDelay = ctx.createDelay(0.02);
    this.xoverHighGain = ctx.createGain();
    this.enforceStereoBus(this.xoverHighGain);

    this.xoverSumNode = ctx.createGain();
    this.xoverSumNode.gain.value = 1;
    this.enforceStereoBus(this.xoverSumNode);

    this.masterOutputGainNode = ctx.createGain();
    this.masterOutputGainNode.gain.value = 1;
    this.enforceStereoBus(this.masterOutputGainNode);

    this.outputSafetyLimiter = ctx.createDynamicsCompressor();
    this.outputSafetyLimiter.threshold.value = -0.3;
    this.outputSafetyLimiter.knee.value = 0;
    this.outputSafetyLimiter.ratio.value = 20;
    this.outputSafetyLimiter.attack.value = 0.001;
    this.outputSafetyLimiter.release.value = 0.05;

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

    // =========================================================================
    // WIRE CONTIGUOUS MASTER SIGNAL GRAPH FROM INPUT SUM TO POST ANALYSER
    // =========================================================================
    this.busMixSum.connect(this.inputGain);
    this.inputGain.connect(this.preAnalyser);

    // Hum Notch Bank Input/Output splice (direct bypass wire when 'off', 3x Q=14 notch when '50hz'/'60hz')
    this.preAnalyser.connect(this.subSonicNode);
    this.subSonicNode.connect(this.agcGainNode);
    this.humNotchFundamental.connect(this.humNotchHarmonic1);
    this.humNotchHarmonic1.connect(this.humNotchHarmonic2);
    this.humNotchConnected = false;

    this.agcGainNode.connect(this.gateGainNode);
    this.gateGainNode.connect(this.standbyGateGainNode);
    this.standbyGateGainNode.connect(this.deEsserNode);
    this.deEsserNode.connect(this.hpfNode);

    let chain: AudioNode = this.hpfNode;
    for (const eq of this.eqNodes) {
      chain.connect(eq);
      chain = eq;
    }
    chain.connect(this.lpfNode);
    this.lpfNode.connect(this.autoRumbleHpfNode);
    this.autoRumbleHpfNode.connect(this.autoMudCutNode);

    let troubleChain: AudioNode = this.autoMudCutNode;
    for (const notch of this.surgicalNotchNodes) {
      troubleChain.connect(notch);
      troubleChain = notch;
    }

    troubleChain.connect(this.dynInputNode);
    this.dynInputNode.connect(this.compNode);
    this.compNode.connect(this.makeupGain);
    this.makeupGain.connect(this.limiterNode);
    this.limiterNode.connect(this.delayNode);
    this.dynCompWired = true;
    this.dynLimiterWired = true;

    // Stereo Width Matrix — L' = same*L + cross*R ; R' = cross*L + same*R
    this.delayNode.connect(this.widthSplitter);
    this.widthSplitter.connect(this.widthLLGain, 0);
    this.widthSplitter.connect(this.widthLRGain, 0);
    this.widthSplitter.connect(this.widthRLGain, 1);
    this.widthSplitter.connect(this.widthRRGain, 1);

    this.widthLLGain.connect(this.widthMerger, 0, 0);
    this.widthRLGain.connect(this.widthMerger, 0, 0);
    this.widthLRGain.connect(this.widthMerger, 0, 1);
    this.widthRRGain.connect(this.widthMerger, 0, 1);

    // 31-Band Graphic EQ Insert (direct bypass initially)
    this.widthMerger.connect(this.eq31InputNode);
    this.eq31InputNode.connect(this.eq31OutputNode);
    this.eq31ChainConnected = false;
    for (let i = 0; i < this.eq31Nodes.length - 1; i++) {
      this.eq31Nodes[i].connect(this.eq31Nodes[i + 1]);
    }

    // 3-Way Crossover Split & Sum
    this.eq31OutputNode.connect(this.xoverBypassGain);
    this.xoverBypassGain.connect(this.xoverSumNode);

    this.xoverSubHpf.connect(this.xoverSuperBassFilter);
    this.xoverSuperBassFilter.connect(this.xoverSubLp1);
    this.xoverSubLp1.connect(this.xoverSubLp2);
    this.xoverSubLp2.connect(this.xoverSubDelay);
    this.xoverSubDelay.connect(this.xoverSubGain);
    this.xoverSubGain.connect(this.xoverSumNode);

    this.xoverMidHp1.connect(this.xoverMidHp2);
    this.xoverMidHp2.connect(this.xoverMidLp1);
    this.xoverMidLp1.connect(this.xoverMidLp2);
    this.xoverMidLp2.connect(this.xoverMidDelay);
    this.xoverMidDelay.connect(this.xoverMidGain);
    this.xoverMidGain.connect(this.xoverSumNode);

    this.xoverHighHp1.connect(this.xoverHighHp2);
    this.xoverHighHp2.connect(this.xoverHighDelay);
    this.xoverHighDelay.connect(this.xoverHighGain);
    this.xoverHighGain.connect(this.xoverSumNode);
    this.xoverBranchesConnected = false;

    this.xoverSumNode.connect(this.masterOutputGainNode);
    this.masterOutputGainNode.connect(this.outputSafetyLimiter);
    this.outputSafetyLimiter.connect(this.postAnalyser);

    // True Stereo L/R Metering Split
    this.postAnalyser.connect(this.postSplitter);
    this.postSplitter.connect(this.postLAnalyser, 0);
    this.postSplitter.connect(this.postRAnalyser, 1);

    this.built = true;
  }

  private syncEq31ChainWiring(needed: boolean): void {
    if (!this.built || this.eq31Nodes.length === 0 || needed === this.eq31ChainConnected) return;
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

  private syncHumNotchWiring(needed: boolean): void {
    if (!this.built || needed === this.humNotchConnected) return;
    if (needed) {
      try {
        this.subSonicNode.disconnect(this.agcGainNode);
      } catch {
        // ignore
      }
      this.subSonicNode.connect(this.humNotchFundamental);
      this.humNotchHarmonic2.connect(this.agcGainNode);
    } else {
      try {
        this.subSonicNode.disconnect(this.humNotchFundamental);
      } catch {
        // ignore
      }
      try {
        this.humNotchHarmonic2.disconnect(this.agcGainNode);
      } catch {
        // ignore
      }
      this.subSonicNode.connect(this.agcGainNode);
    }
    this.humNotchConnected = needed;
  }

  private syncXoverBranchesWiring(needed: boolean): void {
    if (!this.built || needed === this.xoverBranchesConnected) return;
    if (needed) {
      this.eq31OutputNode.connect(this.xoverSubHpf);
      this.eq31OutputNode.connect(this.xoverMidHp1);
      this.eq31OutputNode.connect(this.xoverHighHp1);
    } else {
      try {
        this.eq31OutputNode.disconnect(this.xoverSubHpf);
      } catch {
        // ignore
      }
      try {
        this.eq31OutputNode.disconnect(this.xoverMidHp1);
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

  private syncDynamicsWiring(useComp: boolean, useLimiter: boolean): void {
    if (!this.built) return;
    if (useComp === this.dynCompWired && useLimiter === this.dynLimiterWired) return;

    try {
      this.dynInputNode.disconnect();
    } catch {
      // ignore
    }
    try {
      this.makeupGain.disconnect();
    } catch {
      // ignore
    }
    try {
      this.limiterNode.disconnect();
    } catch {
      // ignore
    }

    if (useComp && useLimiter) {
      this.dynInputNode.connect(this.compNode);
      this.makeupGain.connect(this.limiterNode);
      this.limiterNode.connect(this.delayNode);
    } else if (useComp && !useLimiter) {
      this.dynInputNode.connect(this.compNode);
      this.makeupGain.connect(this.delayNode);
    } else if (!useComp && useLimiter) {
      this.dynInputNode.connect(this.limiterNode);
      this.limiterNode.connect(this.delayNode);
    } else {
      this.dynInputNode.connect(this.delayNode);
    }

    this.dynCompWired = useComp;
    this.dynLimiterWired = useLimiter;
  }

  public applyDsp(dsp: DspConfig): void {
    if (!this.built || !this.ctx) return;
    const now = this.ctx.currentTime;
    const nyquist = this.ctx.sampleRate * 0.48;

    const polaritySign = dsp.polarityInverted ? -1 : 1;
    const trimLinear = dsp.bypassed ? 1 : dbToLinear(dsp.inputTrimDb) * polaritySign;
    this.inputGain.gain.setTargetAtTime(trimLinear, now, 0.015);

    if (dsp.bypassed) {
      this.subSonicNode.frequency.setTargetAtTime(5, now, 0.015);
      this.syncHumNotchWiring(false);
      this.agcGainNode.gain.setTargetAtTime(1, now, 0.015);
      this.gateGainNode.gain.setTargetAtTime(1, now, 0.015);
      this.standbyGateGainNode.gain.setTargetAtTime(1, now, 0.015);
      this.deEsserNode.gain.setTargetAtTime(0, now, 0.015);

      this.hpfNode.frequency.setTargetAtTime(10, now, 0.015);
      this.lpfNode.frequency.setTargetAtTime(nyquist, now, 0.015);
      this.eqNodes.forEach((n) => n.gain.setTargetAtTime(0, now, 0.015));
      this.autoRumbleHpfNode.frequency.setTargetAtTime(10, now, 0.015);
      this.autoMudCutNode.gain.setTargetAtTime(0, now, 0.015);
      this.surgicalNotchNodes.forEach((n) => n.gain.setTargetAtTime(0, now, 0.015));

      this.syncDynamicsWiring(false, false);
      this.compNode.threshold.setTargetAtTime(0, now, 0.015);
      this.compNode.ratio.setTargetAtTime(1, now, 0.015);
      this.makeupGain.gain.setTargetAtTime(1, now, 0.015);
      this.limiterNode.threshold.setTargetAtTime(0, now, 0.015);
      this.delayNode.delayTime.setTargetAtTime(0, now, 0.015);

      this.widthLLGain.gain.setTargetAtTime(1, now, 0.015);
      this.widthRRGain.gain.setTargetAtTime(1, now, 0.015);
      this.widthRLGain.gain.setTargetAtTime(0, now, 0.015);
      this.widthLRGain.gain.setTargetAtTime(0, now, 0.015);

      this.syncEq31ChainWiring(false);
      this.syncXoverBranchesWiring(false);
      this.xoverBypassGain.gain.setTargetAtTime(1, now, 0.015);
      this.xoverSubGain.gain.setTargetAtTime(0, now, 0.015);
      this.xoverMidGain.gain.setTargetAtTime(0, now, 0.015);
      this.xoverHighGain.gain.setTargetAtTime(0, now, 0.015);
      this.masterOutputGainNode.gain.setTargetAtTime(1, now, 0.015);
      this.outputSafetyLimiter.threshold.setTargetAtTime(-0.3, now, 0.015);
      return;
    }

    // DC Blocker
    const dcActive = dsp.cleanStandby?.dcBlockerEnabled !== false;
    this.subSonicNode.frequency.setTargetAtTime(dcActive ? 18 : 5, now, 0.015);

    // 50/60 Hz Mains Hum Notch Bank (spliced cleanly only when enabled)
    const notchMode = dsp.cleanStandby?.mainsHumNotch ?? '60hz';
    if (notchMode === '50hz' || notchMode === '60hz') {
      this.syncHumNotchWiring(true);
      const baseHz = notchMode === '50hz' ? 50 : 60;
      this.humNotchFundamental.frequency.setTargetAtTime(baseHz, now, 0.015);
      this.humNotchFundamental.Q.setTargetAtTime(14, now, 0.015);
      this.humNotchHarmonic1.frequency.setTargetAtTime(baseHz * 2, now, 0.015);
      this.humNotchHarmonic1.Q.setTargetAtTime(14, now, 0.015);
      this.humNotchHarmonic2.frequency.setTargetAtTime(baseHz * 3, now, 0.015);
      this.humNotchHarmonic2.Q.setTargetAtTime(14, now, 0.015);
    } else {
      this.syncHumNotchWiring(false);
    }

    if (!dsp.gate.enabled) {
      this.gateGainNode.gain.setTargetAtTime(1, now, 0.015);
    }

    this.deEsserNode.frequency.setTargetAtTime(
      clamp(dsp.deEsser.frequencyHz, 2000, nyquist),
      now,
      0.015
    );
    if (!dsp.deEsser.enabled) {
      this.deEsserNode.gain.setTargetAtTime(0, now, 0.015);
    }

    this.hpfNode.frequency.setTargetAtTime(
      dsp.hpfEnabled ? clamp(dsp.hpfHz, 20, nyquist) : 10,
      now,
      0.015
    );
    this.lpfNode.frequency.setTargetAtTime(
      dsp.lpfEnabled ? clamp(dsp.lpfHz, 200, nyquist) : nyquist,
      now,
      0.015
    );

    dsp.eqBands.slice(0, this.eqNodes.length).forEach((band, idx) => {
      const node = this.eqNodes[idx];
      if (!node) return;
      node.type = band.type;
      node.frequency.setTargetAtTime(clamp(band.frequency, 20, nyquist), now, 0.015);
      node.Q.setTargetAtTime(clamp(band.q, 0.1, 24), now, 0.015);
      node.gain.setTargetAtTime(band.enabled ? band.gainDb : 0, now, 0.015);
    });

    this.syncDynamicsWiring(dsp.compressor.enabled, dsp.limiter.enabled);

    if (dsp.compressor.enabled) {
      this.compNode.threshold.setTargetAtTime(clamp(dsp.compressor.thresholdDb, -60, 0), now, 0.02);
      this.compNode.ratio.setTargetAtTime(clamp(dsp.compressor.ratio, 1, 20), now, 0.02);
      this.compNode.attack.setTargetAtTime(clamp(dsp.compressor.attackMs / 1000, 0.001, 0.5), now, 0.02);
      this.compNode.release.setTargetAtTime(clamp(dsp.compressor.releaseMs / 1000, 0.01, 1.0), now, 0.02);
      this.makeupGain.gain.setTargetAtTime(dbToLinear(dsp.compressor.makeupDb), now, 0.02);
    } else {
      this.compNode.threshold.setTargetAtTime(0, now, 0.02);
      this.compNode.ratio.setTargetAtTime(1, now, 0.02);
      this.makeupGain.gain.setTargetAtTime(1, now, 0.02);
    }

    if (dsp.limiter.enabled) {
      this.limiterNode.threshold.setTargetAtTime(Math.min(0, dsp.limiter.ceilingDb), now, 0.01);
      this.limiterNode.release.setTargetAtTime(clamp(dsp.limiter.releaseMs / 1000, 0.01, 0.5), now, 0.01);
    } else {
      this.limiterNode.threshold.setTargetAtTime(0, now, 0.01);
    }

    const masterDb = clamp(dsp.masterOutputGainDb ?? 0, -36, 6);
    this.masterOutputGainNode.gain.setTargetAtTime(dbToLinear(masterDb), now, 0.015);

    const safetyCeiling = dsp.limiter.enabled ? Math.min(-0.3, dsp.limiter.ceilingDb) : -0.3;
    this.outputSafetyLimiter.threshold.setTargetAtTime(safetyCeiling, now, 0.01);

    this.delayNode.delayTime.setTargetAtTime(
      clamp((dsp.masterDelayMs || 0) / 1000, 0, 0.45),
      now,
      0.01
    );

    const { same, cross } = computeWidthMatrixCoefficients(dsp.stereoWidth);
    this.widthLLGain.gain.setTargetAtTime(same, now, 0.015);
    this.widthRRGain.gain.setTargetAtTime(same, now, 0.015);
    this.widthRLGain.gain.setTargetAtTime(cross, now, 0.015);
    this.widthLRGain.gain.setTargetAtTime(cross, now, 0.015);

    // 31-Band Graphic EQ Insert
    const eq31Cfg = dsp.graphicEq31;
    const eq31Enabled = eq31Cfg?.enabled ?? true;
    const needsEq31 =
      eq31Enabled && Boolean(eq31Cfg?.bands?.some((b) => Math.abs(b.gainDb) >= 0.05));
    this.syncEq31ChainWiring(needsEq31);
    if (needsEq31) {
      this.eq31Nodes.forEach((node, idx) => {
        const gainDb = eq31Cfg?.bands?.[idx]?.gainDb ?? 0;
        node.gain.setTargetAtTime(gainDb, now, 0.015);
      });
    }

    // Active 3-Way LR-24 Crossover
    const xover = dsp.crossover;
    const xoverActive = Boolean(xover && (xover.enabled ?? true));
    this.syncXoverBranchesWiring(xoverActive);

    if (xoverActive && xover) {
      this.xoverBypassGain.gain.setTargetAtTime(0, now, 0.015);
      const subToMid = clamp(xover.subToMidHz || 80, 40, nyquist * 0.4);
      const midToHigh = clamp(xover.midToHighHz || 2500, subToMid + 200, nyquist);
      const anySolo = Boolean(xover.sub.solo || xover.mid.solo || xover.high.solo);

      const sb = xover.superBass;
      this.xoverSubHpf.frequency.setTargetAtTime(sb?.subInfrasoundHpfHz ?? 28, now, 0.015);
      if (sb?.enabled) {
        const freq = sb.mode === 'punch-808' ? 63 : sb.mode === 'subharmonic' ? 40 : 45;
        this.xoverSuperBassFilter.frequency.setTargetAtTime(freq, now, 0.015);
        this.xoverSuperBassFilter.Q.setTargetAtTime(sb.mode === 'punch-808' ? 2.5 : 1.8, now, 0.015);
        this.xoverSuperBassFilter.gain.setTargetAtTime(sb.boostDb ?? 4, now, 0.015);
      } else {
        this.xoverSuperBassFilter.gain.setTargetAtTime(0, now, 0.015);
      }

      // Sub band (LR-24)
      this.xoverSubLp1.frequency.setTargetAtTime(subToMid, now, 0.015);
      this.xoverSubLp2.frequency.setTargetAtTime(subToMid, now, 0.015);
      this.xoverSubDelay.delayTime.setTargetAtTime(clamp((xover.sub.delayMs || 0) / 1000, 0, 0.045), now, 0.015);
      const subSign = xover.sub.polarityInverted ? -1 : 1;
      const subLin = xover.sub.mute || (anySolo && !xover.sub.solo) ? 0 : dbToLinear(xover.sub.gainDb || 0) * subSign;
      this.xoverSubGain.gain.setTargetAtTime(subLin, now, 0.015);

      // Mid band (LR-24 Bandpass)
      this.xoverMidHp1.frequency.setTargetAtTime(subToMid, now, 0.015);
      this.xoverMidHp2.frequency.setTargetAtTime(subToMid, now, 0.015);
      this.xoverMidLp1.frequency.setTargetAtTime(midToHigh, now, 0.015);
      this.xoverMidLp2.frequency.setTargetAtTime(midToHigh, now, 0.015);
      this.xoverMidDelay.delayTime.setTargetAtTime(clamp((xover.mid.delayMs || 0) / 1000, 0, 0.045), now, 0.015);
      const midSign = xover.mid.polarityInverted ? -1 : 1;
      const midLin = xover.mid.mute || (anySolo && !xover.mid.solo) ? 0 : dbToLinear(xover.mid.gainDb || 0) * midSign;
      this.xoverMidGain.gain.setTargetAtTime(midLin, now, 0.015);

      // High band (LR-24)
      this.xoverHighHp1.frequency.setTargetAtTime(midToHigh, now, 0.015);
      this.xoverHighHp2.frequency.setTargetAtTime(midToHigh, now, 0.015);
      this.xoverHighDelay.delayTime.setTargetAtTime(clamp((xover.high.delayMs || 0) / 1000, 0, 0.02), now, 0.015);
      const highSign = xover.high.polarityInverted ? -1 : 1;
      const highLin = xover.high.mute || (anySolo && !xover.high.solo) ? 0 : dbToLinear(xover.high.gainDb || 0) * highSign;
      this.xoverHighGain.gain.setTargetAtTime(highLin, now, 0.015);
    } else {
      this.xoverBypassGain.gain.setTargetAtTime(1, now, 0.015);
      this.xoverSubGain.gain.setTargetAtTime(0, now, 0.015);
      this.xoverMidGain.gain.setTargetAtTime(0, now, 0.015);
      this.xoverHighGain.gain.setTargetAtTime(0, now, 0.015);
    }
  }

  public getReport(): SignalGraphReport {
    return {
      built: this.built,
      sampleRate: this.ctx?.sampleRate ?? 48000,
      stages: [
        { name: 'BusMixSum -> InputGain', active: this.built, channels: 2 },
        { name: 'PreAnalyser (4096-pt FFT)', active: this.built, channels: 2 },
        { name: 'Conditioning (SubSonic + HumNotch x3 + SmartAGC + Gate + Standby + DeEsser)', active: this.built, channels: 2 },
        { name: 'Tone & Troubleshooting (HPF + 8-Band PEQ + LPF + Rumble + Mud + 4x Surgical Notches)', active: this.built, channels: 2 },
        { name: 'Dynamics & Delay (Compressor + Makeup + Limiter + Delay)', active: this.built, channels: 2 },
        { name: 'StereoWidthMatrix (4-Leg L/R M/S Matrix)', active: this.built, channels: 2 },
        { name: '31-Band ISO Graphic EQ', active: this.eq31ChainConnected, channels: 2 },
        { name: '3-Way LR-24 Crossover', active: this.xoverBranchesConnected, channels: 2 },
        { name: 'Master Output Gain + Brickwall Safety Limiter', active: this.built, channels: 2 },
        { name: 'PostAnalyser (Stereo L/R Split)', active: this.built, channels: 2 },
      ],
      eq31Spliced: this.eq31ChainConnected,
      crossoverSpliced: this.xoverBranchesConnected,
      widthMatrixFourLegsWired: this.built,
    };
  }
}
