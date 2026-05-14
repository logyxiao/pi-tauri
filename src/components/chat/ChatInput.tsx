import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUp, AtSign, Check, Gauge, Image, Loader2, Pause, RefreshCw, Sparkles, X } from "lucide-react";
import { CommandPalette } from "@/components/chat/CommandPalette";
import { ComposerExtensionShelf } from "@/components/extensions/ComposerExtensionShelf";
import { ModelSelector } from "@/components/model/ModelSelector";
import { SafetyConfirmDialog } from "@/components/safety/SafetyConfirmDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/shared/i18n";
import { createSafetyEvent, detectDangerousCommand } from "@/shared/pi/safety";
import type { PiCommand, PiExtensionPanel, PiExtensionStatus, PiModel, PiSafetyEvent, PiSessionStats, PiSettings, PiState } from "@/shared/pi/types";

interface ChatInputProps {
  isRunning: boolean;
  commands: PiCommand[];
  extensionPanels: PiExtensionPanel[];
  extensionStatuses: PiExtensionStatus[];
  state: PiState | null;
  stats: PiSessionStats | null;
  settings: PiSettings | null;
  models: PiModel[];
  status: string;
  prefillValue?: string;
  disabled?: boolean;
  onSubmit: (message: string) => Promise<void> | void;
  onAbort: () => Promise<void> | void;
  onSteer: (message: string) => Promise<void> | void;
  onFollowUp: (message: string) => Promise<void> | void;
  onModelChange: (model: PiModel) => Promise<void> | void;
  onExecuteCommand: (commandName: string, safetyEvent?: PiSafetyEvent) => Promise<void> | void;
  onRecordSafetyEvent: (event: PiSafetyEvent) => Promise<void> | void;
  onConsumePrefill: () => void;
}

