mod audio;
mod commands;
mod meeting_detector;
mod setup;
mod state;

use audio::recorder::AudioRecorder;
use audio::transcribe::LiveTranscriber;
use audio::playback::AudioPlayer;
use audio::events::AudioEventDetector;
use audio::desktop_capture::DesktopCapture;
use meeting_detector::MeetingDetector;
use std::sync::Mutex;

use commands::recording::*;
use commands::playback::*;
use commands::tapes::*;
use commands::ui::*;
use commands::dictation::*;
use commands::system::*;

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
    let desktop_capture = DesktopCapture::new(&scripts_dir);
    let meeting_detector = MeetingDetector::new();
    let player = AudioPlayer::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state::AppState {
            recorder,
            transcriber: Mutex::new(transcriber),
            event_detector: Mutex::new(event_detector),
            desktop_capture: Mutex::new(desktop_capture),
            player: Mutex::new(player),
            meeting_detector: Mutex::new(meeting_detector),
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
            get_meeting_state,
            dismiss_meeting,
            check_models_ready,
            download_models,
            hide_window,
            show_window,
            save_tapes,
            load_tapes,
        ])
        .setup(|app| setup::setup(app))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
