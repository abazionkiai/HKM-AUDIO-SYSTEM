/**
 * AudioWorkletProcessor that captures post-DSP console output stereo frames and posts
 * 480-frame (10ms @ 48kHz) interleaved Float32 blocks for native WASAPI RAW output (Option 2).
 */
class RawOutputTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockFrames = 480;
    this.interleaved = new Float32Array(this.blockFrames * 2);
    this.cursor = 0;
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

    for (let i = 0; i < frames; i++) {
      this.interleaved[this.cursor * 2] = inL ? inL[i] : 0;
      this.interleaved[this.cursor * 2 + 1] = inR ? inR[i] : 0;
      this.cursor += 1;
      if (this.cursor >= this.blockFrames) {
        const copy = new Float32Array(this.interleaved);
        this.port.postMessage(copy.buffer, [copy.buffer]);
        this.cursor = 0;
      }
    }

    return true;
  }
}

registerProcessor('raw-output-tap-processor', RawOutputTapProcessor);
