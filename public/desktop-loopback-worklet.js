/**
 * AudioWorkletProcessor that receives 48 kHz interleaved Float32 stereo frames
 * streamed from the Rust WASAPI process-exclusion loopback engine (or APO bridge)
 * over Tauri v2 binary IPC and outputs smooth stereo audio into a console strip.
 * Includes a zero-glitch linear resampler whenever the AudioContext runs at a rate != 48 kHz.
 */
class DesktopLoopbackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputSampleRate = 48000;
    this.outputSampleRate = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000;
    this.ratio = this.inputSampleRate / this.outputSampleRate;
    this.fracPhase = 0;

    this.ringFrames = 16384; // ~341ms @ 48kHz
    this.ringL = new Float32Array(this.ringFrames);
    this.ringR = new Float32Array(this.ringFrames);
    this.writePos = 0;
    this.readPos = 0;
    this.bufferedFrames = 0;
    this.prebuffered = false;
    this.minPrebufferFrames = 480; // 10ms startup cushion @ 48kHz
    this.maxLatencyFrames = 3840; // 80ms ceiling @ 48kHz
    this.lastL = 0;
    this.lastR = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!(data instanceof ArrayBuffer)) return;
      const sampleCount = Math.floor(data.byteLength / 4);
      const frameCount = Math.floor(sampleCount / 2);
      if (frameCount <= 0) return;

      const f32 = new Float32Array(data, 0, frameCount * 2);

      // Trim excess latency if producer surges ahead (e.g. tab backgrounded)
      if (this.bufferedFrames + frameCount > this.maxLatencyFrames) {
        const excess = this.bufferedFrames + frameCount - this.minPrebufferFrames;
        const skip = Math.min(this.bufferedFrames, Math.max(0, excess));
        this.readPos = (this.readPos + skip) % this.ringFrames;
        this.bufferedFrames -= skip;
        this.fracPhase = 0;
      }

      for (let i = 0; i < frameCount; i++) {
        this.ringL[this.writePos] = f32[i * 2];
        this.ringR[this.writePos] = f32[i * 2 + 1];
        this.writePos = (this.writePos + 1) % this.ringFrames;
      }
      this.bufferedFrames = Math.min(this.ringFrames, this.bufferedFrames + frameCount);
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out[1] ?? out[0];
    const framesNeeded = outL.length;

    if (
      !this.prebuffered &&
      this.bufferedFrames === 0 &&
      Math.abs(this.lastL) < 1e-6 &&
      Math.abs(this.lastR) < 1e-6
    ) {
      this.lastL = 0;
      this.lastR = 0;
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    if (!this.prebuffered) {
      if (this.bufferedFrames < this.minPrebufferFrames) {
        outL.fill(0);
        if (outR !== outL) outR.fill(0);
        return true;
      }
      this.prebuffered = true;
    }

    if (Math.abs(this.ratio - 1) < 1e-6) {
      // Exact 48 kHz 1:1 fast path
      if (this.bufferedFrames >= framesNeeded) {
        for (let i = 0; i < framesNeeded; i++) {
          const l = this.ringL[this.readPos];
          const r = this.ringR[this.readPos];
          this.readPos = (this.readPos + 1) % this.ringFrames;
          outL[i] = l;
          if (outR !== outL) outR[i] = r;
          this.lastL = l;
          this.lastR = r;
        }
        this.bufferedFrames -= framesNeeded;
      } else {
        for (let i = 0; i < framesNeeded; i++) {
          if (this.bufferedFrames > 0) {
            this.lastL = this.ringL[this.readPos];
            this.lastR = this.ringR[this.readPos];
            this.readPos = (this.readPos + 1) % this.ringFrames;
            this.bufferedFrames -= 1;
          } else {
            this.lastL = Math.abs(this.lastL) < 1e-5 ? 0 : this.lastL * 0.85;
            this.lastR = Math.abs(this.lastR) < 1e-5 ? 0 : this.lastR * 0.85;
          }
          outL[i] = this.lastL;
          if (outR !== outL) outR[i] = this.lastR;
        }
        if (this.bufferedFrames === 0) {
          this.prebuffered = false;
        }
      }
      return true;
    }

    // Fractional linear resampling path (48 kHz WASAPI -> device sampleRate, e.g. 44.1 kHz / 96 kHz)
    for (let i = 0; i < framesNeeded; i++) {
      if (this.bufferedFrames >= 2) {
        const idx0 = this.readPos;
        const idx1 = (this.readPos + 1) % this.ringFrames;
        const frac = this.fracPhase;
        const l = this.ringL[idx0] + (this.ringL[idx1] - this.ringL[idx0]) * frac;
        const r = this.ringR[idx0] + (this.ringR[idx1] - this.ringR[idx0]) * frac;
        outL[i] = l;
        if (outR !== outL) outR[i] = r;
        this.lastL = l;
        this.lastR = r;

        this.fracPhase += this.ratio;
        const advance = Math.floor(this.fracPhase);
        if (advance > 0) {
          const step = Math.min(this.bufferedFrames - 1, advance);
          this.readPos = (this.readPos + step) % this.ringFrames;
          this.bufferedFrames -= step;
          this.fracPhase -= advance;
        }
      } else {
        this.lastL = Math.abs(this.lastL) < 1e-5 ? 0 : this.lastL * 0.85;
        this.lastR = Math.abs(this.lastR) < 1e-5 ? 0 : this.lastR * 0.85;
        outL[i] = this.lastL;
        if (outR !== outL) outR[i] = this.lastR;
        this.prebuffered = false;
        this.fracPhase = 0;
      }
    }

    return true;
  }
}

registerProcessor('desktop-loopback-processor', DesktopLoopbackProcessor);
