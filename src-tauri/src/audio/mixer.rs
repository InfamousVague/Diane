/// Mix microphone and desktop audio streams into a single stream.
/// Desktop audio is slightly reduced to prevent clipping.
/// Uses tanh soft-clipping for natural-sounding limiting.
pub fn mix_streams(mic: &[f32], desktop: &[f32]) -> Vec<f32> {
    let len = mic.len().max(desktop.len());
    (0..len)
        .map(|i| {
            let m = mic.get(i).copied().unwrap_or(0.0);
            let d = desktop.get(i).copied().unwrap_or(0.0);
            (m + d * 0.8).tanh()
        })
        .collect()
}
