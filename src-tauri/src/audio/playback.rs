use rodio::{OutputStream, OutputStreamHandle, Sink, Source};
use std::fs::File;
use std::io::BufReader;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq)]
pub enum PlaybackState {
    Idle,
    Playing,
    Rewinding,
    FastForward,
    Finished,
}

impl PlaybackState {
    pub fn as_str(&self) -> &str {
        match self {
            PlaybackState::Idle => "idle",
            PlaybackState::Playing => "playing",
            PlaybackState::Rewinding => "rewinding",
            PlaybackState::FastForward => "fastforward",
            PlaybackState::Finished => "finished",
        }
    }
}

// Wrappers for !Send types
struct StreamHolder(Option<OutputStream>);
unsafe impl Send for StreamHolder {}
unsafe impl Sync for StreamHolder {}

struct HandleHolder(Option<OutputStreamHandle>);
unsafe impl Send for HandleHolder {}
unsafe impl Sync for HandleHolder {}

struct SinkHolder(Option<Sink>);
unsafe impl Send for SinkHolder {}
unsafe impl Sync for SinkHolder {}

/// Spawns a thread that ramps a speed value from 0.5 to 8.0 over 1200ms
/// using a quadratic ease-in curve. Used by both rewind and fast-forward.
fn spawn_speed_ramp(speed: Arc<Mutex<f32>>, active: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let start = std::time::Instant::now();
        let ramp_ms = 1200.0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(16));
            if !active.load(Ordering::Relaxed) {
                break;
            }
            let elapsed = start.elapsed().as_millis() as f32;
            let t = (elapsed / ramp_ms).min(1.0);
            let s = 0.5 + 7.5 * t * t;
            if let Ok(mut spd) = speed.lock() {
                *spd = s;
            }
            if t >= 1.0 {
                break;
            }
        }
    });
}

/// Spawns a thread that polls the playback position and stops the sink
/// when a boundary condition is met (`check` returns true).
fn spawn_position_monitor(
    check: impl Fn(usize) -> bool + Send + 'static,
    end_state: PlaybackState,
    position: Arc<AtomicUsize>,
    active: Arc<AtomicBool>,
    state: Arc<Mutex<PlaybackState>>,
    level: Arc<Mutex<f32>>,
    sink: Arc<Mutex<SinkHolder>>,
    stream: Arc<Mutex<StreamHolder>>,
    handle: Arc<Mutex<HandleHolder>>,
) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(50));
            if !active.load(Ordering::Relaxed) {
                break;
            }
            if check(position.load(Ordering::Relaxed)) {
                active.store(false, Ordering::Relaxed);
                if let Ok(mut s) = sink.lock() {
                    if let Some(sink) = s.0.take() {
                        sink.stop();
                    }
                }
                if let Ok(mut s) = stream.lock() {
                    s.0 = None;
                }
                if let Ok(mut h) = handle.lock() {
                    h.0 = None;
                }
                if let Ok(mut st) = state.lock() {
                    *st = end_state;
                }
                if let Ok(mut lv) = level.lock() {
                    *lv = 0.0;
                }
                break;
            }
        }
    });
}

pub struct AudioPlayer {
    state: Arc<Mutex<PlaybackState>>,
    level: Arc<Mutex<f32>>,
    /// Decoded samples shared with the audio source (lock-free read via Arc)
    samples: Arc<Vec<f32>>,
    sample_rate: u32,
    channels: u16,
    /// Current sample position (atomic for lock-free audio thread access)
    position: Arc<AtomicUsize>,
    /// Whether audio source should be actively producing samples
    active: Arc<AtomicBool>,
    /// Speed multiplier for rewind/fast-forward (0.0 = stopped, 8.0 = max)
    speed: Arc<Mutex<f32>>,
    _stream: Arc<Mutex<StreamHolder>>,
    stream_handle: Arc<Mutex<HandleHolder>>,
    sink: Arc<Mutex<SinkHolder>>,
}

