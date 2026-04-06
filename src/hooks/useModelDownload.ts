import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useModelDownload() {
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    // Request microphone permission on first launch (triggers macOS prompt)
    invoke<string>("request_mic_permission").catch(() => {});

    // Check and download Whisper model if needed
    invoke<boolean>("check_models_ready")
      .then((ready) => {
        if (!ready) {
          setDownloading(true);
          invoke("download_models")
            .then(() => setDownloading(false))
            .catch(() => setDownloading(false));
        }
      })
      .catch(() => {});
  }, []);

  return { downloading };
}
