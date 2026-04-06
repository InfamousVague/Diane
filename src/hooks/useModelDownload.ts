import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useModelDownload() {
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
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
