/**
 * Pure audio math, buffer generation, and signal-processing utility helpers.
 * Free of DOM/singleton coupling so DSP math can be verified independently.
 */

/**
 * Web Audio API BiquadFilterNode (`lowpass` / `highpass`) specifies `Q` in dB (`10^(Q/20)`).
 * For maximally-flat 2nd-order Butterworth (-3.01 dB @ fc) — and cascaded 4th-order
 * Linkwitz-Riley LR-24 (-6.02 dB @ fc, 0 dB vector sum) — Q must be `-20 * log10(sqrt(2))`.
 */
export const BUTTERWORTH_Q_DB = -20 * Math.log10(Math.SQRT2);

export function dbToLinear(db: number): number {
  if (!Number.isFinite(db)) return 0;
  if (db <= -80) return 0;
  return Math.pow(10, Math.max(-80, Math.min(36, db)) / 20);
}

export function linearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 1.585e-5) return -96;
  return Math.max(-96, 20 * Math.log10(linear));
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function calcTimeStats(buf: Float32Array): { rmsDb: number; peakDb: number } {
  const len = buf.length;
  if (len === 0) return { rmsDb: -96, peakDb: -96 };
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const v = Math.abs(buf[i]);
    sumSq += v * v;
    if (v > peak) peak = v;
  }
  const rms = Math.sqrt(sumSq / len);
  const rmsDb = Math.max(-96, 20 * Math.log10(Math.max(1.585e-5, rms)));
  const peakDb = Math.max(-96, 20 * Math.log10(Math.max(1.585e-5, peak)));
  return { rmsDb, peakDb };
}

export function computeFrequencyAxis(
  binCount: number,
  sampleRate: number,
  fftSize: number
): Float32Array<ArrayBuffer> {
  const axis = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    axis[i] = (i * sampleRate) / fftSize;
  }
  return axis;
}

/**
 * Computes Mid/Side stereo width matrix gains:
 *  L' = same * L + cross * R
 *  R' = cross * L + same * R
 * At width = 1.0: same = 1, cross = 0 (true stereo pass-through)
 * At width = 0.0: same = 0.5, cross = 0.5 (unity mono sum)
 */
export function computeWidthMatrixCoefficients(stereoWidth: number): {
  same: number;
  cross: number;
} {
  const w = clamp(Number.isFinite(stereoWidth) ? stereoWidth : 1, 0, 1.5);
  return {
    same: (1 + w) / 2,
    cross: (1 - w) / 2,
  };
}

/**
 * Generates an ITU-R calibrated -20 dBFS RMS stereo pink noise AudioBuffer
 * using Paul Kellet's -3 dB/octave weighted filter bank.
 */
export function createCalibratedPinkNoiseBuffer(
  ctx: BaseAudioContext,
  durationSec = 2
): AudioBuffer {
  const len = Math.max(1024, Math.round(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
    }
    let sumSq = 0;
    for (let i = 0; i < len; i++) {
      sumSq += out[i] * out[i];
    }
    const rms = Math.sqrt(sumSq / len);
    const scale = rms > 1e-6 ? 0.1 / rms : 0.055; // exact -20.0 dBFS RMS
    for (let i = 0; i < len; i++) {
      out[i] = clamp(out[i] * scale, -0.95, 0.95);
    }
  }
  return buffer;
}
