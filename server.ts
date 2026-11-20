import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '.data');
const DB_FILE = path.join(DATA_DIR, 'church-audio-db.json');

interface PersistedState {
  venue: {
    organization: string;
    venueName: string;
    roomName: string;
    targetPlatform: 'windows' | 'macos' | 'linux';
    activeDeviceId: string;
  };
  versions: Array<Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
  midiMappings?: Array<Record<string, unknown>>;
  automationSnapshots?: Array<Record<string, unknown>>;
  keyboardShortcuts?: Array<Record<string, unknown>>;
}

function ensureStore(): PersistedState {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial: PersistedState = {
      venue: {
        organization: 'Grace Community Fellowship',
        venueName: 'Main Campus',
        roomName: 'Primary Sanctuary (650 Seats)',
        targetPlatform: 'windows',
        activeDeviceId: 'yamaha-mg16xu',
      },
      versions: [],
      diagnostics: [],
      auditEvents: [
        {
          id: 'evt-init-1',
          timestamp: new Date().toISOString(),
          actor: 'System Watchdog',
          action: 'Local Configuration Store Initialized',
          detail: 'Windows WASAPI/ASIO hardware abstraction and CamillaDSP v2 schema ready.',
          authority: 'system',
        },
      ],
      automationSnapshots: [],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as PersistedState;
  } catch {
    return {
      venue: {
        organization: 'Grace Community Fellowship',
        venueName: 'Main Campus',
        roomName: 'Primary Sanctuary (650 Seats)',
        targetPlatform: 'windows',
        activeDeviceId: 'yamaha-mg16xu',
      },
      versions: [],
      diagnostics: [],
      auditEvents: [],
      automationSnapshots: [],
    };
  }
}

