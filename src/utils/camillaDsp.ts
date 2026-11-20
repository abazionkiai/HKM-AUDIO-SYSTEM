import type {
  DriverBackend,
  DspConfig,
  EqBand,
  HardwareDevice,
  PlatformTarget,
  SpeakerZone,
} from '../types/audio.ts';

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateDspConfig(
  dsp: DspConfig,
  sampleRate: number,
  zones: SpeakerZone[]
): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nyquist = sampleRate / 2;

  if (dsp.hpfEnabled && (dsp.hpfHz < 20 || dsp.hpfHz >= nyquist * 0.8)) {
    errors.push(`HPF cutoff (${dsp.hpfHz} Hz) is outside safe operating bounds for ${sampleRate} Hz.`);
  }
  if (dsp.lpfEnabled && (dsp.lpfHz <= dsp.hpfHz || dsp.lpfHz >= nyquist)) {
    errors.push(`LPF cutoff (${dsp.lpfHz} Hz) must sit above HPF and below Nyquist (${nyquist} Hz).`);
  }

  for (const band of dsp.eqBands) {
    if (!band.enabled) continue;
    if (band.frequency < 20 || band.frequency >= nyquist * 0.95) {
      errors.push(`EQ Band "${band.label}" (${band.frequency} Hz) exceeds Nyquist limit.`);
    }
    if (band.q < 0.1 || band.q > 24) {
      errors.push(`EQ Band "${band.label}" Q factor (${band.q}) must be between 0.1 and 24.`);
    }
    if (band.gainDb > 12 || band.gainDb < -24) {
      errors.push(`EQ Band "${band.label}" gain (${band.gainDb} dB) exceeds safe range (-24 to +12 dB).`);
    }
    if (band.gainDb > 6) {
      warnings.push(`High positive boost (+${band.gainDb.toFixed(1)} dB at ${band.frequency} Hz) reduces feedback headroom.`);
    }
  }

  if (!dsp.limiter.enabled) {
    warnings.push('Master brickwall limiter is disabled. PA speakers and livestream lack overload protection.');
  } else if (dsp.limiter.ceilingDb > 0) {
    errors.push(`Limiter ceiling (${dsp.limiter.ceilingDb} dBFS) must be <= 0.0 dBFS to prevent digital clipping.`);
  }

  if (dsp.compressor.ratio < 1 || dsp.compressor.ratio > 20) {
    errors.push(`Compressor ratio (${dsp.compressor.ratio}:1) is out of range.`);
  }

  for (const z of zones) {
    if (z.delayMs < 0 || z.delayMs > 500) {
      errors.push(`Zone "${z.name}" delay (${z.delayMs} ms) exceeds 500 ms safety cap.`);
    }
    if (z.levelDb > 6) {
      warnings.push(`Zone "${z.name}" boost (+${z.levelDb} dB) may overdrive amplifiers.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function calculateRoundTripLatencyMs(bufferSize: number, sampleRate: number, driver: DriverBackend): number {
  const baseBufferMs = (bufferSize / sampleRate) * 1000 * 2; // capture + playback
  const driverOverheadMs =
    driver === 'ASIO'
      ? 1.8
      : driver === 'WASAPI Exclusive'
        ? 3.2
        : driver === 'CoreAudio'
          ? 2.1
          : driver === 'PipeWire'
            ? 2.8
            : driver === 'ALSA'
              ? 2.0
              : 12.5; // WASAPI Shared
  return Number((baseBufferMs + driverOverheadMs).toFixed(2));
}

export function generateCamillaDspYaml(
  dsp: DspConfig,
  device: HardwareDevice,
  platform: PlatformTarget,
  driver: DriverBackend,
  sampleRate: number,
  bufferSize: number,
  zones: SpeakerZone[]
): string {
  const captureType =
    platform === 'windows'
      ? driver === 'ASIO'
        ? 'Asio'
        : 'Wasapi'
      : platform === 'macos'
        ? 'CoreAudio'
        : driver === 'PipeWire'
          ? 'Pulse'
          : 'Alsa';

  const exclusiveFlag = platform === 'windows' && driver === 'WASAPI Exclusive' ? '\n    exclusive: true' : '';
  const deviceLabel = `${device.manufacturer} ${device.model}`;
  const channels = Math.min(device.capabilities.maxInputChannels, 8);
  const outChannels = Math.max(2, Math.min(zones.length, device.capabilities.maxOutputChannels || 2));

  const filterLines: string[] = [];
  const pipelineNames: string[] = [];

  if (dsp.hpfEnabled) {
    filterLines.push(
      `  hpf_main:\n    type: Biquad\n    parameters:\n      type: Highpass\n      freq: ${dsp.hpfHz}\n      q: 0.707`
    );
    pipelineNames.push('hpf_main');
  }

  dsp.eqBands.forEach((band, idx) => {
    if (!band.enabled) return;
    const key = `peq_${idx + 1}_${band.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    const bType =
      band.type === 'lowshelf'
        ? 'Lowshelf'
        : band.type === 'highshelf'
          ? 'Highshelf'
          : 'Peaking';
    filterLines.push(
      `  ${key}:\n    type: Biquad\n    parameters:\n      type: ${bType}\n      freq: ${band.frequency}\n      gain: ${band.gainDb.toFixed(1)}\n      q: ${band.q.toFixed(2)}`
    );
    pipelineNames.push(key);
  });

  if (dsp.lpfEnabled) {
    filterLines.push(
      `  lpf_main:\n    type: Biquad\n    parameters:\n      type: Lowpass\n      freq: ${dsp.lpfHz}\n      q: 0.707`
    );
    pipelineNames.push('lpf_main');
  }

  if (dsp.compressor.enabled) {
    filterLines.push(
      `  comp_main:\n    type: Compressor\n    parameters:\n      channels: 2\n      monitor_channels: [0, 1]\n      process_channels: [0, 1]\n      attack: ${(dsp.compressor.attackMs / 1000).toFixed(4)}\n      release: ${(dsp.compressor.releaseMs / 1000).toFixed(4)}\n      threshold: ${dsp.compressor.thresholdDb}\n      factor: ${dsp.compressor.ratio.toFixed(1)}\n      makeup_gain: ${dsp.compressor.makeupDb.toFixed(1)}`
    );
  }

  if (dsp.limiter.enabled) {
    filterLines.push(
      `  limiter_safety:\n    type: Limiter\n    parameters:\n      clip_limit: ${dsp.limiter.ceilingDb.toFixed(1)}\n      soft_clip: true`
    );
  }

  zones.slice(0, outChannels).forEach((z, idx) => {
    if (z.delayMs > 0) {
      filterLines.push(
        `  delay_zone_${idx}:\n    type: Delay\n    parameters:\n      delay: ${z.delayMs.toFixed(2)}\n      unit: ms\n      subsample: true`
      );
    }
  });

  return `# CamillaDSP v2.0 Configuration — Generated by Church Audio Intelligence
# Target Platform: ${platform.toUpperCase()} (${driver}) · Hardware: ${deviceLabel}
devices:
  samplerate: ${sampleRate}
  chunksize: ${bufferSize}
  queuelimit: 4
  silence_threshold: -90.0
  silence_timeout: 3.0
  capture:
    type: ${captureType}
    channels: ${channels}
    device: "${deviceLabel}"${exclusiveFlag}
    format: FLOAT32LE
  playback:
    type: ${captureType}
    channels: ${outChannels}
    device: "${deviceLabel} Main Out"${exclusiveFlag}
    format: FLOAT32LE

mixers:
  church_matrix:
    channels:
      in: ${channels}
      out: ${outChannels}
    mapping:
      - dest: 0
        sources:
          - channel: 0
            gain: ${dsp.inputTrimDb.toFixed(1)}
            inverted: ${dsp.polarityInverted}
      - dest: 1
        sources:
          - channel: ${channels > 1 ? 1 : 0}
            gain: ${dsp.inputTrimDb.toFixed(1)}
            inverted: ${dsp.polarityInverted}

filters:
${filterLines.join('\n')}

pipeline:
  - type: Mixer
    name: church_matrix
  - type: Filter
    channels: [0, 1]
    names:
${pipelineNames.map((n) => `      - ${n}`).join('\n')}
${dsp.compressor.enabled ? '  - type: Processor\n    name: comp_main' : ''}
${dsp.limiter.enabled ? '  - type: Processor\n    name: limiter_safety' : ''}
`;
}

/**
 * Computes analytical magnitude response (in dB) at frequency f (Hz)
 * for a biquad EQ chain so the Parametric EQ graph accurately reflects
 * the exact Web Audio / CamillaDSP filter math.
 */
export function computeFilterCurveDb(dsp: DspConfig, freqHz: number, sampleRate = 48000): number {
  if (dsp.bypassed) return 0;
  let totalDb = dsp.inputTrimDb;
  const w0 = (2 * Math.PI * freqHz) / sampleRate;

  const evalBiquad = (
    type: EqBand['type'],
    fc: number,
    gainDb: number,
    q: number
  ): number => {
    const wc = (2 * Math.PI * Math.min(fc, sampleRate * 0.48)) / sampleRate;
    const cosW = Math.cos(wc);
    const sinW = Math.sin(wc);
    const alpha = sinW / (2 * Math.max(0.1, q));
    const A = Math.pow(10, gainDb / 40);

    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

    if (type === 'peaking') {
      b0 = 1 + alpha * A;
      b1 = -2 * cosW;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosW;
      a2 = 1 - alpha / A;
    } else if (type === 'highpass') {
      b0 = (1 + cosW) / 2;
      b1 = -(1 + cosW);
      b2 = (1 + cosW) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW;
      a2 = 1 - alpha;
    } else if (type === 'lowpass') {
      b0 = (1 - cosW) / 2;
      b1 = 1 - cosW;
      b2 = (1 - cosW) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW;
      a2 = 1 - alpha;
    } else if (type === 'lowshelf') {
      const sq = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cosW + sq);
      b1 = 2 * A * (A - 1 - (A + 1) * cosW);
      b2 = A * (A + 1 - (A - 1) * cosW - sq);
      a0 = A + 1 + (A - 1) * cosW + sq;
      a1 = -2 * (A - 1 + (A + 1) * cosW);
      a2 = A + 1 + (A - 1) * cosW - sq;
    } else if (type === 'highshelf') {
      const sq = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cosW + sq);
      b1 = -2 * A * (A - 1 + (A + 1) * cosW);
      b2 = A * (A + 1 + (A - 1) * cosW - sq);
      a0 = A + 1 - (A - 1) * cosW + sq;
      a1 = 2 * (A - 1 - (A + 1) * cosW);
      a2 = A + 1 - (A - 1) * cosW - sq;
    }

    const cos1 = Math.cos(w0);
    const sin1 = Math.sin(w0);
    const cos2 = Math.cos(2 * w0);
    const sin2 = Math.sin(2 * w0);

    const numRe = b0 + b1 * cos1 + b2 * cos2;
    const numIm = -b1 * sin1 - b2 * sin2;
    const denRe = a0 + a1 * cos1 + a2 * cos2;
    const denIm = -a1 * sin1 - a2 * sin2;

    const magSq = (numRe * numRe + numIm * numIm) / Math.max(1e-12, denRe * denRe + denIm * denIm);
    return 10 * Math.log10(Math.max(1e-8, magSq));
  };

  if (dsp.hpfEnabled) {
    totalDb += evalBiquad('highpass', dsp.hpfHz, 0, 0.707);
  }
  if (dsp.lpfEnabled) {
    totalDb += evalBiquad('lowpass', dsp.lpfHz, 0, 0.707);
  }
  for (const band of dsp.eqBands) {
    if (band.enabled) {
      totalDb += evalBiquad(band.type, band.frequency, band.gainDb, band.q);
    }
  }
  return Math.max(-36, Math.min(18, totalDb));
}
