import { useEffect, useRef } from "react";
import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";

interface HotkeyCallbacks {
  onToggleRecord: () => void;
  onStop: () => void;
  onSaveTape?: () => void;
  onPrevTape?: () => void;
  onNextTape?: () => void;
  onToggleDictation?: () => void;
  onPlay?: () => void;
}

const SHORTCUTS = [
  { key: "CommandOrControl+Shift+R", cb: "onToggleRecord" as const },
  { key: "CommandOrControl+Shift+S", cb: "onStop" as const },
  { key: "CommandOrControl+Shift+E", cb: "onSaveTape" as const },
  { key: "CommandOrControl+Shift+Left", cb: "onPrevTape" as const },
  { key: "CommandOrControl+Shift+Right", cb: "onNextTape" as const },
  { key: "CommandOrControl+Shift+T", cb: "onToggleDictation" as const },
  { key: "CommandOrControl+Shift+P", cb: "onPlay" as const },
];

export function useGlobalHotkeys(callbacks: HotkeyCallbacks) {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const registered = useRef(false);

  useEffect(() => {
    const setup = async () => {
      if (registered.current) return;
      registered.current = true;
      for (const s of SHORTCUTS) {
        try {
          const already = await isRegistered(s.key);
          if (already) {
            await unregister(s.key);
          }
          await register(s.key, (event) => {
            if (event.state === "Pressed") {
              const fn = cbRef.current[s.cb];
              if (fn) fn();
            }
          });
          console.log(`Registered: ${s.key}`);
        } catch (e) {
          console.warn(`Failed: ${s.key}`, e);
        }
      }
    };

    // Delay to avoid Strict Mode double-mount race
    const timer = setTimeout(setup, 100);
    return () => clearTimeout(timer);
  }, []);
}
