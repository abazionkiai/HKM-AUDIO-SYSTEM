import { Router } from 'express';
import { audioDb, type PersistedState } from '../db.ts';
import { clients, broadcast } from '../ws.ts';
import { listLanInterfaces } from '../config.ts';

export const stateRouter = Router();

stateRouter.get('/health', (_req, res) => {
  const dbStats = audioDb.getStats();
  res.json({
    status: 'ok',
    engine: 'Church Audio Intelligence Control Plane',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    storage: dbStats.engine,
    dbStats,
    wsClients: clients.size,
  });
});

stateRouter.get('/network/interfaces', (req, res) => {
  const port = Number(req.app.get('port') ?? 3030);
  res.json({ interfaces: listLanInterfaces(port) });
});

stateRouter.get('/state', (_req, res) => {
  const state = audioDb.ensureStore();
  res.json(state);
});

stateRouter.put('/state/sync', (req, res) => {
  const state = audioDb.ensureStore();
  const body = (req.body ?? {}) as Partial<PersistedState>;

  if (body.venue && typeof body.venue === 'object') {
    state.venue = { ...state.venue, ...body.venue };
  }
  if (Array.isArray(body.channels)) state.channels = body.channels;
  if (body.dsp && typeof body.dsp === 'object') state.dsp = body.dsp;
  if (typeof body.activePresetId === 'string') state.activePresetId = body.activePresetId;
  if (body.broadcastDsp && typeof body.broadcastDsp === 'object') {
    state.broadcastDsp = body.broadcastDsp;
  }
  if (Array.isArray(body.zones)) state.zones = body.zones;
  if (body.obsStatus && typeof body.obsStatus === 'object') state.obsStatus = body.obsStatus;
  if (body.measurement && typeof body.measurement === 'object') {
    state.measurement = body.measurement;
  }
  if (body.bassDi && typeof body.bassDi === 'object') state.bassDi = body.bassDi;
  if (typeof body.emergencyMuted === 'boolean') state.emergencyMuted = body.emergencyMuted;
  if (Array.isArray(body.findings)) state.findings = body.findings;

  audioDb.saveStore(state);
  broadcast({
    type: 'state:sync',
    channels: state.channels,
    dsp: state.dsp,
    venue: state.venue,
    emergencyMuted: state.emergencyMuted,
  });
  res.json({ ok: true });
});

stateRouter.post('/venue', (req, res) => {
  const state = audioDb.ensureStore();
  state.venue = {
    ...state.venue,
    ...req.body,
  };
  audioDb.saveStore(state, true);
  res.json({ ok: true, venue: state.venue });
});

stateRouter.post('/versions', (req, res) => {
  const state = audioDb.ensureStore();
  const version = req.body;
  if (!version || typeof version !== 'object') {
    res.status(400).json({ error: 'Invalid version payload' });
    return;
  }
  state.versions = [version, ...state.versions].slice(0, 40);
  state.auditEvents = [
    {
      id: `evt-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actor: String(version.author ?? 'Operator'),
      action: `Saved Configuration ${String(version.version ?? '')}`,
      detail: String(version.summary ?? 'Configuration snapshot stored locally.'),
      authority: 'operator',
    },
    ...state.auditEvents,
  ].slice(0, 100);
  audioDb.saveStore(state, true);
  res.json({ ok: true, versions: state.versions, auditEvents: state.auditEvents });
});

stateRouter.post('/audit', (req, res) => {
  const state = audioDb.ensureStore();
  const event = req.body;
  if (!event || typeof event !== 'object') {
    res.status(400).json({ error: 'Invalid audit event payload' });
    return;
  }
  state.auditEvents = [
    {
      id: `evt-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...event,
    },
    ...state.auditEvents,
  ].slice(0, 100);
  audioDb.saveStore(state);
  res.json({ ok: true, auditEvents: state.auditEvents });
});

