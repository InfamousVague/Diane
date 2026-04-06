use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub struct AudioEvent {
    pub timestamp_ms: u64,
    pub label: String,
    pub confidence: f32,
}

pub struct AudioEventDetector {
    child: Option<Child>,
    stdin_writer: Option<std::process::ChildStdin>,
    events: Arc<Mutex<Vec<AudioEvent>>>,
    ready: Arc<AtomicBool>,
    scripts_dir: String,
}

impl AudioEventDetector {
    pub fn new(scripts_dir: &str) -> Self {
        Self {
            child: None,
            stdin_writer: None,
            events: Arc::new(Mutex::new(Vec::new())),
            ready: Arc::new(AtomicBool::new(false)),
            scripts_dir: scripts_dir.to_string(),
        }
    }

    pub fn start(&mut self) -> Result<(), String> {
        let tts_env_python = dirs::home_dir()
            .unwrap_or_default()
            .join(".diane/tts-env/bin/python3");

        let script_path = std::path::Path::new(&self.scripts_dir)
            .join("scripts/audio-events.py");

        if !script_path.exists() {
            log::warn!("Audio events script not found: {}", script_path.display());
            return Ok(()); // Graceful degradation — events just won't appear
        }

        let mut child = Command::new(tts_env_python.to_str().unwrap_or("python3"))
            .arg(script_path.to_str().unwrap())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn audio-events: {}", e))?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Log stderr from Python in background
        if let Some(stderr) = stderr {
            thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        log::warn!("Audio events stderr: {}", line);
                    }
                }
            });
        }

        // Read events from stdout in background
        let events = self.events.clone();
        let ready = self.ready.clone();

        if let Some(stdout) = stdout {
            thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        if line.starts_with("STATUS:ready") {
                            ready.store(true, Ordering::Relaxed);
                            log::info!("Audio event detector ready");
                        } else if line.starts_with("STATUS:loading") {
                            log::info!("Audio event detector loading model...");
                        } else if line.starts_with("EVENT:") {
                            // Parse EVENT:<ms>:<label>:<confidence>
                            let parts: Vec<&str> = line[6..].splitn(3, ':').collect();
                            if parts.len() == 3 {
                                let ts = parts[0].parse::<u64>().unwrap_or(0);
                                let label = parts[1].to_string();
                                let conf = parts[2].parse::<f32>().unwrap_or(0.0);

                                log::info!("Audio event: [{}] ({:.1}%)", label, conf * 100.0);

                                events.lock().unwrap().push(AudioEvent {
                                    timestamp_ms: ts,
                                    label,
                                    confidence: conf,
                                });
                            }
                        }
                    }
                }
            });
        }

        self.stdin_writer = stdin;
        self.child = Some(child);

        log::info!("Audio event detector started");
        Ok(())
    }

    /// Feed audio samples to the detector (converts f32 to i16 PCM)
    pub fn feed_samples(&mut self, samples: &[f32]) {
        if !self.ready.load(Ordering::Relaxed) {
            return; // Model not loaded yet, skip
        }

        if let Some(ref mut writer) = self.stdin_writer {
            let mut bytes = Vec::with_capacity(samples.len() * 2);
            for &s in samples {
                let i16_sample = (s * 32767.0).clamp(-32768.0, 32767.0) as i16;
                bytes.extend_from_slice(&i16_sample.to_le_bytes());
            }
            if writer.write_all(&bytes).is_err() {
                log::warn!("Failed to write to audio-events stdin");
                self.stdin_writer = None;
            }
        }
    }

    /// Take all accumulated events (drains the buffer)
    pub fn take_events(&self) -> Vec<AudioEvent> {
        let mut events = self.events.lock().unwrap();
        std::mem::take(&mut *events)
    }

    pub fn stop(&mut self) {
        self.stdin_writer = None;
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.ready.store(false, Ordering::Relaxed);
        log::info!("Audio event detector stopped");
    }
}

impl Drop for AudioEventDetector {
    fn drop(&mut self) {
        self.stop();
    }
}
