use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use sysinfo::System;
use tauri::{AppHandle, Emitter};

/// Known meeting app process names
const MEETING_PROCESSES: &[(&str, &str)] = &[
    ("zoom.us", "Zoom"),
    ("Slack", "Slack"),
    ("Slack Helper", "Slack"),
    ("Microsoft Teams", "Microsoft Teams"),
    ("FaceTime", "FaceTime"),
    ("Webex", "Webex"),
    ("Discord", "Discord"),
];

/// Browser processes that might indicate Google Meet
const BROWSER_PROCESSES: &[&str] = &[
    "Google Chrome",
    "Google Chrome Helper",
    "Safari",
    "Arc",
    "Microsoft Edge",
    "Firefox",
    "Brave Browser",
];

#[derive(Clone, Debug, PartialEq)]
pub enum MeetingState {
    Idle,
    Detected(String), // app name
    Dismissed,        // user dismissed the notification for this session
}

pub struct MeetingDetector {
    stop_signal: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    state: Arc<Mutex<MeetingState>>,
    last_detected_app: Arc<Mutex<Option<String>>>,
}

impl MeetingDetector {
    pub fn new() -> Self {
        Self {
            stop_signal: Arc::new(AtomicBool::new(false)),
            worker: None,
            state: Arc::new(Mutex::new(MeetingState::Idle)),
            last_detected_app: Arc::new(Mutex::new(None)),
        }
    }

    pub fn get_state(&self) -> String {
        match &*self.state.lock().unwrap() {
            MeetingState::Idle => "idle".to_string(),
            MeetingState::Detected(app) => format!("detected:{}", app),
            MeetingState::Dismissed => "dismissed".to_string(),
        }
    }

    pub fn dismiss(&self) {
        *self.state.lock().unwrap() = MeetingState::Dismissed;
    }

    pub fn start(&mut self, app_handle: AppHandle) {
        self.stop_signal.store(false, Ordering::Relaxed);

        let stop = self.stop_signal.clone();
        let state = self.state.clone();
        let last_detected = self.last_detected_app.clone();

        self.worker = Some(thread::spawn(move || {
            let mut sys = System::new();
            log::info!("Meeting detector started");

            loop {
                thread::sleep(std::time::Duration::from_secs(5));

                if stop.load(Ordering::Relaxed) {
                    break;
                }

                sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

                let mut found_app: Option<String> = None;

                // Check for native meeting apps
                for (proc_name, display_name) in MEETING_PROCESSES {
                    for (_pid, process) in sys.processes() {
                        if process.name().to_string_lossy().contains(proc_name) {
                            found_app = Some(display_name.to_string());
                            break;
                        }
                    }
                    if found_app.is_some() {
                        break;
                    }
                }

                // Check for browser-based meetings (browser + mic active)
                if found_app.is_none() {
                    let browser_running = sys.processes().values().any(|p| {
                        let name = p.name().to_string_lossy();
                        BROWSER_PROCESSES.iter().any(|b| name.contains(b))
                    });

                    if browser_running && is_mic_in_use() {
                        found_app = Some("Browser Meeting".to_string());
                    }
                }

                let current_state = state.lock().unwrap().clone();
                let last = last_detected.lock().unwrap().clone();

                match (&current_state, &found_app) {
                    (MeetingState::Idle, Some(app)) => {
                        // New meeting detected
                        if last.as_ref() != Some(app) {
                            log::info!("Meeting detected: {}", app);
                            *state.lock().unwrap() = MeetingState::Detected(app.clone());
                            *last_detected.lock().unwrap() = Some(app.clone());

                            // Send notification
                            send_meeting_notification(&app_handle, app);
                        }
                    }
                    (MeetingState::Dismissed, None) | (MeetingState::Detected(_), None) => {
                        // Meeting ended
                        log::info!("Meeting ended");
                        *state.lock().unwrap() = MeetingState::Idle;
                        *last_detected.lock().unwrap() = None;
                    }
                    _ => {}
                }
            }

            log::info!("Meeting detector stopped");
        }));
    }

    #[allow(dead_code)]
    pub fn stop(&mut self) {
        self.stop_signal.store(true, Ordering::Relaxed);
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
    }
}

/// Check if the default microphone is currently in use by any app
fn is_mic_in_use() -> bool {
    // Use CoreAudio to check kAudioDevicePropertyDeviceIsRunningSomewhere
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // Quick check via log — if any audio input stream is active
        if let Ok(output) = Command::new("sh")
            .arg("-c")
            .arg("ioreg -l | grep -c 'IOAudioStream.*Input.*isActive.*Yes' 2>/dev/null")
            .output()
        {
            let count = String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse::<i32>()
                .unwrap_or(0);
            return count > 0;
        }
    }
    false
}

/// Send a macOS notification about the detected meeting
fn send_meeting_notification(app_handle: &AppHandle, app_name: &str) {
    use tauri_plugin_notification::NotificationExt;

    let _ = app_handle
        .notification()
        .builder()
        .title("Meeting Detected")
        .body(format!("{} is active — would you like to record this meeting?", app_name))
        .action_type_id("meeting-record")
        .show();

    // Also emit event so the frontend can react if the window is visible
    let _ = app_handle.emit("meeting-detected", app_name.to_string());
}
