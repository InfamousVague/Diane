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
        log::info!("Default tape already at {}", dest);
        return dest;
    }

    // Build a list of candidate paths to search
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // 1. Bundled resource dir (tauri.conf.json resources mapping)
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("default-tape.wav"));
        // Also check the _up_ path variant that Tauri creates
        candidates.push(resource_dir.join("_up_/public/assets/default-tape.wav"));
    }

    // 2. Resolve via BaseDirectory::Resource
    if let Ok(p) = app.path().resolve("default-tape.wav", tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }
    if let Ok(p) = app.path().resolve("assets/default-tape.wav", tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }

    // 3. Relative to the executable (release builds)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("../Resources/default-tape.wav"));
            candidates.push(exe_dir.join("../Resources/_up_/public/assets/default-tape.wav"));
        }
    }

    // 4. Dev mode: relative to CARGO_MANIFEST_DIR
    if let Ok(d) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.push(std::path::PathBuf::from(format!("{}/../public/assets/default-tape.wav", d)));
    }

    // Try each candidate
    for candidate in &candidates {
        if candidate.exists() {
            match std::fs::copy(candidate, &dest) {
                Ok(_) => {
                    log::info!("Copied default tape from {} to {}", candidate.display(), dest);
                    return dest;
                }
                Err(e) => {
                    log::warn!("Found default tape at {} but copy failed: {}", candidate.display(), e);
                }
            }
        }
    }

    log::warn!("Could not find default-tape.wav in any of {} locations: {:?}",
        candidates.len(),
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>()
    );
    String::new()
}

#[tauri::command]
pub fn truncate_audio_cmd(audio_path: String, at_secs: f32) -> Result<String, String> {
    crate::audio::playback::truncate_audio(&audio_path, at_secs)
}
