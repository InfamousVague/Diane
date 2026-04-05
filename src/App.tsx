import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Recorder } from "./components/Recorder";
import { TranscriptOverlay } from "./components/TranscriptOverlay";
import { Header } from "./components/Header";
import { useGlobalHotkeys } from "./hooks/useGlobalHotkeys";
import "./App.css";

export type Recording = {
  id: string;
  date: number;
  duration: number;
  transcript: string;
  label: string;
  variant: number; // index into TAPE_VARIANTS, persisted with tape
  audio_path: string; // path to the recorded WAV file
};

const VARIANT_COUNT = 11;
const PEAKS_VARIANT = 10; // index of cassette_variant_peaks.png

const DEFAULT_TAPES: Recording[] = [
  {
    id: "coop-tape-001",
    date: new Date("1989-04-08T10:25:00").getTime(),
    duration: 61,
    transcript: "Diane 10:25 AM Twin Peaks County morgue upon the completion of Laura autopsy Sheriff Truman and Albert Rosenfield entered into a heat discussion at the end of which sheriff Truman punched Albert in the nose I can't say I didn't see it coming let's face the music Albert Rosenfield has not changed since arriving in Twin Peaks his actions have been as usual callous and insensitive you better prepare the appropriate paperwork for action and becoming a field officer as I suspect Albert will attempt to file charges against the sheriff Truman and I intend to defend Harry to the upmost of my ability Diane in three hours Twin Peaks berries a young girl I'm looking at her face is seldom kind and never fair I know that God is strong stronger than evil and yet sometimes it's difficult to see it even in a place like Twin Peaks",
    label: "Twin Peaks 1989",
    variant: PEAKS_VARIANT,
    audio_path: "__DEFAULT__",
  },
];

