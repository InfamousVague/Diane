import { useState } from "react";
import type { Recording } from "../App";
import "./Header.css";

const TAPE_VARIANTS = [
  "cassette_variant_gray.png",
  "cassette_variant_black.png",
  "cassette_variant_red.png",
  "cassette_variant_green.png",
  "cassette_variant_white.png",
  "cassette_variant_orange.png",
  "cassette_variant_brown.png",
  "cassette_variant_gold.png",
  "cassette_variant_pink.png",
  "cassette_variant_teal.png",
  "cassette_variant_peaks.png",
];

interface Props {
  recordings: Recording[];
  onSelectTape: (index: number) => void;
  selectedTape: number | null;
  liveTranscript: string;
  recording: boolean;
  dictating: boolean;
}

const HOTKEYS = [
  { keys: "⌘⇧R", action: "Record / Stop" },
  { keys: "⌘⇧S", action: "Force Stop" },
  { keys: "⌘⇧E", action: "Save Tape" },
  { keys: "⌘⇧T", action: "Dictation Mode" },
  { keys: "⌘⇧A", action: "Desktop Audio" },
  { keys: "⌘⇧P", action: "Play Tape" },
  { keys: "⌘⇧←", action: "Previous Tape" },
  { keys: "⌘⇧→", action: "Next Tape" },
];

export function Header({ recordings, onSelectTape, selectedTape, liveTranscript, recording, dictating }: Props) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="diane-header">
      <div className="diane-header__card">
      {/* Tape counter + help */}
      <div className="diane-header__top">
        <span className="diane-header__tape-count">
          {recordings.length > 0 ? `${recordings.length} tape${recordings.length !== 1 ? "s" : ""}` : "No tapes"}
          {dictating && <span className="diane-header__dict-badge">DICT</span>}
        </span>
        <div className="diane-header__help-anchor">
          <button
            className="diane-header__help-btn"
            onClick={() => setShowHelp(!showHelp)}
            title="Keyboard shortcuts"
          >
            ?
          </button>
          {showHelp && (
            <div className="diane-header__help">
              <span className="diane-header__help-title">Keyboard Shortcuts</span>
              {HOTKEYS.map((h) => (
                <div key={h.keys} className="diane-header__help-row">
                  <kbd className="diane-header__kbd">{h.keys}</kbd>
                  <span className="diane-header__help-action">{h.action}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tape carousel — 3D fan */}
      {(recordings.length > 0 || liveTranscript || selectedTape === null) && (
        <div className="diane-header__tapes">
          <div className="diane-header__tape-fan">
            {/* Live/blank tape — shown when no saved tape is selected */}
            {selectedTape === null && (
              <div
                className="diane-header__tape diane-header__tape--selected diane-header__tape--live"
                style={{ transform: "translateX(0px) scale(1)", opacity: 1, zIndex: 100 }}
              >
                <div className="diane-header__tape-body">
                  <img
                    src={`./assets/${TAPE_VARIANTS[0]}`}
                    alt=""
                    className="diane-header__tape-img"
                    draggable={false}
                  />
                  <span className="diane-header__tape-label">
                    {recording ? "Recording" : liveTranscript ? "Unsaved" : "Empty Tape"}
                    {liveTranscript ? ` · ${liveTranscript.split(/\s+/).filter(Boolean).length} w` : ""}
                  </span>
                </div>
              </div>
            )}
            {recordings.slice(0, 7).map((rec, i) => {
              const hasLive = (liveTranscript || recording) && selectedTape === null;
              const isSelected = selectedTape === i;
              const center = selectedTape ?? (hasLive ? -1 : 0);
              const offset = i - center;
              const translateX = offset * 40;
              const scale = 1 - Math.abs(offset) * 0.1;
              const opacity = 1;

              return (
                <div
                  key={rec.id}
                  className={`diane-header__tape ${isSelected ? "diane-header__tape--selected" : ""}`}
                  style={{
                    transform: `translateX(${translateX}px) scale(${scale})`,
                    opacity,
                    zIndex: 100 - Math.abs(offset),
                  }}
                  onClick={() => onSelectTape(i)}
                >
                  <div className="diane-header__tape-body">
                    <img
                      src={`./assets/${TAPE_VARIANTS[rec.variant ?? 0]}`}
                      alt=""
                      className="diane-header__tape-img"
                      draggable={false}
                    />
                    <span className="diane-header__tape-label">
                      {new Date(rec.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      {" · "}
                      {rec.transcript.split(/\s+/).filter(Boolean).length} w
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
