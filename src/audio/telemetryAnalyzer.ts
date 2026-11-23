import type {
  AudioSourceSimulation,
  DspConfig,
  SignalTelemetry,
} from '../types/audio.ts';
import { calcTimeStats, clamp, computeFrequencyAxis, dbToLinear } from './audioUtils.ts';
import type { ChannelStripBank } from './channelStripBank.ts';
import type { MasterDspGraph } from './masterDspGraph.ts';

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

/**
 * Real-time DSP Telemetry Analyzer & Adaptive Protection Controller.
 * Samples Pre/Post stereo buffers and FFT spectra using real elapsed timestamps
 * to drive: Smart AGC, Noise Gate, Clean Standby Gate, De-Esser, Sub-Rumble HPF,
 * Mud Cut, Surgical Q=18 Feedback Notches, and Output Quality Normalization.
 */
export class TelemetryAnalyzer {
  private preFreqBuf = new Float32Array(2048);
  private postFreqBuf = new Float32Array(2048);
  private preTimeBuf = new Float32Array(2048);
  private postTimeBuf = new Float32Array(2048);
  private postLTimeBuf = new Float32Array(1024);
  private postRTimeBuf = new Float32Array(1024);
  private cachedFreqAxis = new Float32Array(2048);
  private cachedFreqSampleRate = 0;

  private latestSpectrum: SpectrumSnapshot = {
    frequencies: this.cachedFreqAxis,
    preDb: this.preFreqBuf,
    postDb: this.postFreqBuf,
  };

  private lastFastSnapTs = 0;
  private lastFastSnap: FastMeterSnapshot | null = null;
  private lastSampleTs = 0;
  private telemetryTickCount = 0;
  private lastSpectrumReadTs = 0;

  private currentAgcGainDb = 0;
  private gateIsClosed = false;
  private standbySilenceTimerSec = 0;
  private standbyGateIsClosed = false;
  private persistentPeakBin = -1;
  private persistentPeakFrames = 0;
  private feedbackPersistenceSec = 0;
  private clippingCount = 0;
  private noiseFloorDb = -96;
  private surgicalNotchMeta: { freqHz: number; cutDb: number; holdSec: number }[] = Array.from(
    { length: 4 },
    () => ({ freqHz: 0, cutDb: 0, holdSec: 0 })
  );

  public initBuffers(graph: MasterDspGraph, sampleRate: number): void {
    const binCount = graph.preAnalyser.frequencyBinCount;
    this.preFreqBuf = new Float32Array(binCount);
    this.postFreqBuf = new Float32Array(binCount);
    this.preTimeBuf = new Float32Array(binCount);
    this.postTimeBuf = new Float32Array(binCount);
    this.postLTimeBuf = new Float32Array(graph.postLAnalyser.fftSize);
    this.postRTimeBuf = new Float32Array(graph.postRAnalyser.fftSize);
    this.cachedFreqSampleRate = sampleRate;
    this.cachedFreqAxis = computeFrequencyAxis(binCount, sampleRate, graph.preAnalyser.fftSize);
    this.latestSpectrum = {
      frequencies: this.cachedFreqAxis,
      preDb: this.preFreqBuf,
      postDb: this.postFreqBuf,
    };
  }

  public reset(): void {
    this.lastFastSnap = null;
    this.lastFastSnapTs = 0;
    this.lastSampleTs = 0;
    this.telemetryTickCount = 0;
    this.currentAgcGainDb = 0;
    this.gateIsClosed = false;
    this.standbySilenceTimerSec = 0;
    this.standbyGateIsClosed = false;
    this.persistentPeakBin = -1;
    this.persistentPeakFrames = 0;
    this.feedbackPersistenceSec = 0;
    this.clippingCount = 0;
    this.noiseFloorDb = -96;
    this.surgicalNotchMeta = Array.from({ length: 4 }, () => ({
      freqHz: 0,
      cutDb: 0,
      holdSec: 0,
    }));
    this.preFreqBuf.fill(-96);
    this.postFreqBuf.fill(-96);
    this.preTimeBuf.fill(0);
    this.postTimeBuf.fill(0);
    this.postLTimeBuf.fill(0);
    this.postRTimeBuf.fill(0);
  }

