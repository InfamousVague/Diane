use crate::state::{AppState, lock};

#[tauri::command]
pub fn load_tape(state: tauri::State<'_, AppState>, audio_path: String) -> Result<(), String> {
    let mut player = lock(&state.player)?;
    player.load_tape(&audio_path)
}

#[tauri::command]
pub fn start_playback(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let player = lock(&state.player)?;
    player.play()
}

#[tauri::command]
pub fn stop_playback(state: tauri::State<'_, AppState>) {
    let player = lock(&state.player).unwrap();
    player.stop();
}

#[tauri::command]
pub fn start_rewind(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let player = lock(&state.player)?;
    player.start_rewind()
}

#[tauri::command]
pub fn stop_rewind(state: tauri::State<'_, AppState>) {
    let player = lock(&state.player).unwrap();
    player.stop_rewind();
}

#[tauri::command]
pub fn start_fast_forward(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let player = lock(&state.player)?;
    player.start_fast_forward()
}

#[tauri::command]
pub fn stop_fast_forward(state: tauri::State<'_, AppState>) {
    // Same deceleration as rewind
    let player = lock(&state.player).unwrap();
    player.stop_rewind();
}

#[tauri::command]
pub fn seek_to(state: tauri::State<'_, AppState>, progress: f32) {
    let player = lock(&state.player).unwrap();
    player.seek_to(progress);
}

#[tauri::command]
pub fn seek_to_end(state: tauri::State<'_, AppState>) {
    let player = lock(&state.player).unwrap();
    player.seek_to_end();
}

#[tauri::command]
pub fn get_playback_state(state: tauri::State<'_, AppState>) -> String {
    let player = lock(&state.player).unwrap();
    player.get_state()
}

#[tauri::command]
pub fn get_playback_level(state: tauri::State<'_, AppState>) -> f32 {
    let player = lock(&state.player).unwrap();
    player.get_level()
}

#[tauri::command]
pub fn get_playback_position(state: tauri::State<'_, AppState>) -> f32 {
    let player = lock(&state.player).unwrap();
    player.get_position()
}

#[tauri::command]
pub fn get_tape_position_secs(state: tauri::State<'_, AppState>) -> f32 {
    let player = lock(&state.player).unwrap();
    player.get_position_secs()
}
