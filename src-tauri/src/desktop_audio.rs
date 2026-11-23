use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSourceIsolationStatus {
    pub enabled: bool,
    pub muted_sessions: usize,
    pub skipped_sessions: usize,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAudioStatus {
    pub supported: bool,
    pub os_build: u32,
    pub apo_active: bool,
    pub active_streams: Vec<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAudioSession {
    pub pid: u32,
    pub name: String,
    pub exe_path: String,
    pub state: String,
}

#[cfg(windows)]
mod win_impl {
    use super::*;
    use apo_shared::{current_time_ms, SharedMemoryHandle, RING_CHANNELS};
    use std::collections::{HashMap, HashSet};
    use std::ffi::c_void;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;
    use tauri::ipc::{Channel, Response};
    use windows::core::{implement, Interface, HRESULT, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, MAX_PATH, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, ActivateAudioInterfaceAsync, AudioSessionStateActive,
        AudioSessionStateExpired, AudioSessionStateInactive, IActivateAudioInterfaceAsyncOperation,
        IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
        IAudioCaptureClient, IAudioClient, IAudioSessionControl2, IAudioSessionEnumerator,
        IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
        AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
        AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDIOCLIENT_ACTIVATION_PARAMS,
        AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, DEVICE_STATE_ACTIVE,
        PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
        PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
    };
    use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemAlloc, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::SystemInformation::{GetVersionExW, OSVERSIONINFOW};
    use windows::Win32::System::Threading::{
        CreateEventW, OpenProcess, QueryFullProcessImageNameW, SetEvent, WaitForSingleObject,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::System::Variant::VT_BLOB;

    const CAPTURE_SAMPLE_RATE: u32 = 48000;
    const CAPTURE_CHANNELS: u16 = 2;

    struct CaptureEntry {
        stop_flag: Arc<AtomicBool>,
        join_handle: Option<JoinHandle<()>>,
    }

    struct SourceIsolationEntry {
        stop_flag: Arc<AtomicBool>,
        join_handle: Option<JoinHandle<()>>,
    }

    struct RecoveryEntry {
        stop_flag: Arc<AtomicBool>,
        join_handle: Option<JoinHandle<()>>,
    }

    #[derive(Default)]
    pub struct DesktopAudioManager {
        captures: Mutex<HashMap<String, CaptureEntry>>,
        source_isolation: Mutex<Option<SourceIsolationEntry>>,
        source_mute_recovery_file: Mutex<Option<PathBuf>>,
        recovery_worker: Mutex<Option<RecoveryEntry>>,
    }

    impl Drop for DesktopAudioManager {
        fn drop(&mut self) {
            self.stop_all();
        }
    }

    struct ComGuard;
    impl ComGuard {
        fn enter() -> Self {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            Self
        }
    }
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(lpVersionInformation: *mut OSVERSIONINFOW) -> i32;
    }

    pub fn windows_build_number() -> u32 {
        unsafe {
            let mut info = OSVERSIONINFOW {
                dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
                ..Default::default()
            };
            if RtlGetVersion(&mut info) == 0 && info.dwBuildNumber > 0 {
                return info.dwBuildNumber;
            }
            if GetVersionExW(&mut info).is_ok() {
                info.dwBuildNumber
            } else {
                0
            }
        }
    }

    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct ActivationCallback {
        state: Arc<(
            Mutex<Option<std::result::Result<IAudioClient, String>>>,
            Condvar,
        )>,
    }

    impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationCallback_Impl {
        fn ActivateCompleted(
            &self,
            operation: windows_core::Ref<'_, IActivateAudioInterfaceAsyncOperation>,
        ) -> windows::core::Result<()> {
            let outcome = match operation.as_ref() {
                None => Err("Null activation operation returned by Windows Audio.".to_string()),
                Some(op) => unsafe {
                    let mut hr = HRESULT(0);
                    let mut punk = None;
                    if let Err(e) = op.GetActivateResult(&mut hr, &mut punk) {
                        Err(format!("GetActivateResult failed: {e}"))
                    } else if hr.is_err() {
                        Err(format!(
                            "Process loopback activation failed with HRESULT 0x{:08X}",
                            hr.0 as u32
                        ))
                    } else if let Some(u) = punk {
                        u.cast::<IAudioClient>()
                            .map_err(|e| format!("Cast to IAudioClient failed: {e}"))
                    } else {
                        Err("Windows returned null IAudioClient for process loopback.".to_string())
                    }
                },
            };

            let (lock, cvar) = &*self.state;
            if let Ok(mut guard) = lock.lock() {
                *guard = Some(outcome);
                cvar.notify_all();
            }
            Ok(())
        }
    }

    fn build_float_stereo_format() -> WAVEFORMATEXTENSIBLE {
        WAVEFORMATEXTENSIBLE {
            Format: WAVEFORMATEX {
                wFormatTag: WAVE_FORMAT_EXTENSIBLE as u16,
                nChannels: CAPTURE_CHANNELS,
                nSamplesPerSec: CAPTURE_SAMPLE_RATE,
                nAvgBytesPerSec: CAPTURE_SAMPLE_RATE * (CAPTURE_CHANNELS as u32) * 4,
                nBlockAlign: CAPTURE_CHANNELS * 4,
                wBitsPerSample: 32,
                cbSize: (std::mem::size_of::<WAVEFORMATEXTENSIBLE>()
                    - std::mem::size_of::<WAVEFORMATEX>()) as u16,
            },
            Samples: WAVEFORMATEXTENSIBLE_0 {
                wValidBitsPerSample: 32,
            },
            dwChannelMask: 0x3, // SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT
            SubFormat: windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71),
        }
    }

    pub fn activate_process_loopback_client(
        target_pid: Option<u32>,
    ) -> std::result::Result<IAudioClient, String> {
        let (pid, mode) = match target_pid {
            Some(p) => (p, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE),
            None => (
                std::process::id(),
                PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
            ),
        };

        let activation_params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: mode,
                },
            },
        };

        unsafe {
            let blob_size = std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>();
            let blob_ptr = CoTaskMemAlloc(blob_size) as *mut AUDIOCLIENT_ACTIVATION_PARAMS;
            if blob_ptr.is_null() {
                return Err("CoTaskMemAlloc failed for AUDIOCLIENT_ACTIVATION_PARAMS.".to_string());
            }
            std::ptr::write(blob_ptr, activation_params);

            // Safety: PropVariantClear inside PROPVARIANT Drop frees pBlobData using CoTaskMemFree.
            let mut prop = PROPVARIANT::default();
            {
                let inner = &mut prop.Anonymous.Anonymous;
                inner.vt = VT_BLOB;
                inner.Anonymous.blob.cbSize = blob_size as u32;
                inner.Anonymous.blob.pBlobData = blob_ptr as *mut u8;
            }

            let state = Arc::new((Mutex::new(None), Condvar::new()));
            let handler: IActivateAudioInterfaceCompletionHandler = ActivationCallback {
                state: Arc::clone(&state),
            }
            .into();

            let op_res = ActivateAudioInterfaceAsync(
                VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                &IAudioClient::IID,
                Some(&prop as *const PROPVARIANT),
                &handler,
            );
            drop(prop);

            let _op = op_res.map_err(|e| {
                format!(
                    "ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK) failed: {e}"
                )
            })?;

            let (lock, cvar) = &*state;
            let guard = lock
                .lock()
                .map_err(|_| "Loopback activation mutex poisoned.".to_string())?;
            let (guard, timeout) = cvar
                .wait_timeout_while(guard, std::time::Duration::from_secs(3), |s| s.is_none())
                .map_err(|_| "Loopback activation wait failed.".to_string())?;

            if timeout.timed_out() && guard.is_none() {
                return Err(
                    "Timed out waiting for Windows process loopback activation.".to_string()
                );
            }

            guard
                .as_ref()
                .cloned()
                .unwrap_or_else(|| Err("Missing process loopback activation outcome.".to_string()))
        }
    }

    fn process_tree_ids() -> Result<HashSet<u32>, String> {
        let own_pid = std::process::id();
        let mut parent_by_pid = HashMap::new();
        unsafe {
            let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return Err("Windows could not inspect the HKM process tree.".to_string());
            };
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snapshot, &mut entry).is_err() {
                let _ = CloseHandle(snapshot);
                return Err("Windows returned an empty process snapshot.".to_string());
            }
            loop {
                parent_by_pid.insert(entry.th32ProcessID, entry.th32ParentProcessID);
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
            let _ = CloseHandle(snapshot);
        }

        let mut tree = HashSet::from([own_pid]);
        loop {
            let children: Vec<u32> = parent_by_pid
                .iter()
                .filter_map(|(pid, parent)| {
                    (tree.contains(parent) && !tree.contains(pid)).then_some(*pid)
                })
                .collect();
            if children.is_empty() {
                break;
            }
            tree.extend(children);
        }
        Ok(tree)
    }

    struct SessionVolume {
        instance_id: String,
        session_id: String,
        pid: u32,
        volume: ISimpleAudioVolume,
    }

    #[derive(Debug, Clone, Deserialize, Serialize)]
    struct MuteSnapshotEntry {
        session_id: String,
        originally_muted: bool,
    }

    fn enumerate_render_session_volumes() -> Result<Vec<SessionVolume>, String> {
        let mut sessions = Vec::new();
        unsafe {
            let Ok(enumerator): windows::core::Result<IMMDeviceEnumerator> =
                windows::Win32::System::Com::CoCreateInstance(
                    &MMDeviceEnumerator,
                    None,
                    CLSCTX_ALL,
                )
            else {
                return Err("Windows could not create the audio endpoint enumerator.".to_string());
            };
            let Ok(devices) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else {
                return Err("Windows could not enumerate active render endpoints.".to_string());
            };
            let Ok(device_count) = devices.GetCount() else {
                return Err("Windows could not count active render endpoints.".to_string());
            };
            for device_index in 0..device_count {
                let Ok(device) = devices.Item(device_index) else {
                    return Err("Windows could not open an active render endpoint.".to_string());
                };
                let Ok(session_manager) =
                    device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
                else {
                    return Err(
                        "Windows could not inspect an active endpoint's audio sessions."
                            .to_string(),
                    );
                };
                let Ok(session_enum) = session_manager.GetSessionEnumerator() else {
                    return Err(
                        "Windows could not enumerate an endpoint's audio sessions.".to_string()
                    );
                };
                let Ok(session_count) = session_enum.GetCount() else {
                    return Err("Windows could not count an endpoint's audio sessions.".to_string());
                };
                for index in 0..session_count {
                    let Ok(control) = session_enum.GetSession(index) else {
                        return Err("Windows could not read an audio session.".to_string());
                    };
                    let state = control.GetState().map_err(|_| {
                        "Windows could not read an audio session's state.".to_string()
                    })?;
                    if state == AudioSessionStateExpired {
                        continue;
                    }
                    let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
                        return Err(
                            "A Windows audio session does not expose process information."
                                .to_string(),
                        );
                    };
                    let Ok(pid) = control2.GetProcessId() else {
                        return Err(
                            "Windows could not identify an audio session's process.".to_string()
                        );
                    };
                    let Ok(identifier_ptr) = control2.GetSessionIdentifier() else {
                        return Err(
                            "Windows could not identify a Windows audio session.".to_string()
                        );
                    };
                    let session_id = identifier_ptr.to_string().unwrap_or_default();
                    windows::Win32::System::Com::CoTaskMemFree(Some(
                        identifier_ptr.0 as *const c_void,
                    ));
                    if session_id.is_empty() {
                        return Err(
                            "Windows returned an empty audio session identifier.".to_string()
                        );
                    }
                    let Ok(instance_ptr) = control2.GetSessionInstanceIdentifier() else {
                        return Err(
                            "Windows could not identify this audio session instance.".to_string()
                        );
                    };
                    let instance_id = instance_ptr.to_string().unwrap_or_default();
                    windows::Win32::System::Com::CoTaskMemFree(Some(
                        instance_ptr.0 as *const c_void,
                    ));
                    if instance_id.is_empty() {
                        return Err(
                            "Windows returned an empty audio session instance identifier."
                                .to_string(),
                        );
                    }
                    let Ok(volume) = control.cast::<ISimpleAudioVolume>() else {
                        return Err(
                            "A Windows audio session does not expose its mute control.".to_string()
                        );
                    };
                    sessions.push(SessionVolume {
                        instance_id,
                        session_id,
                        pid,
                        volume,
                    });
                }
            }
        }
        Ok(sessions)
    }

    fn write_mute_snapshot(
        path: &Path,
        original_mutes: &HashMap<String, MuteSnapshotEntry>,
    ) -> Result<(), String> {
        if original_mutes.is_empty() {
            if path.exists() {
                std::fs::remove_file(path).map_err(|error| {
                    format!("Could not clear the desktop audio mute recovery file: {error}")
                })?;
            }
            return Ok(());
        }
        let directory = path.parent().ok_or_else(|| {
            "Desktop audio mute recovery path has no parent directory.".to_string()
        })?;
        std::fs::create_dir_all(directory).map_err(|error| {
            format!("Could not create the desktop audio recovery directory: {error}")
        })?;
        let bytes = serde_json::to_vec(original_mutes).map_err(|error| {
            format!("Could not encode the desktop audio mute recovery state: {error}")
        })?;
        let mut staged = tempfile::NamedTempFile::new_in(directory).map_err(|error| {
            format!("Could not stage desktop audio mute recovery state: {error}")
        })?;
        staged
            .write_all(&bytes)
            .and_then(|_| staged.as_file().sync_all())
            .map_err(|error| {
                format!("Could not write desktop audio mute recovery state: {error}")
            })?;
        staged.persist(path).map_err(|error| {
            format!(
                "Could not commit desktop audio mute recovery state: {}",
                error.error
            )
        })?;
        Ok(())
    }

    fn load_mute_snapshot(path: &Path) -> Result<HashMap<String, MuteSnapshotEntry>, String> {
        if !path.exists() {
            return Ok(HashMap::new());
        }
        let bytes = std::fs::read(path).map_err(|error| {
            format!("Could not read desktop audio mute recovery state: {error}")
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("Desktop audio mute recovery state is invalid: {error}"))
    }

    fn restore_mute_snapshot(path: &Path) -> Result<usize, String> {
        let mut pending = load_mute_snapshot(path)?;
        if pending.is_empty() {
            return Ok(0);
        }
        let sessions = enumerate_render_session_volumes()?;
        let mut restored_count = 0;
        let mut restored_instance_ids = HashSet::new();
        for session in &sessions {
            if let Some(snapshot) = pending.get(&session.instance_id) {
                if unsafe {
                    session
                        .volume
                        .SetMute(snapshot.originally_muted, &SOURCE_MUTE_EVENT_CONTEXT)
                }
                .is_ok()
                {
                    restored_instance_ids.insert(session.instance_id.clone());
                    restored_count += 1;
                }
            }
        }
        for instance_id in &restored_instance_ids {
            pending.remove(instance_id);
        }

        let mut pending_by_session = HashMap::<String, Vec<String>>::new();
        for (instance_id, snapshot) in &pending {
            pending_by_session
                .entry(snapshot.session_id.clone())
                .or_default()
                .push(instance_id.clone());
        }
        for (session_id, instance_ids) in pending_by_session {
            let candidates: Vec<&SessionVolume> = sessions
                .iter()
                .filter(|session| {
                    session.session_id == session_id
                        && !restored_instance_ids.contains(&session.instance_id)
                })
                .collect();
            if candidates.len() != instance_ids.len() {
                continue;
            }

            let mut group_restored = true;
            for (session, instance_id) in candidates.iter().zip(instance_ids.iter()) {
                let Some(snapshot) = pending.get(instance_id) else {
                    group_restored = false;
                    break;
                };
                if unsafe {
                    session
                        .volume
                        .SetMute(snapshot.originally_muted, &SOURCE_MUTE_EVENT_CONTEXT)
                }
                .is_err()
                {
                    group_restored = false;
                    break;
                }
            }
            if group_restored {
                restored_count += instance_ids.len();
                for instance_id in instance_ids {
                    pending.remove(&instance_id);
                }
            }
        }
        write_mute_snapshot(path, &pending)?;
        Ok(restored_count)
    }

    fn apply_source_mute_pass(
        path: &Path,
        original_mutes: &Mutex<HashMap<String, MuteSnapshotEntry>>,
    ) -> DesktopSourceIsolationStatus {
        let own_tree = match process_tree_ids() {
            Ok(tree) => tree,
            Err(error) => {
                return DesktopSourceIsolationStatus {
                    enabled: true,
                    muted_sessions: 0,
                    skipped_sessions: 1,
                    message: Some(error),
                };
            }
        };
        let sessions = match enumerate_render_session_volumes() {
            Ok(sessions) => sessions,
            Err(error) => {
                return DesktopSourceIsolationStatus {
                    enabled: true,
                    muted_sessions: 0,
                    skipped_sessions: 1,
                    message: Some(error),
                };
            }
        };
        let mut muted_sessions = 0;
        let mut skipped_sessions = 0;
        let mut failure: Option<String> = None;

        for session in sessions {
            if own_tree.contains(&session.pid) {
                continue;
            }
            let is_muted = match unsafe { session.volume.GetMute() } {
                Ok(value) => value.as_bool(),
                Err(error) => {
                    skipped_sessions += 1;
                    failure.get_or_insert_with(|| {
                        format!("Could not read a Windows audio session mute state: {error}")
                    });
                    continue;
                }
            };
            if is_muted {
                continue;
            }

            let Ok(mut saved) = original_mutes.lock() else {
                skipped_sessions += 1;
                failure
                    .get_or_insert_with(|| "Desktop source mute state is unavailable.".to_string());
                continue;
            };
            let inserted = if saved.contains_key(&session.instance_id) {
                false
            } else {
                saved.insert(
                    session.instance_id.clone(),
                    MuteSnapshotEntry {
                        session_id: session.session_id.clone(),
                        originally_muted: false,
                    },
                );
                if let Err(error) = write_mute_snapshot(path, &saved) {
                    saved.remove(&session.instance_id);
                    skipped_sessions += 1;
                    failure.get_or_insert(error);
                    continue;
                }
                true
            };
            drop(saved);

            if unsafe { session.volume.SetMute(true, &SOURCE_MUTE_EVENT_CONTEXT) }.is_ok() {
                muted_sessions += 1;
            } else {
                skipped_sessions += 1;
                if inserted {
                    // Keep the recovery entry; a retry or startup recovery is harmless.
                }
            }
        }

        DesktopSourceIsolationStatus {
            enabled: true,
            muted_sessions,
            skipped_sessions,
            message: failure,
        }
    }

    const SOURCE_MUTE_EVENT_CONTEXT: windows::core::GUID =
        windows::core::GUID::from_u128(0x74a31148_96d3_43f1_a02a_bdd5c726409e);

    pub fn enumerate_active_audio_sessions() -> Vec<DesktopAudioSession> {
        let _com = ComGuard::enter();
        let mut sessions_out = Vec::new();
        let own_pid = std::process::id();
        let own_tree = process_tree_ids().unwrap_or_else(|_| HashSet::from([own_pid]));
        let mut seen_pids = HashSet::new();

        unsafe {
            let Ok(enumerator): windows::core::Result<IMMDeviceEnumerator> =
                windows::Win32::System::Com::CoCreateInstance(
                    &MMDeviceEnumerator,
                    None,
                    CLSCTX_ALL,
                )
            else {
                return sessions_out;
            };

            let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) else {
                return sessions_out;
            };

            let Ok(session_mgr) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
                return sessions_out;
            };

            let Ok(session_enum): windows::core::Result<IAudioSessionEnumerator> =
                session_mgr.GetSessionEnumerator()
            else {
                return sessions_out;
            };

            let Ok(count) = session_enum.GetCount() else {
                return sessions_out;
            };

            for i in 0..count {
                let Ok(ctrl) = session_enum.GetSession(i) else {
                    continue;
                };
                let Ok(ctrl2) = ctrl.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let Ok(pid) = ctrl2.GetProcessId() else {
                    continue;
                };
                if pid == 0 || own_tree.contains(&pid) || seen_pids.contains(&pid) {
                    continue;
                }

                let state_str = match ctrl.GetState() {
                    Ok(s) if s == AudioSessionStateActive => "active",
                    Ok(s) if s == AudioSessionStateInactive => "inactive",
                    _ => "expired",
                };
                if state_str == "expired" {
                    continue;
                }

                let mut exe_path = String::new();
                if let Ok(proc_h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                    let mut buf = [0u16; MAX_PATH as usize];
                    let mut len = buf.len() as u32;
                    if QueryFullProcessImageNameW(
                        proc_h,
                        PROCESS_NAME_WIN32,
                        PWSTR(buf.as_mut_ptr()),
                        &mut len,
                    )
                    .is_ok()
                    {
                        exe_path = String::from_utf16_lossy(&buf[..len as usize]);
                    }
                    let _ = CloseHandle(proc_h);
                }

                let friendly_raw = ctrl
                    .GetDisplayName()
                    .ok()
                    .and_then(|p| {
                        let s = p.to_string().ok();
                        windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const c_void));
                        s
                    })
                    .unwrap_or_default();

                let stem = if !exe_path.is_empty() {
                    Path::new(&exe_path)
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| format!("PID {pid}"))
                } else {
                    format!("PID {pid}")
                };

                // Skip embedded WebView2 helper sessions belonging to our UI
                let lower_stem = stem.to_ascii_lowercase();
                if lower_stem.contains("church-audio-intelligence") {
                    continue;
                }

                let name = if !friendly_raw.trim().is_empty() && !friendly_raw.contains('@') {
                    friendly_raw.trim().to_string()
                } else {
                    prettify_process_name(&stem)
                };

                seen_pids.insert(pid);
                sessions_out.push(DesktopAudioSession {
                    pid,
                    name,
                    exe_path,
                    state: state_str.to_string(),
                });
            }
        }

        sessions_out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        sessions_out
    }

    fn prettify_process_name(raw: &str) -> String {
        let lower = raw.to_ascii_lowercase();
        match lower.as_str() {
            "chrome" => "Google Chrome".to_string(),
            "msedge" => "Microsoft Edge".to_string(),
            "firefox" => "Mozilla Firefox".to_string(),
            "brave" => "Brave Browser".to_string(),
            "opera" => "Opera Browser".to_string(),
            "spotify" => "Spotify".to_string(),
            "vlc" => "VLC Media Player".to_string(),
            "obs64" => "OBS Studio".to_string(),
            "msedgewebview2" => "WebView2 Media".to_string(),
            _ => {
                let mut chars = raw.chars();
                match chars.next() {
                    None => "App Audio".to_string(),
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                }
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

    fn run_capture_thread(
        stream_key: String,
        target_pid: Option<u32>,
        channel: Channel<Response>,
        stop_flag: Arc<AtomicBool>,
        startup: std::sync::mpsc::SyncSender<std::result::Result<(), String>>,
    ) {
        let _com = ComGuard::enter();
        let audio_client = match activate_process_loopback_client(target_pid) {
            Ok(client) => client,
            Err(err) => {
                let _ = startup.send(Err(err));
                return;
            }
        };
        if stop_flag.load(Ordering::Acquire) {
            return;
        }

        let wfx = build_float_stereo_format();
        let flags = AUDCLNT_STREAMFLAGS_LOOPBACK
            | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
            | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
            | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;

        let init_hr = unsafe {
            audio_client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                flags,
                100_000, // 10 ms buffer duration
                0,
                &wfx.Format,
                None,
            )
        };
        if let Err(err) = init_hr {
            let _ = startup.send(Err(format!(
                "Could not initialize desktop audio capture: {err}"
            )));
            return;
        }
        if stop_flag.load(Ordering::Acquire) {
            return;
        }

        let event_h = unsafe { CreateEventW(None, false, false, None) };
        let event_h = match event_h {
            Ok(handle) => handle,
            Err(err) => {
                let _ = startup.send(Err(format!(
                    "Could not create desktop audio capture event: {err}"
                )));
                return;
            }
        };
        let _event_guard = HandleGuard(event_h);
        if stop_flag.load(Ordering::Acquire) {
            return;
        }

        if let Err(err) = unsafe { audio_client.SetEventHandle(event_h) } {
            let _ = startup.send(Err(format!(
                "Could not configure desktop audio capture event: {err}"
            )));
            return;
        }
        if stop_flag.load(Ordering::Acquire) {
            return;
        }

        let capture_client = match unsafe { audio_client.GetService::<IAudioCaptureClient>() } {
            Ok(client) => client,
            Err(err) => {
                let _ = startup.send(Err(format!(
                    "Could not get desktop audio capture service: {err}"
                )));
                return;
            }
        };
        if stop_flag.load(Ordering::Acquire) {
            return;
        }

        if let Err(err) = unsafe { audio_client.Start() } {
            let _ = startup.send(Err(format!("Could not start desktop audio capture: {err}")));
            return;
        }
        if stop_flag.load(Ordering::Acquire) {
            let _ = unsafe { audio_client.Stop() };
            return;
        }
        if startup.send(Ok(())).is_err() {
            let _ = unsafe { audio_client.Stop() };
            return;
        }

        const BATCH_FRAMES: usize = 960; // 20ms @ 48kHz (50 IPC frames/sec max vs 100/sec)
        const BATCH_SAMPLES: usize = BATCH_FRAMES * RING_CHANNELS;

        let mut shm_handle = if target_pid.is_none() {
            SharedMemoryHandle::open_for_client()
        } else {
            None
        };
        let mut apo_scratch = vec![0.0f32; 2048 * RING_CHANNELS];
        let mut pending_samples: Vec<f32> = Vec::with_capacity(BATCH_SAMPLES * 2);
        let mut send_byte_buf: Vec<u8> = Vec::with_capacity(BATCH_SAMPLES * 4);
        let mut consecutive_silent_batches: u32 = 0;
        let mut ticks_since_recheck: u32 = 0;

        #[inline]
        fn is_pcm_silent(samples: &[f32]) -> bool {
            samples.iter().all(|s| s.abs() < 1e-6)
        }

        #[inline]
        fn send_f32_chunk(
            channel: &Channel<Response>,
            samples: &[f32],
            byte_buf: &mut Vec<u8>,
        ) -> bool {
            byte_buf.clear();
            let raw = unsafe {
                std::slice::from_raw_parts(samples.as_ptr() as *const u8, samples.len() * 4)
            };
            byte_buf.extend_from_slice(raw);
            channel.send(Response::new(byte_buf.clone())).is_ok()
        }

        while !stop_flag.load(Ordering::Acquire) {
            let wait_res = unsafe { WaitForSingleObject(event_h, 50) };
            if stop_flag.load(Ordering::Acquire) {
                break;
            }

            if let Some(ref mut shm_h) = shm_handle {
                ticks_since_recheck = ticks_since_recheck.wrapping_add(1);
                if !shm_h.is_global && ticks_since_recheck % 25 == 0 {
                    let _ = shm_h.try_reattach_global();
                }
            }

            let apo_feeding = if target_pid.is_none() {
                shm_handle
                    .as_ref()
                    .map(|h| {
                        let s = h.shm();
                        let now = current_time_ms();
                        s.is_apo_alive(now, apo_shared::APO_ALIVE_TIMEOUT_MS)
                            && s.should_suppress_dry(now)
                    })
                    .unwrap_or(false)
            } else {
                false
            };

            if apo_feeding {
                pending_samples.clear();
                if let Some(ref h) = shm_handle {
                    loop {
                        let read_frames = h.shm().pop_interleaved(&mut apo_scratch);
                        if read_frames == 0 {
                            break;
                        }
                        let sample_count = read_frames * RING_CHANNELS;
                        let chunk = &apo_scratch[..sample_count];
                        if is_pcm_silent(chunk) {
                            consecutive_silent_batches =
                                consecutive_silent_batches.saturating_add(1);
                            if consecutive_silent_batches > 3 {
                                continue;
                            }
                        } else {
                            consecutive_silent_batches = 0;
                        }
                        if !send_f32_chunk(&channel, chunk, &mut send_byte_buf) {
                            stop_flag.store(true, Ordering::Release);
                            break;
                        }
                    }
                }
            }

            // Always drain WASAPI capture client queue (or batch & silence-gate for Engine 1)
            loop {
                if stop_flag.load(Ordering::Acquire) {
                    break;
                }
                let next_packet_frames = unsafe { capture_client.GetNextPacketSize().unwrap_or(0) };
                if next_packet_frames == 0 {
                    break;
                }

                let mut data_ptr: *mut u8 = std::ptr::null_mut();
                let mut frames_avail: u32 = 0;
                let mut buf_flags: u32 = 0;

                let get_res = unsafe {
                    capture_client.GetBuffer(
                        &mut data_ptr,
                        &mut frames_avail,
                        &mut buf_flags,
                        None,
                        None,
                    )
                };
                if get_res.is_err() {
                    break;
                }

                if !apo_feeding && frames_avail > 0 {
                    let sample_len = (frames_avail as usize) * (CAPTURE_CHANNELS as usize);
                    if (buf_flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)) != 0
                        || data_ptr.is_null()
                    {
                        pending_samples.resize(pending_samples.len() + sample_len, 0.0);
                    } else {
                        let floats = unsafe {
                            std::slice::from_raw_parts(data_ptr as *const f32, sample_len)
                        };
                        pending_samples.extend_from_slice(floats);
                    }

                    while pending_samples.len() >= BATCH_SAMPLES {
                        let batch_silent = is_pcm_silent(&pending_samples[..BATCH_SAMPLES]);
                        if batch_silent {
                            consecutive_silent_batches =
                                consecutive_silent_batches.saturating_add(1);
                            if consecutive_silent_batches <= 3 {
                                if !send_f32_chunk(
                                    &channel,
                                    &pending_samples[..BATCH_SAMPLES],
                                    &mut send_byte_buf,
                                ) {
                                    stop_flag.store(true, Ordering::Release);
                                    break;
                                }
                            }
                        } else {
                            consecutive_silent_batches = 0;
                            if !send_f32_chunk(
                                &channel,
                                &pending_samples[..BATCH_SAMPLES],
                                &mut send_byte_buf,
                            ) {
                                stop_flag.store(true, Ordering::Release);
                                break;
                            }
                        }
                        pending_samples.drain(..BATCH_SAMPLES);
                    }
                }

                let _ = unsafe { capture_client.ReleaseBuffer(frames_avail) };
            }

            let _ = wait_res == WAIT_OBJECT_0;
        }

        let _ = unsafe { audio_client.Stop() };
        let _ = unsafe { SetEvent(event_h) };
        let _ = stream_key;
    }

    impl DesktopAudioManager {
        pub fn configure_source_mute_recovery(&self, recovery_file: PathBuf) -> Result<(), String> {
            if let Ok(mut configured) = self.source_mute_recovery_file.lock() {
                *configured = Some(recovery_file.clone());
            } else {
                return Err("Desktop source mute recovery state is unavailable.".to_string());
            }

            if recovery_file.exists() {
                self.start_source_mute_recovery(recovery_file)?;
            }
            Ok(())
        }

        fn start_source_mute_recovery(&self, recovery_file: PathBuf) -> Result<(), String> {
            self.stop_source_mute_recovery();
            let stop_flag = Arc::new(AtomicBool::new(false));
            let worker_stop = Arc::clone(&stop_flag);
            let worker_file = recovery_file;
            let handle = thread::Builder::new()
                .name("hkm-audio-mute-recovery".to_string())
                .spawn(move || {
                    while !worker_stop.load(Ordering::Acquire) && worker_file.exists() {
                        {
                            let _com = ComGuard::enter();
                            let _ = restore_mute_snapshot(&worker_file);
                        }
                        for _ in 0..50 {
                            if worker_stop.load(Ordering::Acquire) || !worker_file.exists() {
                                break;
                            }
                            thread::sleep(Duration::from_millis(100));
                        }
                    }
                })
                .map_err(|error| format!("Could not start desktop mute recovery: {error}"))?;
            let mut recovery = self
                .recovery_worker
                .lock()
                .map_err(|_| "Desktop mute recovery state is unavailable.".to_string())?;
            *recovery = Some(RecoveryEntry {
                stop_flag,
                join_handle: Some(handle),
            });
            Ok(())
        }

        fn stop_source_mute_recovery(&self) {
            let entry = self
                .recovery_worker
                .lock()
                .ok()
                .and_then(|mut recovery| recovery.take());
            if let Some(mut entry) = entry {
                entry.stop_flag.store(true, Ordering::Release);
                if let Some(handle) = entry.join_handle.take() {
                    let _ = handle.join();
                }
            }
        }

        pub fn set_source_isolation(
            &self,
            enabled: bool,
        ) -> Result<DesktopSourceIsolationStatus, String> {
            if !enabled {
                self.stop_source_isolation();
                self.stop_source_mute_recovery();
                if let Some(path) = self
                    .source_mute_recovery_file
                    .lock()
                    .ok()
                    .and_then(|path| path.clone())
                {
                    let restore_result = {
                        let _com = ComGuard::enter();
                        restore_mute_snapshot(&path).and_then(|restored| {
                            load_mute_snapshot(&path).map(|pending| (restored, pending.len()))
                        })
                    };
                    let (restored, remaining) = match restore_result {
                        Ok(result) => result,
                        Err(error) => {
                            if let Err(recovery_error) = self.start_source_mute_recovery(path) {
                                return Err(format!(
                                    "{error}; could not restart mute recovery: {recovery_error}"
                                ));
                            }
                            return Err(error);
                        }
                    };
                    if remaining > 0 {
                        self.start_source_mute_recovery(path)?;
                    }
                    return Ok(DesktopSourceIsolationStatus {
                        enabled: false,
                        muted_sessions: 0,
                        skipped_sessions: remaining,
                        message: if remaining > 0 {
                            Some(format!("Restored {restored} session(s); {remaining} session(s) are still waiting for Windows to expose their audio controls."))
                        } else if restored > 0 {
                            Some(format!(
                                "Restored {restored} desktop audio app mute state(s)."
                            ))
                        } else {
                            None
                        },
                    });
                }
                return Ok(DesktopSourceIsolationStatus {
                    enabled: false,
                    muted_sessions: 0,
                    skipped_sessions: 0,
                    message: None,
                });
            }

            self.stop_source_mute_recovery();
            let mut active = self
                .source_isolation
                .lock()
                .map_err(|_| "Desktop source isolation state is unavailable.".to_string())?;
            if active.is_some() {
                let muted_sessions = self
                    .source_mute_recovery_file
                    .lock()
                    .ok()
                    .and_then(|path| path.as_ref().cloned())
                    .and_then(|path| load_mute_snapshot(&path).ok())
                    .map(|saved| saved.len())
                    .unwrap_or(0);
                return Ok(DesktopSourceIsolationStatus {
                    enabled: true,
                    muted_sessions,
                    skipped_sessions: 0,
                    message: None,
                });
            }
            let recovery_file = self
                .source_mute_recovery_file
                .lock()
                .map_err(|_| "Desktop source mute recovery state is unavailable.".to_string())?
                .clone()
                .ok_or_else(|| "Desktop source mute recovery is not configured.".to_string())?;
            let initial_snapshot = load_mute_snapshot(&recovery_file)?;
            let stop_flag = Arc::new(AtomicBool::new(false));
            let worker_stop = Arc::clone(&stop_flag);
            let recovery_file_worker = recovery_file.clone();
            let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
            let handle = thread::Builder::new()
                .name("hkm-desktop-source-isolation".to_string())
                .spawn(move || {
                    let _com = ComGuard::enter();
                    let original_mutes = Mutex::new(initial_snapshot);
                    let first_status =
                        apply_source_mute_pass(&recovery_file_worker, &original_mutes);
                    let _ = ready_tx.send(first_status);
                    while !worker_stop.load(Ordering::Acquire) {
                        thread::sleep(Duration::from_millis(1000));
                        if worker_stop.load(Ordering::Acquire) {
                            break;
                        }
                        let _ = apply_source_mute_pass(&recovery_file_worker, &original_mutes);
                    }
                    let _ = restore_mute_snapshot(&recovery_file_worker);
                })
                .map_err(|error| format!("Could not start desktop source isolation: {error}"))?;
            let initial_status = match ready_rx.recv_timeout(Duration::from_secs(5)) {
                Ok(status) => status,
                Err(error) => {
                    stop_flag.store(true, Ordering::Release);
                    let _ = handle.join();
                    return Err(format!(
                        "Desktop source isolation did not start cleanly: {error}"
                    ));
                }
            };
            *active = Some(SourceIsolationEntry {
                stop_flag,
                join_handle: Some(handle),
            });
            Ok(initial_status)
        }

        fn stop_source_isolation(&self) {
            let entry = self
                .source_isolation
                .lock()
                .ok()
                .and_then(|mut active| active.take());
            if let Some(mut entry) = entry {
                entry.stop_flag.store(true, Ordering::Release);
                if let Some(handle) = entry.join_handle.take() {
                    let _ = handle.join();
                }
            }
        }

        pub fn status(&self, apo_active: bool) -> DesktopAudioStatus {
            let build = windows_build_number();
            let supported = build >= 20348;
            let active_streams = self
                .captures
                .lock()
                .map(|m| m.keys().cloned().collect())
                .unwrap_or_default();
            DesktopAudioStatus {
                supported,
                os_build: build,
                apo_active,
                active_streams,
                reason: if supported {
                    None
                } else if build == 0 {
                    Some(
                        "Could not determine the Windows build; WASAPI process-exclusion loopback support is unconfirmed."
                            .to_string(),
                    )
                } else {
                    Some(format!(
                        "Windows build {build} is below 20348; WASAPI process-exclusion loopback requires Windows 10 21H2+ or Windows 11."
                    ))
                },
            }
        }

        pub fn start_stream(
            &self,
            stream_key: String,
            target_pid: Option<u32>,
            channel: Channel<Response>,
        ) -> std::result::Result<(), String> {
            self.stop_stream(&stream_key);

            let stop_flag = Arc::new(AtomicBool::new(false));
            let stop_clone = Arc::clone(&stop_flag);
            let key_clone = stream_key.clone();
            let (startup_tx, startup_rx) = std::sync::mpsc::sync_channel(1);

            let handle = thread::Builder::new()
                .name(format!("hkm-desktop-in-{stream_key}"))
                .spawn(move || {
                    run_capture_thread(key_clone, target_pid, channel, stop_clone, startup_tx)
                })
                .map_err(|e| format!("Failed to spawn desktop capture thread: {e}"))?;

            let startup_result = startup_rx.recv_timeout(std::time::Duration::from_secs(5));
            match startup_result {
                Ok(Ok(())) => {}
                Ok(Err(err)) => {
                    let _ = handle.join();
                    return Err(err);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    stop_flag.store(true, Ordering::Release);
                    drop(handle);
                    return Err("Timed out while starting desktop audio capture.".to_string());
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    let _ = handle.join();
                    return Err(
                        "Desktop audio capture stopped before startup completed.".to_string()
                    );
                }
            }

            let mut guard = match self.captures.lock() {
                Ok(guard) => guard,
                Err(_) => {
                    stop_flag.store(true, Ordering::Release);
                    let _ = handle.join();
                    return Err("Desktop audio capture state lock is unavailable.".to_string());
                }
            };
            guard.insert(
                stream_key,
                CaptureEntry {
                    stop_flag,
                    join_handle: Some(handle),
                },
            );
            Ok(())
        }

        pub fn stop_stream(&self, stream_key: &str) {
            let entry = self
                .captures
                .lock()
                .ok()
                .and_then(|mut map| map.remove(stream_key));
            if let Some(mut e) = entry {
                e.stop_flag.store(true, Ordering::Release);
                if let Some(h) = e.join_handle.take() {
                    let _ = h.join();
                }
            }
        }

        pub fn stop_all(&self) {
            self.stop_source_isolation();
            self.stop_source_mute_recovery();
            self.stop_all_captures();
        }

        pub fn stop_all_captures(&self) {
            let entries: Vec<CaptureEntry> = self
                .captures
                .lock()
                .ok()
                .map(|mut map| map.drain().map(|(_, v)| v).collect())
                .unwrap_or_default();
            for e in &entries {
                e.stop_flag.store(true, Ordering::Release);
            }
            for mut e in entries {
                if let Some(h) = e.join_handle.take() {
                    let _ = h.join();
                }
            }
        }
    }

    pub fn _keep_imports() {
        let _ = PCWSTR::null();
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn windows11_process_exclusion_loopback_activates_cleanly() {
            let _com = ComGuard::enter();
            let build = windows_build_number();
            assert!(
                build >= 20348,
                "Expected Windows 10 20348+ / Windows 11, got {build}"
            );
            let client = activate_process_loopback_client(None)
                .expect("ActivateAudioInterfaceAsync(EXCLUDE_TARGET_PROCESS_TREE) should succeed");
            let wfx = build_float_stereo_format();
            let hr = unsafe {
                client.Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK
                        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                        | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                    100_000,
                    0,
                    &wfx.Format,
                    None,
                )
            };
            assert!(hr.is_ok(), "IAudioClient::Initialize failed: {hr:?}");
        }

        #[test]
        fn enumerates_sessions_without_panic() {
            let list = enumerate_active_audio_sessions();
            // Host might have 0 or more active sessions; verify valid structure & no self PID
            let my_pid = std::process::id();
            assert!(list.iter().all(|s| s.pid != my_pid));
        }
    }
}

