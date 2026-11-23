/**
 * AudioWorkletProcessor that captures post-DSP console output stereo frames and posts
 * 480-frame (10ms @ 48kHz) interleaved Float32 blocks for native WASAPI RAW output (Option 2).
 * Automatically resamples to 48 kHz whenever AudioContext sampleRate differs from 48000 Hz.
 */
class RawOutputTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockFrames = 480;
    this.interleaved = new Float32Array(this.blockFrames * 2);
    this.cursor = 0;
    this.inputSampleRate = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000;
    this.outputSampleRate = 48000;
    this.stepIn = this.inputSampleRate / this.outputSampleRate;
    this.srcPhase = 0;
    this.prevL = 0;
    this.prevR = 0;
    this.hasPrev = false;
  }

  emitSample(l, r) {
    this.interleaved[this.cursor * 2] = l;
    this.interleaved[this.cursor * 2 + 1] = r;
    this.cursor += 1;
    if (this.cursor >= this.blockFrames) {
      const copy = new Float32Array(this.interleaved);
      this.port.postMessage(copy.buffer, [copy.buffer]);
      this.cursor = 0;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    const frames = inL ? inL.length : output && output[0] ? output[0].length : 128;

    // Keep graph downstream alive with silent pass (monitorGain is muted while RAW mode runs)
    if (output) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }
    }

    if (Math.abs(this.stepIn - 1) < 1e-6) {
      for (let i = 0; i < frames; i++) {
        this.emitSample(inL ? inL[i] : 0, inR ? inR[i] : 0);
      }
      return true;
    }

    if (!this.hasPrev) {
      this.prevL = inL ? inL[0] : 0;
      this.prevR = inR ? inR[0] : 0;
      this.hasPrev = true;
    }

    while (this.srcPhase < frames) {
      const idx0 = Math.floor(this.srcPhase);
      const frac = this.srcPhase - idx0;
      const l0 = idx0 < 0 ? this.prevL : inL ? inL[idx0] : 0;
      const r0 = idx0 < 0 ? this.prevR : inR ? inR[idx0] : 0;
      const idx1 = Math.min(frames - 1, idx0 + 1);
      const l1 = inL ? inL[idx1] : 0;
      const r1 = inR ? inR[idx1] : 0;
      this.emitSample(l0 + (l1 - l0) * frac, r0 + (r1 - r0) * frac);
      this.srcPhase += this.stepIn;
    }

    this.srcPhase -= frames;
    if (frames > 0) {
      this.prevL = inL ? inL[frames - 1] : 0;
      this.prevR = inR ? inR[frames - 1] : 0;
    }

    return true;
  }
}

registerProcessor('raw-output-tap-processor', RawOutputTapProcessor);
