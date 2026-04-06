use crate::state::{AppState, lock};

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
