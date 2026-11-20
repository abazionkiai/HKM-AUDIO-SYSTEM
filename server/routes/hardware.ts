import { Router } from 'express';
import dgram from 'dgram';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { audioDb } from '../db.ts';
import { resolveCurrentHostPlatform } from '../config.ts';
import { recognizeAudioEndpoint } from '../../src/utils/hardwareRecognition.ts';
import type { DetectedHardwareEndpoint, PlatformTarget } from '../../src/types/audio.ts';

const execFileAsync = promisify(execFile);

export const hardwareRouter = Router();

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

export async function scanHostAudioHardware(): Promise<{
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

hardwareRouter.get('/scan', async (_req, res) => {
  const result = await scanHostAudioHardware();
  res.json({
    ok: true,
    scannedAt: new Date().toISOString(),
    hostPlatform: result.hostPlatform,
    endpoints: result.endpoints,
  });
});

hardwareRouter.get('/profiles/:deviceId', (req, res) => {
  const profile = audioDb.getDeviceProfile(req.params.deviceId);
  res.json({ ok: true, profile });
});

hardwareRouter.post('/profiles/:deviceId', (req, res) => {
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const saved = audioDb.saveDeviceProfile(req.params.deviceId, payload);
  res.json({ ...saved, deviceId: req.params.deviceId });
});
