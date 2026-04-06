use std::sync::Mutex;

use crate::audio::recorder::AudioRecorder;
use crate::audio::transcribe::LiveTranscriber;
use crate::audio::playback::AudioPlayer;
use crate::audio::events::AudioEventDetector;
use crate::audio::desktop_capture::DesktopCapture;
use crate::meeting_detector::MeetingDetector;

pub struct AppState {
    pub recorder: AudioRecorder,
    pub transcriber: Mutex<LiveTranscriber>,
    pub event_detector: Mutex<AudioEventDetector>,
    pub desktop_capture: Mutex<DesktopCapture>,
    pub player: Mutex<AudioPlayer>,
    pub meeting_detector: Mutex<MeetingDetector>,
    pub recordings_dir: String,
    #[allow(dead_code)]
    pub scripts_dir: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SavedTape {
    pub id: String,
    pub date: u64,
    pub duration: u64,
    pub transcript: String,
    pub label: String,
    #[serde(default)]
    pub variant: u32,
    #[serde(default)]
    pub audio_path: String,
}

#[derive(serde::Serialize)]
pub struct StopRecordingResult {
    pub transcript: String,
    pub audio_path: String,
}

/// Helper to lock a mutex with a readable error
pub fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    m.lock().map_err(|_| "Lock poisoned".to_string())
}
