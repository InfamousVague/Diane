mod audio;

use audio::recorder::AudioRecorder;
use audio::transcribe::LiveTranscriber;
use audio::playback::AudioPlayer;
use audio::events::AudioEventDetector;
use std::sync::Mutex;
use tauri::Manager;
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState};

struct AppState {
    recorder: AudioRecorder,
    transcriber: Mutex<LiveTranscriber>,
    event_detector: Mutex<AudioEventDetector>,
    player: Mutex<AudioPlayer>,
    recordings_dir: String,
    scripts_dir: String,
}

#[tauri::command]
fn start_recording(state: tauri::State<'_, AppState>) -> Result<(), String> {
    // Start audio recording
    state.recorder.start()?;

    // Start live transcriber
    let mut transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
    transcriber.start()?;

    // Start audio event detector
    let mut detector = state.event_detector.lock().map_err(|e| e.to_string())?;
    if let Err(e) = detector.start() {
        log::warn!("Audio event detector failed to start: {}", e);
        // Non-fatal — transcription works without events
    }

    Ok(())
}

#[derive(serde::Serialize)]
struct StopRecordingResult {
    transcript: String,
    audio_path: String,
}

#[tauri::command]
async fn stop_recording(state: tauri::State<'_, AppState>) -> Result<StopRecordingResult, String> {
    // Stop recording and get segment samples
    let segment = state.recorder.stop();

    // Stop event detector and merge events into transcriber
    {
        let mut detector = state.event_detector.lock().map_err(|e| e.to_string())?;
        let events = detector.take_events();
        let transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
        for event in events {
            transcriber.push_event(event.timestamp_ms, event.label);
        }
        detector.stop();
    }

    // Feed final samples to transcriber and stop
    let transcript = {
        let mut transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
        if !segment.is_empty() {
            transcriber.feed_samples(&segment);
        }
        transcriber.stop()
    };

    // Save the FULL accumulated tape (all segments) as a single WAV
    let all_samples = state.recorder.take_all_samples();
    let audio_path = if !all_samples.is_empty() {
        let dir = state.recordings_dir.clone();
        let id = uuid::Uuid::new_v4().to_string();
        let wav_path = format!("{}/{}.wav", dir, id);
        AudioRecorder::save_wav(&all_samples, &wav_path, 16000)?;
        log::info!("Saved full tape recording to {} ({} samples)", wav_path, all_samples.len());
        wav_path
    } else {
        String::new()
    };

    Ok(StopRecordingResult { transcript, audio_path })
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct SavedTape {
    id: String,
    date: u64,
    duration: u64,
    transcript: String,
    label: String,
    #[serde(default)]
    variant: u32,
    #[serde(default)]
    audio_path: String,
}

#[tauri::command]
fn save_tapes(state: tauri::State<'_, AppState>, tapes: Vec<SavedTape>) -> Result<(), String> {
    let path = format!("{}/../tapes.json", state.recordings_dir);
    let json = serde_json::to_string_pretty(&tapes).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to save tapes: {}", e))?;
    log::info!("Saved {} tapes to {}", tapes.len(), path);
    Ok(())
}

#[tauri::command]
fn load_tapes(state: tauri::State<'_, AppState>) -> Vec<SavedTape> {
    let path = format!("{}/../tapes.json", state.recordings_dir);
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
fn get_audio_level(state: tauri::State<'_, AppState>) -> f32 {
    state.recorder.get_level()
}

#[tauri::command]
fn get_live_transcript(state: tauri::State<'_, AppState>) -> String {
    let transcriber = state.transcriber.lock().unwrap();
    transcriber.get_transcript()
}

#[tauri::command]
async fn type_text(text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        use enigo::{Enigo, Keyboard, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        for ch in text.chars() {
            enigo.text(&ch.to_string()).map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        Ok::<(), String>(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn load_tape(state: tauri::State<'_, AppState>, audio_path: String) -> Result<(), String> {
    let mut player = state.player.lock().map_err(|e| e.to_string())?;
    player.load_tape(&audio_path)
}

#[tauri::command]
fn start_playback(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.play()
}

#[tauri::command]
fn stop_playback(state: tauri::State<'_, AppState>) {
    let player = state.player.lock().unwrap();
    player.stop();
}

#[tauri::command]
fn start_rewind(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.start_rewind()
}

#[tauri::command]
fn stop_rewind(state: tauri::State<'_, AppState>) {
    let player = state.player.lock().unwrap();
    player.stop_rewind();
}

#[tauri::command]
fn start_fast_forward(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let player = state.player.lock().map_err(|e| e.to_string())?;
    player.start_fast_forward()
}

#[tauri::command]
fn stop_fast_forward(state: tauri::State<'_, AppState>) {
    // Same deceleration as rewind
    let player = state.player.lock().unwrap();
    player.stop_rewind();
}

#[tauri::command]
fn seek_to(state: tauri::State<'_, AppState>, progress: f32) {
    let player = state.player.lock().unwrap();
    player.seek_to(progress);
}

#[tauri::command]
fn seek_to_end(state: tauri::State<'_, AppState>) {
    let player = state.player.lock().unwrap();
    player.seek_to_end();
}

#[tauri::command]
fn get_playback_state(state: tauri::State<'_, AppState>) -> String {
    let player = state.player.lock().unwrap();
    player.get_state()
}

#[tauri::command]
fn get_playback_level(state: tauri::State<'_, AppState>) -> f32 {
    let player = state.player.lock().unwrap();
    player.get_level()
}

#[tauri::command]
fn get_playback_position(state: tauri::State<'_, AppState>) -> f32 {
    let player = state.player.lock().unwrap();
    player.get_position()
}

#[tauri::command]
fn get_tape_position_secs(state: tauri::State<'_, AppState>) -> f32 {
    let player = state.player.lock().unwrap();
    player.get_position_secs()
}

#[tauri::command]
fn resolve_default_audio(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> String {
    let dest = format!("{}/default-tape.wav", state.recordings_dir);
    if std::path::Path::new(&dest).exists() {
        return dest;
    }
    // Try to copy from the frontend dist assets
    if let Ok(resource) = app.path().resolve("assets/default-tape.wav", tauri::path::BaseDirectory::Resource) {
        if resource.exists() {
            let _ = std::fs::copy(&resource, &dest);
            log::info!("Copied default tape from resources to {}", dest);
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
    String::new()
}

#[tauri::command]
fn check_models_ready() -> bool {
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".diane/models/ggml-base.en.bin").exists()
}

/// Download the whisper model (blocking — call from async context)
#[tauri::command]
async fn download_models() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        audio::models::ensure_whisper_model("base.en")
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn truncate_audio_cmd(audio_path: String, at_secs: f32) -> Result<String, String> {
    audio::playback::truncate_audio(&audio_path, at_secs)
}

#[tauri::command]
fn feed_audio_to_transcriber(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let samples = state.recorder.get_recent_samples();
    if !samples.is_empty() {
        // Feed to whisper transcriber
        let transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
        transcriber.feed_samples(&samples);

        // Feed to audio event detector
        let mut detector = state.event_detector.lock().map_err(|e| e.to_string())?;
        detector.feed_samples(&samples);

        // Pull any new events into the transcriber
        let events = detector.take_events();
        for event in events {
            transcriber.push_event(event.timestamp_ms, event.label);
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let home = dirs::home_dir().unwrap_or_default();
    let recordings_dir = home.join(".diane").join("recordings");
    std::fs::create_dir_all(&recordings_dir).ok();

    let scripts_dir = std::env::var("CARGO_MANIFEST_DIR")
        .unwrap_or_else(|_| {
            std::env::current_exe()
                .unwrap_or_default()
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .to_string_lossy()
                .to_string()
        });

    let recorder = AudioRecorder::new().expect("Failed to initialize audio recorder");
    let transcriber = LiveTranscriber::new();
    let event_detector = AudioEventDetector::new(&scripts_dir);
    let player = AudioPlayer::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            recorder,
            transcriber: Mutex::new(transcriber),
            event_detector: Mutex::new(event_detector),
            player: Mutex::new(player),
            recordings_dir: recordings_dir.to_string_lossy().to_string(),
            scripts_dir: scripts_dir.to_string(),
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            get_audio_level,
            get_live_transcript,
            feed_audio_to_transcriber,
            type_text,
            load_tape,
            start_playback,
            stop_playback,
            start_rewind,
            stop_rewind,
            start_fast_forward,
            stop_fast_forward,
            seek_to,
            seek_to_end,
            get_playback_state,
            get_playback_level,
            get_playback_position,
            get_tape_position_secs,
            truncate_audio_cmd,
            resolve_default_audio,
            check_models_ready,
            download_models,
            hide_window,
            show_window,
            save_tapes,
            load_tapes,
        ])
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // System tray icon — clicking it toggles the window
            // Hide from dock — menu bar only app
            #[cfg(target_os = "macos")]
            {
                use tauri::ActivationPolicy;
                app.set_activation_policy(ActivationPolicy::Accessory);
            }

            // Tray icon with cassette image
            let app_handle = app.handle().clone();
            let tray_icon = {
                let rgba = include_bytes!("../icons/tray-icon.rgba");
                tauri::image::Image::new_owned(rgba.to_vec(), 600, 600)
            };

            TrayIconBuilder::new()
                .tooltip("Diane — Voice Recorder")
                .icon(tray_icon)
                .icon_as_template(true)
                .on_tray_icon_event(move |_tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Set up window blur handler — hide when clicking off
            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = win.hide();
                    }
                });
            }

            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let screen = monitor.size();
                    let scale = monitor.scale_factor();
                    let win_w = 344.0; // sidebar + margins
                    let screen_h = screen.height as f64 / scale;
                    let screen_w = screen.width as f64 / scale;
                    let menu_bar_h = 25.0;
                    let win_h = screen_h - menu_bar_h;
                    let x = screen_w - win_w;
                    let y = menu_bar_h;
                    let _ = window.set_size(tauri::Size::Logical(
                        tauri::LogicalSize::new(win_w, win_h),
                    ));
                    let _ = window.set_position(tauri::Position::Logical(
                        tauri::LogicalPosition::new(x, y),
                    ));
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
