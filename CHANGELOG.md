# Release notes

## 0.2.36

- Simplified and unified the audio input pipeline so HKM scans all available physical inputs (USB interfaces, microphones, line-ins) and virtual cable inputs (`CABLE Output / VB-Audio Virtual Cable`, VoiceMeeter, BlackHole) and imports them 1-to-1 as live console input channels (`CH 1 .. CH N`) where the DSP processing chain starts immediately.
- Refactored desktop/browser audio capture to use the industry-standard **VB-Audio Virtual Cable route** (`Browser/App → CABLE Input → HKM VB-Audio Cable Channel → DSP → Physical Speakers`) with 1-click setup and automatic cycle-guarded self-loopback protection.

## 0.2.35

- Implemented cross-rate resampling in `desktop-loopback-worklet.js` and `raw-output-tap-worklet.js` so 48 kHz native WASAPI streams and arbitrary Web Audio `AudioContext` sample rates (e.g. 44.1 kHz / 48 kHz / 96 kHz) bridge cleanly without pitch shift or drift.
- Hardened output routing (`outputRouter.ts`), source capture (`sourceCaptureManager.ts`), and device naming/auto-slotting (`audioNaming.ts`, `_verify_audio.ts`).

## 0.2.34

- Refactored the Web Audio engine (`liveAudioEngine.ts`) into modular DSP blocks: `audioUtils.ts`, `channelStripBank.ts`, `masterDspGraph.ts`, `outputRouter.ts`, `sourceCaptureManager.ts`, and `telemetryAnalyzer.ts`.
- Synchronized lockfiles and ignore rules for clean desktop release packaging.

## 0.2.33

- Added the **System Audio Input Bridge** (`systemAudioBridge.ts`) supporting browser `getDisplayMedia` capture (with `suppressLocalAudioPlayback` tab isolation) as well as specialized virtual audio interfaces (VB-Cable, BlackHole, VoiceMeeter, Stereo Mix) and Tauri WASAPI process-exclusion loopback.
- Added the **Self-Loopback Firewall** inside `liveAudioEngine` to prevent desktop audio self-oscillation even when physical microphones are muted, plus 1-click secondary headphone/USB monitor rerouting and isolated browser-tab re-pick controls across `TopBar`, `ConsoleLeftPanel`, `HardwareDiagnosticsModule`, and the main alert banner.
- Fixed Windows desktop audio session enumeration (`src-tauri/src/desktop_audio.rs`) to exclude the entire HKM parent/child WebView2 process tree, preventing child renderer sessions from leaking or double-routing.
- Resolved React `Maximum update depth exceeded` errors by stabilizing store hooks, callback references, hardware scan mutexes, peak-hold state updates, and OBS mute deduplication.

## 0.2.32

- Implemented driverless Windows desktop audio source isolation (`set_desktop_audio_source_isolation`) that temporarily mutes source-app render sessions while process loopback captures audio pre-mute, eliminating single-speaker dry+wet doubling without a virtual cable.
- Added automatic safety hold/restore when any active render session cannot be safely isolated, plus clean session unmute restoration on stop or exit.
- Updated OBS livestreaming and routing views for driverless OBS Studio 28+ Application Audio Capture of HKM’s post-DSP output, with OBS WebSocket source detection and one-click processed output start.

## 0.2.31

- Fixed the desktop audio path from capture through channel DSP to speaker output.
- Surface native capture and output-device startup failures in the console.
- Added measured Windows system-wide CPU utilization; audio-thread CPU is not exposed by the Web Audio API.
- Reduced idle telemetry work and relabeled scheduling warnings so they are not presented as confirmed audio underruns.
