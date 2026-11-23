import type { AudioSourceSimulation, InputChannel } from '../types/audio.ts';
import { isNativeDesktopInputId } from '../utils/audioNaming.ts';
import { isDesktopApp } from '../utils/appApi.ts';
import {
  parseNativeAppPid,
  startNativeDesktopCapture,
  stopAllNativeDesktopCaptures,
  stopNativeDesktopCapture,
} from '../utils/nativeDesktopAudio.ts';
import { createCalibratedPinkNoiseBuffer } from './audioUtils.ts';
import type { ChannelStripBank } from './channelStripBank.ts';
import {
  acquireSystemAudioStream,
  type SystemAudioCaptureMethod,
} from './systemAudioBridge.ts';

export interface ActiveBridgeMetadata {
  displaySurface: string | null;
  suppressLocalAudioPlayback: boolean;
  inputLabel: string | null;
  methodUsed: SystemAudioCaptureMethod;
}

/**
 * Manages audio input source acquisition & 1-to-1 per-strip hardware bindings:
 *   - 'live-mic': 1-to-1 collision-free getUserMedia / Tauri per-app WASAPI capture
 *   - 'desktop-audio': WASAPI Process-Exclusion | getDisplayMedia | Specialized Virtual Interface
 *   - 'pink-noise': Calibrated -20 dBFS stereo pink noise generator
 */
export class SourceCaptureManager {
  private sourceNodes: AudioNode[] = [];
  private activeStream: MediaStream | null = null;
  private deviceStreams = new Map<
    string,
    { stream: MediaStream; node: MediaStreamAudioSourceNode; strips: Set<number> }
  >();
  private nativeStreams = new Map<
    string,
    { node: AudioWorkletNode; strips: Set<number>; streamKey: string }
  >();
  private stripDeviceBindings = new Map<number, string>();
  private desktopWorkletPromise: Promise<void> | null = null;
  private syncQueuePromise: Promise<void> = Promise.resolve();

  private activeInputLabel: string | null = null;
  private activeDisplaySurface: string | null = null;
  private activeSuppressLocalPlayback = false;
  private onSourceEndedCb: (() => void) | null = null;

  public setOnSourceEnded(cb: (() => void) | null): void {
    this.onSourceEndedCb = cb;
  }

  public getActiveInputLabel(): string | null {
    return this.activeInputLabel;
  }

  public getActiveDisplaySurface(): string | null {
    return this.activeDisplaySurface;
  }

  public getActiveSuppressLocalPlayback(): boolean {
    return this.activeSuppressLocalPlayback;
  }

  private async ensureDesktopWorklet(ctx: AudioContext): Promise<void> {
    if (!this.desktopWorkletPromise) {
      this.desktopWorkletPromise = ctx.audioWorklet.addModule('/desktop-loopback-worklet.js');
    }
    await this.desktopWorkletPromise;
  }

  private unbindStripDevice(stripIndex: number, stripBank: ChannelStripBank): void {
    stripBank.setStripActiveConnection(stripIndex, false);
    const prevId = this.stripDeviceBindings.get(stripIndex);
    const strip = stripBank.getStrip(stripIndex);
    if (!prevId) return;

    this.stripDeviceBindings.delete(stripIndex);

    const nativeEntry = this.nativeStreams.get(prevId);
    if (nativeEntry) {
      nativeEntry.strips.delete(stripIndex);
      if (strip) {
        try {
          nativeEntry.node.disconnect(strip.preampGain);
        } catch {
          // ignore disconnect mismatch
        }
      }
      if (nativeEntry.strips.size === 0) {
        try {
          nativeEntry.node.disconnect();
        } catch {
          // ignore
        }
        this.nativeStreams.delete(prevId);
        void stopNativeDesktopCapture(nativeEntry.streamKey);
      }
      return;
    }

    const entry = this.deviceStreams.get(prevId);
    if (!entry) return;

    entry.strips.delete(stripIndex);
    if (strip) {
      try {
        entry.node.disconnect(strip.preampGain);
      } catch {
        // ignore
      }
    }

    if (entry.strips.size === 0) {
      try {
        entry.node.disconnect();
        entry.stream.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
      } catch {
        // ignore
      }
      this.deviceStreams.delete(prevId);
    }
  }

  public syncChannelHardwareInputs(
    ctx: AudioContext | null,
    isRunning: boolean,
    sourceMode: AudioSourceSimulation,
    channels: InputChannel[],
    stripBank: ChannelStripBank
  ): Promise<void> {
    const pending = this.syncQueuePromise.then(() =>
      this.applyBindings(ctx, isRunning, sourceMode, channels, stripBank)
    );
    this.syncQueuePromise = pending.catch(() => {});
    return pending;
  }

