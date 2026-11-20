import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASS_DI_CONFIG,
  DEFAULT_DSP_CONFIG,
  DEFAULT_SPEAKER_ZONES,
  HARDWARE_CATALOG,
  INITIAL_ACOUSTIC_MEASUREMENT,
  SERVICE_PRESETS,
  buildChannelsForDevice,
} from '../src/data/hardwareCatalog.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_DIR = path.resolve(__dirname, '..', '.data');
export const SQLITE_FILE = path.join(DATA_DIR, 'church-audio.sqlite');
export const JSON_BACKUP_FILE = path.join(DATA_DIR, 'church-audio-db.json');

export interface RemoteAccessState {
  sessionToken: string;
  pinEnabled: boolean;
  pinCode: string;
  allowGainAdjustment: boolean;
  allowMuteControl: boolean;
  allowMasterTrim: boolean;
  lanHostOverride: string;
  createdAt: string;
}

export interface PersistedState {
  venue: {
    organization: string;
    venueName: string;
    roomName: string;
    targetPlatform: 'windows' | 'macos' | 'linux';
    driver: string;
    sampleRate: number;
    bufferSize: number;
    activeDeviceId: string;
  };
  channels: Array<Record<string, unknown>>;
  dsp: Record<string, unknown>;
  activePresetId: string;
  broadcastDsp: Record<string, unknown>;
  zones: Array<Record<string, unknown>>;
  obsStatus: Record<string, unknown>;
  measurement: Record<string, unknown>;
  bassDi: Record<string, unknown>;
  emergencyMuted: boolean;
  findings: Array<Record<string, unknown>>;
  remoteAccess: RemoteAccessState;
  versions: Array<Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
  midiMappings?: Array<Record<string, unknown>>;
  automationSnapshots?: Array<Record<string, unknown>>;
  keyboardShortcuts?: Array<Record<string, unknown>>;
}

export function generateToken(): string {
  return crypto.randomBytes(12).toString('base64url');
}

export function buildDefaultState(): PersistedState {
  const defaultDevice = HARDWARE_CATALOG[0];
  const defaultPreset = SERVICE_PRESETS[0];
  return {
    venue: {
      organization: 'Grace Community Fellowship',
      venueName: 'Grace Community Fellowship',
      roomName: 'Main Sanctuary',
      targetPlatform: 'windows',
      driver: 'ASIO',
      sampleRate: defaultDevice.defaultSampleRate,
      bufferSize: defaultDevice.defaultBufferSize,
      activeDeviceId: defaultDevice.id,
    },
    channels: buildChannelsForDevice(defaultDevice) as unknown as Array<Record<string, unknown>>,
    dsp: DEFAULT_DSP_CONFIG as unknown as Record<string, unknown>,
    activePresetId: defaultPreset.id,
    broadcastDsp: defaultPreset.broadcastDsp as unknown as Record<string, unknown>,
    zones: DEFAULT_SPEAKER_ZONES as unknown as Array<Record<string, unknown>>,
    obsStatus: {
      connected: false,
      websocketUrl: 'ws://127.0.0.1:4455',
      activeScene: 'Sanctuary Wide + Preacher',
      scenes: [
        'Pre-Service Countdown',
        'Worship Full Band',
        'Sanctuary Wide + Preacher',
        'Pulpit Close-Up',
      ],
      streaming: false,
      recording: false,
      bitrateKbps: 0,
      droppedFrames: 0,
      cpuUsagePct: 0,
      audioMonitorMode: 'Monitor Off',
      syncWarning: false,
    },
    measurement: INITIAL_ACOUSTIC_MEASUREMENT as unknown as Record<string, unknown>,
    bassDi: DEFAULT_BASS_DI_CONFIG as unknown as Record<string, unknown>,
    emergencyMuted: false,
    findings: [],
    remoteAccess: {
      sessionToken: generateToken(),
      pinEnabled: false,
      pinCode: '2026',
      allowGainAdjustment: true,
      allowMuteControl: true,
      allowMasterTrim: true,
      lanHostOverride: '',
      createdAt: new Date().toISOString(),
    },
    versions: [],
    diagnostics: [],
    auditEvents: [
      {
        id: 'evt-init-1',
        timestamp: new Date().toISOString(),
        actor: 'System Watchdog',
        action: 'SQLite Database & Local Store Initialized',
        detail: 'Embedded SQLite WAL store, JSON backup snapshot, and WebSocket sync engine active.',
        authority: 'system',
      },
    ],
    automationSnapshots: [],
  };
}

