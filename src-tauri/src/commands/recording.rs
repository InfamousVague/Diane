use crate::audio::recorder::AudioRecorder;
use crate::state::{AppState, StopRecordingResult, lock};

#[tauri::command]
pub fn start_recording(state: tauri::State<'_, AppState>) -> Result<(), String> {
    // Start audio recording
    state.recorder.start()?;

    // Start live transcriber
    let mut transcriber = lock(&state.transcriber)?;
    transcriber.start()?;

    // Start audio event detector
    let mut detector = lock(&state.event_detector)?;
    if let Err(e) = detector.start() {
        log::warn!("Audio event detector failed to start: {}", e);
    }

    // Start desktop audio capture
    let mut desktop = lock(&state.desktop_capture)?;
    if let Err(e) = desktop.start() {
        log::warn!("Desktop audio capture failed to start: {}", e);
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_recording(state: tauri::State<'_, AppState>) -> Result<StopRecordingResult, String> {
    // Stop recording and get segment samples
    let segment = state.recorder.stop();

    // Stop event detector and merge events into transcriber
    {
        let mut detector = lock(&state.event_detector)?;
        let events = detector.take_events();
        let transcriber = lock(&state.transcriber)?;
        for event in events {
            transcriber.push_event(event.timestamp_ms, event.label);
        }
        detector.stop();
    }

    // Stop desktop audio capture
    {
        let mut desktop = lock(&state.desktop_capture)?;
        desktop.stop();
    }

    // Feed final samples to transcriber and stop
    let transcript = {
        let mut transcriber = lock(&state.transcriber)?;
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
pub fn get_audio_level(state: tauri::State<'_, AppState>) -> f32 {
    state.recorder.get_level()
}

#[tauri::command]
pub fn get_live_transcript(state: tauri::State<'_, AppState>) -> String {
    let transcriber = lock(&state.transcriber).unwrap();
    transcriber.get_transcript()
}

#[tauri::command]
pub fn feed_audio_to_transcriber(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mic_samples = state.recorder.get_recent_samples();
    let desktop_samples = {
        let desktop = lock(&state.desktop_capture)?;
        desktop.get_recent_samples()
    };

    // Mix mic + desktop audio
    let samples = if desktop_samples.is_empty() {
        mic_samples
    } else if mic_samples.is_empty() {
        desktop_samples
    } else {
        crate::audio::mixer::mix_streams(&mic_samples, &desktop_samples)
    };

    if !samples.is_empty() {
        // Feed mixed audio to whisper transcriber
        let transcriber = lock(&state.transcriber)?;
        transcriber.feed_samples(&samples);

        // Feed to audio event detector
        let mut detector = lock(&state.event_detector)?;
        detector.feed_samples(&samples);

        // Pull any new events into the transcriber
        let events = detector.take_events();
        for event in events {
            transcriber.push_event(event.timestamp_ms, event.label);
        }
    }
    Ok(())
}