impl AudioPlayer {
    /// Create a new audio player with no tape loaded.
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(PlaybackState::Idle)),
            level: Arc::new(Mutex::new(0.0)),
            samples: Arc::new(Vec::new()),
            sample_rate: 16000,
            channels: 1,
            position: Arc::new(AtomicUsize::new(0)),
            active: Arc::new(AtomicBool::new(false)),
            speed: Arc::new(Mutex::new(0.0)),
            _stream: Arc::new(Mutex::new(StreamHolder(None))),
            stream_handle: Arc::new(Mutex::new(HandleHolder(None))),
            sink: Arc::new(Mutex::new(SinkHolder(None))),
        }
    }

    /// Return the current playback state as a string identifier.
    pub fn get_state(&self) -> String {
        self.state
            .lock()
            .map(|s| s.as_str().to_string())
            .unwrap_or_else(|_| "idle".to_string())
    }

    /// Return the current audio level (0.0 to 1.0).
    pub fn get_level(&self) -> f32 {
        self.level.lock().map(|l| *l).unwrap_or(0.0)
    }

    /// Return the current playback position as a fraction (0.0 to 1.0).
    pub fn get_position(&self) -> f32 {
        let total = self.samples.len();
        if total == 0 {
            return 0.0;
        }
        let pos = self.position.load(Ordering::Relaxed);
        (pos as f32 / total as f32).min(1.0)
    }

    /// Return the current playback position in seconds.
    pub fn get_position_secs(&self) -> f32 {
        if self.sample_rate == 0 || self.channels == 0 {
            return 0.0;
        }
        let pos = self.position.load(Ordering::Relaxed);
        pos as f32 / (self.sample_rate as f32 * self.channels as f32)
    }

    /// Load a WAV file into memory for instant playback/rewind.
    pub fn load_tape(&mut self, path: &str) -> Result<(), String> {
        self.stop();

        let file = File::open(path).map_err(|e| format!("Can't open WAV: {}", e))?;
        let reader = BufReader::new(file);
        let source = rodio::Decoder::new(reader).map_err(|e| format!("Can't decode: {}", e))?;

        let sample_rate = source.sample_rate();
        let channels = source.channels();
        let samples: Vec<f32> = source.convert_samples::<f32>().collect();

        log::info!(
            "Loaded tape: {} samples, {}Hz, {}ch, {:.1}s",
            samples.len(),
            sample_rate,
            channels,
            samples.len() as f32 / (sample_rate as f32 * channels as f32)
        );

        self.samples = Arc::new(samples);
        self.sample_rate = sample_rate;
        self.channels = channels;
        self.position.store(0, Ordering::Relaxed);
        if let Ok(mut st) = self.state.lock() {
            *st = PlaybackState::Idle;
        }

        Ok(())
    }

    /// Build a `BufferSource` with the player's shared state and the given direction.
    fn make_source(&self, direction: Direction) -> BufferSource {
        BufferSource {
            samples: self.samples.clone(),
            position: self.position.clone(),
            active: self.active.clone(),
            level: self.level.clone(),
            direction,
            speed: self.speed.clone(),
            sample_rate: self.sample_rate,
            channels: self.channels,
            cached_speed: 1.0,
            level_accum: 0.0,
            level_count: 0,
        }
    }

    /// Spawn a position monitor thread using this player's shared state.
    fn monitor_position(
        &self,
        check: impl Fn(usize) -> bool + Send + 'static,
        end_state: PlaybackState,
    ) {
        spawn_position_monitor(
            check,
            end_state,
            self.position.clone(),
            self.active.clone(),
            self.state.clone(),
            self.level.clone(),
            self.sink.clone(),
            self._stream.clone(),
            self.stream_handle.clone(),
        );
    }

    /// Play forward from the current position.
    pub fn play(&self) -> Result<(), String> {
        self.stop_audio();

        if self.samples.is_empty() {
            return Err("No tape loaded".to_string());
        }

        if self.position.load(Ordering::Relaxed) >= self.samples.len() {
            if let Ok(mut st) = self.state.lock() {
                *st = PlaybackState::Finished;
            }
            return Ok(());
        }

        let total_samples = self.samples.len();
        let source = self.make_source(Direction::Forward);

        self.active.store(true, Ordering::Relaxed);
        self.start_source(source)?;
        if let Ok(mut st) = self.state.lock() {
            *st = PlaybackState::Playing;
        }

        self.monitor_position(
            move |pos| pos >= total_samples,
            PlaybackState::Finished,
        );

        log::info!(
            "Playing from sample {}",
            self.position.load(Ordering::Relaxed)
        );
        Ok(())
    }

    /// Begin rewinding with speed ramp from 0.5x to 8.0x.
    pub fn start_rewind(&self) -> Result<(), String> {
        self.stop_audio();

        if self.samples.is_empty() {
            return Err("No tape loaded".to_string());
        }

        if self.position.load(Ordering::Relaxed) == 0 {
            return Ok(());
        }

        if let Ok(mut s) = self.speed.lock() {
            *s = 0.5;
        }

        let source = self.make_source(Direction::Reverse);

        self.active.store(true, Ordering::Relaxed);
        self.start_source(source)?;
        if let Ok(mut st) = self.state.lock() {
            *st = PlaybackState::Rewinding;
        }

        spawn_speed_ramp(self.speed.clone(), self.active.clone());

        self.monitor_position(|pos| pos == 0, PlaybackState::Idle);

        log::info!(
            "Rewinding from sample {}",
            self.position.load(Ordering::Relaxed)
        );
        Ok(())
    }

    /// Begin fast-forwarding with speed ramp from 0.5x to 8.0x.
    pub fn start_fast_forward(&self) -> Result<(), String> {
        self.stop_audio();

        if self.samples.is_empty() {
            return Err("No tape loaded".to_string());
        }

        if self.position.load(Ordering::Relaxed) >= self.samples.len() {
            return Ok(());
        }

        if let Ok(mut s) = self.speed.lock() {
            *s = 0.5;
        }

        let source = self.make_source(Direction::FastForward);
        let total = self.samples.len();

        self.active.store(true, Ordering::Relaxed);
        self.start_source(source)?;
        if let Ok(mut st) = self.state.lock() {
            *st = PlaybackState::FastForward;
        }

        spawn_speed_ramp(self.speed.clone(), self.active.clone());

        self.monitor_position(move |pos| pos >= total, PlaybackState::Finished);

        log::info!(
            "Fast-forwarding from sample {}",
            self.position.load(Ordering::Relaxed)
        );
        Ok(())
    }

    /// Stop rewinding with momentum deceleration.
    pub fn stop_rewind(&self) {
        let current_speed = self.speed.lock().map(|s| *s).unwrap_or(0.0);
        if current_speed <= 0.0 {
            self.stop_audio();
            if let Ok(mut st) = self.state.lock() {
                *st = PlaybackState::Idle;
            }
            return;
        }

        let speed = self.speed.clone();
        let active = self.active.clone();
        let state = self.state.clone();
        let level = self.level.clone();
        std::thread::spawn(move || {
            let start = std::time::Instant::now();
            let decel_ms = 300.0;
            let start_speed = current_speed;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(16));
                let elapsed = start.elapsed().as_millis() as f32;
                let t = (elapsed / decel_ms).min(1.0);
                let s = start_speed * (1.0 - t * t);
                if let Ok(mut spd) = speed.lock() {
                    *spd = s;
                }
                if t >= 1.0 || s < 0.05 {
                    if let Ok(mut spd) = speed.lock() {
                        *spd = 0.0;
                    }
                    active.store(false, Ordering::Relaxed);
                    if let Ok(mut st) = state.lock() {
                        *st = PlaybackState::Idle;
                    }
                    if let Ok(mut lv) = level.lock() {
                        *lv = 0.0;
                    }
                    break;
                }
            }
        });
    }

    /// Seek to a position expressed as a fraction (0.0 to 1.0).
    pub fn seek_to(&self, progress: f32) {
        let pos = (progress.clamp(0.0, 1.0) * self.samples.len() as f32) as usize;
        self.position.store(pos, Ordering::Relaxed);
        log::info!("Seeked to {:.1}% (sample {})", progress * 100.0, pos);
    }

    /// Seek to the end of the tape.
    pub fn seek_to_end(&self) {
        self.position.store(self.samples.len(), Ordering::Relaxed);
    }

    /// Stop all audio output and reset to idle.
    pub fn stop(&self) {
        self.stop_audio();
        if let Ok(mut st) = self.state.lock() {
            *st = PlaybackState::Idle;
        }
        if let Ok(mut lv) = self.level.lock() {
            *lv = 0.0;
        }
    }

    fn stop_audio(&self) {
        self.active.store(false, Ordering::Relaxed);
        if let Ok(mut s) = self.sink.lock() {
            if let Some(sink) = s.0.take() {
                sink.stop();
            }
        }
        if let Ok(mut s) = self._stream.lock() {
            s.0 = None;
        }
        if let Ok(mut h) = self.stream_handle.lock() {
            h.0 = None;
        }
    }

    fn start_source(&self, source: BufferSource) -> Result<(), String> {
        let (stream, handle) =
            OutputStream::try_default().map_err(|e| format!("No audio output: {}", e))?;
        let sink = Sink::try_new(&handle).map_err(|e| format!("Can't create sink: {}", e))?;
        sink.append(source);

        if let Ok(mut s) = self._stream.lock() {
            s.0 = Some(stream);
        }
        if let Ok(mut h) = self.stream_handle.lock() {
            h.0 = Some(handle);
        }
        if let Ok(mut s) = self.sink.lock() {
            s.0 = Some(sink);
        }

        Ok(())
    }
}