  public clearFastCache(): void {
    this.lastFastSnap = null;
    this.lastFastSnapTs = 0;
  }

  public getLatestSpectrum(graph: MasterDspGraph | null, isRunning: boolean): SpectrumSnapshot {
    const nowTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (isRunning && graph && nowTs - this.lastSpectrumReadTs > 120) {
      graph.preAnalyser.getFloatFrequencyData(this.preFreqBuf);
      graph.postAnalyser.getFloatFrequencyData(this.postFreqBuf);
      this.lastSpectrumReadTs = nowTs;
    }
    return this.latestSpectrum;
  }

  public sampleFastLevels(params: {
    isRunning: boolean;
    graph: MasterDspGraph;
    stripBank: ChannelStripBank;
    dsp: DspConfig | null;
  }): FastMeterSnapshot {
    const { isRunning, graph, stripBank, dsp } = params;
    if (!isRunning) {
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

    graph.preAnalyser.getFloatTimeDomainData(this.preTimeBuf);
    graph.postAnalyser.getFloatTimeDomainData(this.postTimeBuf);
    graph.postLAnalyser.getFloatTimeDomainData(this.postLTimeBuf);
    graph.postRAnalyser.getFloatTimeDomainData(this.postRTimeBuf);

    const preStats = calcTimeStats(this.preTimeBuf);
    const postStats = calcTimeStats(this.postTimeBuf);
    const postLStats = calcTimeStats(this.postLTimeBuf);
    const postRStats = calcTimeStats(this.postRTimeBuf);

    const chMeters = stripBank.sampleFastMeters();
    const masterGrDb =
      !dsp?.bypassed && dsp?.compressor.enabled
        ? Number(Math.abs(graph.compNode.reduction).toFixed(1))
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
      capturedChannels: stripBank.getStripCount(),
      channelRmsDb: chMeters.channelRmsDb,
      channelPeakDb: chMeters.channelPeakDb,
      channelCompGrDb: chMeters.channelCompGrDb,
      masterGrDb,
    };

    this.lastFastSnapTs = nowTs;
    this.lastFastSnap = snap;
    return snap;
  }