stateRouter.post('/midi-mappings', (req, res) => {
  const state = audioDb.ensureStore();
  const { mappings } = req.body ?? {};
  if (!Array.isArray(mappings)) {
    res.status(400).json({ error: 'mappings must be an array' });
    return;
  }
  state.midiMappings = mappings;
  audioDb.saveStore(state, true);
  res.json({ ok: true, midiMappings: state.midiMappings });
});

stateRouter.post('/shortcuts', (req, res) => {
  const state = audioDb.ensureStore();
  const { shortcuts } = req.body ?? {};
  if (!Array.isArray(shortcuts)) {
    res.status(400).json({ error: 'shortcuts must be an array' });
    return;
  }
  state.keyboardShortcuts = shortcuts;
  audioDb.saveStore(state, true);
  res.json({ ok: true, keyboardShortcuts: state.keyboardShortcuts });
});

stateRouter.post('/automations', (req, res) => {
  const state = audioDb.ensureStore();
  const snapshot = req.body?.snapshot ?? req.body;
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.id) {
    res.status(400).json({ error: 'Invalid automation snapshot payload' });
    return;
  }
  const existing = Array.isArray(state.automationSnapshots) ? state.automationSnapshots : [];
  state.automationSnapshots = [
    snapshot,
    ...existing.filter((s) => s.id !== snapshot.id),
  ].slice(0, 40);
  audioDb.saveStore(state, true);
  res.json({ ok: true, automationSnapshots: state.automationSnapshots });
});

stateRouter.patch('/automations/:id', (req, res) => {
  const state = audioDb.ensureStore();
  const { id } = req.params;
  const patch = req.body ?? {};
  const existing = Array.isArray(state.automationSnapshots) ? state.automationSnapshots : [];
  state.automationSnapshots = existing.map((s) => (s.id === id ? { ...s, ...patch } : s));
  audioDb.saveStore(state, true);
  res.json({ ok: true, automationSnapshots: state.automationSnapshots });
});

stateRouter.delete('/automations/:id', (req, res) => {
  const state = audioDb.ensureStore();
  const { id } = req.params;
  const existing = Array.isArray(state.automationSnapshots) ? state.automationSnapshots : [];
  state.automationSnapshots = existing.filter((s) => s.id !== id);
  audioDb.saveStore(state, true);
  res.json({ ok: true, automationSnapshots: state.automationSnapshots });
});

stateRouter.get('/architecture/manifest', (_req, res) => {
  res.json({
    desktopShell: 'Tauri 2 (Rust backend + React/TypeScript UI)',
    targetPlatforms: [
      { os: 'Windows 10/11 (x64)', status: 'Primary Target', audioBackends: ['WASAPI Exclusive', 'WASAPI Shared', 'ASIO 2.3'], installer: 'MSI / NSIS Signed' },
      { os: 'macOS 14+ (Apple Silicon & Intel)', status: 'Secondary Target', audioBackends: ['CoreAudio', 'AUHAL'], installer: 'Universal DMG' },
      { os: 'Linux (Ubuntu 24.04 / Debian / PipeWire)', status: 'Secondary Target', audioBackends: ['PipeWire', 'ALSA Direct', 'JACK2'], installer: 'AppImage / .deb' },
    ],
    dspEngine: 'CamillaDSP v2.x (Supervised sidecar process over WebSocket API)',
    monorepoLayout: [
      'apps/desktop (Tauri 2 + React + Tailwind)',
      'engines/audio-core (Rust WASAPI/ASIO/CoreAudio/ALSA supervisor)',
      'engines/dsp-engine (CamillaDSP config compiler & safety validator)',
      'engines/signal-analysis (4096-pt FFT, RT60, feedback & hum detectors)',
      'engines/intelligence-engine (Deterministic rules + Gemini reasoning)',
      'integrations/hardware-adapters (Yamaha MG/TF/DM3, Behringer XR18/X32, A&H SQ/AHM, Soundcraft MTK, Focusrite, Dante)',
      'integrations/obs-websocket (OBS v5 broadcast sync)',
      'integrations/rew-interop (REW .txt FR & impulse parser)',
    ],
  });
});
