# Church Audio Intelligence — Cross-Platform & Plugin Architecture

## 1. Cross-Platform Audio & Build Refactoring (Windows, macOS, Linux)

The application separates the React/TypeScript UI from native audio I/O and DSP supervision so the same UI codebase targets **Windows (primary)**, **macOS**, and **Linux** via **Tauri 2 + Rust + CamillaDSP**:

| Platform | Target Triple | Audio Backends | Sidecar Binary Resolution | Installer |
| :--- | :--- | :--- | :--- | :--- |
| **Windows 10/11 (x64)** | `x86_64-pc-windows-msvc` | ASIO 2.3, WASAPI Exclusive, WASAPI Shared | `resources/bin/win32-x64/camilladsp.exe` | Signed MSI / NSIS |
| **macOS 14+ (Universal)** | `universal-apple-darwin` | CoreAudio, AUHAL (Aggregate Devices) | `Contents/Resources/bin/darwin-universal/camilladsp` | Universal `.dmg` |
| **Linux (Ubuntu/Debian/Arch)** | `x86_64-unknown-linux-gnu` | PipeWire, ALSA UAC2, JACK2 | `/usr/lib/church-audio/bin/camilladsp` | AppImage / `.deb` |

### Required Codebase Abstractions
1. **`AudioBackendAdapter` Trait (Rust / Native Host)**: Abstracts device enumeration, buffer size negotiation, and stream callbacks across WASAPI/ASIO (`cpal` + `asio-sys`), CoreAudio, and ALSA/PipeWire.
2. **Platform-Normalized Paths & IPC**: Configuration snapshots and REW sweeps use OS-agnostic app data directories (`tauri::api::path::app_config_dir`) rather than hardcoded Windows `C:\` paths, and communicate with the supervised `camilladsp` sidecar over local WebSocket (`127.0.0.1:1234`).
3. **Device Capability Contracts**: Hardware adapters report explicit control authority (`perChannelFaderControl`, `perChannelCapture`, `stereoMixCapture`, `phantomPowerControl`) so the UI never pretends to move analog faders on stereo-USB consoles like the Yamaha MG16XU.

---

## 2. Dynamic Plugin System & SDK API

Plugins are loaded at runtime via `src/plugins/pluginManager.ts` (and in Tauri desktop builds from `<app_data>/plugins/*.json` or dynamic WASM/shared libraries) under two interfaces:

```ts
export interface AudioPlugin {
  readonly id: string;
  readonly version: string;
  readonly kind: 'hardware-driver' | 'dsp-processor';
  readonly supportedPlatforms: ('windows' | 'macos' | 'linux')[];
  readonly protocols: ('ASIO' | 'WASAPI Exclusive' | 'CoreAudio' | 'PipeWire' | 'ALSA')[];
  onLoad(host: PluginHostContext): Promise<void>;
  onUnload(): Promise<void>;
}

export interface HardwareDriverPlugin extends AudioPlugin {
  kind: 'hardware-driver';
  discoverDevices(): Promise<HardwareDevice[]>;
  getCapabilities(deviceId: string): HardwareCapabilities;
  setChannelGain?(channel: number, gainDb: number): Promise<void>;
  setChannelMute?(channel: number, muted: boolean): Promise<void>;
}

export interface DspProcessorPlugin extends AudioPlugin {
  kind: 'dsp-processor';
  getParameters(): DspPluginParameter[];
  setParameter(key: string, value: number): void;
  toCamillaDspStage(): CamillaFilterSpec;
}
```

---

## 3. Recommended Audio Interfaces & Mixing Hardware (Beyond Yamaha MG16XU)

1. **RME Fireface UCX II (20×20)** — Benchmark Windows ASIO & macOS CoreAudio driver stability (32–64 sample buffers) + Linux Class-Compliant mode.
2. **MOTU UltraLite-mk5 (18×22)** — 10 balanced line outputs ideal for multi-zone church PA + livestream routing across Windows/macOS/Linux.
3. **Focusrite Scarlett 18i20 (4th Gen, 18×20)** — Remote preamp gain, +48V phantom, and low-latency ASIO/CoreAudio/ALSA support.
4. **Audient iD44 MkII (20×24)** — Console-grade preamps with dedicated loopback stream for OBS livestream capture.
5. **Behringer U-PHORIA UMC1820 (18×20)** — Cost-effective 8-preamp multitrack interface with native Linux kernel UAC2 support.
6. **Solid State Logic SSL 12 (12×8)** — Software-controlled +48V, HPF, and 4 balanced outputs for small/medium church sanctuaries.
7. **Universal Audio Volt 476P (4×4)** — Compact 4-input broadcast interface for mixer stereo return + room ambience mics.
8. **Soundcraft Signature 12 MTK (14×12)** — Multitrack analog mixer allowing per-channel software DSP inserts.
9. **Behringer X Air XR18 / X32** — Full bidirectional UDP OSC fader/preamp control + multitrack USB.
10. **Allen & Heath SQ-5 / Yamaha DM3** — 96 kHz digital consoles with Dante/SLink expansion and dedicated broadcast buses.
