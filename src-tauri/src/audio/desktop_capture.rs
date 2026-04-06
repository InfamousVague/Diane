use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub struct DesktopCapture {
    child: Option<Child>,
    samples: Arc<Mutex<Vec<f32>>>,
    cursor: Mutex<usize>,
    ready: Arc<AtomicBool>,
    capturing: Arc<AtomicBool>,
    permission_denied: Arc<AtomicBool>,
    scripts_dir: String,
}

impl DesktopCapture {
    pub fn new(scripts_dir: &str) -> Self {
        Self {
            child: None,
            samples: Arc::new(Mutex::new(Vec::new())),
            cursor: Mutex::new(0),
            ready: Arc::new(AtomicBool::new(false)),
            capturing: Arc::new(AtomicBool::new(false)),
            permission_denied: Arc::new(AtomicBool::new(false)),
            scripts_dir: scripts_dir.to_string(),
        }
    }

    #[allow(dead_code)]
    pub fn is_capturing(&self) -> bool {
        self.capturing.load(Ordering::Relaxed)
    }

    #[allow(dead_code)]
    pub fn permission_denied(&self) -> bool {
        self.permission_denied.load(Ordering::Relaxed)
    }

    pub fn start(&mut self) -> Result<(), String> {
        self.stop();

        // Compile Swift script on first run
        let binary_path = dirs::home_dir()
            .unwrap_or_default()
            .join(".diane/bin/capture-desktop-audio");

        let script_path = std::path::Path::new(&self.scripts_dir)
            .join("scripts/capture-desktop-audio.swift");

        if !script_path.exists() {
            log::warn!("Desktop capture script not found: {}", script_path.display());
            return Ok(()); // Graceful degradation
        }

        // Compile if binary doesn't exist or is older than script
        let needs_compile = if binary_path.exists() {
            let script_mod = std::fs::metadata(&script_path)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let bin_mod = std::fs::metadata(&binary_path)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            script_mod > bin_mod
        } else {
            true
        };

        if needs_compile {
            std::fs::create_dir_all(binary_path.parent().unwrap()).ok();
            log::info!("Compiling desktop audio capture script...");
            let compile = Command::new("swiftc")
                .arg("-O")
                .arg("-framework").arg("ScreenCaptureKit")
                .arg("-framework").arg("CoreMedia")
                .arg("-framework").arg("AVFoundation")
                .arg(script_path.to_str().unwrap())
                .arg("-o")
                .arg(binary_path.to_str().unwrap())
                .output()
                .map_err(|e| format!("Failed to compile: {}", e))?;

            if !compile.status.success() {
                let stderr = String::from_utf8_lossy(&compile.stderr);
                log::error!("Swift compilation failed: {}", stderr);
                return Err(format!("Compilation failed: {}", stderr));
            }
            log::info!("Desktop capture compiled successfully");
        }

        // Spawn the binary
        let mut child = Command::new(binary_path.to_str().unwrap())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn desktop capture: {}", e))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Read stderr for status messages
        let ready = self.ready.clone();
        let capturing = self.capturing.clone();
        let perm_denied = self.permission_denied.clone();
        if let Some(stderr) = stderr {
            thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        log::info!("Desktop capture: {}", line);
                        if line.contains("STATUS:ready") {
                            ready.store(true, Ordering::Relaxed);
                        } else if line.contains("STATUS:capturing") {
                            capturing.store(true, Ordering::Relaxed);
                        } else if line.contains("STATUS:permission_denied") {
                            perm_denied.store(true, Ordering::Relaxed);
                            log::warn!("Desktop audio capture: Screen Recording permission denied");
                        }
                    }
                }
            });
        }

        // Read raw PCM float32 from stdout in background
        let samples = self.samples.clone();
        if let Some(mut stdout) = stdout {
            thread::spawn(move || {
                let mut buf = [0u8; 16384]; // 4096 float32 samples
                loop {
                    match stdout.read(&mut buf) {
                        Ok(0) => break, // EOF
                        Ok(n) => {
                            // Convert bytes to f32 samples
                            let float_count = n / 4;
                            let mut new_samples = Vec::with_capacity(float_count);
                            for i in 0..float_count {
                                let offset = i * 4;
                                if offset + 4 <= n {
                                    let bytes = [buf[offset], buf[offset+1], buf[offset+2], buf[offset+3]];
                                    let sample = f32::from_le_bytes(bytes);
                                    new_samples.push(sample);
                                }
                            }

                            // Downsample 48kHz → 16kHz (take every 3rd sample)
                            let downsampled: Vec<f32> = new_samples
                                .iter()
                                .step_by(3)
                                .copied()
                                .collect();

                            samples.lock().unwrap().extend_from_slice(&downsampled);
                        }
                        Err(e) => {
                            log::warn!("Desktop capture stdout read error: {}", e);
                            break;
                        }
                    }
                }
            });
        }

        self.child = Some(child);
        self.samples.lock().unwrap().clear();
        *self.cursor.lock().unwrap() = 0;

        log::info!("Desktop audio capture started");
        Ok(())
    }

    /// Get new samples since last call (same cursor pattern as recorder)
    pub fn get_recent_samples(&self) -> Vec<f32> {
        let samples = self.samples.lock().unwrap();
        let mut cursor = self.cursor.lock().unwrap();
        if *cursor >= samples.len() {
            return Vec::new();
        }
        let new_samples = samples[*cursor..].to_vec();
        *cursor = samples.len();
        new_samples
    }

    pub fn stop(&mut self) {
        if let Some(ref mut child) = self.child {
            // Send STOP command
            if let Some(ref mut stdin) = child.stdin {
                let _ = stdin.write_all(b"STOP\n");
            }
            // Give it a moment then kill
            thread::sleep(std::time::Duration::from_millis(200));
            let _ = child.kill();
            let _ = child.wait();
        }
        self.child = None;
        self.ready.store(false, Ordering::Relaxed);
        self.capturing.store(false, Ordering::Relaxed);
        self.samples.lock().unwrap().clear();
        *self.cursor.lock().unwrap() = 0;
        log::info!("Desktop audio capture stopped");
    }
}

impl Drop for DesktopCapture {
    fn drop(&mut self) {
        self.stop();
    }
}
