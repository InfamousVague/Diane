import { useState, useRef, useEffect } from "react";
import "./Recorder.css";

const BUTTON_FRAMES = {
  record: ["ReordOff", "RecordMid1", "RecordMid2", "RecordOn"],
};

interface Props {
  recording: boolean;
  audioLevel: number;
  dictating: boolean;
  playing: boolean;
  generating: boolean;
  rewinding: boolean;
  forwarding: boolean;
  playbackLevel: number;
  onToggleDictation: () => void;
  onPlay: () => void;
  onToggleRecord: () => void;
  onRewindStart: () => void;
  onRewindStop: () => void;
  onForwardStart: () => void;
  onForwardStop: () => void;
  tapeProgress: number; // 0.0 = all tape on left reel, 1.0 = all on right
}

export function Recorder({ recording, audioLevel, dictating, playing, generating, rewinding, forwarding, playbackLevel, onToggleDictation, onPlay, onToggleRecord, onRewindStart, onRewindStop, onForwardStart, onForwardStop, tapeProgress }: Props) {
  const [reelAngle, setReelAngle] = useState(0);
  const animRef = useRef(0);

  // Debug: only log state changes, not every render
  const prevRecording = useRef(recording);
  if (prevRecording.current !== recording) {
    console.log("Recorder state changed — recording:", recording);
    prevRecording.current = recording;
  }

  // Track rewind speed for wheel animation (matches Rust ramp: 0.5→4.0 over 800ms)
  const rewindStartRef = useRef(0);
  const rewindMomentumRef = useRef(0); // for deceleration after release

  useEffect(() => {
    if (rewinding || forwarding) {
      rewindStartRef.current = performance.now();
      rewindMomentumRef.current = 0;
    } else if (rewindStartRef.current > 0) {
      rewindMomentumRef.current = 0;
      rewindStartRef.current = 0;
    }
  }, [rewinding, forwarding]);

  // Animate reels
  useEffect(() => {
    const animate = () => {
      if (rewinding || forwarding) {
        const elapsed = performance.now() - rewindStartRef.current;
        const t = Math.min(elapsed / 1200, 1);
        const speed = (0.5 + 7.5 * t * t) * 5;
        setReelAngle((a) => a + (rewinding ? -speed : speed));
      } else if (rewindMomentumRef.current > 0) {
        // Momentum deceleration after releasing rewind
        rewindMomentumRef.current *= 0.92;
        if (rewindMomentumRef.current < 0.1) rewindMomentumRef.current = 0;
        setReelAngle((a) => a - rewindMomentumRef.current);
      } else if (recording || playing) {
        setReelAngle((a) => a + (playing ? 3.5 : 2.5));
      } else {
        setReelAngle((a) => a + 0.2);
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [recording, playing, rewinding, forwarding]);

  // Subtle flickering glow — always on, random flicker
  const [recGlow, setRecGlow] = useState(0);
  useEffect(() => {
    let raf: number;
    let target = 0.5;
    let current = 0.5;
    let nextChange = 0;
    const tick = (now: number) => {
      if (now >= nextChange) {
        target = 0.3 + Math.random() * 0.7; // flicker between 0.3–1.0
        nextChange = now + 80 + Math.random() * 250; // change every 80–330ms
      }
      current += (target - current) * 0.08; // smooth chase
      setRecGlow(current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const activeLevel = (playing || rewinding) ? playbackLevel : audioLevel;
  const activeMeter = Math.max(recording || playing || rewinding ? 1 : 0, Math.round(activeLevel * 15));

  return (
    <div className="recorder">
      <div className="recorder__body">
        {/* === Behind body === */}
        <img src="./assets/Casette.png" className="recorder__layer" style={{ zIndex: 1 }} alt="" draggable={false} />
        <img src="./assets/MeterBG.png" className="recorder__layer" style={{ zIndex: 1 }} alt="" draggable={false} />
        <img src="./assets/ButtonBackground.png" className="recorder__layer" style={{ zIndex: 1 }} alt="" draggable={false} />
        {/* Wheels — clip-path circle crops to simulate tape amount on each reel */}
        {(() => {
          // Min radius = hub only (22%), max = full reel (40%)
          const minR = 22;
          const maxR = 45;
          const range = maxR - minR;
          const leftR = maxR - tapeProgress * range;  // full → hub
          const rightR = minR + tapeProgress * range;  // hub → full
          return (
            <>
              <div className="recorder__wheel recorder__wheel--left"
                style={{ transform: `rotate(${reelAngle}deg)`, zIndex: 3, clipPath: `circle(${leftR}% at center)` }}>
                <img src="./assets/Wheel.png" alt="" draggable={false} />
              </div>
              <div className="recorder__wheel recorder__wheel--right"
                style={{ transform: `rotate(${reelAngle + 45}deg)`, zIndex: 3, clipPath: `circle(${rightR}% at center)` }}>
                <img src="./assets/Wheel.png" alt="" draggable={false} />
              </div>
            </>
          );
        })()}
        <div className="recorder__glass" style={{ zIndex: 3 }} />
        <img src="./assets/CasetteCover.png" className="recorder__layer" style={{ zIndex: 4 }} alt="" draggable={false} />

        {/* === Body frame === */}
        <img src="./assets/Body.png" className="recorder__layer" style={{ zIndex: 5 }} alt="" draggable={false} />

        {/* Meter ticks */}
        {Array.from({ length: 15 }).map((_, i) => (
          <img key={i} src={`./assets/Meter${i + 1}.png`}
            className="recorder__layer recorder__meter-tick"
            style={{ zIndex: 12, opacity: i < activeMeter ? 1 : 0 }}
            alt="" draggable={false} />
        ))}

        {/* Record button — flickers when recording, off otherwise */}
        {recording ? (
          <>
            <img src="./assets/RecordMid2.png" className="recorder__layer"
              style={{ zIndex: 13 }} alt="" draggable={false} />
            <img src="./assets/RecordOn.png" className="recorder__layer"
              style={{ zIndex: 14, opacity: recGlow }} alt="" draggable={false} />
          </>
        ) : (
          <img src="./assets/ReordOff.png" className="recorder__layer"
            style={{ zIndex: 13 }} alt="" draggable={false} />
        )}
        {/* Forward button — lit when fast-forwarding */}
        {forwarding ? (
          <>
            <img src="./assets/ForwardMid2.png" className="recorder__layer"
              style={{ zIndex: 13 }} alt="" draggable={false} />
            <img src="./assets/ForwardOn.png" className="recorder__layer"
              style={{ zIndex: 14, opacity: recGlow }} alt="" draggable={false} />
          </>
        ) : (
          <img src="./assets/ForwardOff.png" className="recorder__layer" style={{ zIndex: 13 }} alt="" draggable={false} />
        )}
        {/* Play button — pulsing when generating, glowing when playing */}
        {generating ? (
          <>
            <img src="./assets/PlayMid1.png" className="recorder__layer"
              style={{ zIndex: 13 }} alt="" draggable={false} />
            <img src="./assets/PlayMid2.png" className="recorder__layer"
              style={{ zIndex: 14, opacity: recGlow }} alt="" draggable={false} />
          </>
        ) : playing ? (
          <>
            <img src="./assets/PlayMid2.png" className="recorder__layer"
              style={{ zIndex: 13 }} alt="" draggable={false} />
            <img src="./assets/PlayOn.png" className="recorder__layer"
              style={{ zIndex: 14, opacity: recGlow }} alt="" draggable={false} />
          </>
        ) : (
          <img src="./assets/PlayOff.png" className="recorder__layer" style={{ zIndex: 13 }} alt="" draggable={false} />
        )}
        {/* Rewind button — lit when rewinding */}
        {rewinding ? (
          <>
            <img src="./assets/RewindMid2.png" className="recorder__layer"
              style={{ zIndex: 13 }} alt="" draggable={false} />
            <img src="./assets/RewindOn.png" className="recorder__layer"
              style={{ zIndex: 14, opacity: recGlow }} alt="" draggable={false} />
          </>
        ) : (
          <img src="./assets/RewindOff.png" className="recorder__layer" style={{ zIndex: 13 }} alt="" draggable={false} />
        )}

        {/* Invisible click zones positioned over each button */}
        <div className="recorder__click-zone recorder__click-zone--record" style={{ zIndex: 20 }} onClick={onToggleRecord} />
        <div className="recorder__click-zone recorder__click-zone--forward" style={{ zIndex: 20 }}
          onMouseDown={onForwardStart} onMouseUp={onForwardStop} onMouseLeave={onForwardStop} />
        <div className="recorder__click-zone recorder__click-zone--play" style={{ zIndex: 20 }} onClick={onPlay} />
        <div className="recorder__click-zone recorder__click-zone--rewind" style={{ zIndex: 20 }}
          onMouseDown={onRewindStart} onMouseUp={onRewindStop} onMouseLeave={onRewindStop} />

        {/* Dictation toggle switch */}
        <img src="./assets/SwitchLabel.png" className="recorder__layer" style={{ zIndex: 12 }} alt="" draggable={false} />
        <img src="./assets/SwitchTray.png" className="recorder__layer" style={{ zIndex: 10, opacity: dictating ? 0 : 1 }} alt="" draggable={false} />
        <img src="./assets/SwitchTrayOn.png" className="recorder__layer" style={{ zIndex: 10, opacity: dictating ? 1 : 0 }} alt="" draggable={false} />
        <img
          src="./assets/SwitchOff.png"
          className="recorder__layer recorder__layer--interactive recorder__switch-knob"
          style={{ zIndex: 11, transform: dictating ? "translateX(-58px)" : "translateX(0)" }}
          alt=""
          draggable={false}
          onClick={onToggleDictation}
        />

        {/* Hotkey hint */}
        <div className="recorder__hotkey-hint" style={{ zIndex: 12 }}>
          {recording ? "⌘⇧R to stop" : "⌘⇧R to record"}
        </div>
      </div>
    </div>
  );
}
