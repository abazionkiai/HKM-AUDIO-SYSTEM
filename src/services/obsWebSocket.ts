/**
 * Church Audio Intelligence — OBS Studio v5 WebSocket Client
 * Protocol: obs-websocket protocol v5.x
 * Supports SHA-256 challenge-response authentication, live scene switching,
 * broadcast streaming control, and real-time streaming telemetry.
 */

export interface ObsServerHello {
  obsWebSocketVersion: string;
  rpcVersion: number;
  authentication?: {
    challenge: string;
    salt: string;
  };
}

export interface ObsStreamTelemetry {
  streaming: boolean;
  recording: boolean;
  bitrateKbps: number;
  droppedFrames: number;
  totalFrames: number;
  cpuUsagePct: number;
  fps: number;
  outputTimecode: string;
}

export interface ObsAudioInput {
  inputName: string;
  inputKind: string;
  muted: boolean;
  volumeDb: number;
}

export interface ObsConnectionState {
  connected: boolean;
  connecting: boolean;
  authRequired: boolean;
  error: string | null;
  activeScene: string;
  previewScene: string;
  studioModeEnabled: boolean;
  scenes: string[];
  audioInputs: ObsAudioInput[];
  telemetry: ObsStreamTelemetry;
}

type StateListener = (state: ObsConnectionState) => void;