#[cfg(not(windows))]
mod win_impl {
    use super::*;
    use tauri::ipc::{Channel, Response};

    #[derive(Default)]
    pub struct DesktopAudioManager;

    impl DesktopAudioManager {
        pub fn configure_source_mute_recovery(
            &self,
            _recovery_file: std::path::PathBuf,
        ) -> Result<(), String> {
            Ok(())
        }
        pub fn set_source_isolation(
            &self,
            enabled: bool,
        ) -> Result<DesktopSourceIsolationStatus, String> {
            if enabled {
                return Err("Desktop source isolation requires Windows.".to_string());
            }
            Ok(DesktopSourceIsolationStatus {
                enabled: false,
                muted_sessions: 0,
                skipped_sessions: 0,
                message: None,
            })
        }
        pub fn status(&self, _apo_active: bool) -> DesktopAudioStatus {
            DesktopAudioStatus {
                supported: false,
                os_build: 0,
                apo_active: false,
                active_streams: Vec::new(),
                reason: Some(
                    "Native WASAPI desktop loopback is only available on Windows.".to_string(),
                ),
            }
        }
        pub fn start_stream(
            &self,
            _stream_key: String,
            _target_pid: Option<u32>,
            _channel: Channel<Response>,
        ) -> Result<(), String> {
            Err("Native desktop loopback requires Windows.".to_string())
        }
        pub fn stop_stream(&self, _stream_key: &str) {}
        pub fn stop_all_captures(&self) {}
        pub fn stop_all(&self) {}
    }

    pub fn enumerate_active_audio_sessions() -> Vec<DesktopAudioSession> {
        Vec::new()
    }
}

pub use win_impl::{enumerate_active_audio_sessions, DesktopAudioManager};
