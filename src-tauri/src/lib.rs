mod apo_manager;
mod desktop_audio;
mod raw_output;

use apo_manager::{ApoManager, ApoSystemStatus};
use chrono::Utc;
use desktop_audio::{enumerate_active_audio_sessions, DesktopAudioManager, DesktopAudioSession, DesktopAudioStatus};
use raw_output::RawOutputManager;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::{
    ipc::{Channel, InvokeBody, Request, Response},
    webview::{PermissionKind, PermissionResponse, WebviewWindowBuilder},
    AppHandle, Manager, RunEvent, State,
};

const MAX_STATE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Default)]
struct DesktopState {
    state_lock: Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiResponse {
    status: u16,
    body: Value,
}

impl ApiResponse {
    fn success(body: Value) -> Self {
        Self { status: 200, body }
    }

    fn failure(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            body: json!({ "ok": false, "error": message.into() }),
        }
    }
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the application data directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the application data directory: {error}"))?;
    Ok(directory.join("church-audio-state.json"))
}

fn initial_state() -> Value {
    json!({
        "venue": {
            "organization": "Grace Community Fellowship",
            "venueName": "Main Campus",
            "roomName": "Primary Sanctuary (650 Seats)",
            "targetPlatform": "windows",
            "driver": "ASIO",
            "sampleRate": 48000,
            "bufferSize": 128,
            "activeDeviceId": "yamaha-mg16xu"
        },
        "versions": [],
        "diagnostics": [],
        "auditEvents": [{
            "id": "evt-init-1",
            "timestamp": Utc::now().to_rfc3339(),
            "actor": "System Watchdog",
            "action": "Local Configuration Store Initialized",
            "detail": "Desktop application data store initialized.",
            "authority": "system"
        }],
        "midiMappings": [],
        "automationSnapshots": [],
        "keyboardShortcuts": [],
        "deviceProfiles": {}
    })
}

fn read_state(path: &PathBuf) -> Result<Value, String> {
    if !path.exists() {
        let state = initial_state();
        write_state(path, &state)?;
        return Ok(state);
    }

    let bytes = fs::read(path).map_err(|error| format!("Could not read saved state: {error}"))?;
    let state: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Saved state is invalid JSON and was left untouched: {error}"))?;
    if !state.is_object() {
        return Err("Saved state must be a JSON object and was left untouched.".to_string());
    }
    Ok(state)
}

fn write_state(path: &PathBuf, state: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Could not encode saved state: {error}"))?;
    if bytes.len() > MAX_STATE_BYTES {
        return Err("Saved state exceeds the 10 MB desktop limit.".to_string());
    }

    let directory = path
        .parent()
        .ok_or_else(|| "Application data path has no parent directory.".to_string())?;
    let mut staged = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| format!("Could not stage saved state: {error}"))?;
    staged
        .write_all(&bytes)
        .and_then(|_| staged.as_file().sync_all())
        .map_err(|error| format!("Could not write saved state: {error}"))?;
    staged
        .persist(path)
        .map_err(|error| format!("Could not commit saved state: {}", error.error))?;
    Ok(())
}

fn as_object_mut<'a>(
    value: &'a mut Value,
    label: &str,
) -> Result<&'a mut Map<String, Value>, String> {
    value
        .as_object_mut()
        .ok_or_else(|| format!("{label} must be a JSON object."))
}

fn body_object(body: Option<Value>, label: &str) -> Result<Map<String, Value>, String> {
    body.as_ref()
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| format!("{label} must be a JSON object."))
}

fn state_array_mut<'a>(state: &'a mut Value, key: &str) -> Result<&'a mut Vec<Value>, String> {
    let object = as_object_mut(state, "Saved state")?;
    if !object.get(key).is_some_and(Value::is_array) {
        object.insert(key.to_string(), json!([]));
    }
    object
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .ok_or_else(|| format!("Saved state field {key} must be an array."))
}

