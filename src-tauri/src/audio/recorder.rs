use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

/// Thread-safe wrapper for cpal::Stream (held to keep stream alive)
#[allow(dead_code)]
struct StreamHolder(cpal::Stream);
unsafe impl Send for StreamHolder {}
unsafe impl Sync for StreamHolder {}

pub struct AudioRecorder {
    samples: Arc<Mutex<Vec<f32>>>,
    /// All samples accumulated across multiple record/stop segments (for full tape WAV)
    all_samples: Mutex<Vec<f32>>,
    stream: Mutex<Option<StreamHolder>>,
    transcribe_cursor: Mutex<usize>, // tracks how far we've fed to transcriber
    sample_rate: u32,
}

// AudioRecorder is safe to share — samples is Arc<Mutex>, stream is Mutex<Option>
unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

impl AudioRecorder {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            samples: Arc::new(Mutex::new(Vec::new())),
            all_samples: Mutex::new(Vec::new()),
            stream: Mutex::new(None),
            transcribe_cursor: Mutex::new(0),
            sample_rate: 16000,
        })
    }

    pub fn start(&self) -> Result<(), String> {
        let host = cpal::default_host();
        let device = host.default_input_device()
            .ok_or("No audio input device found")?;

        log::info!("Recording from: {:?}", device.name());

        // Use the device's default config instead of forcing 16kHz
        let default_config = device.default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        log::info!("Device config: {:?}", default_config);

        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        let device_sample_rate = default_config.sample_rate().0;
        let target_sample_rate = self.sample_rate;
        let downsample_ratio = device_sample_rate / target_sample_rate;

        let samples = self.samples.clone();
        samples.lock().unwrap().clear();
        *self.transcribe_cursor.lock().unwrap() = 0;

        let sample_counter = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let counter = sample_counter.clone();

        let stream = device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if let Ok(mut buf) = samples.lock() {
                    // Downsample: take every Nth sample to get to target rate
                    if downsample_ratio > 1 {
                        let mut count = counter.load(std::sync::atomic::Ordering::Relaxed);
                        for &sample in data {
                            if count % downsample_ratio as u64 == 0 {
                                buf.push(sample);
                            }
                            count += 1;
                        }
                        counter.store(count, std::sync::atomic::Ordering::Relaxed);
                    } else {
                        buf.extend_from_slice(data);
                    }
                }
            },
            move |err| {
                log::error!("Audio stream error: {}", err);
            },
            None,
        ).map_err(|e| format!("Failed to build audio stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to start recording: {}", e))?;
        *self.stream.lock().unwrap() = Some(StreamHolder(stream));

        Ok(())
    }

    pub fn stop(&self) -> Vec<f32> {
        *self.stream.lock().unwrap() = None;
        let segment = self.samples.lock().unwrap().clone();

        // Accumulate into all_samples for full tape WAV
        let mut all = self.all_samples.lock().unwrap();
        all.extend_from_slice(&segment);
        let total_len = all.len();

        log::info!("Segment: {} samples ({:.1}s), Total tape: {} samples ({:.1}s) at {}Hz",
            segment.len(),
            segment.len() as f64 / self.sample_rate as f64,
            total_len,
            total_len as f64 / self.sample_rate as f64,
            self.sample_rate
        );
        segment
    }

    /// Get all accumulated samples across all record/stop segments and reset
    pub fn take_all_samples(&self) -> Vec<f32> {
        let mut all = self.all_samples.lock().unwrap();
        let samples = std::mem::take(&mut *all);
        log::info!("Taking full tape: {} samples ({:.1}s)",
            samples.len(),
            samples.len() as f64 / self.sample_rate as f64,
        );
        samples
    }

    /// Reset the accumulated buffer (when ejecting/saving a tape)
    #[allow(dead_code)]
    pub fn reset_all_samples(&self) {
        self.all_samples.lock().unwrap().clear();
    }

    /// Get new samples since last call (for streaming to transcriber)
    pub fn get_recent_samples(&self) -> Vec<f32> {
        let samples = self.samples.lock().unwrap();
        let mut cursor = self.transcribe_cursor.lock().unwrap();
        if *cursor >= samples.len() {
            return Vec::new();
        }
        let new_samples = samples[*cursor..].to_vec();
        *cursor = samples.len();
        new_samples
    }

    pub fn get_level(&self) -> f32 {
        let samples = self.samples.lock().unwrap();
        if samples.len() < 1600 { return 0.0; }
        let recent = &samples[samples.len() - 1600..];
        let rms = (recent.iter().map(|s| s * s).sum::<f32>() / recent.len() as f32).sqrt();
        (rms * 10.0).min(1.0)
    }

    pub fn save_wav(samples: &[f32], path: &str, sample_rate: u32) -> Result<(), String> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec)
            .map_err(|e| format!("Failed to create WAV: {}", e))?;
        for &sample in samples {
            let amplitude = (sample * 32767.0) as i16;
            writer.write_sample(amplitude)
                .map_err(|e| format!("Failed to write sample: {}", e))?;
        }
        writer.finalize()
            .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
        Ok(())
    }
}
