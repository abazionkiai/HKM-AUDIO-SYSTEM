use crate::raw_output::{list_raw_output_endpoints, RawOutputEndpointInfo};
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApoSystemStatus {
    pub dll_bundled: bool,
    pub dll_path: Option<String>,
    pub apo_registered_any: bool,
    pub apo_loaded_in_audiodg: bool,
    pub dry_suppression_active: bool,
    pub raw_output_active: bool,
    pub selected_endpoint_id: Option<String>,
    pub endpoints: Vec<RawOutputEndpointInfo>,
    pub note: String,
}

#[cfg(windows)]
mod win_impl {
    use super::*;
    use apo_shared::{current_time_ms, SharedMemoryHandle, APO_ALIVE_TIMEOUT_MS, APO_CLSID_STR};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread::{self, JoinHandle};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    struct ApoStateInner {
        shm: Option<SharedMemoryHandle>,
        dry_flag: Arc<AtomicBool>,
        selected_endpoint_id: Option<String>,
        heartbeat_thread: Option<JoinHandle<()>>,
    }

    pub struct ApoManager {
        inner: Mutex<ApoStateInner>,
    }

    impl Default for ApoManager {
        fn default() -> Self {
            Self {
                inner: Mutex::new(ApoStateInner {
                    shm: SharedMemoryHandle::open_for_client(),
                    dry_flag: Arc::new(AtomicBool::new(false)),
                    selected_endpoint_id: None,
                    heartbeat_thread: None,
                }),
            }
        }
    }

    impl Drop for ApoManager {
        fn drop(&mut self) {
            self.set_dry_suppression(false, None);
        }
    }