  private async applyBindings(
    ctx: AudioContext | null,
    isRunning: boolean,
    sourceMode: AudioSourceSimulation,
    channels: InputChannel[],
    stripBank: ChannelStripBank
  ): Promise<void> {
    if (!ctx || !isRunning || sourceMode !== 'live-mic') return;

    stripBank.ensureStrips(Math.max(8, channels.length));
    stripBank.applyChannels(channels, sourceMode);

    const activeLabels: string[] = [];
    const totalStrips = stripBank.getStripCount();

    for (let i = 0; i < totalStrips; i++) {
      const ch = channels[i];
      const rawDevId = ch?.hardwareInputId || '';
      const targetDevId =
        !rawDevId || rawDevId === 'none' || rawDevId === 'default' || rawDevId === 'communications'
          ? ''
          : rawDevId;
      const currentDevId = this.stripDeviceBindings.get(i) || '';

      if (targetDevId !== currentDevId) {
        this.unbindStripDevice(i, stripBank);

        if (targetDevId) {
          this.stripDeviceBindings.set(i, targetDevId);
          const strip = stripBank.getStrip(i);

          if (isNativeDesktopInputId(targetDevId)) {
            let nativeEntry = this.nativeStreams.get(targetDevId);
            if (!nativeEntry && strip) {
              try {
                await this.ensureDesktopWorklet(ctx);
                if (this.stripDeviceBindings.get(i) !== targetDevId || !isRunning) {
                  continue;
                }
                const workletNode = new AudioWorkletNode(ctx, 'desktop-loopback-processor', {
                  numberOfInputs: 0,
                  numberOfOutputs: 1,
                  outputChannelCount: [2],
                });
                const targetPid = parseNativeAppPid(targetDevId);
                await startNativeDesktopCapture(targetDevId, targetPid, (buf) => {
                  try {
                    workletNode.port.postMessage(buf, [buf]);
                  } catch {
                    // ignore closed port
                  }
                });

                if (this.stripDeviceBindings.get(i) !== targetDevId || !isRunning) {
                  workletNode.disconnect();
                  void stopNativeDesktopCapture(targetDevId);
                  continue;
                }

                nativeEntry = { node: workletNode, strips: new Set(), streamKey: targetDevId };
                this.nativeStreams.set(targetDevId, nativeEntry);
              } catch (err) {
                this.stripDeviceBindings.delete(i);
                const message = `Could not start desktop audio capture for CH${i + 1}: ${
                  err instanceof Error ? err.message : String(err)
                }`;
                console.error(message, err);
                throw new Error(message);
              }
            }

            if (nativeEntry && strip) {
              nativeEntry.node.connect(strip.preampGain);
              nativeEntry.strips.add(i);
              stripBank.setStripActiveConnection(i, true);
            } else {
              stripBank.setStripActiveConnection(i, false);
            }
          } else {
            let entry = this.deviceStreams.get(targetDevId);

            if (!entry && strip) {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({
                  audio: {
                    deviceId: { exact: targetDevId },
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: { ideal: 2 },
                    sampleRate: { ideal: 48000 },
                  },
                });

                if (this.stripDeviceBindings.get(i) !== targetDevId || !isRunning) {
                  stream.getTracks().forEach((t) => t.stop());
                  continue;
                }

                const node = ctx.createMediaStreamSource(stream);
                entry = { stream, node, strips: new Set() };
                this.deviceStreams.set(targetDevId, entry);
              } catch (err) {
                this.stripDeviceBindings.delete(i);
                console.warn(`Failed to open dedicated stereo stream for CH${i + 1}:`, err);
              }
            }

            if (entry && strip) {
              entry.node.connect(strip.preampGain);
              entry.strips.add(i);
              stripBank.setStripActiveConnection(i, true);
            } else {
              stripBank.setStripActiveConnection(i, false);
            }
          }
        } else {
          stripBank.setStripActiveConnection(i, false);
        }
      }

      if (targetDevId && ch?.hardwareInputLabel) {
        activeLabels.push(ch.hardwareInputLabel);
      }
    }

