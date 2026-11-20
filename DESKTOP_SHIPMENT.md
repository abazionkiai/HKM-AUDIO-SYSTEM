# Desktop shipment: first milestone

The Windows desktop target now has a Tauri 2 shell, NSIS/MSI bundle targets, and a Rust-owned local state bridge. The desktop bridge stores state under the operating system's app data directory and only accepts the application's allowlisted `/api` routes. The existing Express web development path remains available.

## Build locally

Install the Node dependencies, Rust, the MSVC C++ build tools, WebView2, and the Tauri CLI (`cargo install tauri-cli --version '^2' --locked`). Then run:

```powershell
npm run desktop:dev
npm run desktop:build:windows
```

## Shipment status

This is the desktop foundation, not a release candidate. The desktop build does not yet include the native ASIO/WASAPI/CamillaDSP audio engine, real OBS control, or a secure AI provider setup. AI actions return an explicit unavailable response in the desktop build. Installer signing, update delivery, hardware qualification, and clean-machine installation checks are still required before distribution.
