use tauri::Manager;
use crate::state::{AppState, SavedTape};

#[tauri::command]
pub fn save_tapes(state: tauri::State<'_, AppState>, tapes: Vec<SavedTape>) -> Result<(), String> {
    let path = format!("{}/../tapes.json", state.recordings_dir);
    let json = serde_json::to_string_pretty(&tapes).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to save tapes: {}", e))?;
    log::info!("Saved {} tapes to {}", tapes.len(), path);
    Ok(())
}

#[tauri::command]
pub fn load_tapes(state: tauri::State<'_, AppState>) -> Vec<SavedTape> {
    let path = format!("{}/../tapes.json", state.recordings_dir);
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
pub fn resolve_default_audio(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> String {
    let dest = format!("{}/default-tape.wav", state.recordings_dir);
    if std::path::Path::new(&dest).exists() {
        return dest;
    }

    // Try bundled resource (release builds — from tauri.conf.json resources)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("default-tape.wav");
        if bundled.exists() {
            let _ = std::fs::copy(&bundled, &dest);
            log::info!("Copied default tape from bundled resources to {}", dest);
            return dest;
        }
    }

    // Try frontend dist assets path
    if let Ok(resource) = app.path().resolve("assets/default-tape.wav", tauri::path::BaseDirectory::Resource) {
        if resource.exists() {
            let _ = std::fs::copy(&resource, &dest);
            log::info!("Copied default tape from dist assets to {}", dest);
            return dest;
        }
    }

    // Dev mode: try from the public directory
    let dev_path = std::env::var("CARGO_MANIFEST_DIR")
        .map(|d| format!("{}/../public/assets/default-tape.wav", d))
        .unwrap_or_default();
    if std::path::Path::new(&dev_path).exists() {
        let _ = std::fs::copy(&dev_path, &dest);
        log::info!("Copied default tape from dev assets to {}", dest);
        return dest;
    }

    log::warn!("Could not find default-tape.wav in any location");
    String::new()
}

#[tauri::command]
pub fn truncate_audio_cmd(audio_path: String, at_secs: f32) -> Result<String, String> {
    crate::audio::playback::truncate_audio(&audio_path, at_secs)
}
