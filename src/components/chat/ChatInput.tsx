import { useMemo, useState } from "react";
import { ArrowUp, AtSign, Image, Square } from "lucide-react";
import { CommandPalette } from "@/components/chat/CommandPalette";
import { SafetyConfirmDialog } from "@/components/safety/SafetyConfirmDialog";
import { Button } from "@/components/ui/button";
import { createSafetyEvent, detectDangerousCommand } from "@/shared/pi/safety";
import type { PiCommand, PiSafetyEvent } from "@/shared/pi/types";

interface ChatInputProps {
  isRunning: boolean;
  commands: PiCommand[];
  prefillValue?: string;
  disabled?: boolean;
  onSubmit: (message: string) => Promise<void> | void;
  onAbort: () => Promise<void> | void;
  onExecuteCommand: (commandName: string, safetyEvent?: PiSafetyEvent) => Promise<void> | void;
  onRecordSafetyEvent: (event: PiSafetyEvent) => Promise<void> | void;
  onConsumePrefill: () => void;
}

export function ChatInput({
  isRunning,
  commands,
  prefillValue,
  disabled = false,
  onSubmit,
  onAbort,
  onExecuteCommand,
  onRecordSafetyEvent,
  onConsumePrefill,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingDangerousCommand, setPendingDangerousCommand] = useState<PiCommand | null>(null);

  const inputValue = prefillValue || value;

  const commandQuery = useMemo(() => {
    if (!inputValue.startsWith("/")) return null;
    return inputValue.slice(1).trimStart();
  }, [inputValue]);

  const filteredCommands = useMemo(() => {
    if (commandQuery == null) return [];
    const search = commandQuery.toLowerCase();
    return commands.filter((command) => {
      if (!search) return true;
      return command.name.toLowerCase().includes(search) || command.description?.toLowerCase().includes(search);
    });
  }, [commandQuery, commands]);

  async function submit() {
    const message = inputValue.trim();
    if (!message || isRunning || disabled) return;
    setValue("");
    onConsumePrefill();
    await onSubmit(message);
  }

  async function runCommand(command: PiCommand) {
    if (disabled) return;
    if (command.dangerous || command.safety) {
      setPendingDangerousCommand(command);
      return;
    }

    setValue(`/${command.name}`);
    await onExecuteCommand(command.name);
    setValue("");
  }

  function applyCommand(command: PiCommand) {
    void runCommand(command);
  }

  return (
    <div className="relative">
      {commandQuery != null ? (
        <div className="absolute bottom-full left-0 right-0 z-20 mb-3 max-h-[min(20rem,45vh)] overflow-hidden">
          <CommandPalette commands={commands} query={commandQuery} selectedIndex={selectedIndex} onSelect={applyCommand} />
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-surface/80 p-3 shadow-[inset_2px_0_0_var(--primary),0_8px_28px_rgb(44_54_70/0.08)] backdrop-blur-[1px]">
        <textarea
          className="max-h-36 min-h-20 w-full resize-none bg-transparent px-2 py-1 font-mono text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          placeholder={disabled ? "Connecting to pi runtime..." : "Ask pi to inspect, edit, test, or explain this project... use /commands for extensions, skills, prompts."}
          value={inputValue}
          disabled={disabled}
          onChange={(event) => {
            onConsumePrefill();
            setSelectedIndex(0);
            setValue(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (commandQuery != null && filteredCommands.length) {
              const activeIndex = selectedIndex % filteredCommands.length;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((current) => (current + 1) % filteredCommands.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((current) => (current - 1 + filteredCommands.length) % filteredCommands.length);
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                const selected = filteredCommands[activeIndex] ?? filteredCommands[0];
                if (selected) setValue(`/${selected.name}`);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                const selected = filteredCommands[activeIndex];
                if (selected) {
                  event.preventDefault();
                  applyCommand(selected);
                  return;
                }
              }
            }

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" disabled={disabled}>
              <AtSign size={15} /> File
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled}>
              <Image size={15} /> Image
            </Button>
            <div className="border border-border bg-muted/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground sm:ml-2">/ opens pi commands</div>
            <div className="border border-border bg-muted/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Shift+Enter newline</div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="secondary" disabled={!isRunning} onClick={() => void onAbort()}>
              <Square size={13} /> Abort
            </Button>
            <Button
              size="icon"
              variant="primary"
              aria-label="Send prompt"
              disabled={!inputValue.trim() || isRunning || disabled}
              onClick={() => void submit()}
            >
              <ArrowUp size={17} />
            </Button>
          </div>
        </div>
      </div>

      <SafetyConfirmDialog
        open={Boolean(pendingDangerousCommand)}
        action={pendingDangerousCommand?.safety ?? (pendingDangerousCommand ? detectDangerousCommand(pendingDangerousCommand) : null)}
        onOpenChange={(open) => {
          if (!open && pendingDangerousCommand) {
            const action = pendingDangerousCommand.safety ?? detectDangerousCommand(pendingDangerousCommand);
            if (action) void onRecordSafetyEvent(createSafetyEvent(action, "blocked", "command"));
            setPendingDangerousCommand(null);
          }
        }}
        onCancel={() => {
          if (pendingDangerousCommand) {
            const action = pendingDangerousCommand.safety ?? detectDangerousCommand(pendingDangerousCommand);
            if (action) void onRecordSafetyEvent(createSafetyEvent(action, "blocked", "command"));
          }
          setPendingDangerousCommand(null);
        }}
        onConfirm={() => {
          const command = pendingDangerousCommand;
          setPendingDangerousCommand(null);
          if (!command) return;
          const action = command.safety ?? detectDangerousCommand(command);
          const event = action ? createSafetyEvent(action, "allowed", "command") : undefined;
          void onExecuteCommand(command.name, event);
          setValue("");
        }}
      />
    </div>
  );
}