function ChatInputComponent({
  isRunning,
  commands,
  extensionPanels,
  extensionStatuses,
  state,
  stats,
  settings,
  models,
  status,
  prefillValue,
  disabled = false,
  onSubmit,
  onAbort,
  onFollowUp,
  onModelChange,
  onExecuteCommand,
  onRecordSafetyEvent,
  onConsumePrefill,
}: ChatInputProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef("");
  const canSubmitRef = useRef(false);
  const commandQueryRef = useRef<string | null>(null);
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const deferredCommandQuery = useDeferredValue(commandQuery);
  const [canSubmit, setCanSubmit] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingDangerousCommand, setPendingDangerousCommand] = useState<PiCommand | null>(null);
  const [images, setImages] = useState<Array<{ id: string; name: string; dataUrl: string }>>([]);
  const [optimizeBusy, setOptimizeBusy] = useState(false);
  const [optimizeOptions, setOptimizeOptions] = useState<string[]>([]);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!prefillValue) return;
    if (draftRef.current.trim()) {
      onConsumePrefill();
      return;
    }
    setDraftValue(prefillValue);
    onConsumePrefill();
  }, [onConsumePrefill, prefillValue]);

  useEffect(() => {
    if (!isRunning || disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void onAbort();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, isRunning, onAbort]);

  const filteredCommands = useMemo(() => {
    if (deferredCommandQuery == null) return [];
    const search = deferredCommandQuery.toLowerCase();
    const exact = commands.find((command) => command.name.toLowerCase() === search);
    const matches = commands.filter((command) => {
      if (!search) return true;
      return [command.name, command.description, command.source, command.location, command.path].filter(Boolean).join(" ").toLowerCase().includes(search);
    });
    const ordered = exact ? [exact, ...matches.filter((command) => command !== exact)] : matches;
    return ordered.slice(0, 80);
  }, [deferredCommandQuery, commands]);

  function setDraftValue(next: string) {
    draftRef.current = next;
    if (textareaRef.current && textareaRef.current.value !== next) textareaRef.current.value = next;
    const nextCanSubmit = Boolean(next.trim());
    if (canSubmitRef.current !== nextCanSubmit) {
      canSubmitRef.current = nextCanSubmit;
      setCanSubmit(nextCanSubmit);
    }
    const nextCommandQuery = next.startsWith("/") ? next.slice(1).trimStart() : null;
    if (commandQueryRef.current !== nextCommandQuery) {
      commandQueryRef.current = nextCommandQuery;
      setCommandQuery(nextCommandQuery);
    }
  }

  async function submit() {
    const text = draftRef.current.trim();
    const command = findExactSlashCommand(text, commands);
    if (command) {
      await runCommand(command);
      return;
    }
    const message = buildMessage(text, images);
    if (!message || isRunning || disabled) return;
    clearInput();
    await onSubmit(message);
  }

  async function submitAltEnter() {
    const message = buildMessage(draftRef.current.trim(), images);
    if (!message || disabled) return;
    clearInput();
    await onFollowUp(message);
  }

  async function abortRunning() {
    if (!isRunning || disabled) return;
    await onAbort();
  }

  async function optimizeDraft() {
    const input = draftRef.current.trim();
    if (!input || isRunning || disabled || optimizeBusy) return;
    setOptimizeBusy(true);
    setOptimizeError(null);
    setOptimizeOptions([]);
    try {
      const options = await invoke<string[]>("pi_optimize_prompt_keywords", {
        input,
        model: settings?.model ?? state?.model ?? null,
        provider: settings?.provider ?? null,
        thinkingLevel: settings?.thinkingLevel ?? state?.thinkingLevel ?? null,
      });
      setOptimizeOptions(options.filter(Boolean).slice(0, 3));
    } catch (caught) {
      setOptimizeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setOptimizeBusy(false);
    }
  }

  function applyOptimizedOption(option: string) {
    setDraftValue(option);
    setOptimizeOptions([]);
    setOptimizeError(null);
    textareaRef.current?.focus();
  }

  function clearInput() {
    setDraftValue("");
    setSelectedIndex(0);
    setImages([]);
    setOptimizeOptions([]);
    setOptimizeError(null);
  }

  async function addImages(files: FileList | File[] | null) {
    if (!files?.length) return;
    const next = await Promise.all(Array.from(files).filter((file) => file.type.startsWith("image/")).map(readImageFile));
    if (!next.length) return;
    setImages((current) => [...current, ...next].slice(0, 8));
  }

  function pasteImages(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    event.preventDefault();
    void addImages(imageFiles);
  }

  async function runCommand(command: PiCommand) {
    if (disabled) return;
    if (command.dangerous || command.safety) {
      setPendingDangerousCommand(command);
      return;
    }

    clearInput();
    await onExecuteCommand(command.name);
  }

  function applyCommand(command: PiCommand) {
    void runCommand(command);
  }

  return (
    <div className="relative z-50">
      {commandQuery != null ? (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-3 max-h-[min(20rem,45vh)] overflow-hidden">
          <CommandPalette commands={filteredCommands} selectedIndex={selectedIndex} onSelect={applyCommand} />
        </div>
      ) : null}

      <ComposerExtensionShelf extensionPanels={extensionPanels} placement="aboveEditor" />

      {optimizeOptions.length || optimizeError ? (
        <PromptOptimizePanel options={optimizeOptions} error={optimizeError} onSelect={applyOptimizedOption} onClose={() => { setOptimizeOptions([]); setOptimizeError(null); }} />
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
          ref={textareaRef}
          defaultValue=""
          disabled={disabled}
          onChange={(event) => {
            if (selectedIndex !== 0) setSelectedIndex(0);
            setDraftValue(event.currentTarget.value);
          }}
          onPaste={pasteImages}
          onKeyDown={(event) => {
            if (event.key === "Escape" && isRunning) {
              event.preventDefault();
              event.stopPropagation();
              void abortRunning();
              return;
            }

            if ((event.altKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void submitAltEnter();
              return;
            }

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
                if (selected) setDraftValue(`/${selected.name}`);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                const exact = findExactSlashCommand(draftRef.current.trim(), commands);
                const selected = exact ?? filteredCommands[activeIndex];
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
            <ExtensionStatusLine statuses={extensionStatuses} />
            <StatsTooltip state={state} stats={stats} settings={settings} status={status} models={models} />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex size-8 cursor-pointer items-center justify-center text-muted-foreground transition hover:text-primary disabled:cursor-not-allowed disabled:text-muted-foreground/45"
                  aria-label={t("chat.optimizePrompt")}
                  disabled={disabled || isRunning || optimizeBusy || !canSubmit}
                  onClick={() => void optimizeDraft()}
                >
                  {optimizeBusy ? <Loader2 size={15} className="animate-spin text-primary" /> : <Sparkles size={15} />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("chat.optimizePrompt")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex size-8 cursor-pointer items-center justify-center text-primary transition hover:text-primary/80 disabled:cursor-not-allowed disabled:text-muted-foreground/45"
                  aria-label={isRunning ? t("chat.pause") : t("chat.send")}
                  disabled={disabled || (!isRunning && !canSubmit && !images.length)}
                  onClick={() => isRunning ? void abortRunning() : void submit()}
                >
                  {isRunning ? <Pause size={16} className="fill-current" /> : <ArrowUp size={17} />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{isRunning ? t("chat.pauseHint") : t("chat.send")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <ComposerExtensionShelf extensionPanels={extensionPanels} placement="belowEditor" />

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
          clearInput();
          void onExecuteCommand(command.name, event);
        }}
      />
    </div>
  );
}

export const ChatInput = memo(ChatInputComponent, areChatInputPropsEqual);

function PromptOptimizePanel({ options, error, onSelect, onClose }: { options: string[]; error: string | null; onSelect: (option: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="absolute bottom-full right-0 z-50 mb-3 w-full max-w-2xl border border-border bg-popover/95 p-2 shadow-2xl backdrop-blur-[2px]">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-border/70 pb-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <span className="inline-flex size-6 items-center justify-center bg-primary/10 text-primary"><Sparkles size={13} /></span>
          {t("chat.optimizePromptOptions")}
        </div>
        <button type="button" className="inline-flex size-6 cursor-pointer items-center justify-center text-muted-foreground transition hover:text-foreground" onClick={onClose} aria-label={t("common.cancel")}>
          <X size={13} />
        </button>
      </div>
      {error ? <div className="border border-danger/20 bg-danger/5 px-3 py-2 text-xs leading-5 text-danger">{error}</div> : null}
      {options.length ? (
        <div className="grid gap-1.5">
          {options.map((option, index) => (
            <button
              type="button"
              key={`${index}-${option}`}
              className="group flex cursor-pointer items-start gap-2 border border-border/70 bg-background/70 px-3 py-2 text-left transition hover:border-primary/40 hover:bg-primary/5"
              onClick={() => onSelect(option)}
            >
              <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center bg-surface font-mono text-[10px] text-primary">{index + 1}</span>
              <span className="min-w-0 flex-1 text-xs leading-5 text-foreground">{option}</span>
              <Check size={13} className="mt-1 shrink-0 text-muted-foreground opacity-0 transition group-hover:text-primary group-hover:opacity-100" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function areChatInputPropsEqual(previous: ChatInputProps, next: ChatInputProps) {
  return (
    previous.isRunning === next.isRunning &&
    previous.disabled === next.disabled &&
    previous.prefillValue === next.prefillValue &&
    previous.commands === next.commands &&
    previous.extensionPanels === next.extensionPanels &&
    previous.extensionStatuses === next.extensionStatuses &&
    previous.models === next.models &&
    previous.settings === next.settings &&
    previous.onSubmit === next.onSubmit &&
    previous.onAbort === next.onAbort &&
    previous.onSteer === next.onSteer &&
    previous.onFollowUp === next.onFollowUp &&
    previous.onModelChange === next.onModelChange &&
    previous.onExecuteCommand === next.onExecuteCommand &&
    previous.onRecordSafetyEvent === next.onRecordSafetyEvent &&
    previous.onConsumePrefill === next.onConsumePrefill
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

const BUILTIN_COMMAND_NAMES = new Set(["compact", "cycle-model", "cycle-thinking", "abort-retry", "abort-bash", "export-html", "help", "models", "sessions", "extensions"]);

interface ProviderProbeResult {
  balance?: string;
  balanceSource?: string;
}

interface ProviderBalanceSnapshot {
  balance: string;
  source?: string;
  checkedAt: string;
}

const PROVIDER_BALANCE_STORAGE_KEY = "pi-tauri.providerBalances";

function findExactSlashCommand(text: string, commands: PiCommand[]): PiCommand | null {
  const match = text.match(/^\/([\w.-]+)$/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const command = commands.find((item) => item.name.toLowerCase() === name);
  if (command) return command;
  if (BUILTIN_COMMAND_NAMES.has(name)) return { name, source: "builtin", description: `/${name}` };
  return null;
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

function ExtensionStatusLine({ statuses }: { statuses: PiExtensionStatus[] }) {
  if (!statuses.length) return null;
  return (
    <div className="hidden max-w-48 items-center gap-1 overflow-hidden sm:flex">
      {statuses.slice(0, 3).map((status) => (
        <span key={status.key} className="truncate border border-border/70 bg-background/70 px-1.5 py-1 font-mono text-[10px] leading-none text-muted-foreground" title={`${status.key}: ${status.text}`}>
          {status.text}
        </span>
      ))}
    </div>
  );
}

const StatsTooltip = memo(function StatsTooltip({ state, stats, settings, status, models }: { state: PiState | null; stats: PiSessionStats | null; settings: PiSettings | null; status: string; models: PiModel[] }) {
  const { t } = useI18n();
  const [balance, setBalance] = useState<{ value: string; checkedAt: string } | null>(null);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const providerId = providerFromModelKey(state?.model) ?? settings?.provider;
  const providerBaseUrl = models.find((model) => model.provider === providerId)?.baseUrl;
  const balanceKey = providerId ? providerBalanceKey(providerId, providerBaseUrl) : null;

  useEffect(() => {
    if (!balanceKey) {
      setBalance(null);
      return;
    }
    const balances = readStoredProviderBalances();
    const cached = balances[balanceKey] ?? balances[providerBalanceKey(providerId ?? "")];
    setBalance(cached ? { value: remainingBalanceText(cached.balance), checkedAt: formatBalanceTime(cached.checkedAt) } : null);
  }, [balanceKey, providerId]);

  async function refreshBalance() {
    if (!providerId || balanceBusy) return;
    setBalanceBusy(true);
    try {
      const result = await invoke<ProviderProbeResult>("pi_probe_configured_provider", { providerId });
      if (result.balance) {
        const snapshot = { balance: balanceWithDefaultUnit(result.balance), source: result.balanceSource, checkedAt: new Date().toISOString() };
        writeStoredProviderBalance(providerBalanceKey(providerId, providerBaseUrl), snapshot);
        writeStoredProviderBalance(providerBalanceKey(providerId), snapshot);
        setBalance({ value: remainingBalanceText(snapshot.balance), checkedAt: formatBalanceTime(snapshot.checkedAt) });
      }
    } catch {
      // Balance is optional; provider test/query UI surfaces detailed errors.
    } finally {
      setBalanceBusy(false);
    }
  }

  const rows = [
    [t("composerStats.run"), state?.runState ?? status],
    [t("composerStats.context"), stats?.contextPercent == null ? "n/a" : `${stats.contextPercent.toFixed(1)}%`],
    [t("composerStats.tokens"), (stats?.totalTokens ?? state?.tokenCount ?? 0).toLocaleString()],
    [t("composerStats.cost"), `$${(stats?.costUsd ?? state?.costUsd ?? 0).toFixed(4)}`],
    [t("composerStats.model"), settings?.model ?? state?.model ?? t("common.unknown")],
    [t("composerStats.thinking"), settings?.thinkingLevel ?? state?.thinkingLevel ?? "off"],
  ];
  const balanceText = balance ? `${balance.value} · ${balance.checkedAt}` : balanceBusy ? t("composerStats.balanceRefreshing") : "n/a";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-8 cursor-pointer items-center justify-center text-muted-foreground transition hover:text-primary"
          aria-label={t("composerStats.label")}
        >
          <Gauge size={15} />
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
          {providerId ? (
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{t("composerStats.balance")}</span>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate font-mono text-success" title={balanceText}>{balanceText}</span>
                <Button type="button" size="icon" variant="ghost" className="size-5" title={t("composerStats.refreshBalance")} aria-label={t("composerStats.refreshBalance")} disabled={balanceBusy} onClick={() => void refreshBalance()}>
                  <RefreshCw className={balanceBusy ? "animate-spin" : undefined} />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
});

function providerFromModelKey(value: string | undefined) {
  return value?.includes("/") ? value.split("/")[0] : undefined;
}

function providerBalanceKey(providerId: string, baseUrl?: string) {
  return `${providerId}::${baseUrl?.trim() ?? ""}`;
}

function remainingBalanceText(value: string) {
  const normalized = balanceWithDefaultUnit(value);
  const firstPart = normalized.split("·")[0]?.trim() ?? normalized;
  const [, right] = firstPart.split(/[:：]/);
  return formatBalanceAmount((right ?? firstPart).trim());
}

function balanceWithDefaultUnit(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "0 USD";
  return /\b(USD|CNY|RMB|EUR|GBP|JPY|AUD|CAD|HKD|USDT)\b|[$¥€￥]/i.test(trimmed) ? trimmed : `${trimmed} USD`;
}

function formatBalanceAmount(value: string) {
  return value.replace(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/, (match) => {
    const number = Number(match.replace(/,/g, ""));
    return Number.isFinite(number) ? number.toFixed(1) : match;
  });
}

function readStoredProviderBalances(): Record<string, ProviderBalanceSnapshot> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROVIDER_BALANCE_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredProviderBalance(key: string, value: ProviderBalanceSnapshot) {
  if (typeof window === "undefined") return;
  const balances = readStoredProviderBalances();
  window.localStorage.setItem(PROVIDER_BALANCE_STORAGE_KEY, JSON.stringify({ ...balances, [key]: value }));
}

function formatBalanceTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}
