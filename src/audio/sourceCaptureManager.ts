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
  private desktopWorkletCtx: AudioContext | null = null;
  private syncQueuePromise: Promise<void> = Promise.resolve();
  private captureEpoch = 0;

  private activeInputLabel: string | null = null;
  private activeDisplaySurface: string | null = null;
  private activeSuppressLocalPlayback = false;
  private onSourceEndedCb: (() => void) | null = null;
  private onInputsUnlockedCb: (() => void) | null = null;

  public setOnSourceEnded(cb: (() => void) | null): void {
    this.onSourceEndedCb = cb;
  }

  public setOnInputsUnlocked(cb: (() => void) | null): void {
    this.onInputsUnlockedCb = cb;
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
    if (this.desktopWorkletCtx !== ctx || !this.desktopWorkletPromise) {
      this.desktopWorkletCtx = ctx;
      this.desktopWorkletPromise = ctx.audioWorklet.addModule('/desktop-loopback-worklet.js');
    }
    await this.desktopWorkletPromise;
  }

  private async openHardwareMicStream(targetDevId: string): Promise<MediaStream> {
    const baseConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
    };

    if (!targetDevId || targetDevId === 'default') {
      return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: { exact: targetDevId },
        },
      });
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      if (errName === 'OverconstrainedError' || errName === 'NotFoundError') {
        // Retry clean OS default microphone when a persisted deviceId rotated across sessions
        return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
      }
      throw err;
    }
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
    const epoch = this.captureEpoch;
    const pending = this.syncQueuePromise.then(() =>
      this.applyBindings(ctx, epoch, isRunning, sourceMode, channels, stripBank)
    );
    this.syncQueuePromise = pending.catch(() => {});
    return pending;
  }

  private async applyBindings(
    ctx: AudioContext | null,
    epoch: number,
    isRunning: boolean,
    sourceMode: AudioSourceSimulation,
    channels: InputChannel[],
    stripBank: ChannelStripBank
  ): Promise<void> {
    if (!ctx || !isRunning || sourceMode !== 'live-mic' || epoch !== this.captureEpoch) return;

    stripBank.ensureStrips(Math.max(8, channels.length));
    stripBank.applyChannels(channels, sourceMode);

    const activeLabels: string[] = [];
    const totalStrips = stripBank.getStripCount();
    let unlockedPermissionDuringBind = false;
    let lastMicError: unknown = null;

    for (let i = 0; i < totalStrips; i++) {
      if (epoch !== this.captureEpoch) return;

      const ch = channels[i];
      const rawDevId = ch?.hardwareInputId || '';
      const targetDevId = !rawDevId || rawDevId === 'none' || rawDevId === 'communications' ? '' : rawDevId;
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
                if (epoch !== this.captureEpoch || this.stripDeviceBindings.get(i) !== targetDevId) {
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

                if (epoch !== this.captureEpoch || this.stripDeviceBindings.get(i) !== targetDevId) {
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
              activeLabels.push(ch?.hardwareInputLabel || 'Desktop Audio');
            } else {
              stripBank.setStripActiveConnection(i, false);
            }
          } else {
            let entry = this.deviceStreams.get(targetDevId);

            if (!entry && strip) {
              try {
                const stream = await this.openHardwareMicStream(targetDevId);

                if (epoch !== this.captureEpoch || this.stripDeviceBindings.get(i) !== targetDevId) {
                  stream.getTracks().forEach((t) => t.stop());
                  continue;
                }

                if (targetDevId === 'default') {
                  unlockedPermissionDuringBind = true;
                }

                const node = ctx.createMediaStreamSource(stream);
                entry = { stream, node, strips: new Set() };
                this.deviceStreams.set(targetDevId, entry);
              } catch (err) {
                this.stripDeviceBindings.delete(i);
                lastMicError = err;
                console.warn(`Failed to open dedicated stereo stream for CH${i + 1}:`, err);
              }
            }

            if (entry && strip) {
              entry.node.connect(strip.preampGain);
              entry.strips.add(i);
              stripBank.setStripActiveConnection(i, true);
              const trackLabel = entry.stream.getAudioTracks()[0]?.label;
              activeLabels.push(ch?.hardwareInputLabel || trackLabel || `Input ${i + 1}`);
            } else {
              stripBank.setStripActiveConnection(i, false);
            }
          }
        } else {
          stripBank.setStripActiveConnection(i, false);
        }
      } else if (targetDevId) {
        const hasStream = isNativeDesktopInputId(targetDevId)
          ? this.nativeStreams.has(targetDevId)
          : this.deviceStreams.has(targetDevId);
        if (hasStream) {
          activeLabels.push(ch?.hardwareInputLabel || `Input ${i + 1}`);
        }
      }
    }

    if (epoch !== this.captureEpoch) return;

    // If zero streams opened despite live-mic mode (e.g. first run before mic permission unlock),
    // acquire default microphone onto CH1 and notify caller to refresh concrete device labels.
    if (this.deviceStreams.size === 0 && this.nativeStreams.size === 0) {
      if (lastMicError && channels.some((c) => Boolean(c.hardwareInputId))) {
        throw lastMicError instanceof Error
          ? lastMicError
          : new Error('Unable to access any microphone input.');
      }

      const strip0 = stripBank.getStrip(0);
      if (strip0 && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function') {
        const fallbackStream = await this.openHardwareMicStream('default');
        if (epoch !== this.captureEpoch) {
          fallbackStream.getTracks().forEach((t) => t.stop());
          return;
        }
        const fallbackNode = ctx.createMediaStreamSource(fallbackStream);
        const fallbackEntry = {
          stream: fallbackStream,
          node: fallbackNode,
          strips: new Set<number>([0]),
        };
        this.deviceStreams.set('default', fallbackEntry);
        this.stripDeviceBindings.set(0, 'default');
        fallbackNode.connect(strip0.preampGain);
        stripBank.setStripActiveConnection(0, true);
        const trackLabel = fallbackStream.getAudioTracks()[0]?.label || 'Default Audio Input';
        activeLabels.push(trackLabel);
        unlockedPermissionDuringBind = true;
      }
    }

    if (unlockedPermissionDuringBind) {
      this.onInputsUnlockedCb?.();
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

    const epoch = ++this.captureEpoch;
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
        if (epoch !== this.captureEpoch) return {};
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
        if (epoch !== this.captureEpoch) {
          workletNode.disconnect();
          void stopNativeDesktopCapture(streamKey);
          return {};
        }
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

      if (epoch !== this.captureEpoch) {
        acquired.stream.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
        return {};
      }

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
      await this.applyBindings(ctx, epoch, true, 'live-mic', channels, stripBank);
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
    this.captureEpoch += 1;

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