function saveStore(state: PersistedState): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      engine: 'Church Audio Intelligence Control Plane',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
      storage: 'local-first-json',
    });
  });

  app.get('/api/state', (_req, res) => {
    const state = ensureStore();
    res.json(state);
  });

  app.post('/api/venue', (req, res) => {
    const state = ensureStore();
    state.venue = {
      ...state.venue,
      ...req.body,
    };
    saveStore(state);
    res.json({ ok: true, venue: state.venue });
  });

  app.post('/api/versions', (req, res) => {
    const state = ensureStore();
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
    saveStore(state);
    res.json({ ok: true, versions: state.versions, auditEvents: state.auditEvents });
  });

  app.post('/api/audit', (req, res) => {
    const state = ensureStore();
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
    saveStore(state);
    res.json({ ok: true, auditEvents: state.auditEvents });
  });

  app.post('/api/midi-mappings', (req, res) => {
    const state = ensureStore();
    const { mappings } = req.body ?? {};
    if (!Array.isArray(mappings)) {
      res.status(400).json({ error: 'mappings must be an array' });
      return;
    }
    state.midiMappings = mappings;
    saveStore(state);
    res.json({ ok: true, midiMappings: state.midiMappings });
  });

  app.post('/api/shortcuts', (req, res) => {
    const state = ensureStore();
    const { shortcuts } = req.body ?? {};
    if (!Array.isArray(shortcuts)) {
      res.status(400).json({ error: 'shortcuts must be an array' });
      return;
    }
    state.keyboardShortcuts = shortcuts;
    saveStore(state);
    res.json({ ok: true, keyboardShortcuts: state.keyboardShortcuts });
  });

  app.post('/api/automations', (req, res) => {
    const state = ensureStore();
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
    saveStore(state);
    res.json({ ok: true, automationSnapshots: state.automationSnapshots });
  });

  app.patch('/api/automations/:id', (req, res) => {
    const state = ensureStore();
    const { id } = req.params;
    const patch = req.body ?? {};
    const existing = Array.isArray(state.automationSnapshots) ? state.automationSnapshots : [];
    state.automationSnapshots = existing.map((s) => (s.id === id ? { ...s, ...patch } : s));
    saveStore(state);
    res.json({ ok: true, automationSnapshots: state.automationSnapshots });
  });

  app.delete('/api/automations/:id', (req, res) => {
    const state = ensureStore();
    const { id } = req.params;
    const existing = Array.isArray(state.automationSnapshots) ? state.automationSnapshots : [];
    state.automationSnapshots = existing.filter((s) => s.id !== id);
    saveStore(state);
    res.json({ ok: true, automationSnapshots: state.automationSnapshots });
  });

  app.post('/api/ai/diagnose', async (req, res) => {
    try {
      const ai = createGeminiClient();
      const { telemetry, device, dsp, platform, driver, question } = req.body ?? {};

      const prompt = `You are a senior church acoustic & live sound engineer advising a sound operator.
Analyze the REAL measured signal telemetry, hardware capability boundaries, and active DSP configuration below.

HARDWARE PROFILE:
- Device: ${device?.manufacturer ?? 'Unknown'} ${device?.model ?? 'Mixer'} (${device?.tierLabel ?? 'Tier 1'})
- Platform & Driver: ${platform ?? 'windows'} / ${driver ?? 'WASAPI Exclusive'}
- Capabilities: perChannelFaderControl=${Boolean(device?.capabilities?.perChannelFaderControl)}, perChannelCapture=${Boolean(device?.capabilities?.perChannelCapture)}, stereoMixCapture=${Boolean(device?.capabilities?.stereoMixCapture)}
- Limitations: ${device?.capabilities?.limitationsNote ?? 'None specified'}

LIVE SIGNAL TELEMETRY:
- Source Mode: ${telemetry?.source ?? 'unknown'}
- Pre-DSP RMS / Peak: ${telemetry?.preRmsDb ?? -96} dBFS / ${telemetry?.prePeakDb ?? -96} dBFS
- Post-DSP RMS / Peak: ${telemetry?.postRmsDb ?? -96} dBFS / ${telemetry?.postPeakDb ?? -96} dBFS
- Estimated Loudness: ${telemetry?.estimatedLufs ?? -70} LUFS
- Feedback Risk: detected=${Boolean(telemetry?.feedbackRisk?.detected)}, freq=${telemetry?.feedbackRisk?.frequencyHz ?? 'none'} Hz, prominence=${telemetry?.feedbackRisk?.prominenceDb ?? 0} dB, persistence=${telemetry?.feedbackRisk?.persistenceSec ?? 0}s
- Mains Hum Risk: detected=${Boolean(telemetry?.humRisk?.detected)}, fundamental=${telemetry?.humRisk?.fundamentalHz ?? 'none'} Hz, 100Hz=${telemetry?.humRisk?.harmonic100Db ?? -96} dB, 150Hz=${telemetry?.humRisk?.harmonic150Db ?? -96} dB
- Low-Mid Mud Risk: detected=${Boolean(telemetry?.mudRisk?.detected)}, center=${telemetry?.mudRisk?.centerHz ?? 220} Hz, level=${telemetry?.mudRisk?.bandEnergyDb ?? -96} dB

ACTIVE DSP:
- Bypassed: ${Boolean(dsp?.bypassed)}
- HPF: ${dsp?.hpfEnabled ? `${dsp.hpfHz} Hz` : 'Disabled'}
- EQ Bands: ${JSON.stringify(dsp?.eqBands ?? [])}
- Compressor: enabled=${Boolean(dsp?.compressor?.enabled)}, thresh=${dsp?.compressor?.thresholdDb} dB, ratio=${dsp?.compressor?.ratio}:1
- Limiter Ceiling: ${dsp?.limiter?.ceilingDb ?? -1} dBFS

OPERATOR PROMPT: ${question || 'Perform a full evidence-based sound engineering diagnosis of the current signal and hardware state.'}

STRICT ENGINEERING RULES:
1. Never claim you can control physical faders or individual channels if perChannelFaderControl is false (e.g., Yamaha MG16XU stereo USB return).
2. Never blame EQ alone if physical microphone placement, DI ground lift, cable fault, or room reverberation is a primary suspect.
3. Propose at most ONE concrete, safe DSP adjustment (EQ band cut/boost or HPF change) within safe bounds (-12 to +6 dB, 20 to 16000 Hz) if justified by the measured evidence.
4. Explain clearly why and state confidence (0-100).`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              severity: { type: Type.STRING, description: 'One of: nominal, advisory, warning, critical' },
              category: { type: Type.STRING, description: 'One of: feedback, hum, acoustics, gain-staging, broadcast, hardware' },
              confidence: { type: Type.INTEGER },
              evidence: { type: Type.STRING },
              explanation: { type: Type.STRING },
              physicalChecks: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              proposedDspAction: {
                type: Type.OBJECT,
                properties: {
                  shouldApply: { type: Type.BOOLEAN },
                  description: { type: Type.STRING },
                  hpfHz: { type: Type.NUMBER },
                  eqFrequencyHz: { type: Type.NUMBER },
                  eqGainDb: { type: Type.NUMBER },
                  eqQ: { type: Type.NUMBER },
                  eqLabel: { type: Type.STRING },
                },
              },
            },
          },
        },
      });

      const raw = (response.text ?? '{}').trim();
      const parsed = JSON.parse(raw);
      res.json({ ok: true, result: parsed });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI diagnostic request failed.';
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/ai/chat', async (req, res) => {
    try {
      const ai = createGeminiClient();
      const { message, context } = req.body ?? {};
      if (!message || typeof message !== 'string') {
        res.status(400).json({ ok: false, error: 'Message text is required.' });
        return;
      }

      const systemInstruction = `You are the AI Sound Engineer inside Church Audio Intelligence.
Always ground your answer in the live telemetry, connected hardware capabilities, and DSP state provided in context.
Be concise, practical, and explicit about hardware boundaries (for instance, if a console like the Yamaha MG16XU only sends stereo USB, state that individual mic faders must be adjusted physically on the mixer while master/bus DSP runs in CamillaDSP). Never fabricate measurements not present in the context.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `SYSTEM CONTEXT:\n${JSON.stringify(context ?? {}, null, 2)}\n\nOPERATOR QUESTION:\n${message}`,
        config: {
          systemInstruction,
        },
      });

      res.json({ ok: true, reply: response.text ?? '' });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'AI assistant error.';
      res.status(500).json({ ok: false, error: errMsg });
    }
  });

  app.get('/api/architecture/manifest', (_req, res) => {
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

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Church Audio Intelligence running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
