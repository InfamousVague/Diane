import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Recording } from "../App";

const VARIANT_COUNT = 11;
const PEAKS_VARIANT = 10;

const DEFAULT_TAPES: Recording[] = [
  {
    id: "coop-tape-001",
    date: new Date("1989-04-08T10:25:00").getTime(),
    duration: 61,
    transcript:
      "Diane 10:25 AM Twin Peaks County morgue upon the completion of Laura autopsy Sheriff Truman and Albert Rosenfield entered into a heat discussion at the end of which sheriff Truman punched Albert in the nose I can't say I didn't see it coming let's face the music Albert Rosenfield has not changed since arriving in Twin Peaks his actions have been as usual callous and insensitive you better prepare the appropriate paperwork for action and becoming a field officer as I suspect Albert will attempt to file charges against the sheriff Truman and I intend to defend Harry to the upmost of my ability Diane in three hours Twin Peaks berries a young girl I'm looking at her face is seldom kind and never fair I know that God is strong stronger than evil and yet sometimes it's difficult to see it even in a place like Twin Peaks",
    label: "Twin Peaks 1989",
    variant: PEAKS_VARIANT,
    audio_path: "__DEFAULT__",
  },
];

export function useTapeLibrary() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedTape, setSelectedTape] = useState<number | null>(null);
  const [viewingTape, setViewingTape] = useState(false);
  const [transcript, setTranscript] = useState("");

  // Ref to hold stopPlaybackIfActive so callbacks always see the latest version.
  // Wired from App.tsx after usePlayback is created.
  const stopPlaybackRef = useRef<() => void>(() => {});

  // Load saved tapes on startup, seed defaults if empty
  useEffect(() => {
    invoke<Recording[]>("load_tapes")
      .then((tapes) => {
        if (tapes.length > 0) {
          const allZero = tapes.every((t) => !t.variant);
          const migrated = tapes.map((t) => ({
            ...t,
            variant:
              allZero && tapes.length > 1
                ? t.id.charCodeAt(0) % VARIANT_COUNT
                : (t.variant ?? 0),
          }));
          if (allZero && tapes.length > 1) {
            invoke("save_tapes", { tapes: migrated }).catch(() => {});
          }
          setRecordings(migrated);
          setSelectedTape(0);
          setTranscript(migrated[0].transcript);
          setViewingTape(true);
        } else {
          // Seed with default tape
          invoke<string>("resolve_default_audio")
            .then((audioPath) => {
              const tapes = DEFAULT_TAPES.map((t) => ({
                ...t,
                audio_path:
                  t.audio_path === "__DEFAULT__" ? audioPath || "" : t.audio_path,
              }));
              setRecordings(tapes);
              invoke("save_tapes", { tapes }).catch(() => {});
              setSelectedTape(0);
              setTranscript(tapes[0].transcript);
              setViewingTape(true);
            })
            .catch(() => {
              const tapes = DEFAULT_TAPES.map((t) => ({
                ...t,
                audio_path: t.audio_path === "__DEFAULT__" ? "" : t.audio_path,
              }));
              setRecordings(tapes);
              invoke("save_tapes", { tapes }).catch(() => {});
              setSelectedTape(0);
              setTranscript(tapes[0].transcript);
              setViewingTape(true);
            });
        }
      })
      .catch(() => {});
  }, []);

  const prevTape = useCallback(
    (liveTapeText: string) => {
      stopPlaybackRef.current();
      setSelectedTape((prev) => {
        if (prev === null || prev <= 0) {
          setTranscript(liveTapeText);
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
    },
    [recordings],
  );

  const nextTape = useCallback(() => {
    stopPlaybackRef.current();
    setSelectedTape((prev) => {
      const next =
        prev === null ? 0 : Math.min(prev + 1, recordings.length - 1);
      if (recordings[next]) {
        setTranscript(recordings[next].transcript);
        setViewingTape(true);
      }
      return next;
    });
  }, [recordings]);

  /** Select a tape by index, or null for the live tape */
  const selectTape = useCallback(
    (index: number | null, liveTapeText: string) => {
      stopPlaybackRef.current();
      setSelectedTape(index);
      if (index !== null && recordings[index]) {
        setTranscript(recordings[index].transcript);
        setViewingTape(true);
      } else {
        setTranscript(liveTapeText);
        setViewingTape(false);
      }
    },
    [recordings],
  );

  return {
    recordings,
    setRecordings,
    selectedTape,
    setSelectedTape,
    viewingTape,
    setViewingTape,
    transcript,
    setTranscript,
    stopPlaybackRef,
    prevTape,
    nextTape,
    selectTape,
  };
}
