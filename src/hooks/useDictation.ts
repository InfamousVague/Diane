import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useDictation() {
  const [dictating, setDictating] = useState(false);
  const [desktopAudio, setDesktopAudio] = useState(false);
  const dictatingRef = useRef(false);
  const lastTypedWordsRef = useRef(0);
  const typingInFlightRef = useRef(false);

  // These refs get wired to recorder's refs after both hooks are created.
  // toggleDictation reads them via ref so it always sees the current value.
  const tapeRefHandle = useRef<React.RefObject<string[]>>({ current: [] });
  const currentSegmentRefHandle = useRef<React.RefObject<string>>({ current: "" });

  const toggleDictation = useCallback(() => {
    const next = !dictatingRef.current;
    dictatingRef.current = next;
    setDictating(next);
    if (next) {
      const tapeRef = tapeRefHandle.current;
      const currentSegmentRef = currentSegmentRefHandle.current;
      const existing = [...tapeRef.current];
      if (currentSegmentRef.current) existing.push(currentSegmentRef.current);
      const allText = existing.join(" ");
      lastTypedWordsRef.current = allText.split(/\s+/).filter(Boolean).length;
    }
  }, []);

  const toggleDesktopAudio = useCallback(async () => {
    const next = !desktopAudio;
    if (next) {
      try {
        const result = await invoke<string>("enable_desktop_capture");
        if (result === "permission_denied") {
          // Wait a moment for the permission status to settle, then check again
          setTimeout(async () => {
            const retry = await invoke<string>("enable_desktop_capture");
            if (retry === "permission_denied") {
              alert(
                "Screen Recording permission is required for desktop audio capture.\n\n" +
                "Go to System Settings → Privacy & Security → Screen Recording and enable Diane."
              );
              setDesktopAudio(false);
            } else {
              setDesktopAudio(true);
            }
          }, 2000);
          return;
        }
        setDesktopAudio(true);
      } catch (e) {
        console.error("Failed to enable desktop capture:", e);
        alert(
          "Desktop audio capture failed to start.\n\n" +
          "Make sure Screen Recording permission is granted in System Settings → Privacy & Security."
        );
      }
    } else {
      invoke("disable_desktop_capture").catch(() => {});
      setDesktopAudio(false);
    }
  }, [desktopAudio]);

  return {
    dictating,
    desktopAudio,
    dictatingRef,
    lastTypedWordsRef,
    typingInFlightRef,
    tapeRefHandle,
    currentSegmentRefHandle,
    toggleDictation,
    toggleDesktopAudio,
  };
}
