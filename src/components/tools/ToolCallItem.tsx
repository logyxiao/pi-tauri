import { useState } from "react";
import { Check, ChevronRight, Loader2, ShieldAlert, X } from "lucide-react";
import type { PiToolCall } from "@/shared/pi/types";
import { cn } from "@/shared/lib/cn";
import { ToolResultPanel } from "./ToolResultPanel";

interface ToolCallItemProps {
  tool: PiToolCall;
  onSelect?: (tool: PiToolCall) => void;
}

export function ToolCallItem({ tool, onSelect }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false);
  const icon =
    tool.status === "running" ? (
      <Loader2 className="animate-spin text-primary" size={14} />
    ) : tool.status === "success" ? (
      <Check className="text-success" size={14} />
    ) : (
      <X className="text-danger" size={14} />
    );

  return (
    <div>
      <button
        className="group flex w-full items-center gap-3 rounded-xl border border-border bg-background/60 px-3 py-2 text-left text-xs transition hover:bg-muted/70"
        onClick={() => {
          setExpanded((value) => !value);
          onSelect?.(tool);
        }}
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface">{icon}</span>
        <span className="w-14 shrink-0 font-mono font-semibold text-foreground">{tool.name}</span>
        {tool.safety ? <ShieldAlert size={13} className="shrink-0 text-danger" /> : null}
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{tool.target}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            tool.status === "running" && "bg-primary/10 text-primary",
            tool.status === "success" && "bg-success/10 text-success",
            tool.status === "error" && "bg-danger/10 text-danger",
          )}
        >
          {tool.status === "running" ? "running" : `${tool.durationMs ?? 0}ms`}
        </span>
        <ChevronRight
          className={cn("text-muted-foreground transition group-hover:translate-x-0.5", expanded && "rotate-90")}
          size={14}
        />
      </button>
      {expanded ? (
        <>
          <ToolResultPanel tool={tool} />
          {tool.safety ? (
            <div className="mt-2 rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs leading-5 text-danger">
              {tool.safety.severity}: {tool.safety.reason}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
