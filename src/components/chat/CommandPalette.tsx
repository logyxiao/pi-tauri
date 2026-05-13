import { memo } from "react";
import { Box, FileText, Package, ShieldAlert, Sparkles, TerminalSquare } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { useI18n } from "@/shared/i18n";
import type { PiCommand } from "@/shared/pi/types";

interface CommandPaletteProps {
  commands: PiCommand[];
  selectedIndex: number;
  onSelect: (command: PiCommand) => void;
}

export const CommandPalette = memo(function CommandPalette({ commands, selectedIndex, onSelect }: CommandPaletteProps) {
  const { t } = useI18n();
  const groups = groupCommands(commands);

  if (!commands.length) return null;

  return (
    <div className="overflow-hidden rounded-none border border-border bg-popover/98 shadow-xl shadow-black/10 backdrop-blur-[2px]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("command.title")}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{commands.length}</div>
      </div>
      <div className="max-h-[min(20rem,48vh)] overflow-auto overscroll-contain p-1.5">
        {groups.map((group) => (
          <div key={group.source}>
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {sourceIcon(group.source)} {sourceLabel(group.source, t)}
            </div>
            {group.commands.map(({ command, globalIndex }) => (
              <button
                key={`${command.source}:${command.name}:${command.path ?? ""}`}
                className={cn(
                  "flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-none px-3 py-2 text-left text-xs transition hover:bg-muted/80",
                  globalIndex === selectedIndex && "bg-muted/80",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(command);
                }}
              >
                <div className="mt-0.5 w-5 shrink-0 text-muted-foreground">{sourceIcon(command.source)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-mono font-semibold text-foreground">/{command.name}</span>
                    {command.location ? <span className="shrink-0 border border-border bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">{command.location}</span> : null}
                    {command.dangerous || command.safety ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-none bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger">
                        <ShieldAlert size={10} /> {t("command.confirm")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-muted-foreground">{command.description ?? t("command.noDescription")}</div>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

function groupCommands(commands: PiCommand[]) {
  const grouped = new Map<PiCommand["source"], Array<{ command: PiCommand; globalIndex: number }>>();
  commands.forEach((command, globalIndex) => {
    grouped.set(command.source, [...(grouped.get(command.source) ?? []), { command, globalIndex }]);
  });
  const order: PiCommand["source"][] = ["builtin", "prompt", "skill", "extension"];
  return Array.from(grouped.entries())
    .sort(([left], [right]) => order.indexOf(left) - order.indexOf(right))
    .map(([source, groupedCommands]) => ({ source, commands: groupedCommands }));
}

function sourceLabel(source: PiCommand["source"], t: (key: string) => string) {
  return t(`command.source.${source}`);
}

function sourceIcon(source: PiCommand["source"]) {
  if (source === "builtin") return <TerminalSquare size={12} />;
  if (source === "prompt") return <FileText size={12} />;
  if (source === "skill") return <Sparkles size={12} />;
  if (source === "extension") return <Package size={12} />;
  return <Box size={12} />;
}
