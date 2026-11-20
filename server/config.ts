import os from 'os';
import type { PlatformTarget } from '../src/types/audio.ts';

export function resolveCurrentHostPlatform(): PlatformTarget {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

export function listLanInterfaces(port: number) {
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
