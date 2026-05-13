import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, AtSign, BarChart3, Image, X } from "lucide-react";
import { CommandPalette } from "@/components/chat/CommandPalette";
import { ModelSelector } from "@/components/model/ModelSelector";
import { SafetyConfirmDialog } from "@/components/safety/SafetyConfirmDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/shared/i18n";
import { createSafetyEvent, detectDangerousCommand } from "@/shared/pi/safety";
import type { PiCommand, PiModel, PiSafetyEvent, PiSessionStats, PiSettings, PiState } from "@/shared/pi/types";

interface ChatInputProps {
  isRunning: boolean;
  commands: PiCommand[];
  state: PiState | null;
  stats: PiSessionStats | null;
  settings: PiSettings | null;
  models: PiModel[];
  status: string;
  prefillValue?: string;
  disabled?: boolean;
  onSubmit: (message: string) => Promise<void> | void;
  onModelChange: (model: PiModel) => Promise<void> | void;
  onExecuteCommand: (commandName: string, safetyEvent?: PiSafetyEvent) => Promise<void> | void;
  onRecordSafetyEvent: (event: PiSafetyEvent) => Promise<void> | void;
  onConsumePrefill: () => void;
}

export function ChatInput({
  isRunning,
  commands,
  state,
  stats,
  settings,
  models,
  status,
  prefillValue,
  disabled = false,
  onSubmit,
  onModelChange,
  onExecuteCommand,
  onRecordSafetyEvent,
  onConsumePrefill,
}: ChatInputProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingDangerousCommand, setPendingDangerousCommand] = useState<PiCommand | null>(null);
  const [images, setImages] = useState<Array<{ id: string; name: string; dataUrl: string }>>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

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
      return [command.name, command.description, command.source, command.location, command.path].filter(Boolean).join(" ").toLowerCase().includes(search);
    });
  }, [commandQuery, commands]);

  async function submit() {
    const message = buildMessage(inputValue.trim(), images);
    if (!message || isRunning || disabled) return;
    setValue("");
    setImages([]);
    onConsumePrefill();
    await onSubmit(message);
  }

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const next = await Promise.all(Array.from(files).filter((file) => file.type.startsWith("image/")).map(readImageFile));
    setImages((current) => [...current, ...next].slice(0, 8));
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
    <div className="relative z-10">
      {commandQuery != null ? (
        <div className="absolute bottom-full left-0 right-0 z-20 mb-3 max-h-[min(20rem,45vh)] overflow-hidden">
          <CommandPalette commands={commands} query={commandQuery} selectedIndex={selectedIndex} onSelect={applyCommand} />
        </div>
      ) : null}

      <div className="rounded-none border border-border bg-surface/90 p-2.5 shadow-[0_12px_42px_rgb(44_54_70/0.10)] backdrop-blur-[2px] transition focus-within:border-primary/45 focus-within:bg-surface/95">
        {images.length ? (
          <div className="mb-2 flex flex-wrap gap-2 border-b border-border/70 pb-2">
            {images.map((image) => (
              <div key={image.id} className="group relative border border-border bg-background/70 p-1">
                <img src={image.dataUrl} alt={image.name} className="size-14 object-cover" />
                <button
                  type="button"
                  className="absolute -right-1 -top-1 inline-flex size-5 cursor-pointer items-center justify-center bg-surface text-muted-foreground opacity-0 shadow-sm transition hover:text-danger group-hover:opacity-100"
                  aria-label={t("chat.removeImage")}
                  onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
                >
                  <X size={12} />
                </button>
                <div className="mt-1 max-w-14 truncate text-[9px] text-muted-foreground" title={image.name}>{image.name}</div>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          className="max-h-36 min-h-20 w-full resize-none bg-transparent px-2.5 py-2 font-mono text-[13px] leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          placeholder={disabled ? t("chat.connecting") : t("chat.placeholder")}
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
        <div className="flex flex-col gap-2 border-t border-border/70 pt-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <IconHint label={t("chat.file")} disabled={disabled}>
              <AtSign size={14} />
            </IconHint>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void addImages(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <IconHint label={t("chat.image")} disabled={disabled} onClick={() => imageInputRef.current?.click()}>
              <Image size={14} />
            </IconHint>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <ModelSelector state={state} models={models} compact onModelChange={onModelChange} />
            <StatsTooltip state={state} stats={stats} settings={settings} status={status} />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center text-primary transition hover:text-primary/80 disabled:cursor-not-allowed disabled:text-muted-foreground/45"
                  aria-label={t("chat.send")}
                  disabled={(!inputValue.trim() && !images.length) || isRunning || disabled}
                  onClick={() => void submit()}
                >
                  <ArrowUp size={17} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("chat.send")}</TooltipContent>
            </Tooltip>
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


function IconHint({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-8 cursor-pointer items-center justify-center text-muted-foreground transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled}
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function buildMessage(text: string, images: Array<{ name: string; dataUrl: string }>) {
  if (!images.length) return text;
  const imageText = images.map((image) => `[${image.name}](${image.dataUrl})`).join("\n");
  return [text, imageText].filter(Boolean).join("\n\n");
}

function readImageFile(file: File): Promise<{ id: string; name: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, dataUrl: String(reader.result ?? "") });
    reader.onerror = () => reject(reader.error ?? new Error("failed to read image"));
    reader.readAsDataURL(file);
  });
}

function StatsTooltip({ state, stats, settings, status }: { state: PiState | null; stats: PiSessionStats | null; settings: PiSettings | null; status: string }) {
  const { t } = useI18n();
  const rows = [
    [t("composerStats.run"), state?.runState ?? status],
    [t("composerStats.context"), stats?.contextPercent == null ? "n/a" : `${stats.contextPercent.toFixed(1)}%`],
    [t("composerStats.tokens"), (stats?.totalTokens ?? state?.tokenCount ?? 0).toLocaleString()],
    [t("composerStats.cost"), `$${(stats?.costUsd ?? state?.costUsd ?? 0).toFixed(4)}`],
    [t("composerStats.model"), settings?.model ?? state?.model ?? t("common.unknown")],
    [t("composerStats.thinking"), settings?.thinkingLevel ?? state?.thinkingLevel ?? "off"],
  ];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center text-muted-foreground transition hover:text-primary"
          aria-label={t("composerStats.label")}
        >
          <BarChart3 size={15} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="w-64 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("composerStats.label")}</div>
        <div className="space-y-1.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="min-w-0 truncate font-mono text-foreground" title={value}>{value}</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
