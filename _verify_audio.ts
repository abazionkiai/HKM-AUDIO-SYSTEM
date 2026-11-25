import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  DEFAULT_FALLBACK_INPUT_ID,
  createOpenChannelSlot,
  deduplicateMediaDevices,
  reconcileLiveInputsToChannels,
  sanitizeAndAutoNameChannels,
} from './src/utils/audioNaming.ts';
import { evaluateDesktopLoopbackSafety } from './src/audio/systemAudioBridge.ts';
import { clamp, dbToLinear } from './src/audio/audioUtils.ts';

function fakeDev(
  deviceId: string,
  label: string,
  kind: 'audioinput' | 'audiooutput' = 'audioinput',
  groupId = 'grp-1'
): MediaDeviceInfo {
  return {
    deviceId,
    label,
    kind,
    groupId,
    toJSON: () => ({ deviceId, label, kind, groupId }),
  } as MediaDeviceInfo;
}

console.log('1. Testing audioNaming fallback & deduplication...');
{
  // Case A: Only 'default' OS mic exists -> should keep and assign CH1 with DEFAULT_FALLBACK_INPUT_ID
  const slots = Array.from({ length: 8 }, (_, i) => createOpenChannelSlot(i + 1));
  const defaultOnly = [
    fakeDev('default', 'Default - Microphone Array (Realtek)', 'audioinput', 'g-def'),
    fakeDev('communications', 'Communications - Microphone Array (Realtek)', 'audioinput', 'g-def'),
  ];
  const resDefault = reconcileLiveInputsToChannels(slots, defaultOnly, { isStartupSync: true });
  assert.equal(resDefault.channels[0].hardwareInputId, DEFAULT_FALLBACK_INPUT_ID);
  assert.equal(resDefault.channels[0].faderDb, 0);
  assert.equal(resDefault.channels[1].hardwareInputId, undefined);

  // Sanitize preserves single 'default' fallback when no concrete inputs exist
  const sanitized = sanitizeAndAutoNameChannels(resDefault.channels);
  assert.equal(sanitized[0].hardwareInputId, DEFAULT_FALLBACK_INPUT_ID);

  // Case B: Pre-permission un-ID'd browser placeholder (deviceId === '') must store 'default', NEVER cleanLabel!
  const unIded = [fakeDev('', 'USB Condenser Mic', 'audioinput', 'g-usb')];
  const resUnIded = reconcileLiveInputsToChannels(slots, unIded, { isStartupSync: true });
  assert.equal(resUnIded.channels[0].hardwareInputId, DEFAULT_FALLBACK_INPUT_ID);
  assert.equal(resUnIded.channels[0].hardwareInputLabel, 'USB Condenser Mic');

  // Case C: Once permissions unlock and real concrete IDs arrive (including VB-Audio Virtual Cable),
  // physical inputs + VB-Cable virtual inputs are both imported as live console channels, while raw Stereo Mix is blocked!
  const concrete = [
    fakeDev('default', 'Default - USB Condenser Mic', 'audioinput', 'g-usb'),
    fakeDev('usb-concrete-001', 'USB Condenser Mic', 'audioinput', 'g-usb'),
    fakeDev('vb-cable-out-001', 'CABLE Output (VB-Audio Virtual Cable)', 'audioinput', 'g-vbcable'),
    fakeDev('hw-loopback', 'Stereo Mix (Realtek)', 'audioinput', 'g-mix'),
  ];
  const resUpgrade = reconcileLiveInputsToChannels(resUnIded.channels, concrete, {
    isStartupSync: false,
  });
  assert.equal(resUpgrade.channels[0].hardwareInputId, 'usb-concrete-001');
  assert.equal(resUpgrade.channels[1].hardwareInputId, 'vb-cable-out-001');
  assert.equal(resUpgrade.channels[1].name, 'VB-Audio Cable');
  assert.equal(resUpgrade.channels[1].role, 'Virtual In');
  assert.equal(resUpgrade.channels[2].hardwareInputId, undefined);

  // Raw motherboard loopbacks excluded, while VB-Cable virtual input is preserved as a first-class input channel
  const dedupedInputs = deduplicateMediaDevices(concrete, 'audioinput', { excludeLoopbacks: true });
  assert.equal(dedupedInputs.some((d) => /stereo mix/i.test(d.label)), false);
  assert.equal(dedupedInputs.some((d) => /vb-audio/i.test(d.label)), true);
}

console.log('2. Testing System Audio Bridge Self-Loopback Firewall...');
{
  const wholeScreenUnsafe = evaluateDesktopLoopbackSafety({
    active: true,
    method: 'display-media',
    displaySurface: 'monitor',
    suppressLocalAudioPlayback: false,
    preferredOutputDeviceId: 'spk-1',
    defaultOutputDeviceId: 'spk-1',
  });
  assert.equal(wholeScreenUnsafe.selfLoopbackBlocked, true);
  assert.equal(wholeScreenUnsafe.loopbackRisk, 'unsafe-shared-bus');

  const tabIsolatedSafe = evaluateDesktopLoopbackSafety({
    active: true,
    method: 'display-media',
    displaySurface: 'browser',
    suppressLocalAudioPlayback: true,
    preferredOutputDeviceId: 'spk-1',
    defaultOutputDeviceId: 'spk-1',
  });
  assert.equal(tabIsolatedSafe.selfLoopbackBlocked, false);
  assert.equal(tabIsolatedSafe.loopbackRisk, 'safe-tab-isolated');

  const wasapiWithIsolationSafe = evaluateDesktopLoopbackSafety({
    active: true,
    method: 'native-wasapi',
    displaySurface: 'wasapi-process-exclusion',
    suppressLocalAudioPlayback: false,
    tauriSourceIsolationActive: true,
    tauriRawOutputActive: false,
    preferredOutputDeviceId: 'spk-1',
    defaultOutputDeviceId: 'spk-1',
  });
  assert.equal(wasapiWithIsolationSafe.selfLoopbackBlocked, false);
}

