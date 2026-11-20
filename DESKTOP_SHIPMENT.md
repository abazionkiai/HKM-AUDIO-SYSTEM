# Desktop shipment: first milestone

The Windows desktop target now has a Tauri 2 shell, NSIS/MSI bundle targets, and a Rust-owned local state bridge. The desktop bridge stores state under the operating system's app data directory and only accepts the application's allowlisted `/api` routes. The existing Express web development path remains available.

## Build locally

Install the Node dependencies, Rust, the MSVC C++ build tools, WebView2, and the Tauri CLI (`cargo install tauri-cli --version '^2' --locked`). Then run:

```powershell
npm run desktop:dev
npm run desktop:build:windows
```

## Local build checkpoint (2026-11-20)

The optimized Windows build produced both installer formats under `src-tauri/target/release/bundle/`:

- MSI: `msi/Church Audio Intelligence_0.1.0_x64_en-US.msi`
- NSIS: `nsis/Church Audio Intelligence_0.1.0_x64-setup.exe`

The installers are unsigned and have not been installed on a clean machine. The frontend build succeeded; Vite reports the main JavaScript chunk at about 826 KB, above its 500 KB warning threshold.

## Shipment status

This is the desktop foundation, not a release candidate. The desktop build does not yet include the native ASIO/WASAPI/CamillaDSP audio engine, real OBS control, or a secure AI provider setup. AI actions return an explicit unavailable response in the desktop build. Installer signing, update delivery, hardware qualification, and clean-machine installation checks are still required before distribution.