    fn resolve_bundled_apo_dll(app: &AppHandle) -> Option<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(res_dir) = app.path().resource_dir() {
            candidates.push(res_dir.join("hkm_audio_apo.dll"));
            candidates.push(res_dir.join("resources").join("hkm_audio_apo.dll"));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("hkm_audio_apo.dll"));
                candidates.push(dir.join("resources").join("hkm_audio_apo.dll"));
                if let Some(p1) = dir.parent() {
                    candidates.push(p1.join("release").join("hkm_audio_apo.dll"));
                    if let Some(p2) = p1.parent() {
                        candidates.push(p2.join("resources").join("hkm_audio_apo.dll"));
                    }
                }
            }
        }
        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(cwd.join("resources").join("hkm_audio_apo.dll"));
            candidates.push(cwd.join("src-tauri").join("resources").join("hkm_audio_apo.dll"));
            candidates.push(
                cwd.join("src-tauri")
                    .join("target")
                    .join("release")
                    .join("hkm_audio_apo.dll"),
            );
        }
        candidates.into_iter().find(|p| p.is_file())
    }

    fn validate_endpoint_id(endpoint_id: &str) -> Result<String, String> {
        let trimmed = endpoint_id.trim();
        let guid_part = trimmed.rsplit('.').next().unwrap_or(trimmed).trim();
        if !guid_part.starts_with('{')
            || !guid_part.ends_with('}')
            || !guid_part
                .chars()
                .all(|c| c.is_ascii_hexdigit() || c == '{' || c == '}' || c == '-')
        {
            return Err("Invalid Windows audio endpoint GUID.".to_string());
        }
        Ok(guid_part.to_string())
    }

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn run_elevated_powershell(script_content: &str) -> Result<(), String> {
        let dir = std::env::temp_dir();
        let script_path = dir.join(format!("hkm-apo-{}.ps1", std::process::id()));
        std::fs::write(&script_path, script_content)
            .map_err(|e| format!("Failed to stage elevated APO script: {e}"))?;

        let args = format!(
            "-NoProfile -ExecutionPolicy Bypass -File \"{}\"",
            script_path.display()
        );
        let verb_w = to_wide("runas");
        let file_w = to_wide("powershell.exe");
        let params_w = to_wide(&args);

        let result = unsafe {
            let mut info = SHELLEXECUTEINFOW {
                cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
                fMask: SEE_MASK_NOCLOSEPROCESS,
                lpVerb: PCWSTR(verb_w.as_ptr()),
                lpFile: PCWSTR(file_w.as_ptr()),
                lpParameters: PCWSTR(params_w.as_ptr()),
                nShow: SW_HIDE.0,
                ..Default::default()
            };
            if let Err(e) = ShellExecuteExW(&mut info) {
                Err(format!(
                    "Administrator permission prompt was cancelled or rejected: {e}"
                ))
            } else if info.hProcess.is_invalid() {
                Err("Elevated installer process did not return a valid handle.".to_string())
            } else {
                WaitForSingleObject(info.hProcess, INFINITE);
                let mut exit_code: u32 = 1;
                let _ = GetExitCodeProcess(info.hProcess, &mut exit_code);
                let _ = CloseHandle(info.hProcess);
                if exit_code == 0 {
                    Ok(())
                } else {
                    Err(format!(
                        "APO installer script exited with status code {exit_code}."
                    ))
                }
            }
        };

        let _ = std::fs::remove_file(&script_path);
        result
    }

    impl ApoManager {
        pub fn status(&self, app: &AppHandle, raw_output_active: bool) -> ApoSystemStatus {
            let dll_path = resolve_bundled_apo_dll(app);
            let endpoints = list_raw_output_endpoints();
            let apo_registered_any = endpoints.iter().any(|e| e.apo_registered);

            let (apo_loaded_in_audiodg, dry_suppression_active, selected_endpoint_id) = {
                let Ok(mut guard) = self.inner.lock() else {
                    return ApoSystemStatus {
                        dll_bundled: dll_path.is_some(),
                        dll_path: dll_path.map(|p| p.to_string_lossy().to_string()),
                        apo_registered_any,
                        apo_loaded_in_audiodg: false,
                        dry_suppression_active: false,
                        raw_output_active,
                        selected_endpoint_id: None,
                        endpoints,
                        note: "APO manager state lock unavailable.".to_string(),
                    };
                };
                if guard.shm.is_none() {
                    guard.shm = SharedMemoryHandle::open_for_client();
                } else if let Some(ref mut s) = guard.shm {
                    let _ = s.try_reattach_global();
                }
                let alive = guard
                    .shm
                    .as_ref()
                    .map(|s| s.shm().is_apo_alive(current_time_ms(), APO_ALIVE_TIMEOUT_MS))
                    .unwrap_or(false);
                (
                    alive,
                    guard.dry_flag.load(Ordering::Acquire),
                    guard.selected_endpoint_id.clone(),
                )
            };

            let note = if apo_loaded_in_audiodg {
                "hkm_audio_apo.dll is actively processing inside Windows audiodg.exe with 500ms passthrough fail-safe.".to_string()
            } else if apo_registered_any {
                "APO COM hook is registered on the selected endpoint, but audiodg.exe has not loaded the DLL yet (Windows 11 Protected Audio Path requires Authenticode/EV trust for unsigned APO DLLs). Native WASAPI Process Loopback (Engine 1) remains active.".to_string()
            } else {
                "Engine 1 (WASAPI Process-Exclusion Loopback) runs out of the box with zero drivers. Install Option 2 APO below only if you want single-speaker zero-doubling suppression (requires Admin + restarts Windows Audio).".to_string()
            };

            ApoSystemStatus {
                dll_bundled: dll_path.is_some(),
                dll_path: dll_path.map(|p| p.to_string_lossy().to_string()),
                apo_registered_any,
                apo_loaded_in_audiodg,
                dry_suppression_active,
                raw_output_active,
                selected_endpoint_id,
                endpoints,
                note,
            }
        }

        pub fn set_dry_suppression(&self, enabled: bool, endpoint_id: Option<String>) -> bool {
            let old_thread = {
                let Ok(mut guard) = self.inner.lock() else {
                    return false;
                };
                if guard.shm.is_none() {
                    guard.shm = SharedMemoryHandle::open_for_client();
                } else if let Some(ref mut s) = guard.shm {
                    let _ = s.try_reattach_global();
                }
                if let Some(ep) = endpoint_id {
                    guard.selected_endpoint_id = Some(ep);
                }

                guard.dry_flag.store(enabled, Ordering::Release);
                if let Some(ref s) = guard.shm {
                    let shm = s.shm();
                    if enabled {
                        shm.stamp_app_heartbeat(current_time_ms());
                        shm.set_suppress_dry(true);
                    } else {
                        shm.set_suppress_dry(false);
                        shm.clear_ring();
                    }
                }

                if enabled {
                    if guard.heartbeat_thread.is_none() {
                        let flag = Arc::clone(&guard.dry_flag);
                        guard.heartbeat_thread = thread::Builder::new()
                            .name("hkm-apo-watchdog".to_string())
                            .spawn(move || {
                                let mut shm_opt = SharedMemoryHandle::open_for_client();
                                while flag.load(Ordering::Acquire) {
                                    if let Some(ref mut h) = shm_opt {
                                        if !h.is_global {
                                            let _ = h.try_reattach_global();
                                        }
                                        let shm = h.shm();
                                        shm.stamp_app_heartbeat(current_time_ms());
                                        shm.set_suppress_dry(true);
                                    } else {
                                        shm_opt = SharedMemoryHandle::open_for_client();
                                    }
                                    thread::sleep(std::time::Duration::from_millis(120));
                                }
                                if let Some(ref h) = shm_opt {
                                    h.shm().set_suppress_dry(false);
                                }
                            })
                            .ok();
                    }
                    None
                } else {
                    guard.heartbeat_thread.take()
                }
            };

            if let Some(h) = old_thread {
                let _ = h.join();
            }
            enabled
        }

        pub fn install(&self, app: &AppHandle, endpoint_id: &str) -> Result<String, String> {
            let guid = validate_endpoint_id(endpoint_id)?;
            let dll_src = resolve_bundled_apo_dll(app).ok_or_else(|| {
                "Bundled hkm_audio_apo.dll was not found in resources.".to_string()
            })?;
            let backup_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
            let _ = std::fs::create_dir_all(&backup_dir);
            let backup_file = backup_dir.join("apo-backup.json");

            let prog_files_dll = r"$env:ProgramFiles\HKM Audio System\apo\hkm_audio_apo.dll";
            let ps_script = format!(
                r#"$ErrorActionPreference = 'Stop'
$src = '{src}'
$dst = "{dst}"
$dir = Split-Path -Parent $dst
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item -Path $src -Destination $dst -Force
Start-Process -FilePath 'regsvr32.exe' -ArgumentList '/s', "`"$dst`"" -Wait -NoNewWindow
$fxKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\{guid}\FxProperties'
if (-not (Test-Path $fxKey)) {{ New-Item -Path $fxKey -Force | Out-Null }}
$mfxProp = '{{d04e05a6-594b-4fb6-a80d-01af5eed7d1d}},6'
$cur = (Get-ItemProperty -Path $fxKey -Name $mfxProp -ErrorAction SilentlyContinue).$mfxProp
$backupPath = '{backup}'
if ($cur -and ($cur -ne '{clsid}')) {{
  @{{ endpointGuid = '{guid}'; prop = $mfxProp; previousClsid = $cur }} | ConvertTo-Json | Set-Content -Path $backupPath -Encoding UTF8
}}
New-ItemProperty -Path $fxKey -Name $mfxProp -Value '{clsid}' -PropertyType String -Force | Out-Null
Restart-Service -Name 'audiosrv' -Force -ErrorAction SilentlyContinue
"#,
                src = dll_src.display().to_string().replace('\'', "''"),
                dst = prog_files_dll,
                guid = guid,
                backup = backup_file.display().to_string().replace('\'', "''"),
                clsid = APO_CLSID_STR,
            );

            run_elevated_powershell(&ps_script)?;
            Ok(format!("Registered MFX APO on speaker endpoint {guid}."))
        }

        pub fn uninstall(&self, app: &AppHandle, endpoint_id: &str) -> Result<String, String> {
            self.set_dry_suppression(false, None);
            let guid = validate_endpoint_id(endpoint_id)?;
            let backup_file = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Could not resolve app data dir: {e}"))?
                .join("apo-backup.json");

            let ps_script = format!(
                r#"$ErrorActionPreference = 'Stop'
$dst = "$env:ProgramFiles\HKM Audio System\apo\hkm_audio_apo.dll"
$fxKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\{guid}\FxProperties'
$mfxProp = '{{d04e05a6-594b-4fb6-a80d-01af5eed7d1d}},6'
$backupPath = '{backup}'
if (Test-Path $fxKey) {{
  $restored = $false
  if (Test-Path $backupPath) {{
    try {{
      $b = Get-Content -Path $backupPath -Raw | ConvertFrom-Json
      if ($b.endpointGuid -eq '{guid}' -and $b.previousClsid) {{
        New-ItemProperty -Path $fxKey -Name $mfxProp -Value $b.previousClsid -PropertyType String -Force | Out-Null
        $restored = $true
      }}
    }} catch {{}}
  }}
  if (-not $restored) {{
    $cur = (Get-ItemProperty -Path $fxKey -Name $mfxProp -ErrorAction SilentlyContinue).$mfxProp
    if ($cur -eq '{clsid}') {{
      Remove-ItemProperty -Path $fxKey -Name $mfxProp -ErrorAction SilentlyContinue
    }}
  }}
}}
if (Test-Path $dst) {{
  Start-Process -FilePath 'regsvr32.exe' -ArgumentList '/u', '/s', "`"$dst`"" -Wait -NoNewWindow
  Remove-Item -Path $dst -Force -ErrorAction SilentlyContinue
}}
Restart-Service -Name 'audiosrv' -Force -ErrorAction SilentlyContinue
"#,
                guid = guid,
                backup = backup_file.display().to_string().replace('\'', "''"),
                clsid = APO_CLSID_STR,
            );

            run_elevated_powershell(&ps_script)?;
            Ok(format!("Uninstalled APO hook and restored audio endpoint {guid}."))
        }
    }
}

#[cfg(not(windows))]
mod win_impl {
    use super::*;

    #[derive(Default)]
    pub struct ApoManager;

    impl ApoManager {
        pub fn status(&self, _app: &AppHandle, raw_output_active: bool) -> ApoSystemStatus {
            ApoSystemStatus {
                dll_bundled: false,
                dll_path: None,
                apo_registered_any: false,
                apo_loaded_in_audiodg: false,
                dry_suppression_active: false,
                raw_output_active,
                selected_endpoint_id: None,
                endpoints: Vec::new(),
                note: "Windows Audio Processing Object (APO) is only supported on Windows.".to_string(),
            }
        }
        pub fn set_dry_suppression(&self, _enabled: bool, _endpoint_id: Option<String>) -> bool {
            false
        }
        pub fn install(&self, _app: &AppHandle, _endpoint_id: &str) -> Result<String, String> {
            Err("Windows APO installation requires Windows.".to_string())
        }
        pub fn uninstall(&self, _app: &AppHandle, _endpoint_id: &str) -> Result<String, String> {
            Err("Windows APO uninstall requires Windows.".to_string())
        }
    }
}

pub use win_impl::ApoManager;
