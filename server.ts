import 'dotenv/config';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import dgram from 'dgram';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Type } from '@google/genai';
import {
  audioDb,
  generateToken,
  type PersistedState,
  type RemoteAccessState,
} from './server/db.ts';
import { recognizeAudioEndpoint } from './src/utils/hardwareRecognition.ts';
import type { DetectedHardwareEndpoint, PlatformTarget } from './src/types/audio.ts';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ensureStore = () => audioDb.ensureStore();
const saveStore = (state: PersistedState, immediate = false) =>
  audioDb.saveStore(state, immediate);

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

function listLanInterfaces(port: number) {
  const nets = os.networkInterfaces();
  const result: Array<{ name: string; address: string; url: string }> = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({
          name,
          address: addr.address,
          url: `http://${addr.address}:${port}`,
        });
      }
    }
  }
  return result;
}

function resolveCurrentHostPlatform(): PlatformTarget {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

async function discoverLanOscMixers(): Promise<DetectedHardwareEndpoint[]> {
  const discovered: DetectedHardwareEndpoint[] = [];
  const xinfoMsg = Buffer.from([
    0x2f, 0x78, 0x69, 0x6e, 0x66, 0x6f, 0x00, 0x00,
    0x2c, 0x00, 0x00, 0x00,
  ]);
  const ports = [10023, 10024]; // X32 (10023) & XR18 / MR18 (10024)

  await Promise.all(
    ports.map(
      (port) =>
        new Promise<void>((resolve) => {
          const sock = dgram.createSocket('udp4');
          const seenIps = new Set<string>();
          const finish = () => {
            try {
              sock.close();
            } catch {
              // ignore already closed socket
            }
            resolve();
          };
          const timer = setTimeout(finish, 320);

          sock.on('error', () => {
            clearTimeout(timer);
            finish();
          });

          sock.on('message', (msg, rinfo) => {
            if (seenIps.has(rinfo.address)) return;
            seenIps.add(rinfo.address);
            const ascii = msg.toString('utf8').replace(/[^\x20-\x7e]+/g, ' ').trim();
            const defaultModel = port === 10024 ? 'Behringer XR18 (LAN OSC)' : 'Behringer X32 (LAN OSC)';
            const label = ascii.length > 5 ? `${defaultModel} · ${ascii}` : defaultModel;
            discovered.push(
              recognizeAudioEndpoint({
                id: `lan-${rinfo.address}-${port}`,
                name: label,
                direction: 'duplex',
                source: 'lan-discovery',
                estimatedInputChannels: port === 10024 ? 18 : 32,
                estimatedOutputChannels: port === 10024 ? 18 : 16,
                hostAddress: rinfo.address,
                platform: resolveCurrentHostPlatform(),
              })
            );
          });

          try {
            sock.bind(0, () => {
              try {
                sock.setBroadcast(true);
                sock.send(xinfoMsg, 0, xinfoMsg.length, port, '255.255.255.255');
              } catch {
                clearTimeout(timer);
                finish();
              }
            });
          } catch {
            clearTimeout(timer);
            finish();
          }
        })
    )
  );

  return discovered;
}

async function scanHostAudioHardware(): Promise<{
  hostPlatform: PlatformTarget;
  endpoints: DetectedHardwareEndpoint[];
}> {
  const hostPlatform = resolveCurrentHostPlatform();
  const endpoints: DetectedHardwareEndpoint[] = [];

  if (process.platform === 'linux') {
    try {
      const cardsPath = '/proc/asound/cards';
      if (fs.existsSync(cardsPath)) {
        const rawCards = fs.readFileSync(cardsPath, 'utf8');
        const lines = rawCards.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/^\s*(\d+)\s+\[[^\]]+\]:\s+(.+)$/);
          if (!match) continue;
          const cardIdx = match[1];
          const cardHeader = match[2].trim();
          const detailLine = lines[i + 1]?.trim() || cardHeader;

          let usbIdText = '';
          const usbidPath = `/proc/asound/card${cardIdx}/usbid`;
          if (fs.existsSync(usbidPath)) {
            usbIdText = fs.readFileSync(usbidPath, 'utf8').trim();
          }

          let streamText = '';
          const streamPath = `/proc/asound/card${cardIdx}/stream0`;
          if (fs.existsSync(streamPath)) {
            streamText = fs.readFileSync(streamPath, 'utf8');
          }

          const inMatch = streamText.match(/Capture:[\s\S]*?Channels:\s*(\d+)/i);
          const outMatch = streamText.match(/Playback:[\s\S]*?Channels:\s*(\d+)/i);
          const [vid, pid] = usbIdText.includes(':') ? usbIdText.split(':') : [undefined, undefined];

          endpoints.push(
            recognizeAudioEndpoint({
              id: `alsa-card-${cardIdx}`,
              name: detailLine || cardHeader,
              direction: 'duplex',
              source: 'os-probe',
              vendorId: vid,
              productId: pid,
              estimatedInputChannels: inMatch ? Number(inMatch[1]) : undefined,
              estimatedOutputChannels: outMatch ? Number(outMatch[1]) : undefined,
              isDefault: cardIdx === '0',
              platform: hostPlatform,
            })
          );
        }
      }
    } catch {
      // ignore ALSA probe errors in headless containers
    }
  } else if (process.platform === 'win32') {
    try {
      const psScript = [
        '$devs = Get-CimInstance Win32_SoundDevice | Select-Object Name, Manufacturer, PNPDeviceID, Status;',
        '$asio = @(); if (Test-Path "HKLM:\\SOFTWARE\\ASIO") { $asio = Get-ChildItem "HKLM:\\SOFTWARE\\ASIO" | ForEach-Object { $_.PSChildName } };',
        '@{ devices = @($devs); asioDrivers = @($asio) } | ConvertTo-Json -Depth 3 -Compress',
      ].join(' ');
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { timeout: 2500 }
      );
      if (stdout.trim()) {
        const parsed = JSON.parse(stdout) as {
          devices?: Array<{ Name?: string; Manufacturer?: string; PNPDeviceID?: string; Status?: string }>;
          asioDrivers?: string[];
        };
        const asioDrivers = parsed.asioDrivers ?? [];
        (parsed.devices ?? []).forEach((dev, idx) => {
          if (!dev.Name) return;
          const pnp = dev.PNPDeviceID || '';
          const vidMatch = pnp.match(/VID_([0-9A-F]{4})/i) || pnp.match(/VEN_([0-9A-F]{4})/i);
          const pidMatch = pnp.match(/PID_([0-9A-F]{4})/i) || pnp.match(/DEV_([0-9A-F]{4})/i);
          const matchedAsio = asioDrivers.find((a) =>
            dev.Name!.toLowerCase().includes(a.toLowerCase().split(' ')[0])
          );
          endpoints.push(
            recognizeAudioEndpoint({
              id: `win-snd-${idx}`,
              name: dev.Name,
              direction: 'duplex',
              source: 'os-probe',
              vendorId: vidMatch?.[1]?.toLowerCase(),
              productId: pidMatch?.[1]?.toLowerCase(),
              asioDriverName: matchedAsio,
              isDefault: idx === 0,
              platform: 'windows',
            })
          );
        });
      }
    } catch {
      // ignore powershell errors
    }
  } else if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync(
        'system_profiler',
        ['SPAudioDataType', '-json'],
        { timeout: 2500 }
      );
      const parsed = JSON.parse(stdout) as {
        SPAudioDataType?: Array<{ _items?: Array<Record<string, unknown>> }>;
      };
      const items = parsed.SPAudioDataType?.[0]?._items ?? [];
      items.forEach((item, idx) => {
        const name = String(item._name ?? 'macOS Audio Device');
        const inCh = Number(item.coreaudio_device_input ?? 0) || undefined;
        const outCh = Number(item.coreaudio_device_output ?? 0) || undefined;
        endpoints.push(
          recognizeAudioEndpoint({
            id: `mac-coreaudio-${idx}`,
            name,
            direction: inCh && outCh ? 'duplex' : inCh ? 'input' : 'output',
            source: 'os-probe',
            estimatedInputChannels: inCh,
            estimatedOutputChannels: outCh,
            isDefault: Boolean(item.coreaudio_default_audio_input_device),
            platform: 'macos',
          })
        );
      });
    } catch {
      // ignore macOS probe errors
    }
  }

  const lanMixers = await discoverLanOscMixers();
  endpoints.push(...lanMixers);

  return { hostPlatform, endpoints };
}

