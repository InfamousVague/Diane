import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Recording } from "../App";

interface UsePlaybackParams {
  recordings: Recording[];
  selectedTape: number | null;
  recordingRef: React.RefObject<boolean>;
  dictatingRef: React.RefObject<boolean>;
  typingInFlightRef: React.MutableRefObject<boolean>;
  lastTypedWordsRef: React.MutableRefObject<number>;
}

export function usePlayback({
  recordings,
  selectedTape,
  recordingRef,
  dictatingRef,
  typingInFlightRef,
  lastTypedWordsRef,
}: UsePlaybackParams) {
  const [playing, setPlaying] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [playbackLevel, setPlaybackLevel] = useState(0);
  const [highlightProgress, setHighlightProgress] = useState(0);
  const playbackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadedTapeIdRef = useRef<string | null>(null);
  const seekingRef = useRef(false);
  const tapePositionRef = useRef(0);

  const stopPlaybackIfActive = useCallback(() => {
    if (playing || rewinding || forwarding) {
      invoke("stop_playback").catch(() => {});
      setPlaying(false);
      setRewinding(false);
      setForwarding(false);
      setPlaybackLevel(0);
      setHighlightProgress(0);
    }
    loadedTapeIdRef.current = null;
  }, [playing, rewinding, forwarding]);

  const handlePlay = useCallback(async () => {
    if (playing) {
      await invoke("stop_playback");
      setPlaying(false);
      setPlaybackLevel(0);
      return;
    }
    if (selectedTape === null || !recordings[selectedTape]) return;
    if (recordingRef.current) return;
    const tape = recordings[selectedTape];
    if (!tape.audio_path) return;
    try {
      if (loadedTapeIdRef.current !== tape.id) {
        await invoke("load_tape", { audioPath: tape.audio_path });
        loadedTapeIdRef.current = tape.id;
      }
      // Reset dictation word counter to match current playback position
      const pos = await invoke<number>("get_playback_position");
      if (selectedTape !== null && recordings[selectedTape]) {
        const words = recordings[selectedTape].transcript
          .split(/\s+/)
          .filter(Boolean);
        lastTypedWordsRef.current = Math.floor(pos * words.length);
      }
      await invoke("start_playback");
      setPlaying(true);
    } catch (e) {
      console.error("Playback failed:", e);
    }
  }, [playing, selectedTape, recordings, recordingRef, lastTypedWordsRef]);

  const handleRewindStart = useCallback(async () => {
    if (selectedTape === null || !recordings[selectedTape]) return;
    if (recordingRef.current) return;
    const tape = recordings[selectedTape];
    if (!tape.audio_path) return;
    try {
      if (playing) {
        await invoke("stop_playback");
        setPlaying(false);
      }
      if (loadedTapeIdRef.current !== tape.id) {
        await invoke("load_tape", { audioPath: tape.audio_path });
        loadedTapeIdRef.current = tape.id;
      }
      await invoke("start_rewind");
      setRewinding(true);
    } catch (e) {
      console.error("Rewind failed:", e);
    }
  }, [playing, selectedTape, recordings, recordingRef]);

  const handleRewindStop = useCallback(async () => {
    if (!rewinding) return;
    try {
      await invoke("stop_playback");
      setRewinding(false);
      const pos = await invoke<number>("get_playback_position");
      if (pos > 0.001) {
        await invoke("start_playback");
        setPlaying(true);
      }
    } catch (e) {
      console.error("Stop rewind failed:", e);
    }
  }, [rewinding]);

  const handleForwardStart = useCallback(async () => {
    if (selectedTape === null || !recordings[selectedTape]) return;
    if (recordingRef.current) return;
    const tape = recordings[selectedTape];
    if (!tape.audio_path) return;
    try {
      if (playing) {
        await invoke("stop_playback");
        setPlaying(false);
      }
      if (loadedTapeIdRef.current !== tape.id) {
        await invoke("load_tape", { audioPath: tape.audio_path });
        loadedTapeIdRef.current = tape.id;
      }
      await invoke("start_fast_forward");
      setForwarding(true);
    } catch (e) {
      console.error("Fast-forward failed:", e);
    }
  }, [playing, selectedTape, recordings, recordingRef]);

  const handleForwardStop = useCallback(async () => {
    if (!forwarding) return;
    try {
      await invoke("stop_playback");
      setForwarding(false);
      const pos = await invoke<number>("get_playback_position");
      if (pos < 0.999) {
        await invoke("start_playback");
        setPlaying(true);
      }
    } catch (e) {
      console.error("Stop forward failed:", e);
    }
  }, [forwarding]);

  const handleSeek = useCallback(
    async (progress: number) => {
      if (selectedTape === null || !recordings[selectedTape]) return;
      const tape = recordings[selectedTape];
      if (!tape.audio_path) return;
      try {
        if (loadedTapeIdRef.current !== tape.id) {
          await invoke("load_tape", { audioPath: tape.audio_path });
          loadedTapeIdRef.current = tape.id;
        }
        seekingRef.current = true;
        setPlaying(true);
        setRewinding(false);
        setHighlightProgress(progress);
        await invoke("stop_playback");
        await invoke("seek_to", { progress });
        await invoke("start_playback");
        seekingRef.current = false;
      } catch (e) {
        console.error("Seek failed:", e);
      }
    },
    [selectedTape, recordings],
  );

  // Poll playback state
  useEffect(() => {
    if (!playing && !rewinding && !forwarding) {
      if (playbackPollRef.current) clearInterval(playbackPollRef.current);
      return;
    }
    playbackPollRef.current = setInterval(async () => {
      if (seekingRef.current) return;
      try {
        const state = await invoke<string>("get_playback_state");
        if (seekingRef.current) return;
        const level = await invoke<number>("get_playback_level");
        const position = await invoke<number>("get_playback_position");
        setPlaybackLevel(level);
        setHighlightProgress(position);
        tapePositionRef.current = position;

        // Dictation during playback: type words as they're highlighted
        if (
          dictatingRef.current &&
          playing &&
          !typingInFlightRef.current &&
          selectedTape !== null &&
          recordings[selectedTape]
        ) {
          const tape = recordings[selectedTape];
          const words = tape.transcript.split(/\s+/).filter(Boolean);
          const wordsReached = Math.floor(position * words.length);
          if (wordsReached > lastTypedWordsRef.current) {
            const newWords = words.slice(
              lastTypedWordsRef.current,
              wordsReached,
            );
            if (newWords.length > 0) {
              const prefix = lastTypedWordsRef.current > 0 ? " " : "";
              const toType = prefix + newWords.join(" ");
              lastTypedWordsRef.current = wordsReached;
              typingInFlightRef.current = true;
              invoke("type_text", { text: toType })
                .catch(() => {})
                .finally(() => {
                  typingInFlightRef.current = false;
                });
            }
          }
        }

        if (state === "finished") {
          setPlaying(false);
          setRewinding(false);
          setForwarding(false);
          setPlaybackLevel(0);
          setHighlightProgress(1.0);
        } else if (state === "idle" && (rewinding || forwarding)) {
          setRewinding(false);
          setForwarding(false);
          setPlaybackLevel(0);
        } else if (state === "idle" && playing) {
          setPlaying(false);
          setPlaybackLevel(0);
        }
      } catch {
        /* ignore */
      }
    }, 50);
    return () => {
      if (playbackPollRef.current) clearInterval(playbackPollRef.current);
    };
  }, [playing, rewinding, forwarding, selectedTape, recordings, dictatingRef, typingInFlightRef, lastTypedWordsRef]);

  return {
    playing,
    rewinding,
    forwarding,
    playbackLevel,
    highlightProgress,
    setHighlightProgress,
    loadedTapeIdRef,
    stopPlaybackIfActive,
    handlePlay,
    handleRewindStart,
    handleRewindStop,
    handleForwardStart,
    handleForwardStop,
    handleSeek,
  };
}
