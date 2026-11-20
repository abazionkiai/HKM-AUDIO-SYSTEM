import crypto from 'crypto';
import type http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { audioDb, type PersistedState } from './db.ts';

export interface WsClientRecord {
  clientId: string;
  ws: WebSocket;
  role: 'desktop' | 'mobile';
  deviceName: string;
  ip: string;
  connectedAt: string;
  lastSeenAt: string;
  pinVerified: boolean;
}

export const clients = new Map<string, WsClientRecord>();

export const getPublicClientList = () =>
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

export const broadcast = (payload: Record<string, unknown>, excludeClientId?: string) => {
  const serialized = JSON.stringify(payload);
  for (const [id, client] of clients.entries()) {
    if (excludeClientId && id === excludeClientId) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      if (client.role === 'mobile' && !client.pinVerified) continue;
      client.ws.send(serialized);
    }
  }
};

export const broadcastClientList = () => {
  const list = getPublicClientList();
  const msg = JSON.stringify({ type: 'remote:clients', clients: list });
  for (const client of clients.values()) {
    if (client.role === 'desktop' && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
};

export function setupWebSocket(httpServer: http.Server) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/ws', 'http://localhost');
    const roleParam = url.searchParams.get('role') === 'mobile' ? 'mobile' : 'desktop';
    const tokenParam = url.searchParams.get('token') || '';
    const deviceName =
      url.searchParams.get('device') ||
      (roleParam === 'mobile' ? 'FOH Mobile Companion' : 'FOH Desktop Console');
    const state = audioDb.ensureStore();

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
          state: audioDb.ensureStore(),
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
      audioDb.saveStore(state);
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
      const current = audioDb.ensureStore();

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

  return wss;
}
