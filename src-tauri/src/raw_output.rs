use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOutputEndpointInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub raw_supported: bool,
    pub apo_registered: bool,
}

#[cfg(windows)]
mod win_impl {
    use super::*;
    use apo_shared::APO_CLSID_STR;
    use std::collections::VecDeque;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread::{self, JoinHandle};
    use windows::core::{GUID, BOOL, PCWSTR};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, PROPERTYKEY};
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, AudioClientProperties, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDCLNT_STREAMOPTIONS_RAW, AudioCategory_Media,
        IAudioClient, IAudioClient2, IAudioRenderClient, IMMDevice, IMMDeviceEnumerator,
        MMDeviceEnumerator, DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
        WAVEFORMATEXTENSIBLE_0,
    };
    use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
    };
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ, REG_SZ,
    };
    use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};

    // PKEY_Devices_AudioDevice_RawProcessingSupported = {8943B373-388C-4395-B557-BC6DBAFFAFDB}, 2
    const PKEY_RAW_PROCESSING_SUPPORTED: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_values(
            0x8943_b373,
            0x388c,
            0x4395,
            [0xb5, 0x57, 0xbc, 0x6d, 0xba, 0xff, 0xaf, 0xdb],
        ),
        pid: 2,
    };

    const RENDER_SAMPLE_RATE: u32 = 48000;
    const RENDER_CHANNELS: u16 = 2;
    // Cap queued buffer to ~85ms stereo so latency never drifts
    const MAX_QUEUE_SAMPLES: usize = 4096 * 2;

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Reads HKLM\...\MMDevices\Audio\Render\{GUID}\FxProperties MFX key to see if our CLSID is attached.
    pub fn check_endpoint_apo_registered(endpoint_id: &str) -> bool {
        // Endpoint IDs look like {0.0.0.00000000}.{GUID}; registry stores just {GUID}.
        let guid_part = endpoint_id
            .rsplit('.')
            .next()
            .unwrap_or(endpoint_id)
            .trim();
        if !guid_part.starts_with('{') || !guid_part.ends_with('}') {
            return false;
        }
        let subkey = format!(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render\\{guid_part}\\FxProperties"
        );
        let subkey_w = to_wide(&subkey);
        let value_name = to_wide("{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},6");
        unsafe {
            let mut hkey = HKEY::default();
            if RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                PCWSTR(subkey_w.as_ptr()),
                Some(0),
                KEY_READ,
                &mut hkey,
            )
            .is_err()
            {
                return false;
            }
            let mut buf = [0u8; 256];
            let mut buf_len = buf.len() as u32;
            let mut val_type = REG_SZ;
            let ok = RegQueryValueExW(
                hkey,
                PCWSTR(value_name.as_ptr()),
                None,
                Some(&mut val_type),
                Some(buf.as_mut_ptr()),
                Some(&mut buf_len),
            )
            .is_ok();
            let _ = RegCloseKey(hkey);
            if !ok || buf_len < 2 {
                return false;
            }
            let u16_len = (buf_len as usize) / 2;
            let slice = std::slice::from_raw_parts(buf.as_ptr() as *const u16, u16_len);
            let s = String::from_utf16_lossy(slice)
                .trim_end_matches('\0')
                .to_string();
            s.eq_ignore_ascii_case(APO_CLSID_STR)
        }
    }

    pub fn list_raw_output_endpoints() -> Vec<RawOutputEndpointInfo> {
        let mut results = Vec::new();
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: windows::core::Result<IMMDeviceEnumerator> =
                windows::Win32::System::Com::CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
            let Ok(enumerator) = enumerator else {
                CoUninitialize();
                return results;
            };

            let default_id = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .ok()
                .and_then(|dev| dev.GetId().ok())
                .and_then(|p| {
                    let s = p.to_string().ok();
                    CoTaskMemFree(Some(p.0 as *const c_void));
                    s
                })
                .unwrap_or_default();

            if let Ok(col) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                let count = col.GetCount().unwrap_or(0);
                for i in 0..count {
                    let Ok(dev) = col.Item(i) else {
                        continue;
                    };
                    let id = dev
                        .GetId()
                        .ok()
                        .and_then(|p| {
                            let s = p.to_string().ok();
                            CoTaskMemFree(Some(p.0 as *const c_void));
                            s
                        })
                        .unwrap_or_default();
                    if id.is_empty() {
                        continue;
                    }
                    let mut name = id.clone();
                    let mut raw_supported = false;
                    if let Ok(store) = dev.OpenPropertyStore(STGM_READ) {
                        if let Ok(prop) = store.GetValue(&PKEY_Device_FriendlyName) {
                            let s = prop.to_string();
                            if !s.is_empty() {
                                name = s;
                            }
                        }
                        if let Ok(prop) = store.GetValue(&PKEY_RAW_PROCESSING_SUPPORTED) {
                            // PROPVARIANT VT_BOOL (-1 == TRUE)
                            let vt = prop.Anonymous.Anonymous.vt;
                            if vt.0 == 11 {
                                raw_supported = prop.Anonymous.Anonymous.Anonymous.boolVal.as_bool();
                            }
                        }
                    }

                    let apo_registered = check_endpoint_apo_registered(&id);
                    results.push(RawOutputEndpointInfo {
                        is_default: id == default_id,
                        id,
                        name,
                        raw_supported,
                        apo_registered,
                    });
                }
            }
            CoUninitialize();
        }
        results
    }

    fn build_render_format() -> WAVEFORMATEXTENSIBLE {
        WAVEFORMATEXTENSIBLE {
            Format: WAVEFORMATEX {
                wFormatTag: WAVE_FORMAT_EXTENSIBLE as u16,
                nChannels: RENDER_CHANNELS,
                nSamplesPerSec: RENDER_SAMPLE_RATE,
                nAvgBytesPerSec: RENDER_SAMPLE_RATE * (RENDER_CHANNELS as u32) * 4,
                nBlockAlign: RENDER_CHANNELS * 4,
                wBitsPerSample: 32,
                cbSize: (std::mem::size_of::<WAVEFORMATEXTENSIBLE>()
                    - std::mem::size_of::<WAVEFORMATEX>()) as u16,
            },
            Samples: WAVEFORMATEXTENSIBLE_0 {
                wValidBitsPerSample: 32,
            },
            dwChannelMask: 0x3,
            SubFormat: GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71),
        }
    }

    fn resolve_render_device(
        enumerator: &IMMDeviceEnumerator,
        endpoint_id: Option<&str>,
    ) -> std::result::Result<IMMDevice, String> {
        unsafe {
            match endpoint_id.map(str::trim).filter(|s| !s.is_empty()) {
                Some(id) => {
                    let wide = to_wide(id);
                    enumerator
                        .GetDevice(PCWSTR(wide.as_ptr()))
                        .map_err(|e| format!("Could not open render endpoint {id}: {e}"))
                }
                None => enumerator
                    .GetDefaultAudioEndpoint(eRender, eMultimedia)
                    .map_err(|e| format!("Could not resolve default render endpoint: {e}")),
            }
        }
    }

    struct HandleGuard(HANDLE);
    impl Drop for HandleGuard {
        fn drop(&mut self) {
            if !self.0.is_invalid() {
                unsafe {
                    let _ = CloseHandle(self.0);
                }
            }
        }
    }

    struct RenderState {
        running: bool,
        endpoint_id: Option<String>,
        stop_flag: Arc<AtomicBool>,
        join_handle: Option<JoinHandle<()>>,
        pcm_queue: Arc<Mutex<VecDeque<f32>>>,
    }

    impl Default for RenderState {
        fn default() -> Self {
            Self {
                running: false,
                endpoint_id: None,
                stop_flag: Arc::new(AtomicBool::new(false)),
                join_handle: None,
                pcm_queue: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_QUEUE_SAMPLES))),
            }
        }
    }

    pub struct RawOutputManager {
        inner: Mutex<RenderState>,
    }

    impl Default for RawOutputManager {
        fn default() -> Self {
            Self {
                inner: Mutex::new(RenderState::default()),
            }
        }
    }

    impl Drop for RawOutputManager {
        fn drop(&mut self) {
            self.stop();
        }
    }

    fn run_raw_render_loop(
        endpoint_id: Option<String>,
        pcm_queue: Arc<Mutex<VecDeque<f32>>>,
        stop_flag: Arc<AtomicBool>,
    ) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let res: std::result::Result<(), String> = (|| unsafe {
            let enumerator: IMMDeviceEnumerator =
                windows::Win32::System::Com::CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("CoCreateInstance(MMDeviceEnumerator): {e}"))?;
            let dev = resolve_render_device(&enumerator, endpoint_id.as_deref())?;
            let client2: IAudioClient2 = dev
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate IAudioClient2 failed: {e}"))?;

            let props = AudioClientProperties {
                cbSize: std::mem::size_of::<AudioClientProperties>() as u32,
                bIsOffload: BOOL(0),
                eCategory: AudioCategory_Media,
                Options: AUDCLNT_STREAMOPTIONS_RAW,
            };
            // Request RAW mode so output bypasses installed MFX/SFX APO; fall back gracefully if device lacks raw support.
            let _ = client2.SetClientProperties(&props);

            let client: IAudioClient = windows::core::Interface::cast(&client2)
                .map_err(|e| format!("Cast IAudioClient failed: {e}"))?;

            let wfx = build_render_format();
            let flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
            client
                .Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 200_000, 0, &wfx.Format, None)
                .map_err(|e| format!("RAW output Initialize failed: {e}"))?;

            let buf_frames = client
                .GetBufferSize()
                .map_err(|e| format!("GetBufferSize failed: {e}"))?;
            let event_h =
                CreateEventW(None, false, false, None).map_err(|e| format!("CreateEventW: {e}"))?;
            let _ev_guard = HandleGuard(event_h);
            client
                .SetEventHandle(event_h)
                .map_err(|e| format!("SetEventHandle: {e}"))?;

            let render_client: IAudioRenderClient = client
                .GetService()
                .map_err(|e| format!("GetService IAudioRenderClient: {e}"))?;

            // Prime initial silence block cleanly before Start()
            if let Ok(ptr) = render_client.GetBuffer(buf_frames) {
                std::ptr::write_bytes(ptr, 0, (buf_frames as usize) * (RENDER_CHANNELS as usize) * 4);
                let _ = render_client.ReleaseBuffer(buf_frames, 0);
            }

            client.Start().map_err(|e| format!("RAW render Start: {e}"))?;

            while !stop_flag.load(Ordering::Acquire) {
                let _ = WaitForSingleObject(event_h, 50);
                if stop_flag.load(Ordering::Acquire) {
                    break;
                }
                let padding = client.GetCurrentPadding().unwrap_or(buf_frames);
                let writable = buf_frames.saturating_sub(padding);
                if writable == 0 {
                    continue;
                }
                let Ok(ptr) = render_client.GetBuffer(writable) else {
                    continue;
                };
                let needed_samples = (writable as usize) * (RENDER_CHANNELS as usize);
                let out_slice = std::slice::from_raw_parts_mut(ptr as *mut f32, needed_samples);

                if let Ok(mut q) = pcm_queue.lock() {
                    let avail = q.len().min(needed_samples);
                    for i in 0..avail {
                        out_slice[i] = q.pop_front().unwrap_or(0.0);
                    }
                    for i in avail..needed_samples {
                        out_slice[i] = 0.0;
                    }
                } else {
                    out_slice.fill(0.0);
                }

                let _ = render_client.ReleaseBuffer(writable, 0);
            }

            let _ = client.Stop();
            let _ = SetEvent(event_h);
            Ok(())
        })();

        if let Err(err) = res {
            eprintln!("RAW output render loop exited: {err}");
        }
        unsafe {
            CoUninitialize();
        }
    }

    impl RawOutputManager {
        pub fn start(&self, endpoint_id: Option<String>) -> std::result::Result<(), String> {
            self.stop();

            // Probe RAW activation synchronously so errors surface cleanly to UI
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let probe = (|| -> std::result::Result<(), String> {
                    let enumerator: IMMDeviceEnumerator =
                        windows::Win32::System::Com::CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                            .map_err(|e| format!("MMDeviceEnumerator failed: {e}"))?;
                    let dev = resolve_render_device(&enumerator, endpoint_id.as_deref())?;
                    let _c2: IAudioClient2 = dev
                        .Activate(CLSCTX_ALL, None)
                        .map_err(|e| format!("Activate IAudioClient2 failed: {e}"))?;
                    Ok(())
                })();
                CoUninitialize();
                probe?;
            }

            let mut guard = self
                .inner
                .lock()
                .map_err(|_| "RAW output lock poisoned".to_string())?;
            if let Ok(mut q) = guard.pcm_queue.lock() {
                q.clear();
            }
            let stop_flag = Arc::new(AtomicBool::new(false));
            let stop_clone = Arc::clone(&stop_flag);
            let q_clone = Arc::clone(&guard.pcm_queue);
            let ep_clone = endpoint_id.clone();

            let handle = thread::Builder::new()
                .name("hkm-raw-output".to_string())
                .spawn(move || run_raw_render_loop(ep_clone, q_clone, stop_clone))
                .map_err(|e| format!("Failed to spawn RAW render thread: {e}"))?;

            guard.running = true;
            guard.endpoint_id = endpoint_id;
            guard.stop_flag = stop_flag;
            guard.join_handle = Some(handle);
            Ok(())
        }

        pub fn push_pcm_bytes(&self, bytes: &[u8]) {
            let pcm_queue = {
                let Ok(guard) = self.inner.lock() else {
                    return;
                };
                if !guard.running {
                    return;
                }
                Arc::clone(&guard.pcm_queue)
            };
            let sample_count = bytes.len() / 4;
            if sample_count == 0 {
                return;
            }
            if let Ok(mut q) = pcm_queue.lock() {
                for chunk in bytes.chunks_exact(4) {
                    let s = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                    q.push_back(s);
                }
                while q.len() > MAX_QUEUE_SAMPLES {
                    q.pop_front();
                }
            };
        }

        pub fn stop(&self) {
            let handle = {
                let Ok(mut guard) = self.inner.lock() else {
                    return;
                };
                guard.running = false;
                guard.stop_flag.store(true, Ordering::Release);
                if let Ok(mut q) = guard.pcm_queue.lock() {
                    q.clear();
                }
                guard.join_handle.take()
            };
            if let Some(h) = handle {
                let _ = h.join();
            }
        }

        pub fn is_running(&self) -> bool {
            self.inner.lock().map(|g| g.running).unwrap_or(false)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn enumerates_render_endpoints_cleanly() {
            let eps = list_raw_output_endpoints();
            // Even in headless CI without physical speakers, function should return cleanly without panic
            assert!(eps.iter().all(|e| !e.id.is_empty() && !e.name.is_empty()));
        }
    }
}

#[cfg(not(windows))]
mod win_impl {
    use super::*;

    #[derive(Default)]
    pub struct RawOutputManager;

    impl RawOutputManager {
        pub fn start(&self, _endpoint_id: Option<String>) -> Result<(), String> {
            Err("WASAPI RAW output requires Windows.".to_string())
        }
        pub fn push_pcm_bytes(&self, _bytes: &[u8]) {}
        pub fn stop(&self) {}
        pub fn is_running(&self) -> bool {
            false
        }
    }

    pub fn list_raw_output_endpoints() -> Vec<RawOutputEndpointInfo> {
        Vec::new()
    }
}

pub use win_impl::{list_raw_output_endpoints, RawOutputManager};
