# Release notes

## 0.2.32

- Implemented driverless Windows desktop audio source isolation (`set_desktop_audio_source_isolation`) that temporarily mutes source-app render sessions while process loopback captures audio pre-mute, eliminating single-speaker dry+wet doubling without a virtual cable.
- Added automatic safety hold/restore when any active render session cannot be safely isolated, plus clean session unmute restoration on stop or exit.
- Updated OBS livestreaming and routing views for driverless OBS Studio 28+ Application Audio Capture of HKM’s post-DSP output, with OBS WebSocket source detection and one-click processed output start.

## 0.2.31

- Fixed the desktop audio path from capture through channel DSP to speaker output.
- Surface native capture and output-device startup failures in the console.
- Added measured Windows system-wide CPU utilization; audio-thread CPU is not exposed by the Web Audio API.
- Reduced idle telemetry work and relabeled scheduling warnings so they are not presented as confirmed audio underruns.