  public sampleTelemetry(params: {
    ctx: BaseAudioContext | null;
    isRunning: boolean;
    sourceMode: AudioSourceSimulation;
    activeInputLabel: string | null;
    graph: MasterDspGraph;
    stripBank: ChannelStripBank;
    dsp: DspConfig | null;
    includeSpectrum?: boolean;
  }): { telemetry: SignalTelemetry; spectrum: SpectrumSnapshot } {
    const {
      ctx,
      isRunning,
      sourceMode,
      activeInputLabel,
      graph,
      stripBank,
      dsp,
      includeSpectrum,
    } = params;
    const sampleRate = ctx?.sampleRate ?? 48000;

    if (this.cachedFreqSampleRate !== sampleRate) {
      this.cachedFreqSampleRate = sampleRate;
      this.cachedFreqAxis = computeFrequencyAxis(
        this.cachedFreqAxis.length,
        sampleRate,
        graph.preAnalyser?.fftSize ?? 4096
      );
      this.latestSpectrum = {
        frequencies: this.cachedFreqAxis,
        preDb: this.preFreqBuf,
        postDb: this.postFreqBuf,
      };
    }

    if (!isRunning || !ctx) {
      this.preFreqBuf.fill(-96);
      this.postFreqBuf.fill(-96);
      return {
        telemetry: {
          source: sourceMode,
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

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const deltaSec =
      this.lastSampleTs > 0 ? clamp((nowMs - this.lastSampleTs) / 1000, 0.01, 0.6) : 0.2;
    this.lastSampleTs = nowMs;

    this.telemetryTickCount += 1;
    const readSpecNow = Boolean(includeSpectrum) || this.telemetryTickCount % 2 === 1;
    if (readSpecNow) {
      graph.preAnalyser.getFloatFrequencyData(this.preFreqBuf);
      graph.postAnalyser.getFloatFrequencyData(this.postFreqBuf);
      this.lastSpectrumReadTs = nowMs;
    }

    graph.preAnalyser.getFloatTimeDomainData(this.preTimeBuf);
    graph.postAnalyser.getFloatTimeDomainData(this.postTimeBuf);
    graph.postLAnalyser.getFloatTimeDomainData(this.postLTimeBuf);
    graph.postRAnalyser.getFloatTimeDomainData(this.postRTimeBuf);

    const preStats = calcTimeStats(this.preTimeBuf);
    const postStats = calcTimeStats(this.postTimeBuf);
    const postLStats = calcTimeStats(this.postLTimeBuf);
    const postRStats = calcTimeStats(this.postRTimeBuf);

    const binHz = sampleRate / graph.preAnalyser.fftSize;
    const now = ctx.currentTime;

    // 1. Live Noise Gate (with 2 dB hysteresis)
    if (dsp && !dsp.bypassed && dsp.gate.enabled) {
      const thresh = dsp.gate.thresholdDb;
      if (this.gateIsClosed) {
        if (preStats.rmsDb >= thresh + 2.0) this.gateIsClosed = false;
      } else if (preStats.rmsDb < thresh) {
        this.gateIsClosed = true;
      }
      const gateLinear = this.gateIsClosed ? dbToLinear(-Math.abs(dsp.gate.rangeDb || 24)) : 1;
      graph.gateGainNode.gain.setTargetAtTime(gateLinear, now, this.gateIsClosed ? 0.045 : 0.008);
    } else {
      this.gateIsClosed = false;
      graph.gateGainNode.gain.setTargetAtTime(1, now, 0.015);
    }

    // 2. Clean Standby Gate (exact real elapsed hold timer)
    if (dsp && !dsp.bypassed) {
      const standbyCfg = dsp.cleanStandby;
      const standbyEnabled = standbyCfg
        ? (standbyCfg.standbyGateEnabled ?? standbyCfg.adaptiveStandbyGate) !== false
        : true;
      const thresholdDb = standbyCfg?.standbyGateThresholdDb ?? -56;
      const holdSec = (standbyCfg?.standbyGateHoldMs ?? 1000) / 1000;

      if (standbyEnabled) {
        if (preStats.rmsDb < thresholdDb) {
          this.standbySilenceTimerSec += deltaSec;
          if (this.standbySilenceTimerSec >= holdSec) {
            this.standbyGateIsClosed = true;
          }
        } else if (preStats.rmsDb >= thresholdDb + 1.5) {
          this.standbySilenceTimerSec = 0;
          this.standbyGateIsClosed = false;
        }
        const targetGain = this.standbyGateIsClosed ? 0.00001 : 1.0;
        graph.standbyGateGainNode.gain.setTargetAtTime(
          targetGain,
          now,
          this.standbyGateIsClosed ? 0.08 : 0.005
        );
      } else {
        this.standbyGateIsClosed = false;
        this.standbySilenceTimerSec = 0;
        graph.standbyGateGainNode.gain.setTargetAtTime(1.0, now, 0.015);
      }
    } else {
      this.standbyGateIsClosed = false;
      this.standbySilenceTimerSec = 0;
      graph.standbyGateGainNode.gain.setTargetAtTime(1.0, now, 0.015);
    }

    // 3. Smart AGC with Gate-Hold Protection
    const agc = dsp?.smartAgc;
    if (agc?.enabled && dsp && !dsp.bypassed) {
      const targetRms = agc.targetRmsDb ?? -18;
      const maxBoost = clamp(agc.maxBoostDb ?? 14, 0, 18);
      const maxCut = clamp(agc.maxCutDb ?? 18, 0, 24);
      const gateFloor = agc.gateFloorDb ?? -52;

      if (preStats.peakDb > -3.0) {
        const neededCut = Math.max(-maxCut, -3.0 - preStats.peakDb);
        this.currentAgcGainDb += (neededCut - this.currentAgcGainDb) * 0.45;
        graph.agcGainNode.gain.setTargetAtTime(dbToLinear(this.currentAgcGainDb), now, 0.025);
      } else if (preStats.rmsDb > gateFloor) {
        const desiredDelta = clamp(targetRms - preStats.rmsDb, -maxCut, maxBoost);
        const coeff = desiredDelta < this.currentAgcGainDb ? 0.18 : 0.06;
        this.currentAgcGainDb += (desiredDelta - this.currentAgcGainDb) * coeff;
        graph.agcGainNode.gain.setTargetAtTime(dbToLinear(this.currentAgcGainDb), now, 0.08);
      } else {
        this.currentAgcGainDb *= 0.96;
        graph.agcGainNode.gain.setTargetAtTime(dbToLinear(this.currentAgcGainDb), now, 0.25);
      }
    } else {
      this.currentAgcGainDb = 0;
      graph.agcGainNode.gain.setTargetAtTime(1.0, now, 0.04);
    }

    // 4. Dynamic De-Esser
    if (dsp && !dsp.bypassed && dsp.deEsser.enabled) {
      const center = Math.max(2500, dsp.deEsser.frequencyHz);
      const loBin = Math.max(1, Math.floor((center * 0.85) / binHz));
      const hiBin = Math.min(this.preFreqBuf.length - 1, Math.ceil((center * 1.15) / binHz));
      let peakSibDb = -96;
      for (let b = loBin; b <= hiBin; b++) {
        if (this.preFreqBuf[b] > peakSibDb) peakSibDb = this.preFreqBuf[b];
      }
      const over = peakSibDb - dsp.deEsser.thresholdDb;
      const deEssCutDb = over > 0 ? -Math.min(10, over * 0.75) : 0;
      graph.deEsserNode.gain.setTargetAtTime(deEssCutDb, now, deEssCutDb < 0 ? 0.015 : 0.04);
    } else {
      graph.deEsserNode.gain.setTargetAtTime(0, now, 0.02);
    }

    if (postStats.peakDb > -0.2) this.clippingCount++;

    // 5. Post-DSP Feedback Ring Detector (400 Hz - 10 kHz)
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
        this.feedbackPersistenceSec += deltaSec;
      } else {
        this.persistentPeakBin = maxPromBin;
        this.persistentPeakFrames = 1;
        this.feedbackPersistenceSec = deltaSec;
      }
    } else {
      this.persistentPeakFrames = Math.max(0, this.persistentPeakFrames - 1);
      if (this.persistentPeakFrames === 0) {
        this.feedbackPersistenceSec = 0;
      } else {
        this.feedbackPersistenceSec = Math.max(0, this.feedbackPersistenceSec - deltaSec * 0.5);
      }
    }

    const persistenceSec = Number(this.feedbackPersistenceSec.toFixed(1));
    const feedbackDetected = this.feedbackPersistenceSec >= 0.6 && maxProminence > 11;

    // 6. 50/60 Hz Mains Hum + Mud detectors
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

    const mudEnergy = (getBinDb(200) + getBinDb(220) + getBinDb(245)) / 3;
    const midRef = (getBinDb(550) + getBinDb(750)) / 2;
    const mudDetected = mudEnergy - midRef > 8 && mudEnergy > -42;

    const compGr = !dsp?.bypassed && dsp?.compressor.enabled ? Math.abs(graph.compNode.reduction) : 0;
    const limGr = !dsp?.bypassed && dsp?.limiter.enabled ? Math.abs(graph.limiterNode.reduction) : 0;
    const grDb = Number(Math.max(compGr, limGr).toFixed(1));

    // Quiescent broadband noise floor estimate
    let quietBinSum = 0;
    let quietBinCount = 0;
    const floorStart = Math.floor(800 / binHz);
    const floorEnd = Math.min(this.preFreqBuf.length - 1, Math.floor(6000 / binHz));
    for (let i = floorStart; i <= floorEnd; i += 4) {
      quietBinSum += clamp(this.preFreqBuf[i], -96, -24);
      quietBinCount++;
    }
    const instantNoiseEst =
      quietBinCount > 0 ? clamp(quietBinSum / quietBinCount - 6, -96, -38) : -96;
    if (this.noiseFloorDb <= -95) {
      this.noiseFloorDb = instantNoiseEst;
    } else {
      const floorRate = instantNoiseEst < this.noiseFloorDb ? 0.12 : 0.02;
      this.noiseFloorDb = Number(
        (this.noiseFloorDb + (instantNoiseEst - this.noiseFloorDb) * floorRate).toFixed(1)
      );
    }

    const channelLevels = stripBank.sampleFullTelemetry();

    // 7. Surgical Digital Troubleshooter & Quality Gate
    const qGateEnabled = dsp?.qualityGate?.enabled ?? true;
    const activeSurgicalFilters: string[] = [];

    if (qGateEnabled && dsp && !dsp.bypassed) {
      const subEnergy = (getBinDb(28) + getBinDb(42)) / 2;
      const rumbleExcess = subEnergy - midRef > 6 && subEnergy > -36;
      graph.autoRumbleHpfNode.frequency.setTargetAtTime(rumbleExcess ? 80 : 18, now, 0.06);
      if (rumbleExcess) activeSurgicalFilters.push('Sub-Rumble HPF @ 80 Hz');

      graph.autoMudCutNode.gain.setTargetAtTime(
        mudDetected ? -5.5 : 0,
        now,
        mudDetected ? 0.05 : 0.25
      );
      if (mudDetected) activeSurgicalFilters.push('Mud Cut @ 220 Hz (-5.5 dB)');

      if (this.feedbackPersistenceSec >= 0.2 && maxProminence > 9.5 && maxPromBin > 0) {
        const ringHz = Math.round(maxPromBin * binHz);
        const existingIdx = this.surgicalNotchMeta.findIndex(
          (m) => m.freqHz > 0 && Math.abs(m.freqHz - ringHz) <= Math.max(35, ringHz * 0.04)
        );
        if (existingIdx >= 0) {
          this.surgicalNotchMeta[existingIdx].cutDb = Math.max(
            -14,
            this.surgicalNotchMeta[existingIdx].cutDb - 1.5
          );
          this.surgicalNotchMeta[existingIdx].holdSec = 12;
        } else {
          const emptyIdx = this.surgicalNotchMeta.findIndex((m) => m.holdSec <= 0);
          const slot = emptyIdx >= 0 ? emptyIdx : 0;
          this.surgicalNotchMeta[slot] = { freqHz: ringHz, cutDb: -9.0, holdSec: 12 };
        }
      }

      graph.surgicalNotchNodes.forEach((node, idx) => {
        const meta = this.surgicalNotchMeta[idx];
        if (!meta) return;
        if (meta.holdSec > 0 && meta.freqHz >= 200) {
          meta.holdSec = Math.max(0, meta.holdSec - deltaSec);
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
      graph.autoRumbleHpfNode.frequency.setTargetAtTime(18, now, 0.08);
      graph.autoMudCutNode.gain.setTargetAtTime(0, now, 0.08);
      graph.surgicalNotchNodes.forEach((n) => n.gain.setTargetAtTime(0, now, 0.08));
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
    if (dsp?.bypassed) {
      qualityScore -= 25;
      if (!qualityReason) qualityReason = 'DSP Bypassed (Unprotected)';
    }
    qualityScore = clamp(qualityScore, 0, 100);

    if (dsp) {
      const baseMasterDb = dsp.bypassed ? 0 : (dsp.masterOutputGainDb ?? 0);
      if (qGateEnabled && !dsp.bypassed && postStats.peakDb > -0.15) {
        qualityGateEngaged = true;
        graph.masterOutputGainNode.gain.setTargetAtTime(
          dbToLinear(Math.max(-36, baseMasterDb - 3)),
          now,
          0.03
        );
      } else {
        graph.masterOutputGainNode.gain.setTargetAtTime(
          dbToLinear(clamp(baseMasterDb, -36, 6)),
          now,
          0.08
        );
      }
    }

    return {
      telemetry: {
        source: sourceMode,
        isRunning: true,
        sampleRate,
        activeInputLabel,
        capturedChannels: stripBank.getStripCount(),
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
        frequencies: this.cachedFreqAxis,
        preDb: includeSpectrum ? new Float32Array(this.preFreqBuf) : this.preFreqBuf,
        postDb: includeSpectrum ? new Float32Array(this.postFreqBuf) : this.postFreqBuf,
      },
    };
  }
}
