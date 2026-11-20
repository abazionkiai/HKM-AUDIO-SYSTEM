import { Router } from 'express';
import { audioDb, generateToken, type RemoteAccessState } from '../db.ts';
import { clients, getPublicClientList, broadcast, broadcastClientList } from '../ws.ts';
import { listLanInterfaces } from '../config.ts';

export const remoteRouter = Router();

// Allow reading dynamic port from query or fallback
const getEffectivePort = (req: { app?: { get?: (k: string) => unknown } }) =>
  Number(req.app?.get?.('port') ?? 3030);

remoteRouter.get('/session', (req, res) => {
  const state = audioDb.ensureStore();
  const port = getEffectivePort(req);
  res.json({
    remoteAccess: state.remoteAccess,
    clients: getPublicClientList(),
    interfaces: listLanInterfaces(port),
  });
});

remoteRouter.patch('/session', (req, res) => {
  const state = audioDb.ensureStore();
  const patch = (req.body ?? {}) as Partial<RemoteAccessState>;
  state.remoteAccess = {
    ...state.remoteAccess,
    ...patch,
    sessionToken: state.remoteAccess.sessionToken,
  };
  audioDb.saveStore(state, true);
  broadcast({ type: 'remote:config', remoteAccess: state.remoteAccess });
  res.json({ ok: true, remoteAccess: state.remoteAccess });
});

remoteRouter.post('/rotate-token', (_req, res) => {
  const state = audioDb.ensureStore();
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
  audioDb.saveStore(state, true);
  broadcastClientList();
  res.json({ ok: true, remoteAccess: state.remoteAccess });
});

remoteRouter.delete('/clients/:clientId', (req, res) => {
  const { clientId } = req.params;
  const target = clients.get(clientId);
  if (target) {
    target.ws.close(4003, 'Session revoked by FOH console');
    clients.delete(clientId);
    broadcastClientList();
  }
  res.json({ ok: true, clients: getPublicClientList() });
});

remoteRouter.get('/bootstrap', (req, res) => {
  const token = String(req.query.token ?? '');
  const state = audioDb.ensureStore();
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