fn api_request_inner(
    app: &AppHandle,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<ApiResponse, String> {
    if !path.starts_with("/api/") || path.contains('?') || path.contains("..") {
        return Ok(ApiResponse::failure(400, "Invalid desktop API path."));
    }

    if path.starts_with("/api/ai/") {
        return Ok(ApiResponse::failure(
            501,
            "AI features are not configured for the desktop build yet.",
        ));
    }

    let state_file = state_path(app)?;
    let mut state = read_state(&state_file)?;
    let response = match (method, path) {
        ("GET", "/api/state") => return Ok(ApiResponse::success(state)),
        ("PUT", "/api/state/sync") => {
            let snapshot = body_object(body, "State snapshot")?;
            for key in [
                "venue",
                "channels",
                "dsp",
                "activePresetId",
                "broadcastDsp",
                "zones",
                "obsStatus",
                "measurement",
                "bassDi",
                "emergencyMuted",
                "findings",
            ] {
                if let Some(value) = snapshot.get(key) {
                    state[key] = value.clone();
                }
            }
            json!({ "ok": true })
        }
        ("POST", "/api/venue") => {
            let patch = body_object(body, "Venue payload")?;
            let object = as_object_mut(&mut state["venue"], "Venue state")?;
            object.extend(patch);
            json!({ "ok": true, "venue": state["venue"] })
        }
        ("POST", "/api/versions") => {
            let version = body.ok_or_else(|| "Version payload is required.".to_string())?;
            if !version.is_object() {
                return Ok(ApiResponse::failure(400, "Invalid version payload."));
            }
            let actor = version
                .get("author")
                .and_then(Value::as_str)
                .unwrap_or("Operator")
                .to_string();
            let version_label = version
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let detail = version
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or("Configuration snapshot stored locally.")
                .to_string();
            let timestamp = version
                .get("timestamp")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| Utc::now().to_rfc3339());
            let versions = state_array_mut(&mut state, "versions")?;
            versions.insert(0, version);
            versions.truncate(40);
            let event = json!({
                "id": format!("evt-{}", Utc::now().timestamp_millis()),
                "timestamp": timestamp,
                "actor": actor,
                "action": format!("Saved Configuration {version_label}"),
                "detail": detail,
                "authority": "operator"
            });
            let events = state_array_mut(&mut state, "auditEvents")?;
            events.insert(0, event);
            events.truncate(100);
            json!({ "ok": true, "versions": state["versions"], "auditEvents": state["auditEvents"] })
        }
        ("POST", "/api/audit") => {
            let mut event = body_object(body, "Audit event")?;
            event
                .entry("id".to_string())
                .or_insert_with(|| json!(format!("evt-{}", Utc::now().timestamp_millis())));
            event
                .entry("timestamp".to_string())
                .or_insert_with(|| json!(Utc::now().to_rfc3339()));
            let events = state_array_mut(&mut state, "auditEvents")?;
            events.insert(0, Value::Object(event));
            events.truncate(100);
            json!({ "ok": true, "auditEvents": state["auditEvents"] })
        }
        ("POST", "/api/midi-mappings") => {
            let mappings = body
                .and_then(|value| value.get("mappings").cloned())
                .filter(Value::is_array)
                .ok_or_else(|| "mappings must be an array.".to_string())?;
            state["midiMappings"] = mappings;
            json!({ "ok": true, "midiMappings": state["midiMappings"] })
        }
        ("POST", "/api/shortcuts") => {
            let shortcuts = body
                .and_then(|value| value.get("shortcuts").cloned())
                .filter(Value::is_array)
                .ok_or_else(|| "shortcuts must be an array.".to_string())?;
            state["keyboardShortcuts"] = shortcuts;
            json!({ "ok": true, "keyboardShortcuts": state["keyboardShortcuts"] })
        }
        ("POST", "/api/automations") => {
            let snapshot = body
                .and_then(|value| value.get("snapshot").cloned().or(Some(value)))
                .ok_or_else(|| "Automation snapshot is required.".to_string())?;
            let id = snapshot
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Automation snapshot must include a string id.".to_string())?;
            let snapshots = state_array_mut(&mut state, "automationSnapshots")?;
            snapshots.retain(|item| item.get("id").and_then(Value::as_str) != Some(id));
            snapshots.insert(0, snapshot);
            snapshots.truncate(40);
            json!({ "ok": true, "automationSnapshots": state["automationSnapshots"] })
        }
        _ if path.starts_with("/api/hardware/profiles/") => {
            let device_id = path.trim_start_matches("/api/hardware/profiles/");
            if device_id.is_empty()
                || !device_id.chars().all(|character| {
                    character.is_ascii_alphanumeric() || character == '-' || character == '_'
                })
            {
                return Ok(ApiResponse::failure(400, "Invalid hardware profile id."));
            }
            if !state.get("deviceProfiles").is_some_and(Value::is_object) {
                state["deviceProfiles"] = json!({});
            }
            match method {
                "GET" => json!({
                    "ok": true,
                    "profile": state["deviceProfiles"].get(device_id).cloned().unwrap_or(Value::Null)
                }),
                "POST" => {
                    let profile = Value::Object(body_object(body, "Hardware profile")?);
                    state["deviceProfiles"][device_id] = profile;
                    json!({ "ok": true, "deviceId": device_id, "updatedAt": Utc::now().to_rfc3339() })
                }
                _ => return Ok(ApiResponse::failure(405, "Method not allowed.")),
            }
        }
        ("GET", "/api/hardware/scan") => {
            return Ok(ApiResponse::failure(
                501,
                "Native Windows audio endpoint discovery is not integrated yet; browser-visible devices can still be scanned.",
            ));
        }
        ("GET", "/api/network/interfaces") => {
            return Ok(ApiResponse::failure(
                501,
                "LAN interface discovery is provided by the web companion host, not the desktop shell.",
            ));
        }
        _ if path.starts_with("/api/remote/") => {
            return Ok(ApiResponse::failure(
                501,
                "FOH companion hosting is provided by the web companion host and is not enabled in the desktop shell yet.",
            ));
        }
        _ if path.starts_with("/api/automations/") => {
            let id = path.trim_start_matches("/api/automations/");
            if id.is_empty() || id.contains('/') {
                return Ok(ApiResponse::failure(400, "Invalid automation id."));
            }
            let snapshots = state_array_mut(&mut state, "automationSnapshots")?;
            match method {
                "PATCH" => {
                    let patch = body_object(body, "Automation patch")?;
                    if let Some(snapshot) = snapshots
                        .iter_mut()
                        .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
                    {
                        as_object_mut(snapshot, "Automation snapshot")?.extend(patch);
                    }
                }
                "DELETE" => {
                    snapshots.retain(|item| item.get("id").and_then(Value::as_str) != Some(id))
                }
                _ => return Ok(ApiResponse::failure(405, "Method not allowed.")),
            }
            json!({ "ok": true, "automationSnapshots": state["automationSnapshots"] })
        }
        _ => return Ok(ApiResponse::failure(404, "Desktop API route not found.")),
    };

    write_state(&state_file, &state)?;
    Ok(ApiResponse::success(response))
}

