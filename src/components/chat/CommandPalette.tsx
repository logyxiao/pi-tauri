import { ShieldAlert } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { useI18n } from "@/shared/i18n";
import type { PiCommand } from "@/shared/pi/types";

interface CommandPaletteProps {
  commands: PiCommand[];
  query: string;
  selectedIndex: number;
  onSelect: (command: PiCommand) => void;
}

export function CommandPalette({ commands, query, selectedIndex, onSelect }: CommandPaletteProps) {
  const { t } = useI18n();
  const search = query.toLowerCase();
  const filtered = commands.filter((command) => {
    if (!search) return true;
    return command.name.toLowerCase().includes(search) || command.description?.toLowerCase().includes(search);
  });

  if (!filtered.length) return null;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface/95 shadow-xl backdrop-blur-[2px]">
      <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {t("command.title")}
      </div>
      <div className="max-h-[min(18rem,42vh)] overflow-auto overscroll-contain p-1.5">
        {filtered.map((command, index) => (
          <button
            key={command.name}
            className={cn(
              "flex w-full min-w-0 items-start gap-3 rounded-sm px-3 py-2 text-left font-mono text-xs transition hover:bg-muted",
              index === selectedIndex && "bg-muted",
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(command);
            }}
          >
            <div className="w-20 shrink-0 truncate font-mono font-semibold text-foreground sm:w-24">/{command.name}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-muted-foreground">{command.description ?? t("command.noDescription")}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="border border-border bg-surface/70 px-2 py-0.5">{command.source}</span>
                {command.dangerous || command.safety ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-danger">
                    <ShieldAlert size={11} /> {t("command.confirm")}
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
