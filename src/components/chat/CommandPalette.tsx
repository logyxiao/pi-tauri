import { ShieldAlert } from "lucide-react";
import type { PiCommand } from "@/shared/pi/types";
import { cn } from "@/shared/lib/cn";

interface CommandPaletteProps {
  commands: PiCommand[];
  query: string;
  selectedIndex: number;
  onSelect: (command: PiCommand) => void;
}

export function CommandPalette({ commands, query, selectedIndex, onSelect }: CommandPaletteProps) {
  const search = query.toLowerCase();
  const filtered = commands.filter((command) => {
    if (!search) return true;
    return command.name.toLowerCase().includes(search) || command.description?.toLowerCase().includes(search);
  });

  if (!filtered.length) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-md border border-border bg-surface/90 shadow-xl backdrop-blur-[1px]">
      <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        pi commands
      </div>
      <div className="max-h-64 overflow-auto p-1.5">
        {filtered.map((command, index) => (
          <button
            key={command.name}
            className={cn(
              "flex w-full items-start gap-3 rounded-sm px-3 py-2 text-left font-mono text-xs transition hover:bg-muted",
              index === selectedIndex && "bg-muted",
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(command);
            }}
          >
            <div className="w-24 shrink-0 font-mono font-semibold text-foreground">/{command.name}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-muted-foreground">{command.description ?? "No description"}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="border border-border bg-surface/70 px-2 py-0.5">{command.source}</span>
                {command.dangerous ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-danger">
                    <ShieldAlert size={11} /> confirm
                  </span>
                ) : null}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