class ObsWebSocketService {
  private ws: WebSocket | null = null;
  private url: string = 'ws://127.0.0.1:4455';
  private password: string = 'UAebSZ237i37R0ub';
  private pendingRequests = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (err: Error) => void }
  >();
  private pollTimer: number | null = null;
  private autoReconnect: boolean = true;
  private reconnectTimer: number | null = null;
  private reconnectAttempts: number = 0;
  private listeners = new Set<StateListener>();

  private state: ObsConnectionState = {
    connected: false,
    connecting: false,
    authRequired: false,
    error: null,
    activeScene: 'Pre-Service Countdown',
    previewScene: 'Worship Full Band',
    studioModeEnabled: false,
    scenes: [
      'Pre-Service Countdown',
      'Worship Full Band',
      'Sanctuary Wide + Preacher',
      'Pulpit Close-Up',
    ],
    audioInputs: [],
    telemetry: {
      streaming: false,
      recording: false,
      bitrateKbps: 0,
      droppedFrames: 0,
      totalFrames: 0,
      cpuUsagePct: 0,
      fps: 0,
      outputTimecode: '00:00:00',
    },
  };

  constructor() {
    try {
      const savedUrl = window.localStorage.getItem('church_audio_obs_url');
      if (savedUrl) this.url = savedUrl;
      const savedPass = window.localStorage.getItem('church_audio_obs_password');
      if (savedPass !== null) this.password = savedPass;
    } catch {
      // LocalStorage unavailable in sandbox
    }
  }

  public getState(): ObsConnectionState {
    return this.state;
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private updateState(patch: Partial<ObsConnectionState>) {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  public setConfig(url: string, password?: string) {
    this.url = url.trim() || 'ws://127.0.0.1:4455';
    if (password !== undefined) this.password = password;
    try {
      window.localStorage.setItem('church_audio_obs_url', this.url);
      window.localStorage.setItem('church_audio_obs_password', this.password);
    } catch {
      // Ignore storage errors
    }
  }

  public getConfig(): { url: string; password: string } {
    return { url: this.url, password: this.password };
  }

  /**
   * Connect to OBS Studio WebSocket server v5
   */
  public connect(url?: string, password?: string) {
    if (url || password !== undefined) {
      this.setConfig(url || this.url, password);
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.clearTimers();
    this.updateState({ connecting: true, error: null });

    try {
      const socket = new WebSocket(this.url);
      this.ws = socket;

      const connectTimeout = window.setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          socket.close();
          this.handleDisconnect('Connection timeout. OBS Studio WebSocket did not respond.');
        }
      }, 3500);

      socket.onopen = () => {
        window.clearTimeout(connectTimeout);
        // Do not mark connected yet; wait for OpCode 0 (Hello) & OpCode 2 (Identified)
      };

      socket.onmessage = async (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          await this.handleMessage(payload);
        } catch (e) {
          console.warn('[OBS WS] Message parse error:', e);
        }
      };

      socket.onerror = () => {
        window.clearTimeout(connectTimeout);
      };

      socket.onclose = (evt) => {
        window.clearTimeout(connectTimeout);
        const code = evt.code;
        let reason = 'Connection closed.';
        if (code === 4008) {
          reason = 'Authentication failed. Please verify the OBS WebSocket password.';
          this.updateState({ authRequired: true });
        } else if (code === 4005) {
          reason = 'OBS requires authentication. Please enter your OBS WebSocket password.';
          this.updateState({ authRequired: true });
        } else if (code === 1006) {
          reason = `Unable to reach OBS Studio at ${this.url}. Please ensure OBS Studio is open.`;
        }
        this.handleDisconnect(reason);
      };
    } catch (err) {
      this.handleDisconnect(`Invalid WebSocket URL: ${this.url} (${err})`);
    }
  }

  public disconnect() {
    this.autoReconnect = false;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close(1000, 'User disconnected');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.updateState({
      connected: false,
      connecting: false,
      error: null,
      telemetry: {
        ...this.state.telemetry,
        streaming: false,
        recording: false,
        bitrateKbps: 0,
      },
    });
  }

  private handleDisconnect(errorMsg: string) {
    this.ws = null;
    this.clearTimers();
    this.updateState({
      connected: false,
      connecting: false,
      error: errorMsg,
      telemetry: {
        ...this.state.telemetry,
        streaming: false,
        recording: false,
        bitrateKbps: 0,
      },
    });

    if (this.autoReconnect && this.reconnectAttempts < 5) {
      this.reconnectAttempts++;
      const delay = Math.min(10000, 1500 * this.reconnectAttempts);
      this.reconnectTimer = window.setTimeout(() => {
        this.connect();
      }, delay);
    }
  }

  private clearTimers() {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async handleMessage(msg: { op: number; d: any }) {
    const { op, d } = msg;

    // OpCode 0: Hello from OBS
    if (op === 0) {
      await this.handleHello(d as ObsServerHello);
      return;
    }

    // OpCode 2: Identified (Handshake complete)
    if (op === 2) {
      this.reconnectAttempts = 0;
      this.updateState({
        connected: true,
        connecting: false,
        authRequired: false,
        error: null,
      });
      await this.syncInitialObsState();
      this.startPolling();
      return;
    }

    // OpCode 5: Event from OBS
    if (op === 5) {
      this.handleEvent(d);
      return;
    }

    // OpCode 7: RequestResponse
    if (op === 7) {
      const { requestId, requestStatus, responseData } = d;
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        this.pendingRequests.delete(requestId);
        if (requestStatus?.result) {
          pending.resolve(responseData);
        } else {
          pending.reject(new Error(requestStatus?.comment || 'Request rejected by OBS'));
        }
      }
      return;
    }
  }

  private async handleHello(hello: ObsServerHello) {
    let authResponse: string | undefined = undefined;

    if (hello.authentication) {
      this.updateState({ authRequired: true });
      if (!this.password) {
        this.handleDisconnect('OBS WebSocket requires a password. Please enter your password above.');
        return;
      }
      authResponse = await this.generateAuthResponse(
        this.password,
        hello.authentication.salt,
        hello.authentication.challenge
      );
    }

    // Send OpCode 1: Identify
    const identifyPayload: Record<string, unknown> = {
      rpcVersion: 1,
      // Subscriptions: General (1) + Config (2) + Scenes (4) + Outputs (64) = 71
      eventSubscriptions: 71,
    };
    if (authResponse) {
      identifyPayload.authentication = authResponse;
    }

    this.send(1, identifyPayload);
  }

  /**
   * OBS WebSocket v5 standard SHA-256 challenge response formula:
   * 1. secret = base64(sha256(password + salt))
   * 2. authResponse = base64(sha256(secret + challenge))
   */
  private async generateAuthResponse(password: string, salt: string, challenge: string): Promise<string> {
    const enc = new TextEncoder();

    // Step 1: Hash password + salt
    const hash1Buf = await crypto.subtle.digest('SHA-256', enc.encode(password + salt));
    const hash1Bytes = new Uint8Array(hash1Buf);
    let hash1Binary = '';
    for (let i = 0; i < hash1Bytes.length; i++) {
      hash1Binary += String.fromCharCode(hash1Bytes[i]);
    }
    const base64Secret = btoa(hash1Binary);

    // Step 2: Hash base64Secret + challenge
    const hash2Buf = await crypto.subtle.digest('SHA-256', enc.encode(base64Secret + challenge));
    const hash2Bytes = new Uint8Array(hash2Buf);
    let hash2Binary = '';
    for (let i = 0; i < hash2Bytes.length; i++) {
      hash2Binary += String.fromCharCode(hash2Bytes[i]);
    }
    return btoa(hash2Binary);
  }

  private send(op: number, d: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }));
    }
  }

  public sendRequest<T = any>(requestType: string, requestData?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('OBS Studio is not connected.'));
      }
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      this.pendingRequests.set(requestId, {
        resolve: resolve as (data: unknown) => void,
        reject,
      });

      this.send(6, {
        requestType,
        requestId,
        requestData: requestData || {},
      });

      // Request timeout after 4 seconds
      window.setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`OBS request ${requestType} timed out.`));
        }
      }, 4000);
    });
  }

  private handleEvent(evt: { eventType: string; eventData: any }) {
    const { eventType, eventData } = evt;

    if (eventType === 'CurrentProgramSceneChanged') {
      const sceneName = eventData?.sceneName;
      if (sceneName) {
        this.updateState({ activeScene: sceneName });
      }
    } else if (eventType === 'SceneListChanged') {
      this.syncSceneList();
    } else if (eventType === 'StreamStateChanged') {
      const active = Boolean(eventData?.outputActive);
      this.updateState({
        telemetry: {
          ...this.state.telemetry,
          streaming: active,
        },
      });
    } else if (eventType === 'RecordStateChanged') {
      const active = Boolean(eventData?.outputActive);
      this.updateState({
        telemetry: {
          ...this.state.telemetry,
          recording: active,
        },
      });
    }
  }

  public async syncInitialObsState() {
    await Promise.allSettled([
      this.syncSceneList(),
      this.syncStreamStatus(),
      this.syncRecordStatus(),
      this.syncStudioMode(),
      this.syncAudioInputs(),
      this.syncStats(),
    ]);
  }

  public async syncSceneList() {
    try {
      const data = await this.sendRequest<{
        currentProgramSceneName: string;
        scenes: { sceneName: string; sceneIndex: number }[];
      }>('GetSceneList');

      if (data && Array.isArray(data.scenes)) {
        const sceneNames = data.scenes.map((s) => s.sceneName).reverse();
        this.updateState({
          scenes: sceneNames.length > 0 ? sceneNames : this.state.scenes,
          activeScene: data.currentProgramSceneName || this.state.activeScene,
        });
      }
    } catch (e) {
      console.warn('[OBS WS] Failed to sync scene list:', e);
    }
  }

  public async syncStreamStatus() {
    try {
      const status = await this.sendRequest<{
        outputActive: boolean;
        outputTimecode: string;
        outputBytes: number;
        outputSkippedFrames: number;
        outputTotalFrames: number;
        outputCongestion: number;
      }>('GetStreamStatus');

      if (status) {
        const kbps = status.outputActive && status.outputTotalFrames > 0
          ? Math.round((status.outputBytes * 8) / 1000 / Math.max(1, status.outputTotalFrames / 30))
          : 0;

        this.updateState({
          telemetry: {
            ...this.state.telemetry,
            streaming: status.outputActive,
            outputTimecode: status.outputTimecode || '00:00:00',
            droppedFrames: status.outputSkippedFrames || 0,
            totalFrames: status.outputTotalFrames || 0,
            bitrateKbps: kbps > 0 ? kbps : status.outputActive ? 4500 : 0,
          },
        });
      }
    } catch {
      // Stream output may be idle
    }
  }

  public async syncStats() {
    try {
      const stats = await this.sendRequest<{
        cpuUsage: number;
        activeFps: number;
      }>('GetStats');

      if (stats) {
        this.updateState({
          telemetry: {
            ...this.state.telemetry,
            cpuUsagePct: Math.round(stats.cpuUsage || 0),
            fps: Math.round(stats.activeFps || 0),
          },
        });
      }
    } catch {
      // ignore
    }
  }

  private startPolling() {
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(() => {
      if (this.state.connected) {
        this.syncStreamStatus();
        this.syncStats();
      }
    }, 1800);
  }

  // --- Public Control APIs ---

  public async setProgramScene(sceneName: string): Promise<boolean> {
    try {
      await this.sendRequest('SetCurrentProgramScene', { sceneName });
      this.updateState({ activeScene: sceneName });
      return true;
    } catch (err) {
      console.error('[OBS WS] Failed to switch scene:', err);
      return false;
    }
  }

  public async startStream(): Promise<boolean> {
    try {
      await this.sendRequest('StartStream');
      this.updateState({
        telemetry: { ...this.state.telemetry, streaming: true },
      });
      return true;
    } catch (err) {
      console.error('[OBS WS] Failed to start stream:', err);
      return false;
    }
  }

  public async stopStream(): Promise<boolean> {
    try {
      await this.sendRequest('StopStream');
      this.updateState({
        telemetry: { ...this.state.telemetry, streaming: false, bitrateKbps: 0 },
      });
      return true;
    } catch (err) {
      console.error('[OBS WS] Failed to stop stream:', err);
      return false;
    }
  }

  public async toggleStream(): Promise<boolean> {
    if (this.state.telemetry.streaming) {
      return this.stopStream();
    } else {
      return this.startStream();
    }
  }

  public async syncRecordStatus() {
    try {
      const rec = await this.sendRequest<{ outputActive: boolean }>('GetRecordStatus');
      if (rec) {
        this.updateState({
          telemetry: { ...this.state.telemetry, recording: rec.outputActive },
        });
      }
    } catch {
      // ignore
    }
  }

  public async toggleRecord(): Promise<boolean> {
    try {
      const res = await this.sendRequest<{ outputActive: boolean }>('ToggleRecord');
      this.updateState({
        telemetry: { ...this.state.telemetry, recording: Boolean(res?.outputActive) },
      });
      return true;
    } catch (err) {
      console.error('[OBS WS] Failed to toggle recording:', err);
      return false;
    }
  }

  public async syncStudioMode() {
    try {
      const res = await this.sendRequest<{ studioModeEnabled: boolean }>('GetStudioModeEnabled');
      const enabled = Boolean(res?.studioModeEnabled);
      let previewScene = this.state.previewScene;
      if (enabled) {
        const prevRes = await this.sendRequest<{ currentPreviewSceneName: string }>(
          'GetCurrentPreviewScene'
        );
        if (prevRes?.currentPreviewSceneName) previewScene = prevRes.currentPreviewSceneName;
      }
      this.updateState({ studioModeEnabled: enabled, previewScene });
    } catch {
      // ignore
    }
  }

  public async toggleStudioMode(): Promise<boolean> {
    try {
      const next = !this.state.studioModeEnabled;
      await this.sendRequest('SetStudioModeEnabled', { studioModeEnabled: next });
      this.updateState({ studioModeEnabled: next });
      if (next) await this.syncStudioMode();
      return true;
    } catch (err) {
      console.error('[OBS WS] Failed to toggle studio mode:', err);
      return false;
    }
  }

  public async setPreviewScene(sceneName: string): Promise<boolean> {
    try {
      await this.sendRequest('SetCurrentPreviewScene', { sceneName });
      this.updateState({ previewScene: sceneName });
      return true;
    } catch {
      return false;
    }
  }

  public async triggerTransition(): Promise<boolean> {
    try {
      await this.sendRequest('TriggerStudioModeTransition');
      await this.syncSceneList();
      return true;
    } catch {
      return false;
    }
  }

  public async syncAudioInputs() {
    try {
      const list = await this.sendRequest<{
        inputs: { inputName: string; inputKind: string }[];
      }>('GetInputList');
      if (!list?.inputs) return;

      const audioList: ObsAudioInput[] = [];
      for (const inp of list.inputs) {
        try {
          const [volRes, muteRes] = await Promise.all([
            this.sendRequest<{ inputVolumeDb: number }>('GetInputVolume', {
              inputName: inp.inputName,
            }),
            this.sendRequest<{ inputMuted: boolean }>('GetInputMute', {
              inputName: inp.inputName,
            }),
          ]);
          audioList.push({
            inputName: inp.inputName,
            inputKind: inp.inputKind,
            muted: Boolean(muteRes?.inputMuted),
            volumeDb: typeof volRes?.inputVolumeDb === 'number' ? Number(volRes.inputVolumeDb.toFixed(1)) : 0,
          });
        } catch {
          // Non-audio inputs (e.g. image/color source) throw GetInputVolume unsupported
        }
      }
      this.updateState({ audioInputs: audioList });
    } catch {
      // ignore
    }
  }

  public async setInputMute(inputName: string, muted: boolean): Promise<boolean> {
    try {
      await this.sendRequest('SetInputMute', { inputName, inputMuted: muted });
      this.updateState({
        audioInputs: this.state.audioInputs.map((a) =>
          a.inputName === inputName ? { ...a, muted } : a
        ),
      });
      return true;
    } catch {
      return false;
    }
  }

  public async setInputVolumeDb(inputName: string, volumeDb: number): Promise<boolean> {
    try {
      await this.sendRequest('SetInputVolume', { inputName, inputVolumeDb: volumeDb });
      this.updateState({
        audioInputs: this.state.audioInputs.map((a) =>
          a.inputName === inputName ? { ...a, volumeDb } : a
        ),
      });
      return true;
    } catch {
      return false;
    }
  }

  public async setInputAudioSyncOffset(inputName: string, offsetMs: number): Promise<boolean> {
    try {
      await this.sendRequest('SetInputAudioSyncOffset', {
        inputName,
        inputAudioSyncOffset: Math.round(offsetMs),
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const obsWsService = new ObsWebSocketService();
