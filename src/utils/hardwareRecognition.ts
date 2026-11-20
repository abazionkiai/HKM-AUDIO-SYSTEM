import type {
  DetectedHardwareEndpoint,
  DriverBackend,
  HardwareDevice,
  PlatformTarget,
} from '../types/audio.ts';
import { HARDWARE_CATALOG } from '../data/hardwareCatalog.ts';

export const USB_VENDOR_MAP: Record<string, string> = {
  '0499': 'Yamaha',
  '1235': 'Focusrite',
  '1397': 'Behringer / Midas',
  '07fd': 'MOTU',
  '2a39': 'RME',
  '194f': 'PreSonus',
  '0944': 'KORG',
  '0582': 'Roland',
  '22e8': 'Audinate (Dante)',
  '10ec': 'Realtek (Internal)',
  '8086': 'Intel Smart Sound (Internal)',
  '1022': 'AMD Audio (Internal)',
  '05ac': 'Apple Built-in Audio',
  '0d8c': 'C-Media USB Audio',
  '08bb': 'Texas Instruments USB Audio',
  '17cc': 'Native Instruments',
  '17a0': 'Samson Audio',
  '0e41': 'Line 6',
  '2b53': 'Allen & Heath',
  '05fc': 'Harman / Soundcraft',
  '21b4': 'AudioQuest / miniDSP',
  '2752': 'miniDSP',
};

interface CatalogFingerprintRule {
  deviceId: string;
  vendorIds?: string[];
  productIds?: string[];
  patterns: RegExp[];
}

const FINGERPRINT_RULES: CatalogFingerprintRule[] = [
  {
    deviceId: 'yamaha-mg16xu',
    vendorIds: ['0499'],
    productIds: ['1700', '170f'],
    patterns: [/\bmg\s?(?:10|12|16|20)xu\b/i, /yamaha.*steinberg.*usb/i, /\bmg-?xu\b/i],
  },
  {
    deviceId: 'soundcraft-sig12mtk',
    vendorIds: ['05fc'],
    patterns: [/signature\s*(?:12|22)\s*mtk/i, /soundcraft.*mtk/i],
  },
  {
    deviceId: 'focusrite-18i20-g4',
    vendorIds: ['1235'],
    patterns: [/scarlett\s*(?:18i20|18i16|18i8|8i6|4i4|2i2)/i, /focusrite\s+usb/i, /clarett/i],
  },
  {
    deviceId: 'behringer-xr18',
    vendorIds: ['1397'],
    patterns: [/\bxr\s?18\b/i, /\bx-air\b/i, /\bmr\s?18\b/i, /umc1820/i, /behringer\s+usb/i],
  },
  {
    deviceId: 'behringer-x32',
    vendorIds: ['1397'],
    patterns: [/\bx32\b/i, /\bm32\b/i, /x-usb/i, /x-live/i, /dn32/i],
  },
  {
    deviceId: 'allen-heath-sq5',
    vendorIds: ['2b53'],
    patterns: [/allen\s*&?\s*heath/i, /\bsq-?[567]\b/i, /\bqu-?(?:16|24|32|pac|sb)\b/i],
  },
  {
    deviceId: 'allen-heath-ahm16',
    vendorIds: ['2b53'],
    patterns: [/\bahm-?(?:16|32|64)\b/i],
  },
  {
    deviceId: 'yamaha-dm3',
    vendorIds: ['0499'],
    patterns: [/\bdm3\b/i, /\btf[135]\b/i, /\bql[15]\b/i, /\bcl[135]\b/i],
  },
  {
    deviceId: 'rme-babyface-pro',
    vendorIds: ['2a39'],
    patterns: [/babyface/i, /fireface/i, /madiface/i, /\brme\b/i],
  },
  {
    deviceId: 'motu-828es',
    vendorIds: ['07fd'],
    patterns: [/\bmotu\b/i, /828es/i, /ultralite/i, /m[246]/i],
  },
  {
    deviceId: 'dante-virtual-soundcard',
    vendorIds: ['22e8'],
    patterns: [/dante/i, /audinate/i, /dvs/i],
  },
  {
    deviceId: 'minidsp-umik1',
    vendorIds: ['2752', '21b4'],
    patterns: [/umik-?1/i, /umik-?2/i, /minidsp/i],
  },
];