export function App() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [transcript, setTranscript] = useState("");
  const [selectedTape, setSelectedTape] = useState<number | null>(null);
  const [viewingTape, setViewingTape] = useState(false);
  const viewingTapeRef = useRef(false);

  // Load saved tapes on startup, seed defaults if empty
  useEffect(() => {
    invoke<Recording[]>("load_tapes").then((tapes) => {
      if (tapes.length > 0) {
        // Migrate old tapes: if all variants are 0 (default from Rust), assign from ID
        const allZero = tapes.every((t) => !t.variant);
        const migrated = tapes.map((t) => ({
          ...t,
          variant: (allZero && tapes.length > 1)
            ? (t.id.charCodeAt(0) % VARIANT_COUNT)
            : (t.variant ?? 0),
        }));
        if (allZero && tapes.length > 1) {
          invoke("save_tapes", { tapes: migrated }).catch(() => {});
        }
        setRecordings(migrated);
        // Auto-select first tape
        setSelectedTape(0);
        setTranscript(migrated[0].transcript);
        setViewingTape(true);
        console.log(`Loaded ${migrated.length} tapes`);
      } else {
        // Seed with default tape — resolve bundled audio path
        invoke<string>("resolve_default_audio").then((audioPath) => {
          const tapes = DEFAULT_TAPES.map((t) => ({
            ...t,
            audio_path: t.audio_path === "__DEFAULT__" ? (audioPath || "") : t.audio_path,
          }));
          setRecordings(tapes);
          invoke("save_tapes", { tapes }).catch(() => {});
          setSelectedTape(0);
          setTranscript(tapes[0].transcript);
          setViewingTape(true);
          console.log("Seeded default tapes with audio:", audioPath);
        }).catch(() => {
          setRecordings(DEFAULT_TAPES);
          invoke("save_tapes", { tapes: DEFAULT_TAPES }).catch(() => {});
          setSelectedTape(0);
          setTranscript(DEFAULT_TAPES[0].transcript);
          setViewingTape(true);
        });
      }
    }).catch(() => {});
  }, []);
  const [recording, setRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [dictating, setDictating] = useState(false);
  const dictatingRef = useRef(false);
  const lastTypedWordsRef = useRef(0); // tracks how many words we've already typed out
  const typingInFlightRef = useRef(false); // prevent overlapping type_text calls
  const startTimeRef = useRef(0);
  const levelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false);
  const tapeRef = useRef<string[]>([]); // all finalized segments
  const currentSegmentRef = useRef(""); // live transcript from current recording
  const audioPathsRef = useRef<string[]>([]); // WAV paths from each recording segment

  // Playback state
  const [playing, setPlaying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [playbackLevel, setPlaybackLevel] = useState(0);
  const [highlightProgress, setHighlightProgress] = useState(0);
  const playbackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadedTapeIdRef = useRef<string | null>(null);
  const tapePositionRef = useRef(0); // 0.0-1.0 position in the tape
  const seekingRef = useRef(false); // guard to prevent polling from clearing state during seek

  // Track which saved tape we're recording onto (null = new tape)
  const recordingOntoTapeRef = useRef<number | null>(null);

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
      setSelectedTape((current) => {
        if (current !== null) {
          const existingTape = recordings[current];
          if (existingTape) {
            tapeRef.current = [existingTape.transcript];
            setTranscript(existingTape.transcript);
            recordingOntoTapeRef.current = current;
            // Don't re-type existing tape content
            lastTypedWordsRef.current = existingTape.transcript.split(/\s+/).filter(Boolean).length;
          }
        } else {
          recordingOntoTapeRef.current = null;
          lastTypedWordsRef.current = 0;
        }
        setViewingTape(false);
        return current;
      });
    } catch (e) {
      console.error("Failed to start recording:", e);
    }
  }, [recordings]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);

    // Finalize current segment BEFORE awaiting backend stop
    // so tapeRef has content immediately for saveTape
    const segmentText = currentSegmentRef.current;
    if (segmentText) {
      tapeRef.current.push(segmentText);
      setTranscript(tapeRef.current.join("\n"));
    }
    currentSegmentRef.current = "";

    try {
      const result = await invoke<{ transcript: string; audio_path: string }>("stop_recording");
      if (result.audio_path) {
        audioPathsRef.current.push(result.audio_path);
        console.log("Stop recording got audio_path:", result.audio_path);
      }
    } catch (e) {
      console.error("Recording failed:", e);
    }
  }, []);

  const toggleDictation = useCallback(() => {
    const next = !dictatingRef.current;
    dictatingRef.current = next;
    setDictating(next);
    if (next) {
      // Start typing from current word count so we don't re-type existing text
      const existing = [...tapeRef.current];
      if (currentSegmentRef.current) existing.push(currentSegmentRef.current);
      const allText = existing.join(" ");
      lastTypedWordsRef.current = allText.split(/\s+/).filter(Boolean).length;
    }
    console.log("Dictation mode:", next ? "ON" : "OFF");
  }, []);

  const toggleRecord = useCallback(() => {
    console.log("toggleRecord called, recordingRef:", recordingRef.current);
    if (recordingRef.current) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [startRecording, stopRecording]);

  const handleStop = useCallback(async () => {
    if (recordingRef.current) {
      await stopRecording();
    }
    if (playing || rewinding || forwarding) {
      await invoke("stop_playback");
      setPlaying(false);
      setRewinding(false);
      setForwarding(false);
      setPlaybackLevel(0);
    }
  }, [playing, rewinding, forwarding, stopRecording]);

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
    if (!tape.audio_path) {
      console.warn("No audio for this tape — it's a text-only tape");
      return;
    }
    try {
      // Load tape into memory if not already loaded
      if (loadedTapeIdRef.current !== tape.id) {
        await invoke("load_tape", { audioPath: tape.audio_path });
        loadedTapeIdRef.current = tape.id;
      }
      await invoke("start_playback");
      setPlaying(true);
    } catch (e) {
      console.error("Playback failed:", e);
    }
  }, [playing, selectedTape, recordings]);

  const handleRewindStart = useCallback(async () => {
    if (selectedTape === null || !recordings[selectedTape]) return;
    if (recordingRef.current) return;
    const tape = recordings[selectedTape];
    if (!tape.audio_path) return;
    try {
      // Stop forward playback first
      if (playing) {
        await invoke("stop_playback");
        setPlaying(false);
      }
      // Load tape if not loaded
      if (loadedTapeIdRef.current !== tape.id) {
        await invoke("load_tape", { audioPath: tape.audio_path });
        loadedTapeIdRef.current = tape.id;
      }
      await invoke("start_rewind");
      setRewinding(true);
    } catch (e) {
      console.error("Rewind failed:", e);
    }
  }, [playing, selectedTape, recordings]);

  const handleRewindStop = useCallback(async () => {
    if (!rewinding) return;
    try {
      await invoke("stop_playback");
      setRewinding(false);
      // Only resume playback if we haven't reached the beginning
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
  }, [playing, selectedTape, recordings]);

  const handleForwardStop = useCallback(async () => {
    if (!forwarding) return;
    try {
      await invoke("stop_playback");
      setForwarding(false);
      // Only resume playback if we haven't reached the end
      const pos = await invoke<number>("get_playback_position");
      if (pos < 0.999) {
        await invoke("start_playback");
        setPlaying(true);
      }
    } catch (e) {
      console.error("Stop forward failed:", e);
    }
  }, [forwarding]);

  const handleSeek = useCallback(async (progress: number) => {
    if (selectedTape === null || !recordings[selectedTape]) return;
    const tape = recordings[selectedTape];
    if (!tape.audio_path) return;
    try {
      // Load tape if not loaded
      if (loadedTapeIdRef.current !== tape.id) {
        await invoke("load_tape", { audioPath: tape.audio_path });
        loadedTapeIdRef.current = tape.id;
      }
      // Seek and restart playback from new position
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
  }, [selectedTape, recordings]);

  // Poll playback state (playing, rewinding, or forwarding)
  useEffect(() => {
    if (!playing && !rewinding && !forwarding) {
      if (playbackPollRef.current) clearInterval(playbackPollRef.current);
      return;
    }
    playbackPollRef.current = setInterval(async () => {
      // Don't let polling interfere during a seek operation
      if (seekingRef.current) return;
      try {
        const state = await invoke<string>("get_playback_state");
        if (seekingRef.current) return; // re-check after await
        const level = await invoke<number>("get_playback_level");
        const position = await invoke<number>("get_playback_position");
        setPlaybackLevel(level);
        setHighlightProgress(position);
        tapePositionRef.current = position;

        if (state === "finished") {
          setPlaying(false);
          setRewinding(false);
          setForwarding(false);
          setPlaybackLevel(0);
          setHighlightProgress(1.0); // tape stays at the end visually
        } else if (state === "idle" && (rewinding || forwarding)) {
          setRewinding(false);
          setForwarding(false);
          setPlaybackLevel(0);
        } else if (state === "idle" && playing) {
          setPlaying(false);
          setPlaybackLevel(0);
        }
      } catch { /* ignore */ }
    }, 50);
    return () => {
      if (playbackPollRef.current) clearInterval(playbackPollRef.current);
    };
  }, [playing, rewinding, forwarding]);

  // Poll audio level + feed transcriber + get live transcript when recording
  const transcriptPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (recording) {
      // Poll audio level at 20fps
      levelPollRef.current = setInterval(async () => {
        try {
          const level = await invoke<number>("get_audio_level");
          setAudioLevel(level);
        } catch { /* ignore */ }
      }, 50);

      // Feed audio to transcriber + get transcript at 5fps
      transcriptPollRef.current = setInterval(async () => {
        try {
          await invoke("feed_audio_to_transcriber");
          const liveText = await invoke<string>("get_live_transcript");
          if (liveText && liveText.length >= currentSegmentRef.current.length) {
            currentSegmentRef.current = liveText;
            // Only update display if we're on the live tape, not viewing a saved one
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
                // Add space before if not the very first word
                const prefix = lastTypedWordsRef.current > 0 ? " " : "";
                const toType = prefix + newWords.join(" ");
                lastTypedWordsRef.current = words.length;
                typingInFlightRef.current = true;
                invoke("type_text", { text: toType })
                  .catch(() => {})
                  .finally(() => { typingInFlightRef.current = false; });
              }
            }
          }
        } catch { /* ignore */ }
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
  }, [recording]);

  const saveTape = useCallback(async () => {
    // Stop recording first if active
    if (recordingRef.current) {
      await stopRecording();
    }

    // Flush any pending segment into the tape
    if (currentSegmentRef.current) {
      tapeRef.current.push(currentSegmentRef.current);
      currentSegmentRef.current = "";
    }

    // Check if there's actual content on the live tape to save
    const fullText = tapeRef.current.join("\n");

    if (!fullText.trim()) {
      // No live content — just eject back to fresh
      setSelectedTape(null);
      setViewingTape(false);
      setTranscript("");
      recordingOntoTapeRef.current = null;
      return;
    }

    const tapeIndex = recordingOntoTapeRef.current;

    if (tapeIndex !== null) {
      // Update the existing tape we were recording onto
      setRecordings((prev) => {
        const updated = [...prev];
        if (updated[tapeIndex]) {
          updated[tapeIndex] = {
            ...updated[tapeIndex],
            transcript: fullText,
            duration: updated[tapeIndex].duration + Math.floor((Date.now() - startTimeRef.current) / 1000),
          };
        }
        invoke("save_tapes", { tapes: updated }).catch((e) => console.error("Failed to save tapes:", e));
        return updated;
      });

      setSelectedTape(tapeIndex);
      setTranscript(fullText);
      setViewingTape(true);
    } else {
      // Create a new tape
      const totalDuration = Math.floor((Date.now() - startTimeRef.current) / 1000);
      // Use the last recorded audio path (most recent segment)
      const audioPath = audioPathsRef.current.length > 0
        ? audioPathsRef.current[audioPathsRef.current.length - 1]
        : "";
      console.log("Saving tape with audio_path:", audioPath, "paths:", audioPathsRef.current);

      const newTape: Recording = {
        id: crypto.randomUUID(),
        date: Date.now(),
        duration: totalDuration,
        transcript: fullText,
        label: `Diane, ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
        variant: Math.floor(Math.random() * (VARIANT_COUNT - 1)), // exclude peaks variant (last)
        audio_path: audioPath,
      };

      setRecordings((prev) => {
        const updated = [newTape, ...prev];
        invoke("save_tapes", { tapes: updated }).catch((e) => console.error("Failed to save tapes:", e));
        return updated;
      });

      // Select the newly saved tape (it's at index 0 since we prepend)
      setSelectedTape(0);
      setTranscript(fullText);
      setViewingTape(true);
    }

    // Clear the working tape for fresh recording
    tapeRef.current = [];
    currentSegmentRef.current = "";
    audioPathsRef.current = [];
    recordingOntoTapeRef.current = null;
  }, []);

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

  const prevTape = useCallback(() => {
    stopPlaybackIfActive();
    setSelectedTape((prev) => {
      if (prev === null || prev <= 0) {
        setTranscript(tapeRef.current.join("\n"));
        setViewingTape(false);
        return null;
      }
      const next = prev - 1;
      if (recordings[next]) {
        setTranscript(recordings[next].transcript);
        setViewingTape(true);
      }
      return next;
    });
  }, [recordings, stopPlaybackIfActive]);

  const nextTape = useCallback(() => {
    stopPlaybackIfActive();
    setSelectedTape((prev) => {
      const next = prev === null ? 0 : Math.min(prev + 1, recordings.length - 1);
      if (recordings[next]) {
        setTranscript(recordings[next].transcript);
        setViewingTape(true);
      }
      return next;
    });
  }, [recordings, stopPlaybackIfActive]);

  // Global hotkeys
  useGlobalHotkeys({
    onToggleRecord: toggleRecord,
    onStop: handleStop,
    onSaveTape: saveTape,
    onToggleDictation: toggleDictation,
    onPlay: handlePlay,
    onPrevTape: prevTape,
    onNextTape: nextTape,
  });

  // Plain arrow keys cycle tapes when app window is focused
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); prevTape(); }
      if (e.key === "ArrowRight") { e.preventDefault(); nextTape(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [prevTape, nextTape]);

  return (
    <div className="diane">
      <div className="diane__drag-area" />

      <div className="diane__sidebar">
        <Header
          recordings={recordings}
          selectedTape={selectedTape}
          liveTranscript={!viewingTape ? transcript : ""}
          recording={recording}
          dictating={dictating}
          onSelectTape={(index) => {
            // Stop any active playback when switching tapes
            if (playing || rewinding || forwarding) {
              invoke("stop_playback").catch(() => {});
              setPlaying(false);
              setRewinding(false);
              setForwarding(false);
              setPlaybackLevel(0);
              setHighlightProgress(0);
            }
            loadedTapeIdRef.current = null;
            setSelectedTape(index);
            if (index !== null && recordings[index]) {
              setTranscript(recordings[index].transcript);
              setViewingTape(true);
            } else {
              // Back to live tape
              setTranscript(tapeRef.current.join("\n"));
              setViewingTape(false);
            }
          }}
        />

        <div className="diane__transcript-column">
          <TranscriptOverlay
            text={transcript}
            recording={recording}
            highlightProgress={(playing || rewinding || forwarding) ? highlightProgress : undefined}
            onSeek={viewingTape && selectedTape !== null && recordings[selectedTape]?.audio_path ? handleSeek : undefined}
          />
        </div>

        <div className="diane__recorder-dock">
          <Recorder
            recording={recording}
            audioLevel={audioLevel}
            dictating={dictating}
            playing={playing}
            generating={generating}
            rewinding={rewinding}
            forwarding={forwarding}
            playbackLevel={playbackLevel}
            onToggleDictation={toggleDictation}
            onPlay={handlePlay}
            onToggleRecord={toggleRecord}
            onRewindStart={handleRewindStart}
            onRewindStop={handleRewindStop}
            onForwardStart={handleForwardStart}
            onForwardStop={handleForwardStop}
            tapeProgress={highlightProgress}
          />
        </div>
      </div>
    </div>
  );
}
