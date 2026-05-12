import { useMemo, useState } from "react";
import { ArrowUp, AtSign, Image, ShieldAlert, Square } from "lucide-react";
import { CommandPalette } from "@/components/chat/CommandPalette";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { PiCommand } from "@/shared/pi/types";

interface ChatInputProps {
  isRunning: boolean;
  commands: PiCommand[];
  prefillValue?: string;
  onSubmit: (message: string) => Promise<void> | void;
  onAbort: () => Promise<void> | void;
  onExecuteCommand: (commandName: string) => Promise<void> | void;
  onConsumePrefill: () => void;
}

export function ChatInput({
  isRunning,
  commands,
  prefillValue,
  onSubmit,
  onAbort,
  onExecuteCommand,
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
    if (!message || isRunning) return;
    setValue("");
    onConsumePrefill();
    await onSubmit(message);
  }

  async function runCommand(command: PiCommand) {
    if (command.dangerous) {
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
    <>
      {commandQuery != null ? (
        <CommandPalette commands={commands} query={commandQuery} selectedIndex={selectedIndex} onSelect={applyCommand} />
      ) : null}

      <div className="rounded-md border border-border bg-surface/80 p-3 shadow-[inset_2px_0_0_var(--primary),0_8px_28px_rgb(44_54_70/0.08)] backdrop-blur-[1px]">
        <textarea
          className="max-h-36 min-h-20 w-full resize-none bg-transparent px-2 py-1 font-mono text-sm leading-6 outline-none placeholder:text-muted-foreground"
          placeholder="Ask pi to inspect, edit, test, or explain this project... use /commands for extensions, skills, prompts."
          value={inputValue}
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
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost">
              <AtSign size={15} /> File
            </Button>
            <Button size="sm" variant="ghost">
              <Image size={15} /> Image
            </Button>
            <div className="ml-2 border border-border bg-muted/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">/ opens pi commands</div>
            <div className="border border-border bg-muted/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Shift+Enter newline</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={!isRunning} onClick={() => void onAbort()}>
              <Square size={13} /> Abort
            </Button>
            <Button
              size="icon"
              variant="primary"
              aria-label="Send prompt"
              disabled={!inputValue.trim() || isRunning}
              onClick={() => void submit()}
            >
              <ArrowUp size={17} />
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(pendingDangerousCommand)} onOpenChange={(open) => !open && setPendingDangerousCommand(null)}>
        <DialogContent
          title="Confirm dangerous command"
          description="Dangerous extension/prompt command must be confirmed first. Command stays visible before execution."
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-danger/20 bg-danger/5 p-3 text-sm text-muted-foreground">
              <div className="mb-2 flex items-center gap-2 font-semibold text-danger">
                <ShieldAlert size={16} /> /{pendingDangerousCommand?.name}
              </div>
              <div>{pendingDangerousCommand?.description ?? "This command may trigger shell reset, delete, or batch behavior."}</div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingDangerousCommand(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const command = pendingDangerousCommand;
                  setPendingDangerousCommand(null);
                  if (!command) return;
                  void onExecuteCommand(command.name);
                  setValue("");
                }}
              >
                <ShieldAlert size={14} /> Confirm execute
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