export function extractUsbIds(rawText: string): { vendorId?: string; productId?: string } {
  const parenMatch = rawText.match(/\(([0-9a-f]{4}):([0-9a-f]{4})\)/i);
  if (parenMatch) {
    return {
      vendorId: parenMatch[1].toLowerCase(),
      productId: parenMatch[2].toLowerCase(),
    };
  }
  const winMatch = rawText.match(/VID_([0-9a-f]{4})&PID_([0-9a-f]{4})/i);
  if (winMatch) {
    return {
      vendorId: winMatch[1].toLowerCase(),
      productId: winMatch[2].toLowerCase(),
    };
  }
  const colonMatch = rawText.match(/\b([0-9a-f]{4}):([0-9a-f]{4})\b/i);
  if (colonMatch) {
    return {
      vendorId: colonMatch[1].toLowerCase(),
      productId: colonMatch[2].toLowerCase(),
    };
  }
  return {};
}

export function classifyEndpointKind(
  name: string,
  vendorId?: string
): DetectedHardwareEndpoint['kind'] {
  const lower = name.toLowerCase();
  if (/dante|audinate|vb-audio|voicemeeter|blackhole|soundflower|loopback|obs\b/i.test(lower)) {
    return 'virtual';
  }
  if (/bluetooth|hands-free|a2dp|airpods|bose|sony wh-/i.test(lower)) {
    return 'bluetooth';
  }
  if (/thunderbolt|apogee|universal audio|ua apollo/i.test(lower)) {
    return 'thunderbolt';
  }
  if (
    vendorId === '10ec' ||
    vendorId === '8086' ||
    vendorId === '1022' ||
    vendorId === '05ac' ||
    /realtek|high definition audio|internal|built-in|macbook|display audio|hdmi|intel\(r\) smart sound|amd high definition/i.test(
      lower
    )
  ) {
    return 'internal';
  }
  if (vendorId || /usb|scarlett|yamaha|behringer|presonus|motu|rme|soundcraft|umik|codec|mic/i.test(lower)) {
    return 'usb-audio';
  }
  return 'unknown';
}

export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'audio-device';
}

export interface RawHardwareInput {
  id?: string;
  browserDeviceId?: string;
  name: string;
  direction?: 'input' | 'output' | 'duplex';
  source: 'browser-media' | 'os-probe' | 'lan-discovery';
  vendorId?: string;
  productId?: string;
  estimatedInputChannels?: number;
  estimatedOutputChannels?: number;
  asioDriverName?: string;
  isDefault?: boolean;
  hostAddress?: string;
  platform?: PlatformTarget;
}

