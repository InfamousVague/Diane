import { useState, useCallback, useRef } from "react";

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

  const toggleDesktopAudio = useCallback(() => {
    setDesktopAudio((prev) => !prev);
  }, []);

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
