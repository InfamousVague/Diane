import { useEffect, useRef, useState } from "react";
import "./TranscriptOverlay.css";

interface Props {
  text: string;
  recording: boolean;
  highlightProgress?: number; // 0.0 to 1.0 — portion of text being read aloud
  onSeek?: (progress: number) => void; // called with 0.0–1.0 when a word is clicked
}

const MAX_LINES = 40;

export function TranscriptOverlay({ text, recording, highlightProgress, onSeek }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const prevTextRef = useRef("");

  // Split text into lines as new words arrive
  useEffect(() => {
    if (!text) {
      setLines([]);
      return;
    }

    // Break into ~50 char lines
    const words = text.split(" ");
    const result: string[] = [];
    let current = "";
    for (const word of words) {
      if (current.length + word.length + 1 > 35 && current.length > 0) {
        result.push(current);
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) result.push(current);

    setLines(result);
    prevTextRef.current = text;
  }, [text]);

  if (lines.length === 0 && !recording) return null;

  // Show last MAX_LINES, with opacity fading for older lines
  const visible = lines.slice(-MAX_LINES);
  const offset = Math.max(0, lines.length - MAX_LINES);

  // Calculate character offset for highlight
  const highlightChars = highlightProgress != null && highlightProgress > 0
    ? Math.floor(text.length * highlightProgress)
    : -1;

  // Track cumulative character position per line
  let charsSoFar = 0;

  const allWords = text.split(/\s+/).filter(Boolean);
  const totalWords = allWords.length;
  const seekable = !!onSeek && totalWords > 0;

  // Build word index → progress mapping (word-based, not char-based)
  const handleWordClick = (wordIndex: number) => {
    if (!onSeek || totalWords === 0) return;
    onSeek(wordIndex / totalWords);
  };

  // Track global word index across lines
  let globalWordIndex = 0;

  /** Render a line as clickable word spans */
  const renderWords = (line: string, _lineStart: number, className: string) => {
    if (!seekable) return line;
    const words = line.split(" ");
    return words.map((word, wi) => {
      const idx = globalWordIndex++;
      return (
        <span
          key={wi}
          className={`transcript-overlay__word ${className}`}
          onClick={() => handleWordClick(idx)}
        >
          {word}{wi < words.length - 1 ? " " : ""}
        </span>
      );
    });
  };

  return (
    <div className="transcript-overlay">
      {visible.map((line, i) => {
        const age = visible.length - 1 - i;
        const baseOpacity = age === 0 ? 1 : Math.max(0.1, 1 - age * 0.05);
        const lineStart = charsSoFar;
        charsSoFar += line.length + 1;

        if (highlightChars >= 0) {
          if (lineStart + line.length <= highlightChars) {
            return (
              <div key={offset + i} className="transcript-overlay__line transcript-overlay__line--read" style={{ opacity: 1 }}>
                {renderWords(line, lineStart, "transcript-overlay__read")}
              </div>
            );
          } else if (lineStart < highlightChars) {
            // Split at word boundary closest to the highlight position
            const splitAt = highlightChars - lineStart;
            const words = line.split(" ");
            let charCount = 0;
            let splitWordIdx = words.length;
            for (let w = 0; w < words.length; w++) {
              charCount += words[w].length + (w < words.length - 1 ? 1 : 0);
              if (charCount >= splitAt) {
                splitWordIdx = w + 1;
                break;
              }
            }
            const readWords = words.slice(0, splitWordIdx).join(" ");
            const unreadWords = words.slice(splitWordIdx).join(" ");
            return (
              <div key={offset + i} className="transcript-overlay__line" style={{ opacity: 1 }}>
                {renderWords(readWords, lineStart, "transcript-overlay__read")}
                {unreadWords && <>{" "}{renderWords(unreadWords, lineStart + readWords.length + 1, "transcript-overlay__unread")}</>}
              </div>
            );
          } else {
            return (
              <div key={offset + i} className="transcript-overlay__line transcript-overlay__line--unread" style={{ opacity: 0.3 }}>
                {renderWords(line, lineStart, "transcript-overlay__unread")}
              </div>
            );
          }
        }

        return (
          <div key={offset + i} className="transcript-overlay__line" style={{ opacity: baseOpacity }}>
            {renderWords(line, lineStart, "")}
          </div>
        );
      })}
      {recording && <span className="transcript-overlay__cursor">▋</span>}
    </div>
  );
}
