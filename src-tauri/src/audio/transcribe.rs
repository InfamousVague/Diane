use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use super::models;

pub struct LiveTranscriber {
    ctx: Arc<Mutex<Option<WhisperContext>>>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    segments: Arc<Mutex<Vec<String>>>,
    partial: Arc<Mutex<String>>,
    worker: Option<JoinHandle<()>>,
    stop_signal: Arc<AtomicBool>,
    sample_counter: Arc<AtomicU64>,
    events: Arc<Mutex<Vec<(u64, String)>>>,
}

impl LiveTranscriber {
    pub fn new() -> Self {
        Self {
            ctx: Arc::new(Mutex::new(None)),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
            segments: Arc::new(Mutex::new(Vec::new())),
            partial: Arc::new(Mutex::new(String::new())),
            worker: None,
            stop_signal: Arc::new(AtomicBool::new(false)),
            sample_counter: Arc::new(AtomicU64::new(0)),
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn ensure_model(&self) -> Result<(), String> {
        let mut ctx = self.ctx.lock().map_err(|e| e.to_string())?;
        if ctx.is_some() {
            return Ok(());
        }

        let model_path = models::ensure_whisper_model("base.en")?;
        let params = WhisperContextParameters::default();
        let context = WhisperContext::new_with_params(
            model_path.to_str().unwrap_or(""),
            params,
        )
        .map_err(|e| format!("Failed to load whisper model: {:?}", e))?;

        log::info!("Whisper model loaded successfully");
        *ctx = Some(context);
        Ok(())
    }

    pub fn start(&mut self) -> Result<(), String> {
        self.ensure_model()?;

        self.audio_buffer.lock().unwrap().clear();
        self.segments.lock().unwrap().clear();
        *self.partial.lock().unwrap() = String::new();
        self.stop_signal.store(false, Ordering::Relaxed);
        self.sample_counter.store(0, Ordering::Relaxed);
        self.events.lock().unwrap().clear();

        let ctx = self.ctx.clone();
        let buffer = self.audio_buffer.clone();
        let segments = self.segments.clone();
        let partial = self.partial.clone();
        let stop = self.stop_signal.clone();
        let prev_text = Arc::new(Mutex::new(String::new()));

        self.worker = Some(thread::spawn(move || {
            log::info!("Whisper worker started");
            let mut accumulated = Vec::<f32>::new();

            loop {
                thread::sleep(std::time::Duration::from_millis(500));

                if stop.load(Ordering::Relaxed) {
                    break;
                }

                // Drain the buffer
                let new_samples = {
                    let mut buf = buffer.lock().unwrap();
                    if buf.is_empty() {
                        continue;
                    }
                    std::mem::take(&mut *buf)
                };

                accumulated.extend_from_slice(&new_samples);

                // Need at least 0.5s of audio (8000 samples at 16kHz)
                if accumulated.len() < 8000 {
                    continue;
                }

                // Run inference
                let ctx_guard = ctx.lock().unwrap();
                if let Some(ref context) = *ctx_guard {
                    let mut state = match context.create_state() {
                        Ok(s) => s,
                        Err(e) => {
                            log::error!("Failed to create whisper state: {:?}", e);
                            continue;
                        }
                    };

                    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
                    params.set_language(Some("en"));
                    params.set_n_threads(4);
                    params.set_single_segment(false);
                    params.set_no_context(true);
                    params.set_suppress_blank(true);
                    params.set_suppress_nst(true);

                    if let Err(e) = state.full(params, &accumulated) {
                        log::error!("Whisper inference failed: {:?}", e);
                        continue;
                    }

                    let mut new_text = String::new();
                    for seg in state.as_iter() {
                        if let Ok(text) = seg.to_str() {
                            new_text.push_str(text.trim());
                            new_text.push(' ');
                        }
                    }

                    let new_text = new_text.trim().to_string();
                    if !new_text.is_empty() {
                        let prev = prev_text.lock().unwrap().clone();
                        let deduped = deduplicate_text(&prev, &new_text);

                        if !deduped.is_empty() {
                            let mut segs = segments.lock().unwrap();
                            if segs.is_empty() {
                                segs.push(deduped.clone());
                            } else {
                                *segs.last_mut().unwrap() = new_text.clone();
                            }
                        }

                        *prev_text.lock().unwrap() = new_text.clone();
                        *partial.lock().unwrap() = String::new();
                    }
                }
                drop(ctx_guard);
            }

            log::info!("Whisper worker stopped");
        }));

        Ok(())
    }

    pub fn stop(&mut self) -> String {
        self.stop_signal.store(true, Ordering::Relaxed);

        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }

        // Final inference on remaining audio
        let remaining = std::mem::take(&mut *self.audio_buffer.lock().unwrap());
        if remaining.len() > 1600 {
            let ctx_guard = self.ctx.lock().unwrap();
            if let Some(ref context) = *ctx_guard {
                if let Ok(mut state) = context.create_state() {
                    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
                    params.set_language(Some("en"));
                    params.set_n_threads(4);
                    params.set_no_context(true);
                    params.set_suppress_blank(true);

                    if state.full(params, &remaining).is_ok() {
                        let mut final_text = String::new();
                        for seg in state.as_iter() {
                            if let Ok(text) = seg.to_str() {
                                final_text.push_str(text.trim());
                                final_text.push(' ');
                            }
                        }
                        let final_text = final_text.trim().to_string();
                        if !final_text.is_empty() {
                            self.segments.lock().unwrap().push(final_text);
                        }
                    }
                }
            }
        }

        self.get_transcript()
    }

    pub fn feed_samples(&self, samples: &[f32]) {
        self.audio_buffer.lock().unwrap().extend_from_slice(samples);
        self.sample_counter.fetch_add(samples.len() as u64, Ordering::Relaxed);
    }

    pub fn get_transcript(&self) -> String {
        let segs = self.segments.lock().unwrap();
        let partial = self.partial.lock().unwrap();

        let mut result = segs.join(" ");
        if !partial.is_empty() {
            if !result.is_empty() {
                result.push(' ');
            }
            result.push_str(&partial);
        }

        // Append any audio events
        let events = self.events.lock().unwrap();
        for (_ts, label) in events.iter() {
            if !result.is_empty() {
                result.push(' ');
            }
            result.push_str(&format!("[{}]", label));
        }

        result.trim().to_string()
    }

    pub fn push_event(&self, _timestamp_ms: u64, label: String) {
        self.events.lock().unwrap().push((0, label));
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.sample_counter.load(Ordering::Relaxed) * 1000 / 16000
    }
}

/// Deduplicate overlapping text between consecutive inference results
fn deduplicate_text(prev: &str, new: &str) -> String {
    if prev.is_empty() {
        return new.to_string();
    }

    let prev_words: Vec<&str> = prev.split_whitespace().collect();
    let new_words: Vec<&str> = new.split_whitespace().collect();

    for overlap_len in (1..=prev_words.len().min(new_words.len())).rev() {
        let prev_tail = &prev_words[prev_words.len() - overlap_len..];
        let new_head = &new_words[..overlap_len];
        if prev_tail == new_head {
            return new_words[overlap_len..].join(" ");
        }
    }

    new.to_string()
}