    if (activeLabels.length === 1) {
      this.activeInputLabel = activeLabels[0];
    } else if (activeLabels.length > 1) {
      this.activeInputLabel = `${activeLabels.length} Live Stereo Inputs`;
    } else {
      this.activeInputLabel = 'Ready — Assign or Scan Live Inputs';
    }
  }

  public async setupSource(params: {
    ctx: AudioContext;
    mode: AudioSourceSimulation;
    channels: InputChannel[];
    stripBank: ChannelStripBank;
    desktopCaptureMethod: SystemAudioCaptureMethod;
    specializedDesktopDeviceId: string | null;
    specializedDesktopLabel: string | null;
  }): Promise<{ methodUsed?: SystemAudioCaptureMethod }> {
    const {
      ctx,
      mode,
      channels,
      stripBank,
      desktopCaptureMethod,
      specializedDesktopDeviceId,
      specializedDesktopLabel,
    } = params;

    stripBank.ensureStrips(Math.max(8, channels.length));

    if (mode === 'desktop-audio') {
      // Strictly isolate desktop-audio source onto strip 0, closing all physical mic strips
      for (let i = 0; i < stripBank.getStripCount(); i++) {
        this.unbindStripDevice(i, stripBank);
        stripBank.setStripActiveConnection(i, i === 0);
      }

      const strip0 = stripBank.getStrip(0);
      if (!strip0) {
        throw new Error('Channel strip 0 failed to initialize.');
      }

      if (desktopCaptureMethod === 'native-wasapi' && isDesktopApp()) {
        await this.ensureDesktopWorklet(ctx);
        const workletNode = new AudioWorkletNode(ctx, 'desktop-loopback-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        const streamKey = 'bridge-native-desktop-audio';
        await startNativeDesktopCapture(streamKey, null, (buf) => {
          try {
            workletNode.port.postMessage(buf, [buf]);
          } catch {
            // ignore
          }
        });
        this.nativeStreams.set(streamKey, {
          node: workletNode,
          strips: new Set([0]),
          streamKey,
        });
        workletNode.connect(strip0.preampGain);
        this.activeDisplaySurface = 'wasapi-process-exclusion';
        this.activeSuppressLocalPlayback = false;
        this.activeInputLabel = 'System Audio Bridge (WASAPI Process-Exclusion)';
        return { methodUsed: 'native-wasapi' };
      }

      const methodToUse: SystemAudioCaptureMethod =
        desktopCaptureMethod === 'specialized-interface' && specializedDesktopDeviceId
          ? 'specialized-interface'
          : 'display-media';

      const acquired = await acquireSystemAudioStream({
        method: methodToUse,
        specializedDeviceId: specializedDesktopDeviceId,
        specializedLabel: specializedDesktopLabel,
      });

      this.activeStream = acquired.stream;
      this.activeDisplaySurface = acquired.displaySurface;
      this.activeSuppressLocalPlayback = acquired.suppressLocalAudioPlayback;
      this.activeInputLabel = acquired.label;

      const audioTrack = acquired.stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          this.onSourceEndedCb?.();
        };
      }

      const desktopNode = ctx.createMediaStreamSource(acquired.stream);
      desktopNode.connect(strip0.preampGain);
      this.sourceNodes.push(desktopNode);
      return { methodUsed: methodToUse };
    }

    if (mode === 'live-mic') {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Browser mediaDevices.getUserMedia is unavailable in this environment.');
      }
      await this.applyBindings(ctx, true, 'live-mic', channels, stripBank);
      return {};
    }

    // Calibrated -20 dBFS stereo pink noise generator onto Strip 0 (disconnecting all physical mics)
    for (let i = 0; i < stripBank.getStripCount(); i++) {
      this.unbindStripDevice(i, stripBank);
      stripBank.setStripActiveConnection(i, i === 0);
    }

    const strip0 = stripBank.getStrip(0);
    if (!strip0) {
      throw new Error('Channel strip 0 failed to initialize.');
    }

    const noiseBuffer = createCalibratedPinkNoiseBuffer(ctx, 2);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;

    const calGain = ctx.createGain();
    calGain.gain.value = 0.85;
    calGain.channelCount = 2;
    calGain.channelCountMode = 'explicit';
    calGain.channelInterpretation = 'speakers';

    noiseSrc.connect(calGain);
    calGain.connect(strip0.preampGain);
    noiseSrc.start();

    this.sourceNodes.push(noiseSrc, calGain);
    this.activeDisplaySurface = null;
    this.activeSuppressLocalPlayback = false;
    this.activeInputLabel = 'Calibration: Pink Noise (-20 dBFS)';
    return {};
  }

  public teardown(stripBank: ChannelStripBank): void {
    for (const node of this.sourceNodes) {
      try {
        node.disconnect();
        if ('stop' in node && typeof (node as AudioBufferSourceNode).stop === 'function') {
          (node as AudioBufferSourceNode).stop();
        }
      } catch {
        // ignore stopped nodes
      }
    }
    this.sourceNodes = [];

    for (const [, entry] of this.deviceStreams) {
      try {
        entry.node.disconnect();
        entry.stream.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
      } catch {
        // ignore
      }
    }
    this.deviceStreams.clear();

    for (const [, entry] of this.nativeStreams) {
      try {
        entry.node.disconnect();
      } catch {
        // ignore
      }
    }
    this.nativeStreams.clear();
    void stopAllNativeDesktopCaptures();

    this.stripDeviceBindings.clear();

    for (let i = 0; i < stripBank.getStripCount(); i++) {
      stripBank.setStripActiveConnection(i, false);
    }

    if (this.activeStream) {
      this.activeStream.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      this.activeStream = null;
    }

    this.activeInputLabel = null;
    this.activeDisplaySurface = null;
    this.activeSuppressLocalPlayback = false;
  }
}
