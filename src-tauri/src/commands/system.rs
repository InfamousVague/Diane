use crate::state::{AppState, lock};

/// Returns "granted", "denied", or "undetermined" for mic permission
#[tauri::command]
pub fn request_mic_permission() -> String {
    // On macOS, cpal triggers the mic permission dialog automatically
    // when we first access the default input device.
    // We can check the TCC status via a quick device enumeration.
    use cpal::traits::{HostTrait, DeviceTrait};
    let host = cpal::default_host();
    match host.default_input_device() {
        Some(device) => {
            // Try to get config — this triggers the permission prompt
            match device.default_input_config() {
                Ok(_) => "granted".to_string(),
                Err(_) => "denied".to_string(),
            }
        }
        None => "denied".to_string(),
    }
}

#[tauri::command]
pub fn enable_desktop_capture(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let mut desktop = lock(&state.desktop_capture)?;
    desktop.start()?;
    // Check if permission was denied
    if desktop.permission_denied() {
        return Ok("permission_denied".to_string());
    }
    Ok("ok".to_string())
}

#[tauri::command]
pub fn disable_desktop_capture(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut desktop = lock(&state.desktop_capture)?;
    desktop.stop();
    Ok(())
}

#[tauri::command]
pub fn check_models_ready() -> bool {
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".diane/models/ggml-base.en.bin").exists()
}

/// Download the whisper model (blocking -- call from async context)
#[tauri::command]
pub async fn download_models() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        crate::audio::models::ensure_whisper_model("base.en")
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_meeting_state(state: tauri::State<'_, AppState>) -> String {
    let detector = lock(&state.meeting_detector).unwrap();
    detector.get_state()
}

#[tauri::command]
pub fn dismiss_meeting(state: tauri::State<'_, AppState>) {
    let detector = lock(&state.meeting_detector).unwrap();
    detector.dismiss();
}