console.log('3. Testing Worklet 44.1 kHz <-> 48 kHz Linear Resamplers...');
{
  // Load desktop-loopback-worklet.js under 44100 Hz global sampleRate
  let registeredLoopback: { new (): { port: { onmessage: (ev: { data: ArrayBuffer }) => void }; process: (i: unknown, o: Float32Array[][]) => boolean } } | null = null;
  const sandboxA: Record<string, unknown> = {
    sampleRate: 44100,
    Float32Array,
    Math,
    ArrayBuffer,
    AudioWorkletProcessor: class {
      port = { onmessage: null as unknown, postMessage: () => {} };
    },
    registerProcessor: (_name: string, cls: typeof registeredLoopback) => {
      registeredLoopback = cls;
    },
  };
  vm.runInNewContext(fs.readFileSync('./public/desktop-loopback-worklet.js', 'utf8'), sandboxA);
  assert.ok(registeredLoopback);
  const proc = new registeredLoopback!();

  // Feed 4800 frames (100ms @ 48kHz) of 1 kHz sine wave
  const inFrames = 4800;
  const interleaved = new Float32Array(inFrames * 2);
  for (let i = 0; i < inFrames; i++) {
    const v = Math.sin((2 * Math.PI * 1000 * i) / 48000);
    interleaved[i * 2] = v;
    interleaved[i * 2 + 1] = v * 0.5;
  }
  proc.port.onmessage({ data: interleaved.buffer });

  // Render 4410 frames @ 44100 Hz (in 128-frame Web Audio quanta) and count zero crossings -> must equal ~1000 Hz!
  const renderedL = new Float32Array(34 * 128);
  let pos = 0;
  for (let q = 0; q < 34; q++) {
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);
    proc.process([], [[outL, outR]]);
    renderedL.set(outL, pos);
    pos += 128;
  }
  // Check peak energy and frequency after initial frames
  let rms = 0;
  let crossings = 0;
  for (let i = 256; i < renderedL.length; i++) {
    rms += renderedL[i] * renderedL[i];
    if (renderedL[i - 1] < 0 && renderedL[i] >= 0) crossings++;
  }
  rms = Math.sqrt(rms / (renderedL.length - 256));
  const durSec = (renderedL.length - 256) / 44100;
  const estFreq = crossings / durSec;
  assert.ok(rms > 0.65 && rms < 0.75, `Unexpected RMS ${rms}`);
  assert.ok(Math.abs(estFreq - 1000) < 25, `Expected ~1000 Hz resampled sine, got ${estFreq}`);

  // Now test raw-output-tap-worklet.js from 44100 Hz -> 48000 Hz (emits 480-frame 48kHz packets)
  const emitted: Float32Array[] = [];
  let registeredRawTap: { new (): { port: { postMessage: (buf: ArrayBuffer) => void }; process: (i: Float32Array[][], o: Float32Array[][]) => boolean } } | null = null;
  const sandboxB: Record<string, unknown> = {
    sampleRate: 44100,
    Float32Array,
    Math,
    ArrayBuffer,
    AudioWorkletProcessor: class {
      port = {
        onmessage: null as unknown,
        postMessage: (buf: ArrayBuffer) => {
          emitted.push(new Float32Array(buf));
        },
      };
    },
    registerProcessor: (_name: string, cls: typeof registeredRawTap) => {
      registeredRawTap = cls;
    },
  };
  vm.runInNewContext(fs.readFileSync('./public/raw-output-tap-worklet.js', 'utf8'), sandboxB);
  assert.ok(registeredRawTap);
  const rawProc = new registeredRawTap!();

  // Feed 4410 frames @ 44100 Hz of 1 kHz sine (100ms) -> should emit 10 packets of 480 frames (4800 frames @ 48kHz)
  const srcTotal = 4410;
  let offset = 0;
  while (offset < srcTotal) {
    const chunk = Math.min(128, srcTotal - offset);
    const inL = new Float32Array(chunk);
    const inR = new Float32Array(chunk);
    for (let i = 0; i < chunk; i++) {
      const v = Math.sin((2 * Math.PI * 1000 * (offset + i)) / 44100);
      inL[i] = v;
      inR[i] = v;
    }
    rawProc.process([[inL, inR]], [[new Float32Array(chunk), new Float32Array(chunk)]]);
    offset += chunk;
  }
  assert.equal(emitted.length, 10, `Expected 10 packets (4800 frames @ 48kHz), got ${emitted.length}`);
  assert.equal(emitted[0].length, 960);

  // Measure frequency of emitted 48 kHz samples
  const all48L = new Float32Array(4800);
  for (let p = 0; p < emitted.length; p++) {
    for (let i = 0; i < 480; i++) {
      all48L[p * 480 + i] = emitted[p][i * 2];
    }
  }
  let rawCrossings = 0;
  for (let i = 100; i < all48L.length; i++) {
    if (all48L[i - 1] < 0 && all48L[i] >= 0) rawCrossings++;
  }
  const rawFreq = rawCrossings / ((all48L.length - 100) / 48000);
  assert.ok(Math.abs(rawFreq - 1000) < 25, `Expected ~1000 Hz output, got ${rawFreq}`);
}

console.log('4. Testing dB linearity clamping...');
assert.equal(clamp(-60, -48, 6), -48);
assert.ok(Math.abs(dbToLinear(0) - 1) < 1e-6);

console.log('ALL NODE VERIFICATION CHECKS PASSED!');