interface WsClientRecord {
  clientId: string;
  ws: WebSocket;
  role: 'desktop' | 'mobile';
  deviceName: string;
  ip: string;
  connectedAt: string;
  lastSeenAt: string;
  pinVerified: boolean;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Map<string, WsClientRecord>();

  const getPublicClientList = () =>
    Array.from(clients.values())
      .filter((c) => c.role === 'mobile')
      .map(({ clientId, role, deviceName, ip, connectedAt, lastSeenAt }) => ({
        clientId,
        role,
        deviceName,
        ip,
        connectedAt,
        lastSeenAt,
      }));

  const broadcast = (payload: Record<string, unknown>, excludeClientId?: string) => {
    const serialized = JSON.stringify(payload);
    for (const [id, client] of clients.entries()) {
      if (excludeClientId && id === excludeClientId) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        if (client.role === 'mobile' && !client.pinVerified) continue;
        client.ws.send(serialized);
      }
    }
  };

  const broadcastClientList = () => {
    const list = getPublicClientList();
    const msg = JSON.stringify({ type: 'remote:clients', clients: list });
    for (const client of clients.values()) {
      if (client.role === 'desktop' && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  };

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/ws', 'http://localhost');
    const roleParam = url.searchParams.get('role') === 'mobile' ? 'mobile' : 'desktop';
    const tokenParam = url.searchParams.get('token') || '';
    const deviceName =
      url.searchParams.get('device') ||
      (roleParam === 'mobile' ? 'FOH Mobile Companion' : 'FOH Desktop Console');
    const state = ensureStore();

    if (roleParam === 'mobile' && tokenParam !== state.remoteAccess.sessionToken) {
      ws.send(JSON.stringify({ type: 'auth:error', error: 'Invalid or expired pairing token.' }));
      ws.close(4001, 'Invalid pairing token');
      return;
    }

    const clientId = `cli-${crypto.randomBytes(6).toString('hex')}`;
    const rawIp =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'local';
    const ip = rawIp.replace(/^::ffff:/, '');
    const nowIso = new Date().toISOString();

    const record: WsClientRecord = {
      clientId,
      ws,
      role: roleParam,
      deviceName,
      ip,
      connectedAt: nowIso,
      lastSeenAt: nowIso,
      pinVerified: roleParam === 'desktop' || !state.remoteAccess.pinEnabled,
    };
    clients.set(clientId, record);

    if (record.pinVerified) {
      ws.send(
        JSON.stringify({
          type: 'state:full',
          state: ensureStore(),
          clientId,
        })
      );
    } else {
      ws.send(JSON.stringify({ type: 'auth:pin-required', clientId }));
    }

    if (roleParam === 'mobile') {
      state.auditEvents = [
        {
          id: `evt-${Date.now()}`,
          timestamp: nowIso,
          actor: deviceName,
          action: 'Mobile Companion Linked',
          detail: `Remote FOH companion connected from ${ip}`,
          authority: 'system',
        },
        ...state.auditEvents,
      ].slice(0, 100);
      saveStore(state);
      broadcastClientList();
    }

    ws.on('message', (rawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(rawData)) as Record<string, unknown>;
      } catch {
        return;
      }

      record.lastSeenAt = new Date().toISOString();
      const current = ensureStore();

      if (msg.type === 'auth:verify-pin') {
        if (String(msg.pin ?? '') === current.remoteAccess.pinCode) {
          record.pinVerified = true;
          ws.send(JSON.stringify({ type: 'auth:ok' }));
          ws.send(JSON.stringify({ type: 'state:full', state: current, clientId }));
          broadcastClientList();
        } else {
          ws.send(JSON.stringify({ type: 'auth:error', error: 'Incorrect PIN code.' }));
        }
        return;
      }

      if (!record.pinVerified) {
        ws.send(JSON.stringify({ type: 'auth:pin-required' }));
        return;
      }

      if (msg.type === 'channel:patch') {
        const channelId = String(msg.channelId ?? '');
        const rawPatch = (msg.patch && typeof msg.patch === 'object' ? msg.patch : {}) as Record<
          string,
          unknown
        >;
        if (!channelId) return;

        // Enforce remote companion permissions
        const sanitizedPatch: Record<string, unknown> = { ...rawPatch };
        if (record.role === 'mobile') {
          if (!current.remoteAccess.allowGainAdjustment) {
            delete sanitizedPatch.gainDb;
            delete sanitizedPatch.phantom48v;
            delete sanitizedPatch.padDb;
          }
          if (!current.remoteAccess.allowMuteControl) {
            delete sanitizedPatch.mute;
            delete sanitizedPatch.solo;
          }
        }
        if (Object.keys(sanitizedPatch).length === 0) return;

        audioDb.patchChannel(channelId, sanitizedPatch);
        broadcast(
          {
            type: 'channel:patch',
            channelId,
            patch: sanitizedPatch,
            sourceRole: record.role,
          },
          clientId
        );
        return;
      }

      if (msg.type === 'master:patch') {
        if (record.role === 'mobile' && !current.remoteAccess.allowMasterTrim) {
          return;
        }
        const updatedMaster = audioDb.patchMaster({
          inputTrimDb: typeof msg.inputTrimDb === 'number' ? msg.inputTrimDb : undefined,
          emergencyMuted:
            typeof msg.emergencyMuted === 'boolean' ? msg.emergencyMuted : undefined,
        });
        broadcast(
          {
            type: 'master:patch',
            inputTrimDb: (updatedMaster.dsp as { inputTrimDb?: number }).inputTrimDb,
            emergencyMuted: updatedMaster.emergencyMuted,
            sourceRole: record.role,
          },
          clientId
        );
        return;
      }

      if (msg.type === 'telemetry:frame' && record.role === 'desktop') {
        const serialized = JSON.stringify({
          type: 'telemetry:frame',
          telemetry: msg.telemetry,
        });
        for (const client of clients.values()) {
          if (
            client.role === 'mobile' &&
            client.pinVerified &&
            client.ws.readyState === WebSocket.OPEN
          ) {
            client.ws.send(serialized);
          }
        }
      }
    });

    ws.on('close', () => {
      const wasMobile = record.role === 'mobile';
      clients.delete(clientId);
      if (wasMobile) {
        broadcastClientList();
      }
    });
  });

  app.get('/api/health', (_req, res) => {
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

  app.get('/api/state', (_req, res) => {
    const state = ensureStore();
    res.json(state);
  });

  app.put('/api/state/sync', (req, res) => {
    const state = ensureStore();
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

    saveStore(state);
    broadcast({
      type: 'state:sync',
      channels: state.channels,
      dsp: state.dsp,
      venue: state.venue,
      emergencyMuted: state.emergencyMuted,
    });
    res.json({ ok: true });
  });

  app.get('/api/network/interfaces', (_req, res) => {
    res.json({ interfaces: listLanInterfaces(3000) });
  });

  app.get('/api/hardware/scan', async (_req, res) => {
    const result = await scanHostAudioHardware();
    res.json({
      ok: true,
      scannedAt: new Date().toISOString(),
      hostPlatform: result.hostPlatform,
      endpoints: result.endpoints,
    });
  });

  app.get('/api/hardware/profiles/:deviceId', (req, res) => {
    const profile = audioDb.getDeviceProfile(req.params.deviceId);
    res.json({ ok: true, profile });
  });

  app.post('/api/hardware/profiles/:deviceId', (req, res) => {
    const payload = (req.body ?? {}) as Record<string, unknown>;
    const saved = audioDb.saveDeviceProfile(req.params.deviceId, payload);
    res.json({ ...saved, deviceId: req.params.deviceId });
  });

  app.get('/api/remote/session', (_req, res) => {
    const state = ensureStore();
    res.json({
      remoteAccess: state.remoteAccess,
      clients: getPublicClientList(),
      interfaces: listLanInterfaces(3000),
    });
  });

  app.patch('/api/remote/session', (req, res) => {
    const state = ensureStore();
    const patch = (req.body ?? {}) as Partial<RemoteAccessState>;
    state.remoteAccess = {
      ...state.remoteAccess,
      ...patch,
      sessionToken: state.remoteAccess.sessionToken,
    };
    saveStore(state, true);
    broadcast({ type: 'remote:config', remoteAccess: state.remoteAccess });
    res.json({ ok: true, remoteAccess: state.remoteAccess });
  });

  app.post('/api/remote/rotate-token', (_req, res) => {
    const state = ensureStore();
    state.remoteAccess = {
      ...state.remoteAccess,
      sessionToken: generateToken(),
      createdAt: new Date().toISOString(),
    };
    for (const [id, client] of clients.entries()) {
      if (client.role === 'mobile') {
        client.ws.close(4002, 'Pairing token rotated by FOH engineer');
        clients.delete(id);
      }
    }
    state.auditEvents = [
      {
        id: `evt-${Date.now()}`,
        timestamp: new Date().toISOString(),
        actor: 'Sound Engineer',
        action: 'Rotated Remote Access QR Token',
        detail: 'Previous mobile companion sessions revoked; new pairing token issued.',
        authority: 'operator',
      },
      ...state.auditEvents,
    ].slice(0, 100);
    saveStore(state, true);
    broadcastClientList();
    res.json({ ok: true, remoteAccess: state.remoteAccess });
  });

  app.delete('/api/remote/clients/:clientId', (req, res) => {
    const { clientId } = req.params;
    const target = clients.get(clientId);
    if (target) {
      target.ws.close(4003, 'Session revoked by FOH console');
      clients.delete(clientId);
      broadcastClientList();
    }
    res.json({ ok: true, clients: getPublicClientList() });
  });

  app.get('/api/remote/bootstrap', (req, res) => {
    const token = String(req.query.token ?? '');
    const state = ensureStore();
    if (!token || token !== state.remoteAccess.sessionToken) {
      res.status(401).json({ ok: false, error: 'Invalid or expired QR pairing token.' });
      return;
    }
    res.json({
      ok: true,
      pinRequired: state.remoteAccess.pinEnabled,
      remoteAccess: {
        pinEnabled: state.remoteAccess.pinEnabled,
        allowGainAdjustment: state.remoteAccess.allowGainAdjustment,
        allowMuteControl: state.remoteAccess.allowMuteControl,
        allowMasterTrim: state.remoteAccess.allowMasterTrim,
      },
      state: state.remoteAccess.pinEnabled
        ? null
        : {
            venue: state.venue,
            channels: state.channels,
            dsp: state.dsp,
            emergencyMuted: state.emergencyMuted,
          },
    });
  });

  app.post('/api/venue', (req, res) => {
    const state = ensureStore();
    state.venue = {
      ...state.venue,
      ...req.body,
    };
    saveStore(state, true);
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
    saveStore(state, true);
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
    saveStore(state, true);
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
    saveStore(state, true);
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
    saveStore(state, true);
    res.json({ ok: true, automationSnapshots: state.automationSnapshots });
  });

  app.patch('/api/automations/:id', (req, res) => {
    const state = ensureStore();
    const { id } = req.params;
    const patch = req.body ?? {};
    const existing = Array.isArray(state.automationSnapshots) ? state.automationSnapshots : [];
    state.automationSnapshots = existing.map((s) => (s.id === id ? { ...s, ...patch } : s));
    saveStore(state, true);
    res.json({ ok: true, automationSnapshots: state.automationSnapshots });
  });

  app.delete('/api/automations/:id', (req, res) => {
    const state = ensureStore();
    const { id } = req.params;
    const existing = Array.isArray(state.automationSnapshots) ? state.automationSnapshots : [];
    state.automationSnapshots = existing.filter((s) => s.id !== id);
    saveStore(state, true);
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
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Church Audio Intelligence running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
