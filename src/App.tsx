import { useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Recorder } from "./components/Recorder";
import { TranscriptOverlay } from "./components/TranscriptOverlay";
import { Header } from "./components/Header";
import { useGlobalHotkeys } from "./hooks/useGlobalHotkeys";
import { useModelDownload } from "./hooks/useModelDownload";
import { useRecorder } from "./hooks/useRecorder";
import { usePlayback } from "./hooks/usePlayback";
import { useDictation } from "./hooks/useDictation";
import { useTapeLibrary } from "./hooks/useTapeLibrary";
import "./App.css";

export type Recording = {
  id: string;
  date: number;
  duration: number;
  transcript: string;
  label: string;
  variant: number;
  audio_path: string;
};

const VARIANT_COUNT = 11;

export function App() {
  const { downloading } = useModelDownload();

  // 1. Dictation — owns shared refs that recorder and playback read
  const dictation = useDictation();

  // 2. Tape library — uses a ref for stopPlayback to avoid circular deps
  const library = useTapeLibrary();

  // 3. Recorder — reads dictation refs, writes library state
  const recorder = useRecorder({
    recordings: library.recordings,
    setTranscript: library.setTranscript,
    setViewingTape: library.setViewingTape,
    dictatingRef: dictation.dictatingRef,
    typingInFlightRef: dictation.typingInFlightRef,
    lastTypedWordsRef: dictation.lastTypedWordsRef,
  });

  // Wire dictation's ref handles to recorder's actual refs
  dictation.tapeRefHandle.current = recorder.tapeRef;
  dictation.currentSegmentRefHandle.current = recorder.currentSegmentRef;

  // 4. Playback — reads library state, recorder ref, dictation refs
  const playback = usePlayback({
    recordings: library.recordings,
    selectedTape: library.selectedTape,
    recordingRef: recorder.recordingRef,
    dictatingRef: dictation.dictatingRef,
    typingInFlightRef: dictation.typingInFlightRef,
    lastTypedWordsRef: dictation.lastTypedWordsRef,
  });

  // Wire library's stopPlayback ref to playback's function
  library.stopPlaybackRef.current = playback.stopPlaybackIfActive;

  // --- Composed callbacks ---

  const saveTape = useCallback(async () => {
    // If viewing a saved tape (not recording), eject to blank
    if (
      library.viewingTape &&
      !recorder.recordingRef.current &&
      recorder.tapeRef.current.length === 0
    ) {
      playback.stopPlaybackIfActive();
      library.setSelectedTape(null);
      library.setViewingTape(false);
      library.setTranscript("");
      playback.setHighlightProgress(0);
      return;
    }

    if (recorder.recordingRef.current) {
      await recorder.stopRecording();
    }

    if (recorder.currentSegmentRef.current) {
      recorder.tapeRef.current.push(recorder.currentSegmentRef.current);
      recorder.currentSegmentRef.current = "";
    }

    const fullText = recorder.tapeRef.current.join("\n");

    if (!fullText.trim()) {
      library.setSelectedTape(null);
      library.setViewingTape(false);
      library.setTranscript("");
      recorder.recordingOntoTapeRef.current = null;
      return;
    }

    const tapeIndex = recorder.recordingOntoTapeRef.current;

    if (tapeIndex !== null) {
      library.setRecordings((prev) => {
        const updated = [...prev];
        if (updated[tapeIndex]) {
          updated[tapeIndex] = {
            ...updated[tapeIndex],
            transcript: fullText,
            duration:
              updated[tapeIndex].duration +
              Math.floor((Date.now() - recorder.startTimeRef.current) / 1000),
          };
        }
        invoke("save_tapes", { tapes: updated }).catch(() => {});
        return updated;
      });
      library.setSelectedTape(tapeIndex);
      library.setTranscript(fullText);
      library.setViewingTape(true);
    } else {
      const totalDuration = Math.floor(
        (Date.now() - recorder.startTimeRef.current) / 1000,
      );
      const audioPath =
        recorder.audioPathsRef.current.length > 0
          ? recorder.audioPathsRef.current[recorder.audioPathsRef.current.length - 1]
          : "";

      const newTape: Recording = {
        id: crypto.randomUUID(),
        date: Date.now(),
        duration: totalDuration,
        transcript: fullText,
        label: `Diane, ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
        variant: Math.floor(Math.random() * (VARIANT_COUNT - 1)),
        audio_path: audioPath,
      };

      library.setRecordings((prev) => {
        const updated = [newTape, ...prev];
        invoke("save_tapes", { tapes: updated }).catch(() => {});
        return updated;
      });
      library.setSelectedTape(0);
      library.setTranscript(fullText);
      library.setViewingTape(true);
    }

    recorder.tapeRef.current = [];
    recorder.currentSegmentRef.current = "";
    recorder.audioPathsRef.current = [];
    recorder.recordingOntoTapeRef.current = null;
  }, [library, recorder, playback]);

  const handleStop = useCallback(async () => {
    if (recorder.recordingRef.current) {
      await recorder.stopRecording();
    }
    if (playback.playing || playback.rewinding || playback.forwarding) {
      await invoke("stop_playback");
      playback.stopPlaybackIfActive();
    }
  }, [recorder, playback]);

  const startRecordingWithContext = useCallback(async () => {
    await recorder.startRecording();
    recorder.initRecordingContext(library.selectedTape);
  }, [recorder, library.selectedTape]);

  const toggleRecord = useCallback(() => {
    if (recorder.recordingRef.current) {
      recorder.stopRecording();
    } else {
      startRecordingWithContext();
    }
  }, [recorder, startRecordingWithContext]);

  const prevTape = useCallback(() => {
    library.prevTape(recorder.tapeRef.current.join("\n"));
  }, [library, recorder]);

  const nextTape = useCallback(() => {
    library.nextTape();
  }, [library]);

  // Listen for meeting detection — auto-start recording when notification clicked
  useEffect(() => {
    const unlisten = listen<string>("meeting-detected", () => {});
    const unlistenAutoStart = listen("auto-start-recording", () => {
      if (!recorder.recordingRef.current) {
        startRecordingWithContext();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
      unlistenAutoStart.then((fn) => fn());
    };
  }, [recorder, startRecordingWithContext]);

  // Global hotkeys
  useGlobalHotkeys({
    onToggleRecord: toggleRecord,
    onStop: handleStop,
    onSaveTape: saveTape,
    onToggleDictation: dictation.toggleDictation,
    onToggleDesktopAudio: dictation.toggleDesktopAudio,
    onPlay: playback.handlePlay,
    onPrevTape: prevTape,
    onNextTape: nextTape,
  });

  // Arrow keys cycle tapes when app window is focused
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevTape();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        nextTape();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [prevTape, nextTape]);

  const isPlaybackActive = playback.playing || playback.rewinding || playback.forwarding;

  return (
    <div className="diane">
      <div className="diane__drag-area" />

      <div className="diane__sidebar">
        {downloading && (
          <div className="diane__download-overlay">
            <div className="diane__download-spinner" />
            <div className="diane__download-title">Downloading Assets</div>
            <div className="diane__download-label">First run setup</div>
          </div>
        )}
        <Header
          recordings={library.recordings}
          selectedTape={library.selectedTape}
          liveTranscript={!library.viewingTape ? library.transcript : ""}
          recording={recorder.recording}
          dictating={dictation.dictating}
          onSelectTape={(index) => {
            library.selectTape(index, recorder.tapeRef.current.join("\n"));
          }}
        />

        <div className="diane__transcript-column">
          <TranscriptOverlay
            text={library.transcript}
            recording={recorder.recording}
            highlightProgress={isPlaybackActive ? playback.highlightProgress : undefined}
            onSeek={
              library.viewingTape &&
              library.selectedTape !== null &&
              library.recordings[library.selectedTape]?.audio_path
                ? playback.handleSeek
                : undefined
            }
          />
        </div>

        <div className="diane__recorder-dock">
          <Recorder
            recording={recorder.recording}
            audioLevel={recorder.audioLevel}
            dictating={dictation.dictating}
            playing={playback.playing}
            generating={false}
            rewinding={playback.rewinding}
            forwarding={playback.forwarding}
            playbackLevel={playback.playbackLevel}
            onToggleDictation={dictation.toggleDictation}
            onToggleDesktopAudio={dictation.toggleDesktopAudio}
            desktopAudio={dictation.desktopAudio}
            onPlay={playback.handlePlay}
            onToggleRecord={toggleRecord}
            onRewindStart={playback.handleRewindStart}
            onRewindStop={playback.handleRewindStop}
            onForwardStart={playback.handleForwardStart}
            onForwardStop={playback.handleForwardStop}
            tapeProgress={playback.highlightProgress}
          />
        </div>
      </div>
    </div>
  );
}