/// Truncate a WAV file at the given time in seconds.
pub fn truncate_audio(path: &str, at_secs: f32) -> Result<String, String> {
    let file = File::open(path).map_err(|e| format!("Can't open: {}", e))?;
    let reader = BufReader::new(file);
    let source = rodio::Decoder::new(reader).map_err(|e| format!("Can't decode: {}", e))?;

    let sample_rate = source.sample_rate();
    let channels = source.channels();
    let all_samples: Vec<f32> = source.convert_samples::<f32>().collect();

    let cut_sample = (at_secs * sample_rate as f32 * channels as f32) as usize;
    let truncated = if cut_sample < all_samples.len() {
        &all_samples[..cut_sample]
    } else {
        &all_samples
    };

    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(path, spec).map_err(|e| format!("Can't write WAV: {}", e))?;
    for &s in truncated {
        let sample_i16 = (s * 32767.0).clamp(-32768.0, 32767.0) as i16;
        writer.write_sample(sample_i16).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;

    log::info!(
        "Truncated {} at {:.1}s ({} samples)",
        path,
        at_secs,
        truncated.len()
    );
    Ok(path.to_string())
}

// ── Audio Source ─────────────────────────────────────────

#[derive(Clone, Copy, PartialEq)]
enum Direction {
    Forward,
    Reverse,
    FastForward,
}

struct BufferSource {
    /// Direct read-only access to samples — no mutex, no locking
    samples: Arc<Vec<f32>>,
    position: Arc<AtomicUsize>,
    active: Arc<AtomicBool>,
    level: Arc<Mutex<f32>>,
    direction: Direction,
    speed: Arc<Mutex<f32>>,
    cached_speed: f32,
    sample_rate: u32,
    channels: u16,
    level_accum: f32,
    level_count: u32,
}

impl BufferSource {
    /// Accumulate a sample into the level meter, flushing to the shared
    /// level value every `window` samples.
    fn meter_level(&mut self, sample: f32, window: u32) {
        self.level_accum += sample * sample;
        self.level_count += 1;
        if self.level_count >= window {
            let rms = (self.level_accum / self.level_count as f32).sqrt();
            if let Ok(mut lv) = self.level.lock() {
                *lv = (rms * 10.0).min(1.0);
            }
            self.level_accum = 0.0;
            self.level_count = 0;
        }
    }

    /// Read the shared speed value, but only every 256 samples to reduce
    /// lock contention on the audio thread.
    fn refresh_cached_speed(&mut self) {
        if self.level_count % 256 == 0 {
            if let Ok(s) = self.speed.lock() {
                self.cached_speed = *s;
            }
        }
    }
}

impl Iterator for BufferSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if !self.active.load(Ordering::Relaxed) {
            return Some(0.0);
        }

        let pos = self.position.load(Ordering::Relaxed);

        match self.direction {
            Direction::Forward => {
                if pos >= self.samples.len() {
                    self.active.store(false, Ordering::Relaxed);
                    return Some(0.0);
                }
                let sample = self.samples[pos];
                self.position.store(pos + 1, Ordering::Relaxed);
                self.meter_level(sample, 1024);
                Some(sample)
            }
            Direction::Reverse => {
                self.refresh_cached_speed();
                let speed = self.cached_speed;

                if pos == 0 {
                    self.active.store(false, Ordering::Relaxed);
                    return Some(0.0);
                }

                let skip = (speed as usize).max(1);
                let new_pos = pos.saturating_sub(skip);
                self.position.store(new_pos, Ordering::Relaxed);

                let sample = self.samples[new_pos];
                self.meter_level(sample, 512);
                Some(sample * 0.6)
            }
            Direction::FastForward => {
                self.refresh_cached_speed();
                let speed = self.cached_speed;

                if pos >= self.samples.len() {
                    self.active.store(false, Ordering::Relaxed);
                    return Some(0.0);
                }

                let skip = (speed as usize).max(1);
                let new_pos = (pos + skip).min(self.samples.len() - 1);
                self.position.store(new_pos, Ordering::Relaxed);

                let sample = self.samples[new_pos];
                self.meter_level(sample, 512);
                Some(sample * 0.6)
            }
        }
    }
}

impl Source for BufferSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<std::time::Duration> {
        None
    }
}