export function hydrateWithDefaults(raw: Partial<PersistedState>): PersistedState {
  const defaults = buildDefaultState();
  const venue = { ...defaults.venue, ...(raw.venue ?? {}) };
  const activeDevice =
    HARDWARE_CATALOG.find((d) => d.id === venue.activeDeviceId) ?? HARDWARE_CATALOG[0];
  const channels =
    Array.isArray(raw.channels) && raw.channels.length > 0
      ? raw.channels
      : (buildChannelsForDevice(activeDevice) as unknown as Array<Record<string, unknown>>);

  return {
    ...defaults,
    ...raw,
    venue,
    channels,
    dsp: raw.dsp && typeof raw.dsp === 'object' ? raw.dsp : defaults.dsp,
    activePresetId: raw.activePresetId || defaults.activePresetId,
    broadcastDsp:
      raw.broadcastDsp && typeof raw.broadcastDsp === 'object'
        ? raw.broadcastDsp
        : defaults.broadcastDsp,
    zones: Array.isArray(raw.zones) && raw.zones.length > 0 ? raw.zones : defaults.zones,
    obsStatus:
      raw.obsStatus && typeof raw.obsStatus === 'object' ? raw.obsStatus : defaults.obsStatus,
    measurement:
      raw.measurement && typeof raw.measurement === 'object'
        ? raw.measurement
        : defaults.measurement,
    bassDi: raw.bassDi && typeof raw.bassDi === 'object' ? raw.bassDi : defaults.bassDi,
    emergencyMuted: Boolean(raw.emergencyMuted),
    findings: Array.isArray(raw.findings) ? raw.findings : [],
    remoteAccess: {
      ...defaults.remoteAccess,
      ...(raw.remoteAccess ?? {}),
      sessionToken: raw.remoteAccess?.sessionToken || defaults.remoteAccess.sessionToken,
    },
    versions: Array.isArray(raw.versions) ? raw.versions : [],
    diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : [],
    auditEvents:
      Array.isArray(raw.auditEvents) && raw.auditEvents.length > 0
        ? raw.auditEvents
        : defaults.auditEvents,
    midiMappings: Array.isArray(raw.midiMappings) ? raw.midiMappings : undefined,
    automationSnapshots: Array.isArray(raw.automationSnapshots) ? raw.automationSnapshots : [],
    keyboardShortcuts: Array.isArray(raw.keyboardShortcuts) ? raw.keyboardShortcuts : undefined,
  };
}

class LocalAudioDatabase {
  private db: DatabaseSync | null = null;
  private cachedState: PersistedState | null = null;
  private backupTimer: NodeJS.Timeout | null = null;