export function recognizeAudioEndpoint(raw: RawHardwareInput): DetectedHardwareEndpoint {
  const cleanName = raw.name.trim() || 'Generic System Audio Endpoint';
  const parsedIds = extractUsbIds(cleanName);
  const vendorId = (raw.vendorId || parsedIds.vendorId)?.toLowerCase();
  const productId = (raw.productId || parsedIds.productId)?.toLowerCase();
  const kind =
    raw.source === 'lan-discovery'
      ? 'network-console'
      : classifyEndpointKind(cleanName, vendorId);

  const vendorLabel = vendorId ? USB_VENDOR_MAP[vendorId] : undefined;
  const targetPlatform: PlatformTarget = raw.platform ?? 'windows';

  // 1. Try exact productId or model name pattern match against HARDWARE_CATALOG
  let matchedCatalogDevice: HardwareDevice | undefined;
  let confidence: DetectedHardwareEndpoint['confidence'] = 'auto-synthesized';

  for (const rule of FINGERPRINT_RULES) {
    const dev = HARDWARE_CATALOG.find((d) => d.id === rule.deviceId);
    if (!dev) continue;

    if (
      vendorId &&
      productId &&
      rule.vendorIds?.includes(vendorId) &&
      rule.productIds?.includes(productId)
    ) {
      matchedCatalogDevice = dev;
      confidence = 'exact-usb-id';
      break;
    }

    if (rule.patterns.some((re) => re.test(cleanName))) {
      matchedCatalogDevice = dev;
      confidence = vendorId ? 'exact-usb-id' : 'model-match';
      break;
    }
  }

  // 2. Fallback to vendorId match if only vendor matches a known catalog interface
  if (!matchedCatalogDevice && vendorId) {
    const vendorRule = FINGERPRINT_RULES.find((r) => r.vendorIds?.includes(vendorId));
    if (vendorRule) {
      matchedCatalogDevice = HARDWARE_CATALOG.find((d) => d.id === vendorRule.deviceId);
      if (matchedCatalogDevice) {
        confidence = 'vendor-match';
      }
    }
  }

  const inCh =
    raw.estimatedInputChannels ??
    matchedCatalogDevice?.capabilities.maxInputChannels ??
    (kind === 'internal' || kind === 'bluetooth' ? 2 : 2);
  const outCh =
    raw.estimatedOutputChannels ??
    matchedCatalogDevice?.capabilities.maxOutputChannels ??
    2;

  const recommendedDriver: DriverBackend =
    targetPlatform === 'macos'
      ? 'CoreAudio'
      : targetPlatform === 'linux'
        ? 'PipeWire'
        : raw.asioDriverName ||
            (matchedCatalogDevice &&
              matchedCatalogDevice.capabilities.supportedDrivers.includes('ASIO') &&
              kind !== 'internal' &&
              kind !== 'bluetooth')
          ? 'ASIO'
          : kind === 'internal' || kind === 'bluetooth' || kind === 'virtual'
            ? 'WASAPI Shared'
            : 'WASAPI Exclusive';

  if (matchedCatalogDevice) {
    return {
      id: raw.id || `det-${sanitizeSlug(cleanName)}-${vendorId || 'std'}`,
      browserDeviceId: raw.browserDeviceId,
      name: cleanName,
      direction: raw.direction ?? 'duplex',
      kind,
      source: raw.source,
      vendorId,
      productId,
      manufacturer: matchedCatalogDevice.manufacturer,
      estimatedInputChannels: inCh,
      estimatedOutputChannels: outCh,
      matchedDeviceId: matchedCatalogDevice.id,
      matchedLabel: `${matchedCatalogDevice.manufacturer} ${matchedCatalogDevice.model}`,
      confidence,
      recommendedDriver,
      recommendedSampleRate: matchedCatalogDevice.defaultSampleRate,
      asioDriverName: raw.asioDriverName,
      isDefault: raw.isDefault,
      hostAddress: raw.hostAddress,
      detectedAt: new Date().toISOString(),
    };
  }

  // 3. Universal Auto-Profile Synthesizer for any internal/external card not in catalog
  const autoId = `auto-${sanitizeSlug(cleanName)}${vendorId ? `-${vendorId}${productId || ''}` : ''}`;
  const inferredManufacturer =
    vendorLabel ||
    (kind === 'internal'
      ? 'Internal System Audio'
      : kind === 'virtual'
        ? 'Virtual Audio Driver'
        : kind === 'bluetooth'
          ? 'Bluetooth Audio'
          : 'USB Audio Class');

  const shortModel = cleanName
    .replace(/\(([0-9a-f]{4}:[0-9a-f]{4})\)/gi, '')
    .replace(/^Microphone\s*\(/i, '')
    .replace(/^Line In\s*\(/i, '')
    .replace(/\)$/g, '')
    .trim();

  const synthesizedDevice: HardwareDevice = {
    id: autoId,
    manufacturer: inferredManufacturer,
    model: shortModel || cleanName,
    tier: 1,
    tierLabel:
      kind === 'internal'
        ? 'Auto-Detected · Internal Sound Card'
        : kind === 'virtual'
          ? 'Auto-Detected · Virtual Audio Bus'
          : 'Auto-Detected · Universal USB/Audio Interface',
    category:
      kind === 'internal'
        ? 'Internal Sound Card'
        : kind === 'virtual'
          ? 'Virtual Audio Router'
          : 'USB Audio Interface',
    connectionType:
      vendorId && productId
        ? `${kind.toUpperCase()} (${inCh}-in / ${outCh}-out) · VID:${vendorId.toUpperCase()} PID:${productId.toUpperCase()}`
        : `${kind.toUpperCase()} (${inCh}-in / ${outCh}-out) · ${recommendedDriver}`,
    sampleRates: kind === 'internal' ? [44100, 48000] : [44100, 48000, 96000],
    defaultSampleRate: 48000,
    defaultBufferSize: kind === 'internal' || kind === 'bluetooth' ? 512 : 256,
    supportedPlatforms: ['windows', 'macos', 'linux'],
    capabilities: {
      perChannelFaderControl: false,
      perChannelCapture: inCh > 2,
      stereoMixCapture: true,
      phantomPowerControl: false,
      remoteMuteSolo: false,
      networkMatrix: kind === 'network-console',
      calibratedMeasurement: /umik/i.test(cleanName),
      maxInputChannels: Math.max(2, inCh),
      maxOutputChannels: Math.max(2, outCh),
      controlProtocol: raw.asioDriverName
        ? `ASIO (${raw.asioDriverName}) + Software DSP`
        : `${recommendedDriver} Universal Class Audio`,
      supportedDrivers:
        targetPlatform === 'windows'
          ? raw.asioDriverName
            ? ['ASIO', 'WASAPI Exclusive', 'WASAPI Shared']
            : ['WASAPI Exclusive', 'WASAPI Shared']
          : targetPlatform === 'macos'
            ? ['CoreAudio']
            : ['PipeWire', 'ALSA'],
      limitationsNote:
        kind === 'internal'
          ? 'Auto-profiled internal motherboard/laptop sound card. Recommended WASAPI Shared @ 48 kHz for clean room playback or talkback capture.'
          : 'Auto-synthesized plug-and-play profile from OS hardware descriptors. Individual physical knobs remain manual while full software EQ, HPF, compression, and speaker matrix run in CamillaDSP.',
    },
  };

  return {
    id: raw.id || `det-${autoId}`,
    browserDeviceId: raw.browserDeviceId,
    name: cleanName,
    direction: raw.direction ?? 'duplex',
    kind,
    source: raw.source,
    vendorId,
    productId,
    manufacturer: inferredManufacturer,
    estimatedInputChannels: Math.max(2, inCh),
    estimatedOutputChannels: Math.max(2, outCh),
    matchedDeviceId: autoId,
    matchedLabel: `${synthesizedDevice.manufacturer} ${synthesizedDevice.model}`,
    confidence: 'auto-synthesized',
    recommendedDriver,
    recommendedSampleRate: 48000,
    asioDriverName: raw.asioDriverName,
    isDefault: raw.isDefault,
    hostAddress: raw.hostAddress,
    detectedAt: new Date().toISOString(),
    synthesizedDevice,
  };
}

export async function scanBrowserMediaDevices(
  platform: PlatformTarget = 'windows'
): Promise<DetectedHardwareEndpoint[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const mediaList = await navigator.mediaDevices.enumerateDevices();
  const seenLabels = new Map<string, DetectedHardwareEndpoint>();

  for (const item of mediaList) {
    if (item.kind !== 'audioinput' && item.kind !== 'audiooutput') continue;
    const rawLabel = item.label?.trim();
    if (!rawLabel) continue;
    // Skip duplicate browser "Default - ..." / "Communications - ..." aliases when real entry exists
    const isDefault = /^default\s*-/i.test(rawLabel) || item.deviceId === 'default';
    if (/^communications\s*-/i.test(rawLabel)) continue;

    const normalizedName = rawLabel.replace(/^default\s*-\s*/i, '').trim();
    const key = `${normalizedName.toLowerCase()}::${item.kind}`;
    if (seenLabels.has(key)) continue;

    const recognized = recognizeAudioEndpoint({
      id: `web-${item.kind}-${item.deviceId.slice(0, 12)}`,
      browserDeviceId: item.kind === 'audioinput' ? item.deviceId : undefined,
      name: normalizedName,
      direction: item.kind === 'audioinput' ? 'input' : 'output',
      source: 'browser-media',
      isDefault,
      platform,
    });

    seenLabels.set(key, recognized);
  }

  return Array.from(seenLabels.values());
}
