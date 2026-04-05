use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

pub struct LiveTranscriber {
    child: Option<std::process::Child>,
    stdin_writer: Option<std::process::ChildStdin>,
    latest_transcript: Arc<Mutex<String>>,
}

unsafe impl Send for LiveTranscriber {}
unsafe impl Sync for LiveTranscriber {}

impl LiveTranscriber {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin_writer: None,
            latest_transcript: Arc::new(Mutex::new(String::new())),
        }
    }

    pub fn start(&mut self) -> Result<(), String> {
        let script_path = Self::find_script()?;

        let mut child = Command::new("swift")
            .arg(&script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start live transcriber: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

        // Read transcript lines from stdout in a background thread
        let transcript = self.latest_transcript.clone();
        thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if line.starts_with("FINAL:") {
                        let final_text = line.strip_prefix("FINAL:").unwrap_or(&line);
                        *transcript.lock().unwrap() = final_text.to_string();
                    } else if !line.is_empty() {
                        *transcript.lock().unwrap() = line;
                    }
                }
            }
        });

        self.stdin_writer = Some(stdin);
        self.child = Some(child);

        log::info!("Live transcriber started");
        Ok(())
    }

    /// Feed raw 16-bit 16kHz mono PCM samples to the transcriber
    pub fn feed_samples(&mut self, samples: &[f32]) {
        if let Some(ref mut stdin) = self.stdin_writer {
            // Convert f32 to i16 PCM
            let pcm: Vec<u8> = samples.iter().flat_map(|&s| {
                let i = (s * 32767.0) as i16;
                i.to_le_bytes().to_vec()
            }).collect();

            if stdin.write_all(&pcm).is_err() {
                log::warn!("Failed to write to transcriber stdin");
            }
        }
    }

    /// Get the latest transcript text
    pub fn get_transcript(&self) -> String {
        self.latest_transcript.lock().unwrap().clone()
    }

    /// Stop the transcriber
    pub fn stop(&mut self) -> String {
        // Close stdin to signal end of audio
        self.stdin_writer = None;

        // Give it a moment for the final transcript, but don't block forever
        std::thread::sleep(std::time::Duration::from_millis(200));

        // Kill the process instead of waiting
        if let Some(ref mut child) = self.child {
            let _ = child.kill();
        }
        self.child = None;

        let transcript = self.get_transcript();
        *self.latest_transcript.lock().unwrap() = String::new();
        log::info!("Transcriber stopped, transcript: {}", transcript);
        transcript
    }

    fn find_script() -> Result<String, String> {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let path = manifest.join("scripts/live-transcribe.swift");
        if path.exists() {
            return Ok(path.to_string_lossy().to_string());
        }
        Err("live-transcribe.swift not found".to_string())
    }
}