  private open(): DatabaseSync {
    if (this.db) return this.db;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const db = new DatabaseSync(SQLITE_FILE);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS console_core (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        venue_json TEXT NOT NULL,
        dsp_json TEXT NOT NULL,
        active_preset_id TEXT NOT NULL,
        broadcast_dsp_json TEXT NOT NULL,
        obs_status_json TEXT NOT NULL,
        measurement_json TEXT NOT NULL,
        bass_di_json TEXT NOT NULL,
        emergency_muted INTEGER NOT NULL DEFAULT 0,
        findings_json TEXT NOT NULL DEFAULT '[]',
        diagnostics_json TEXT NOT NULL DEFAULT '[]',
        midi_mappings_json TEXT,
        keyboard_shortcuts_json TEXT,
        remote_access_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        channel_index INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS speaker_zones (
        id TEXT PRIMARY KEY,
        zone_order INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config_versions (
        id TEXT PRIMARY KEY,
        version_order INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_snapshots (
        id TEXT PRIMARY KEY,
        snap_order INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        evt_order INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS device_profiles (
        device_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.db = db;
    return db;
  }

  private writeJsonBackupImmediate(state: PersistedState): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(JSON_BACKUP_FILE, JSON.stringify(state, null, 2), 'utf8');
  }

  private scheduleJsonBackup(state: PersistedState, immediate: boolean): void {
    if (immediate) {
      if (this.backupTimer) {
        clearTimeout(this.backupTimer);
        this.backupTimer = null;
      }
      this.writeJsonBackupImmediate(state);
      return;
    }
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.backupTimer = setTimeout(() => {
      this.backupTimer = null;
      if (this.cachedState) {
        this.writeJsonBackupImmediate(this.cachedState);
      }
    }, 250);
  }

  private writeStateToSqlite(state: PersistedState): void {
    const db = this.open();
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO console_core (
          id, venue_json, dsp_json, active_preset_id, broadcast_dsp_json,
          obs_status_json, measurement_json, bass_di_json, emergency_muted,
          findings_json, diagnostics_json, midi_mappings_json, keyboard_shortcuts_json,
          remote_access_json, updated_at
        ) VALUES (
          1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          venue_json = excluded.venue_json,
          dsp_json = excluded.dsp_json,
          active_preset_id = excluded.active_preset_id,
          broadcast_dsp_json = excluded.broadcast_dsp_json,
          obs_status_json = excluded.obs_status_json,
          measurement_json = excluded.measurement_json,
          bass_di_json = excluded.bass_di_json,
          emergency_muted = excluded.emergency_muted,
          findings_json = excluded.findings_json,
          diagnostics_json = excluded.diagnostics_json,
          midi_mappings_json = excluded.midi_mappings_json,
          keyboard_shortcuts_json = excluded.keyboard_shortcuts_json,
          remote_access_json = excluded.remote_access_json,
          updated_at = excluded.updated_at`
      ).run(
        JSON.stringify(state.venue),
        JSON.stringify(state.dsp),
        state.activePresetId,
        JSON.stringify(state.broadcastDsp),
        JSON.stringify(state.obsStatus),
        JSON.stringify(state.measurement),
        JSON.stringify(state.bassDi),
        state.emergencyMuted ? 1 : 0,
        JSON.stringify(state.findings),
        JSON.stringify(state.diagnostics),
        state.midiMappings ? JSON.stringify(state.midiMappings) : null,
        state.keyboardShortcuts ? JSON.stringify(state.keyboardShortcuts) : null,
        JSON.stringify(state.remoteAccess),
        now
      );

      db.exec('DELETE FROM channels');
      const insertCh = db.prepare(
        'INSERT INTO channels (id, channel_index, payload_json, updated_at) VALUES (?, ?, ?, ?)'
      );
      state.channels.forEach((ch, idx) => {
        const chId = String(ch.id ?? `ch-${idx + 1}`);
        const chIndex = Number(ch.index ?? idx + 1);
        insertCh.run(chId, chIndex, JSON.stringify(ch), now);
      });

      db.exec('DELETE FROM speaker_zones');
      const insertZone = db.prepare(
        'INSERT INTO speaker_zones (id, zone_order, payload_json, updated_at) VALUES (?, ?, ?, ?)'
      );
      state.zones.forEach((zone, idx) => {
        const zId = String(zone.id ?? `zone-${idx + 1}`);
        insertZone.run(zId, idx, JSON.stringify(zone), now);
      });

      db.exec('DELETE FROM config_versions');
      const insertVer = db.prepare(
        'INSERT INTO config_versions (id, version_order, payload_json, created_at) VALUES (?, ?, ?, ?)'
      );
      state.versions.forEach((ver, idx) => {
        const vId = String(ver.id ?? `ver-${idx}`);
        insertVer.run(vId, idx, JSON.stringify(ver), String(ver.timestamp ?? now));
      });

      db.exec('DELETE FROM automation_snapshots');
      const insertSnap = db.prepare(
        'INSERT INTO automation_snapshots (id, snap_order, payload_json, created_at) VALUES (?, ?, ?, ?)'
      );
      (state.automationSnapshots ?? []).forEach((snap, idx) => {
        const sId = String(snap.id ?? `snap-${idx}`);
        insertSnap.run(sId, idx, JSON.stringify(snap), String(snap.createdAt ?? now));
      });

      db.exec('DELETE FROM audit_events');
      const insertAudit = db.prepare(
        'INSERT INTO audit_events (id, evt_order, payload_json, timestamp) VALUES (?, ?, ?, ?)'
      );
      state.auditEvents.forEach((evt, idx) => {
        const eId = String(evt.id ?? `evt-${idx}-${Date.now()}`);
        insertAudit.run(eId, idx, JSON.stringify(evt), String(evt.timestamp ?? now));
      });

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  private readStateFromSqlite(): PersistedState | null {
    const db = this.open();
    const core = db.prepare('SELECT * FROM console_core WHERE id = 1').get() as
      | Record<string, unknown>
      | undefined;

    if (!core) return null;

    const channelRows = db
      .prepare('SELECT payload_json FROM channels ORDER BY channel_index ASC')
      .all() as Array<{ payload_json: string }>;
    const zoneRows = db
      .prepare('SELECT payload_json FROM speaker_zones ORDER BY zone_order ASC')
      .all() as Array<{ payload_json: string }>;
    const verRows = db
      .prepare('SELECT payload_json FROM config_versions ORDER BY version_order ASC')
      .all() as Array<{ payload_json: string }>;
    const snapRows = db
      .prepare('SELECT payload_json FROM automation_snapshots ORDER BY snap_order ASC')
      .all() as Array<{ payload_json: string }>;
    const auditRows = db
      .prepare('SELECT payload_json FROM audit_events ORDER BY evt_order ASC')
      .all() as Array<{ payload_json: string }>;

    const parseJson = <T>(raw: unknown, fallback: T): T => {
      if (typeof raw !== 'string') return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    };

    return hydrateWithDefaults({
      venue: parseJson(core.venue_json, undefined),
      dsp: parseJson(core.dsp_json, undefined),
      activePresetId: String(core.active_preset_id ?? ''),
      broadcastDsp: parseJson(core.broadcast_dsp_json, undefined),
      obsStatus: parseJson(core.obs_status_json, undefined),
      measurement: parseJson(core.measurement_json, undefined),
      bassDi: parseJson(core.bass_di_json, undefined),
      emergencyMuted: Boolean(core.emergency_muted),
      findings: parseJson(core.findings_json, []),
      diagnostics: parseJson(core.diagnostics_json, []),
      midiMappings: core.midi_mappings_json
        ? parseJson(core.midi_mappings_json, undefined)
        : undefined,
      keyboardShortcuts: core.keyboard_shortcuts_json
        ? parseJson(core.keyboard_shortcuts_json, undefined)
        : undefined,
      remoteAccess: parseJson(core.remote_access_json, undefined),
      channels: channelRows.map((r) => parseJson(r.payload_json, {})),
      zones: zoneRows.map((r) => parseJson(r.payload_json, {})),
      versions: verRows.map((r) => parseJson(r.payload_json, {})),
      automationSnapshots: snapRows.map((r) => parseJson(r.payload_json, {})),
      auditEvents: auditRows.map((r) => parseJson(r.payload_json, {})),
    });
  }

  public ensureStore(): PersistedState {
    if (this.cachedState) return this.cachedState;

    this.open();
    const fromSqlite = this.readStateFromSqlite();
    if (fromSqlite) {
      this.cachedState = fromSqlite;
      if (!fs.existsSync(JSON_BACKUP_FILE)) {
        this.writeJsonBackupImmediate(fromSqlite);
      }
      return fromSqlite;
    }

    // One-time migration if legacy church-audio-db.json already exists on disk
    if (fs.existsSync(JSON_BACKUP_FILE)) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(JSON_BACKUP_FILE, 'utf8')
        ) as Partial<PersistedState>;
        const hydrated = hydrateWithDefaults(parsed);
        this.writeStateToSqlite(hydrated);
        this.writeJsonBackupImmediate(hydrated);
        this.cachedState = hydrated;
        return hydrated;
      } catch {
        // Fallback to clean seed if legacy file corrupted
      }
    }

    const seeded = buildDefaultState();
    this.writeStateToSqlite(seeded);
    this.writeJsonBackupImmediate(seeded);
    this.cachedState = seeded;
    return seeded;
  }

  public saveStore(state: PersistedState, immediate = false): void {
    this.cachedState = state;
    this.writeStateToSqlite(state);
    this.scheduleJsonBackup(state, immediate);
  }

  public patchChannel(channelId: string, patch: Record<string, unknown>): PersistedState {
    const state = this.ensureStore();
    const now = new Date().toISOString();
    let updatedChannel: Record<string, unknown> | null = null;

    state.channels = state.channels.map((ch) => {
      if (ch.id === channelId) {
        updatedChannel = { ...ch, ...patch };
        return updatedChannel;
      }
      return ch;
    });

    if (updatedChannel) {
      const db = this.open();
      db.prepare('UPDATE channels SET payload_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(updatedChannel),
        now,
        channelId
      );
      this.scheduleJsonBackup(state, false);
    }

    return state;
  }

  public patchMaster(patch: { inputTrimDb?: number; emergencyMuted?: boolean }): PersistedState {
    const state = this.ensureStore();
    const now = new Date().toISOString();

    if (typeof patch.inputTrimDb === 'number') {
      state.dsp = { ...state.dsp, inputTrimDb: patch.inputTrimDb };
    }
    if (typeof patch.emergencyMuted === 'boolean') {
      state.emergencyMuted = patch.emergencyMuted;
    }

    const db = this.open();
    db.prepare(
      'UPDATE console_core SET dsp_json = ?, emergency_muted = ?, updated_at = ? WHERE id = 1'
    ).run(JSON.stringify(state.dsp), state.emergencyMuted ? 1 : 0, now);

    this.scheduleJsonBackup(state, false);
    return state;
  }

  public getDeviceProfile(deviceId: string): Record<string, unknown> | null {
    const db = this.open();
    const row = db
      .prepare('SELECT payload_json, updated_at FROM device_profiles WHERE device_id = ?')
      .get(deviceId) as { payload_json: string; updated_at: string } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.payload_json) as Record<string, unknown>;
      return { ...parsed, updatedAt: row.updated_at };
    } catch {
      return null;
    }
  }

  public saveDeviceProfile(deviceId: string, payload: Record<string, unknown>): { ok: boolean; updatedAt: string } {
    const db = this.open();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO device_profiles (device_id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`
    ).run(deviceId, JSON.stringify(payload), now);
    return { ok: true, updatedAt: now };
  }

  public getStats() {
    const state = this.ensureStore();
    let sqliteBytes = 0;
    try {
      sqliteBytes = fs.statSync(SQLITE_FILE).size;
    } catch {
      sqliteBytes = 0;
    }
    return {
      engine: 'sqlite-wal+json-backup',
      sqliteFile: '.data/church-audio.sqlite',
      jsonBackupFile: '.data/church-audio-db.json',
      sqliteBytes,
      channelsCount: state.channels.length,
      zonesCount: state.zones.length,
      versionsCount: state.versions.length,
      auditCount: state.auditEvents.length,
      automationsCount: state.automationSnapshots?.length ?? 0,
    };
  }
}

export const audioDb = new LocalAudioDatabase();
