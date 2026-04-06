import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Recording } from "../App";

interface UseRecorderParams {
  recordings: Recording[];
  setTranscript: (text: string) => void;
  setViewingTape: (v: boolean) => void;
  dictatingRef: React.RefObject<boolean>;
  typingInFlightRef: React.MutableRefObject<boolean>;
  lastTypedWordsRef: React.MutableRefObject<number>;
}

export function useRecorder({
  recordings,
  setTranscript,
  setViewingTape,
  dictatingRef,
  typingInFlightRef,
  lastTypedWordsRef,
}: UseRecorderParams) {
  const [recording, setRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const recordingRef = useRef(false);
  const tapeRef = useRef<string[]>([]);
  const currentSegmentRef = useRef("");
  const audioPathsRef = useRef<string[]>([]);
  const startTimeRef = useRef(0);
  const recordingOntoTapeRef = useRef<number | null>(null);
  const levelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    if (recordingRef.current) return;
    try {
      await invoke("start_recording");
      recordingRef.current = true;
      setRecording(true);
      currentSegmentRef.current = "";
      startTimeRef.current = Date.now();
      audioPathsRef.current = [];

      // If a saved tape is selected, load its content into tapeRef so we append to it
      // We read selectedTape indirectly via recordings to avoid stale closure issues —
      // the caller passes the current recordings array.
    } catch (e) {
      console.error("Failed to start recording:", e);
    }
  }, []);

  /** Call after startRecording to set up tape context for recording onto an existing tape */
  const initRecordingContext = useCallback(
    (selectedTape: number | null) => {
      if (selectedTape !== null) {
        const existingTape = recordings[selectedTape];
        if (existingTape) {
          tapeRef.current = [existingTape.transcript];
          setTranscript(existingTape.transcript);
          recordingOntoTapeRef.current = selectedTape;
          lastTypedWordsRef.current = existingTape.transcript
            .split(/\s+/)
            .filter(Boolean).length;
        }
      } else {
        recordingOntoTapeRef.current = null;
        lastTypedWordsRef.current = 0;
      }
      setViewingTape(false);
    },
    [recordings, setTranscript, setViewingTape, lastTypedWordsRef],
  );

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);

    // Finalize current segment BEFORE awaiting backend stop
    const segmentText = currentSegmentRef.current;
    if (segmentText) {
      tapeRef.current.push(segmentText);
      setTranscript(tapeRef.current.join("\n"));
    }
    currentSegmentRef.current = "";

    try {
      const result = await invoke<{ transcript: string; audio_path: string }>(
        "stop_recording",
      );
      if (result.audio_path) {
        audioPathsRef.current.push(result.audio_path);
      }
    } catch (e) {
      console.error("Recording failed:", e);
    }
  }, [setTranscript]);

  const toggleRecord = useCallback(() => {
    if (recordingRef.current) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [startRecording, stopRecording]);

  // Poll audio level + feed transcriber + get live transcript when recording
  useEffect(() => {
    if (recording) {
      // Poll audio level at 20fps
      levelPollRef.current = setInterval(async () => {
        try {
          const level = await invoke<number>("get_audio_level");
          setAudioLevel(level);
        } catch {
          /* ignore */
        }
      }, 50);

      // Feed audio to transcriber + get transcript at 5fps
      transcriptPollRef.current = setInterval(async () => {
        try {
          await invoke("feed_audio_to_transcriber");
          const liveText = await invoke<string>("get_live_transcript");
          if (liveText && liveText.length >= currentSegmentRef.current.length) {
            currentSegmentRef.current = liveText;
            const allSegments = [...tapeRef.current];
            if (currentSegmentRef.current) {
              allSegments.push(currentSegmentRef.current);
            }
            const fullText = allSegments.join("\n");
            setTranscript(fullText);

            // Dictation: type new complete words into the focused input
            if (dictatingRef.current && !typingInFlightRef.current) {
              const words = fullText.split(/\s+/).filter(Boolean);
              const newWords = words.slice(lastTypedWordsRef.current);
              if (newWords.length > 0) {
                const prefix = lastTypedWordsRef.current > 0 ? " " : "";
                const toType = prefix + newWords.join(" ");
                lastTypedWordsRef.current = words.length;
                typingInFlightRef.current = true;
                invoke("type_text", { text: toType })
                  .catch(() => {})
                  .finally(() => {
                    typingInFlightRef.current = false;
                  });
              }
            }
          }
        } catch {
          /* ignore */
        }
      }, 200);
    } else {
      if (levelPollRef.current) clearInterval(levelPollRef.current);
      if (transcriptPollRef.current) clearInterval(transcriptPollRef.current);
      setAudioLevel(0);
    }
    return () => {
      if (levelPollRef.current) clearInterval(levelPollRef.current);
      if (transcriptPollRef.current) clearInterval(transcriptPollRef.current);
    };
  }, [recording, dictatingRef, typingInFlightRef, lastTypedWordsRef, setTranscript]);

  return {
    recording,
    audioLevel,
    recordingRef,
    tapeRef,
    currentSegmentRef,
    audioPathsRef,
    startTimeRef,
    recordingOntoTapeRef,
    startRecording,
    stopRecording,
    toggleRecord,
    initRecordingContext,
  };
}