#[tauri::command]
fn desktop_api_request(
    app: AppHandle,
    desktop_state: State<'_, DesktopState>,
    method: String,
    path: String,
    body: Option<Value>,
) -> ApiResponse {
    if body
        .as_ref()
        .and_then(|value| serde_json::to_vec(value).ok())
        .is_some_and(|bytes| bytes.len() > MAX_STATE_BYTES)
    {
        return ApiResponse::failure(413, "Request body exceeds the 10 MB desktop limit.");
    }

    let _state_guard = match desktop_state.state_lock.lock() {
        Ok(guard) => guard,
        Err(_) => return ApiResponse::failure(500, "Desktop state lock is unavailable."),
    };

    match api_request_inner(&app, &method.to_ascii_uppercase(), &path, body) {
        Ok(response) => response,
        Err(error) => ApiResponse::failure(500, error),
    }
}

#[tauri::command]
fn desktop_audio_status(
    audio_mgr: State<'_, DesktopAudioManager>,
    apo_mgr: State<'_, ApoManager>,
    raw_out: State<'_, RawOutputManager>,
    app: AppHandle,
) -> DesktopAudioStatus {
    let apo = apo_mgr.status(&app, raw_out.is_running());
    audio_mgr.status(apo.apo_loaded_in_audiodg && apo.dry_suppression_active)
}

#[tauri::command]
fn list_desktop_audio_sessions() -> Vec<DesktopAudioSession> {
    enumerate_active_audio_sessions()
}

#[tauri::command]
fn start_desktop_audio_capture(
    audio_mgr: State<'_, DesktopAudioManager>,
    stream_key: String,
    target_pid: Option<u32>,
    audio_channel: Channel<Response>,
) -> Result<(), String> {
    audio_mgr.start_stream(stream_key, target_pid, audio_channel)
}

#[tauri::command]
fn stop_desktop_audio_capture(
    audio_mgr: State<'_, DesktopAudioManager>,
    stream_key: String,
) {
    audio_mgr.stop_stream(&stream_key);
}

