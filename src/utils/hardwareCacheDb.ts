import type { DetectedHardwareEndpoint, HardwareDevice } from '../types/audio.ts';

const DB_NAME = 'church_audio_hardware_v1';
const DB_VERSION = 1;
const STORE_ENDPOINTS = 'endpoints';
const STORE_META = 'meta';

export interface CachedEndpointRecord {
  signature: string;
  endpoint: DetectedHardwareEndpoint;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

export interface CachedHardwareSnapshot {
  endpoints: DetectedHardwareEndpoint[];
  synthesizedDevices: HardwareDevice[];
  lastActiveDeviceId?: string;
}

export function buildEndpointSignature(ep: Pick<DetectedHardwareEndpoint, 'matchedDeviceId' | 'name' | 'vendorId' | 'productId'>): string {
  const usbPart = ep.vendorId ? `${ep.vendorId}:${ep.productId || '0000'}` : 'nousb';
  return `${ep.matchedDeviceId}::${ep.name.trim().toLowerCase()}::${usbPart}`;
}

function openHardwareDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ENDPOINTS)) {
          db.createObjectStore(STORE_ENDPOINTS, { keyPath: 'signature' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadCachedHardwareEndpoints(): Promise<CachedHardwareSnapshot> {
  const db = await openHardwareDb();
  if (!db) {
    return { endpoints: [], synthesizedDevices: [] };
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_ENDPOINTS, STORE_META], 'readonly');
      const epStore = tx.objectStore(STORE_ENDPOINTS);
      const metaStore = tx.objectStore(STORE_META);

      const epReq = epStore.getAll();
      const metaReq = metaStore.get('lastActiveDevice');

      let records: CachedEndpointRecord[] = [];
      let lastActiveDeviceId: string | undefined;

      epReq.onsuccess = () => {
        if (Array.isArray(epReq.result)) {
          records = epReq.result as CachedEndpointRecord[];
        }
      };

      metaReq.onsuccess = () => {
        const res = metaReq.result as { key: string; deviceId?: string } | undefined;
        if (res?.deviceId) {
          lastActiveDeviceId = res.deviceId;
        }
      };

      tx.oncomplete = () => {
        db.close();
        records.sort(
          (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
        );
        const endpoints: DetectedHardwareEndpoint[] = records.map((rec) => ({
          ...rec.endpoint,
          cachedFromIndexedDb: true,
          lastSeenAt: rec.lastSeenAt,
          seenCount: rec.seenCount,
        }));
        const synthesizedDevices: HardwareDevice[] = [];
        const seenSynth = new Set<string>();
        for (const ep of endpoints) {
          if (ep.synthesizedDevice && !seenSynth.has(ep.synthesizedDevice.id)) {
            seenSynth.add(ep.synthesizedDevice.id);
            synthesizedDevices.push(ep.synthesizedDevice);
          }
        }
        resolve({ endpoints, synthesizedDevices, lastActiveDeviceId });
      };

      tx.onerror = () => {
        db.close();
        resolve({ endpoints: [], synthesizedDevices: [] });
      };
    } catch {
      db.close();
      resolve({ endpoints: [], synthesizedDevices: [] });
    }
  });
}

export async function saveDetectedHardwareEndpoints(
  liveEndpoints: DetectedHardwareEndpoint[],
  activeDeviceId?: string
): Promise<DetectedHardwareEndpoint[]> {
  const db = await openHardwareDb();
  const nowIso = new Date().toISOString();

  if (!db) {
    return liveEndpoints.map((ep) => ({
      ...ep,
      cachedFromIndexedDb: false,
      lastSeenAt: nowIso,
      seenCount: ep.seenCount ?? 1,
    }));
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_ENDPOINTS, STORE_META], 'readwrite');
      const epStore = tx.objectStore(STORE_ENDPOINTS);
      const metaStore = tx.objectStore(STORE_META);

      const getAllReq = epStore.getAll();

      getAllReq.onsuccess = () => {
        const existingList = Array.isArray(getAllReq.result)
          ? (getAllReq.result as CachedEndpointRecord[])
          : [];
        const existingMap = new Map<string, CachedEndpointRecord>();
        existingList.forEach((rec) => existingMap.set(rec.signature, rec));

        const updatedSignatures = new Set<string>();

        for (const ep of liveEndpoints) {
          const signature = buildEndpointSignature(ep);
          updatedSignatures.add(signature);
          const prev = existingMap.get(signature);
          const nextRec: CachedEndpointRecord = {
            signature,
            endpoint: {
              ...ep,
              cachedFromIndexedDb: false,
              lastSeenAt: nowIso,
              seenCount: (prev?.seenCount ?? 0) + 1,
            },
            firstSeenAt: prev?.firstSeenAt ?? nowIso,
            lastSeenAt: nowIso,
            seenCount: (prev?.seenCount ?? 0) + 1,
          };
          existingMap.set(signature, nextRec);
          epStore.put(nextRec);
        }

        if (activeDeviceId) {
          metaStore.put({
            key: 'lastActiveDevice',
            deviceId: activeDeviceId,
            updatedAt: nowIso,
          });
        }

        const mergedResult: DetectedHardwareEndpoint[] = [];
        for (const [sig, rec] of existingMap.entries()) {
          mergedResult.push({
            ...rec.endpoint,
            cachedFromIndexedDb: !updatedSignatures.has(sig),
            lastSeenAt: rec.lastSeenAt,
            seenCount: rec.seenCount,
          });
        }

        // Sort live hardware first, then recently seen cached hardware
        mergedResult.sort((a, b) => {
          const aLive = a.cachedFromIndexedDb ? 1 : 0;
          const bLive = b.cachedFromIndexedDb ? 1 : 0;
          if (aLive !== bLive) return aLive - bLive;
          return new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime();
        });

        tx.oncomplete = () => {
          db.close();
          resolve(mergedResult);
        };
      };

      tx.onerror = () => {
        db.close();
        resolve(liveEndpoints);
      };
    } catch {
      db.close();
      resolve(liveEndpoints);
    }
  });
}

export async function saveLastActiveHardwareId(deviceId: string): Promise<void> {
  const db = await openHardwareDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_META], 'readwrite');
      tx.objectStore(STORE_META).put({
        key: 'lastActiveDevice',
        deviceId,
        updatedAt: new Date().toISOString(),
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function clearCachedHardwareEndpoints(): Promise<void> {
  const db = await openHardwareDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_ENDPOINTS], 'readwrite');
      tx.objectStore(STORE_ENDPOINTS).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
