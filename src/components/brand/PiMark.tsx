interface PiMarkProps {
  className?: string;
}

export function PiMark({ className = "size-6" }: PiMarkProps) {
  return <img className={className} src="/pi.svg" alt="π" draggable={false} />;
}
