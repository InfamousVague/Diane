use std::fs;
use std::io::Write;
use std::path::PathBuf;

const MODELS_DIR: &str = ".diane/models";

/// Map model name to HuggingFace download URL
fn model_url(name: &str) -> String {
    format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        name
    )
}

/// Ensure a whisper model is available locally, downloading if needed.
/// Returns the path to the model file.
pub fn ensure_whisper_model(name: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().unwrap_or_default();
    let models_dir = home.join(MODELS_DIR);
    fs::create_dir_all(&models_dir).map_err(|e| format!("Can't create models dir: {}", e))?;

    let model_path = models_dir.join(format!("ggml-{}.bin", name));

    if model_path.exists() {
        log::info!("Whisper model found: {}", model_path.display());
        return Ok(model_path);
    }

    let url = model_url(name);
    log::info!("Downloading whisper model '{}' from {}", name, url);

    let response = ureq::get(&url)
        .call()
        .map_err(|e| format!("Failed to download model: {}", e))?;

    let mut file = fs::File::create(&model_path)
        .map_err(|e| format!("Can't create model file: {}", e))?;

    let mut reader = response.into_reader();
    let mut buf = [0u8; 65536];
    let mut total = 0usize;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("Read error: {}", e))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| format!("Write error: {}", e))?;
        total += n;
        if total % (10 * 1024 * 1024) == 0 {
            log::info!("  Downloaded {}MB...", total / (1024 * 1024));
        }
    }

    log::info!("Whisper model downloaded: {} ({}MB)", model_path.display(), total / (1024 * 1024));
    Ok(model_path)
}
