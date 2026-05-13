interface PiMarkProps {
  className?: string;
}

export function PiMark({ className = "size-6" }: PiMarkProps) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="π">
      <rect x="7" y="7" width="50" height="50" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-border" />
      <path d="M15 22H49" stroke="currentColor" strokeWidth="6" strokeLinecap="square" className="text-primary" />
      <path d="M24 22V48" stroke="currentColor" strokeWidth="6" strokeLinecap="square" className="text-primary" />
      <path d="M40 22V48" stroke="currentColor" strokeWidth="6" strokeLinecap="square" className="text-primary" />
      <path d="M18 50H29" stroke="currentColor" strokeWidth="2.5" className="text-primary/55" />
      <path d="M35 50H46" stroke="currentColor" strokeWidth="2.5" className="text-primary/55" />
    </svg>
  );
}
