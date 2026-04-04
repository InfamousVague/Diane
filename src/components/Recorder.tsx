import { useState, useRef, useEffect, useCallback } from "react";
import type { Recording } from "../App";
import "./Recorder.css";

interface Props {
  onRecordingComplete: (rec: Recording) => void;
  onShowLibrary: () => void;
  recordingCount: number;
}

export function Recorder({ onRecordingComplete, onShowLibrary, recordingCount }: Props) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [reelAngle, setReelAngle] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef(0);
  const startTimeRef = useRef(0);

  // Animate reels
  useEffect(() => {
    const animate = () => {
      if (recording) {
        setReelAngle((a) => a + 3); // fast spin while recording
        // Simulate audio levels
        setAudioLevel(Math.random() * 0.6 + 0.2);
      } else {
        setReelAngle((a) => a + 0.3); // gentle idle drift
        setAudioLevel((l) => l * 0.9); // fade out
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [recording]);

  const startRecording = useCallback(() => {
    setRecording(true);
    setTranscript("");
    setElapsed(0);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 100);

    // Simulate typewriter transcript (placeholder until Whisper integration)
    const phrases = [
      "Diane... ",
      "it is now ",
      `${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. `,
      "I find myself ",
      "recording this message ",
      "on a remarkably ",
      "beautiful evening. ",
    ];
    let idx = 0;
    const typeInterval = setInterval(() => {
      if (idx < phrases.length) {
        setTranscript((t) => t + phrases[idx]);
        idx++;
      } else {
        clearInterval(typeInterval);
      }
    }, 1200);
  }, []);

  const stopRecording = useCallback(() => {
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);

    const rec: Recording = {
      id: crypto.randomUUID(),
      date: Date.now(),
      duration: elapsed,
      transcript: transcript || "Diane, I have nothing to report.",
      label: `Diane, ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    };
    if (elapsed > 0) {
      onRecordingComplete(rec);
    }
  }, [elapsed, transcript, onRecordingComplete]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  // LED levels (8 bars)
  const ledCount = 8;
  const activeLeds = Math.round(audioLevel * ledCount);

  return (
    <div className="recorder">
      {/* Body frame */}
      <div className="recorder__body">
        <img src="./assets/recorder-body.png" alt="" className="recorder__frame" draggable={false} />

        {/* Cassette window overlay — spinning reels */}
        <div className="recorder__cassette-window">
          <div className="recorder__reel recorder__reel--left" style={{ transform: `rotate(${reelAngle}deg)` }}>
            <div className="recorder__reel-hub" />
            <div className="recorder__reel-spoke" />
            <div className="recorder__reel-spoke" style={{ transform: "rotate(120deg)" }} />
            <div className="recorder__reel-spoke" style={{ transform: "rotate(240deg)" }} />
          </div>
          <div className="recorder__reel recorder__reel--right" style={{ transform: `rotate(${reelAngle}deg)` }}>
            <div className="recorder__reel-hub" />
            <div className="recorder__reel-spoke" />
            <div className="recorder__reel-spoke" style={{ transform: "rotate(120deg)" }} />
            <div className="recorder__reel-spoke" style={{ transform: "rotate(240deg)" }} />
          </div>

          {/* Tape between reels */}
          <div className="recorder__tape" />

          {/* Counter */}
          <div className="recorder__counter">
            {formatTime(elapsed)}
          </div>

          {/* REC indicator */}
          {recording && <div className="recorder__rec-light">● REC</div>}
        </div>

        {/* LED meter overlay */}
        <div className="recorder__meter">
          {Array.from({ length: ledCount }).map((_, i) => (
            <div
              key={i}
              className={`recorder__led ${i < activeLeds ? "recorder__led--active" : ""}`}
              style={{
                background: i < activeLeds
                  ? i < 5 ? "var(--diane-green)" : i < 7 ? "var(--diane-amber)" : "var(--diane-red)"
                  : "rgba(255,255,255,0.06)",
              }}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="recorder__buttons">
          <button
            className={`recorder__btn ${recording ? "recorder__btn--recording" : ""}`}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={() => recording && stopRecording()}
          >
            <span className="recorder__btn-label">REC</span>
          </button>
          <button className="recorder__btn" onClick={stopRecording}>
            <span className="recorder__btn-label">STOP</span>
          </button>
          <button className="recorder__btn" disabled>
            <span className="recorder__btn-label">PLAY</span>
          </button>
          <button className="recorder__btn" onClick={onShowLibrary}>
            <span className="recorder__btn-label">
              TAPES{recordingCount > 0 ? ` (${recordingCount})` : ""}
            </span>
          </button>
        </div>
      </div>

      {/* Transcript panel */}
      <div className="recorder__transcript">
        <div className="recorder__transcript-text">
          {transcript || (
            <span className="recorder__transcript-placeholder">
              Hold REC to record. Release to stop.
            </span>
          )}
          {recording && <span className="recorder__cursor">▋</span>}
        </div>
      </div>
    </div>
  );
}
