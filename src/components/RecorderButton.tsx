/** Reusable recorder button with off/mid/on glow states */
interface RecorderButtonProps {
  active: boolean;
  offSrc: string;
  midSrc: string;
  onSrc: string;
  glow: number;
  /** Secondary active state (e.g., generating for play button) */
  secondaryActive?: boolean;
  secondaryMidSrc?: string;
  secondaryOnSrc?: string;
}

export function RecorderButton({
  active,
  offSrc,
  midSrc,
  onSrc,
  glow,
  secondaryActive,
  secondaryMidSrc,
  secondaryOnSrc,
}: RecorderButtonProps) {
  if (secondaryActive && secondaryMidSrc && secondaryOnSrc) {
    return (
      <>
        <img src={secondaryMidSrc} className="recorder__layer" style={{ zIndex: 13 }} alt="" draggable={false} />
        <img src={secondaryOnSrc} className="recorder__layer" style={{ zIndex: 14, opacity: glow }} alt="" draggable={false} />
      </>
    );
  }

  if (active) {
    return (
      <>
        <img src={midSrc} className="recorder__layer" style={{ zIndex: 13 }} alt="" draggable={false} />
        <img src={onSrc} className="recorder__layer" style={{ zIndex: 14, opacity: glow }} alt="" draggable={false} />
      </>
    );
  }

  return <img src={offSrc} className="recorder__layer" style={{ zIndex: 13 }} alt="" draggable={false} />;
}
