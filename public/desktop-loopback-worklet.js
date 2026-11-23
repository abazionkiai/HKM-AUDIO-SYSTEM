/**
 * AudioWorkletProcessor that receives 48 kHz interleaved Float32 stereo frames
 * streamed from the Rust WASAPI process-exclusion loopback engine (or APO bridge)
 * over Tauri v2 binary IPC and outputs smooth stereo audio into a console strip.
 */
class DesktopLoopbackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringFrames = 16384; // ~341ms @ 48kHz
    this.ringL = new Float32Array(this.ringFrames);
    this.ringR = new Float32Array(this.ringFrames);
    this.writePos = 0;
    this.readPos = 0;
    this.bufferedFrames = 0;
    this.prebuffered = false;
    this.minPrebufferFrames = 480; // 10ms startup cushion
    this.maxLatencyFrames = 3840; // 80ms ceiling to stay tight with zero drift
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
      // Smooth exponential decay on underrun to avoid clicks/pops
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
}

registerProcessor('desktop-loopback-processor', DesktopLoopbackProcessor);