#[tauri::command]
fn stop_all_desktop_audio_captures(audio_mgr: State<'_, DesktopAudioManager>) {
    audio_mgr.stop_all();
}

#[tauri::command]
fn get_apo_status(
    apo_mgr: State<'_, ApoManager>,
    raw_out: State<'_, RawOutputManager>,
    app: AppHandle,
) -> ApoSystemStatus {
    apo_mgr.status(&app, raw_out.is_running())
}

#[tauri::command]
fn set_apo_dry_suppression(
    apo_mgr: State<'_, ApoManager>,
    enabled: bool,
    endpoint_id: Option<String>,
) -> bool {
    apo_mgr.set_dry_suppression(enabled, endpoint_id)
}

#[tauri::command]
fn install_system_apo(
    apo_mgr: State<'_, ApoManager>,
    app: AppHandle,
    endpoint_id: String,
) -> Result<String, String> {
    apo_mgr.install(&app, &endpoint_id)
}

#[tauri::command]
fn uninstall_system_apo(
    apo_mgr: State<'_, ApoManager>,
    app: AppHandle,
    endpoint_id: String,
) -> Result<String, String> {
    apo_mgr.uninstall(&app, &endpoint_id)
}

#[tauri::command]
fn start_raw_output(
    raw_out: State<'_, RawOutputManager>,
    endpoint_id: Option<String>,
) -> Result<(), String> {
    raw_out.start(endpoint_id)
}

#[tauri::command]
fn push_raw_output_pcm(raw_out: State<'_, RawOutputManager>, request: Request<'_>) -> Result<(), String> {
    match request.body() {
        InvokeBody::Raw(bytes) => {
            raw_out.push_pcm_bytes(bytes);
            Ok(())
        }
        InvokeBody::Json(_) => Err("Expected raw binary Float32 PCM buffer".to_string()),
    }
}

#[tauri::command]
fn stop_raw_output(raw_out: State<'_, RawOutputManager>) {
    raw_out.stop();
}

#[tauri::command]
fn open_windows_sound_settings(page: Option<String>) -> Result<(), String> {
    let target_uri = match page.as_deref() {
        Some("sound") => "ms-settings:sound",
        _ => "ms-settings:apps-volume",
    };
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(target_uri)
            .spawn()
            .map_err(|e| format!("Failed to open Windows Sound Settings: {e}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = target_uri;
        Err("Windows Sound Settings is only available on Windows.".to_string())
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DesktopState::default())
        .manage(DesktopAudioManager::default())
        .manage(ApoManager::default())
        .manage(RawOutputManager::default())
        .setup(|app| {
            let window_config = &app.config().app.windows[0];
            let mut builder = WebviewWindowBuilder::from_config(app.handle(), window_config)?;
            #[cfg(debug_assertions)]
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                let dev_webview_dir = app_data_dir.join("dev-webview");
                let _ = fs::create_dir_all(&dev_webview_dir);
                builder = builder.data_directory(dev_webview_dir);
            }
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone())?;
            }
            let window = builder
                .on_permission_request(|_, kind| match kind {
                    PermissionKind::Microphone | PermissionKind::Midi => PermissionResponse::Allow,
                    _ => PermissionResponse::Default,
                })
                .build()?;
            if let Some(icon) = app.default_window_icon() {
                let _ = window.set_icon(icon.clone());
            }
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let work = monitor.work_area();
                let scale = monitor.scale_factor();
                let max_w = (work.size.width as f64 / scale).floor() as u32;
                let max_h = (work.size.height as f64 / scale).floor() as u32;
                if max_w <= 1440 || max_h <= 800 {
                    let _ = window.maximize();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_api_request,
            desktop_audio_status,
            list_desktop_audio_sessions,
            start_desktop_audio_capture,
            stop_desktop_audio_capture,
            stop_all_desktop_audio_captures,
            get_apo_status,
            set_apo_dry_suppression,
            install_system_apo,
            uninstall_system_apo,
            start_raw_output,
            push_raw_output_pcm,
            stop_raw_output,
            open_windows_sound_settings
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Church Audio Intelligence desktop application")
        .run(|app_handle, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                app_handle.state::<DesktopAudioManager>().stop_all();
                app_handle.state::<RawOutputManager>().stop();
                app_handle.state::<ApoManager>().set_dry_suppression(false, None);
            }
        });
}
