import { cn } from "@/shared/lib/cn";

interface GlobalLoadingOverlayProps {
  open: boolean;
  title: string;
  description?: string;
  className?: string;
}

export function PiLogo() {
  return (
    <svg className="size-24" viewBox="0 0 96 96" role="img" aria-label="π logo">
      <defs>
        <linearGradient id="pi-logo-gradient" x1="18" y1="16" x2="78" y2="82" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.52" />
        </linearGradient>
      </defs>
      <rect x="14" y="14" width="68" height="68" fill="none" stroke="currentColor" strokeWidth="1" className="text-border" />
      <path d="M25 34H71" stroke="url(#pi-logo-gradient)" strokeWidth="7" strokeLinecap="square" />
      <path d="M38 34V67" stroke="url(#pi-logo-gradient)" strokeWidth="7" strokeLinecap="square" />
      <path d="M59 34V67" stroke="url(#pi-logo-gradient)" strokeWidth="7" strokeLinecap="square" />
      <path d="M31 68H45" stroke="currentColor" strokeWidth="3" className="text-primary/55" />
      <path d="M52 68H66" stroke="currentColor" strokeWidth="3" className="text-primary/55" />
      <circle cx="48" cy="48" r="41" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="18 12" className="animate-spin text-primary/70 [animation-duration:2.8s]" />
      <circle cx="48" cy="9" r="3" className="fill-primary">
        <animate attributeName="opacity" values="0.35;1;0.35" dur="1.4s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

export function GlobalLoadingOverlay({ open, title, description, className }: GlobalLoadingOverlayProps) {
  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex cursor-wait items-center justify-center bg-background/72 p-6 backdrop-blur-md",
        className,
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="relative w-full max-w-sm overflow-hidden border border-border bg-surface/95 p-6 text-center shadow-[0_28px_90px_rgb(44_54_70/0.18)]">
        <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(to_right,var(--grid-minor)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-minor)_1px,transparent_1px)] [background-size:18px_18px]" />
        <div className="relative mx-auto mb-5 flex size-24 items-center justify-center">
          <PiLogo />
        </div>
        <div className="relative">
          <div className="font-serif text-2xl font-semibold italic tracking-tight text-primary">π</div>
          <h2 className="mt-2 text-sm font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p> : null}
          <div className="mt-5 flex items-center justify-center gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((item) => (
              <span
                key={item}
                className="size-1.5 bg-primary/75 [animation:bounce_1.1s_infinite]"
                style={{ animationDelay: `${item * 130}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
