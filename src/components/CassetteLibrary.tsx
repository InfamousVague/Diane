import type { Recording } from "../App";
import "./CassetteLibrary.css";

interface Props {
  recordings: Recording[];
  onBack: () => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function CassetteLibrary({ recordings, onBack }: Props) {
  return (
    <div className="library">
      <div className="library__header">
        <button className="library__back" onClick={onBack}>← Recorder</button>
        <span className="library__title">Tapes</span>
        <span className="library__count">{recordings.length}</span>
      </div>

      <div className="library__grid">
        {recordings.length === 0 ? (
          <div className="library__empty">
            <img src="./assets/cassette.png" alt="" className="library__empty-img" draggable={false} />
            <span>No tapes yet. Hold REC to record.</span>
          </div>
        ) : (
          recordings.map((rec) => (
            <div key={rec.id} className="library__cassette">
              <div className="library__cassette-body">
                {/* Mini tape reels */}
                <div className="library__cassette-reels">
                  <div className="library__mini-reel" />
                  <div className="library__mini-reel" />
                </div>
                {/* Label */}
                <div className="library__cassette-label">
                  <span className="library__cassette-title">{rec.label}</span>
                  <span className="library__cassette-meta">
                    {formatDate(rec.date)} · {formatDuration(rec.duration)}
                  </span>
                </div>
              </div>
              <div className="library__cassette-transcript">
                {rec.transcript.length > 100
                  ? rec.transcript.slice(0, 100) + "..."
                  : rec.transcript}
              </div>
              <div className="library__cassette-actions">
                <button
                  className="library__action-btn"
                  onClick={() => navigator.clipboard.writeText(rec.transcript)}
                >
                  Copy
                </button>
                <button
                  className="library__action-btn"
                  onClick={() => {
                    const blob = new Blob([rec.transcript], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${rec.label.replace(/[^a-zA-Z0-9]/g, "_")}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export .txt
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
