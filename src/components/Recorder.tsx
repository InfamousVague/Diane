import { useState, useRef, useEffect } from "react";
import { RecorderButton } from "./RecorderButton";
import "./Recorder.css";

interface Props {
  recording: boolean;
  audioLevel: number;
  dictating: boolean;
  desktopAudio: boolean;
  playing: boolean;
  generating: boolean;
  rewinding: boolean;
  forwarding: boolean;
  playbackLevel: number;
  onToggleDictation: () => void;
  onToggleDesktopAudio: () => void;
  onPlay: () => void;
  onToggleRecord: () => void;
  onRewindStart: () => void;
  onRewindStop: () => void;
  onForwardStart: () => void;
  onForwardStop: () => void;
  tapeProgress: number;
}

export function Recorder({ recording, audioLevel, dictating, desktopAudio, playing, generating, rewinding, forwarding, playbackLevel, onToggleDictation, onToggleDesktopAudio, onPlay, onToggleRecord, onRewindStart, onRewindStop, onForwardStart, onForwardStop, tapeProgress }: Props) {
  const [reelAngle, setReelAngle] = useState(0);
  const animRef = useRef(0);

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

        {/* Recorder buttons — each with off/mid/on glow states */}
        <RecorderButton active={recording} glow={recGlow}
          offSrc="./assets/ReordOff.png" midSrc="./assets/RecordMid2.png" onSrc="./assets/RecordOn.png" />
        <RecorderButton active={forwarding} glow={recGlow}
          offSrc="./assets/ForwardOff.png" midSrc="./assets/ForwardMid2.png" onSrc="./assets/ForwardOn.png" />
        <RecorderButton active={playing} glow={recGlow}
          offSrc="./assets/PlayOff.png" midSrc="./assets/PlayMid2.png" onSrc="./assets/PlayOn.png"
          secondaryActive={generating} secondaryMidSrc="./assets/PlayMid1.png" secondaryOnSrc="./assets/PlayMid2.png" />
        <RecorderButton active={rewinding} glow={recGlow}
          offSrc="./assets/RewindOff.png" midSrc="./assets/RewindMid2.png" onSrc="./assets/RewindOn.png" />

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
          className="recorder__layer recorder__switch-knob"
          style={{ zIndex: 13, transform: dictating ? "translateX(-58px)" : "translateX(0)" }}
          alt=""
          draggable={false}
        />
        {/* Click zone for dictation switch — only covers the switch area */}
        <div className="recorder__click-zone recorder__click-zone--switch" style={{ zIndex: 20 }}
          onClick={onToggleDictation} />

        {/* Line In (desktop audio) toggle — PNG layers */}
        <img src="./assets/LineInOff.png" className="recorder__layer"
          style={{ zIndex: 12, opacity: desktopAudio ? 0 : 1 }} alt="" draggable={false} />
        <img src="./assets/LineInOn.png" className="recorder__layer"
          style={{ zIndex: 12, opacity: desktopAudio ? 1 : 0 }} alt="" draggable={false} />
        <div className="recorder__click-zone recorder__click-zone--linein" style={{ zIndex: 20 }}
          onClick={onToggleDesktopAudio} />

        {/* Hotkey hint */}
        <div className="recorder__hotkey-hint" style={{ zIndex: 15 }}>
          {recording ? "⌘⇧R to stop" : "⌘⇧R to record"}
        </div>
      </div>
    </div>
  );
}
