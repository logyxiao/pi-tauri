import { ShieldAlert } from "lucide-react";
import { defaultSafetyPolicy } from "@/shared/pi/safety";
import type { PiSafetyEvent } from "@/shared/pi/types";

interface SafetyPanelProps {
  events: PiSafetyEvent[];
}

export function SafetyPanel({ events }: SafetyPanelProps) {
  return (
    <section className="rounded-2xl border border-danger/20 bg-danger/5 p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-danger">
        <ShieldAlert size={14} /> Safety
      </div>
      <div className="space-y-2 text-xs text-muted-foreground">
        <PolicyLine enabled label="Dangerous slash commands require confirmation" />
        <PolicyLine enabled label="Destructive file changes are flagged" />
        <PolicyLine enabled label="Sensitive paths require review" />
        <div className="rounded-xl border border-danger/15 bg-surface p-3 leading-5">
          {defaultSafetyPolicy.rpcToolLimitation}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {events.length ? (
          events.slice(0, 5).map((event) => (
            <div key={event.id} className="rounded-xl border border-border bg-surface p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-foreground">{event.action.kind}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{event.decision}</span>
              </div>
              <div className="truncate font-mono text-xs text-muted-foreground">{event.action.target}</div>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">{event.action.reason}</div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{event.source}</span>
                <span>{event.createdAt}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-xl bg-surface p-3 text-xs text-muted-foreground">No safety events yet.</div>
        )}
      </div>
    </section>
  );
}

function PolicyLine({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-surface p-2">
      <span>{label}</span>
      <span className={enabled ? "font-mono text-[11px] text-success" : "font-mono text-[11px] text-muted-foreground"}>
        {enabled ? "on" : "off"}
      </span>
    </div>
  );
}
