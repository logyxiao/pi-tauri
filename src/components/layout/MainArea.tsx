import { useState, type ReactNode } from "react";
import { ChevronDown, Code2, GitBranch, Loader2, Monitor, Terminal } from "lucide-react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { ErrorBanner } from "@/components/status/ErrorBanner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";
import { openProjectPath, type ProjectOpenTarget } from "@/shared/system-open";
import type { PiCommand, PiMessage, PiModel, PiSafetyEvent, PiSessionStats, PiSettings, PiSettingsUpdate, PiState, PiToolCall } from "@/shared/pi/types";

interface MainAreaProps {
  inspectorOpen: boolean;
  messages: PiMessage[];
  state: PiState | null;
  stats: PiSessionStats | null;
  settings: PiSettings | null;
  models: PiModel[];
  commands: PiCommand[];
  workspacePaths: string[];
  prefillInput: string;
  status: string;
  error: string | null;
  isConnecting: boolean;
  isRefreshing: boolean;
  isSwitchingSession: boolean;
  isRunning: boolean;
  onPrompt: (message: string) => Promise<void> | void;
  onAbort: () => Promise<void> | void;
  onSteer: (message: string) => Promise<void> | void;
  onFollowUp: (message: string) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  onClearError: () => void;
  onUpdateSettings: (update: PiSettingsUpdate) => Promise<void> | void;
  onExecuteCommand: (commandName: string, safetyEvent?: PiSafetyEvent) => Promise<void> | void;
  onRecordSafetyEvent: (event: PiSafetyEvent) => Promise<void> | void;
  onConsumePrefill: () => void;
  onToggleInspector: () => void;
  onSelectTool: (tool: PiToolCall) => void;
}

const OPEN_TARGET_STORAGE_KEY = "pi-tauri.projectOpenTarget";

function loadPreferredOpenTarget(): ProjectOpenTarget {
  try {
    const value = window.localStorage.getItem(OPEN_TARGET_STORAGE_KEY);
    if (value === "fileManager" || value === "terminal" || value === "vscode" || value === "cursor") return value;
  } catch {
    // Ignore storage failures.
  }
  return "terminal";
}

function persistPreferredOpenTarget(target: ProjectOpenTarget) {
  try {
    window.localStorage.setItem(OPEN_TARGET_STORAGE_KEY, target);
  } catch {
    // Ignore storage failures.
  }
}

function openTargetLabel(target: ProjectOpenTarget, t: (key: string, params?: Record<string, string | number>) => string) {
  if (target === "fileManager") return t("main.openFileManager");
  if (target === "vscode") return t("main.openVscode");
  if (target === "cursor") return t("main.openCursor");
  return t("main.openTerminal");
}

function openTargetIcon(target: ProjectOpenTarget): ReactNode {
  if (target === "fileManager") return <Monitor size={14} />;
  if (target === "terminal") return <Terminal size={14} />;
  return <Code2 size={14} />;
}

function resolveProjectPath(cwd: string | undefined, workspacePaths: string[]) {
  if (cwd && cwd !== "unknown cwd" && cwd !== "Unknown cwd") return cwd;
  return workspacePaths[0] ?? null;
}

function projectFolderName(path: string | null) {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function MainArea({
  inspectorOpen,
  messages,
  state,
  stats,
  settings,
  models,
  commands,
  workspacePaths,
  prefillInput,
  status,
  error,
  isConnecting,
  isRefreshing,
  isSwitchingSession,
  isRunning,
  onPrompt,
  onAbort,
  onSteer,
  onFollowUp,
  onRefresh,
  onClearError,
  onUpdateSettings,
  onExecuteCommand,
  onRecordSafetyEvent,
  onConsumePrefill,
  onToggleInspector,
  onSelectTool,
}: MainAreaProps) {
  const { t } = useI18n();
  const [preferredOpenTarget, setPreferredOpenTarget] = useState<ProjectOpenTarget>(() => loadPreferredOpenTarget());

  const projectPath = resolveProjectPath(state?.cwd, workspacePaths);
  const projectTitle = projectFolderName(projectPath) ?? t("main.title");

  function openProject(target = preferredOpenTarget) {
    if (!projectPath) return;
    setPreferredOpenTarget(target);
    persistPreferredOpenTarget(target);
    void openProjectPath(projectPath, target).catch(() => undefined);
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-transparent">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/45 px-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="truncate" title={projectPath ?? undefined}>{projectTitle}</span>
            <span className="rounded-none bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-primary">
              {status}
            </span>
            {isRefreshing ? <Loader2 size={11} className="animate-spin text-primary" /> : null}
          </div>
          <div className="mt-0.5 max-w-[52vw] truncate font-mono text-[10px] text-muted-foreground">{state?.cwd ?? t("main.cwdWaiting")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="inline-flex h-8 min-w-8 cursor-pointer items-center justify-center gap-1 px-1.5 text-muted-foreground transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={t("main.openProjectQuick", { target: openTargetLabel(preferredOpenTarget, t) })}
                  disabled={!projectPath}
                  onClick={() => openProject()}
                >
                  {openTargetIcon(preferredOpenTarget)}
                  <span className="hidden max-w-16 truncate font-mono text-[9px] uppercase tracking-[0.1em] sm:inline">{openTargetLabel(preferredOpenTarget, t)}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("main.openProjectQuick", { target: openTargetLabel(preferredOpenTarget, t) })}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="inline-flex size-8 cursor-pointer items-center justify-center text-muted-foreground transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={t("main.openProject")}
                      disabled={!projectPath}
                    >
                      <ChevronDown size={15} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("main.openProject")}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem className="cursor-pointer" onSelect={() => openProject("terminal")}>
                  <Terminal size={14} /> {t("main.openTerminal")}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onSelect={() => openProject("cursor")}>
                  <Code2 size={14} /> {t("main.openCursor")}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onSelect={() => openProject("vscode")}>
                  <Code2 size={14} /> {t("main.openVscode")}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onSelect={() => openProject("fileManager")}>
                  <Monitor size={14} /> {t("main.openFileManager")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  "inline-flex size-8 cursor-pointer items-center justify-center transition hover:text-primary",
                  inspectorOpen ? "text-primary" : "text-muted-foreground",
                )}
                aria-label={t("main.toggleGit")}
                onClick={onToggleInspector}
              >
                <GitBranch size={17} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{inspectorOpen ? t("main.hideGit") : t("main.showGit")}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <ErrorBanner message={error} onRetry={onRefresh} onDismiss={onClearError} />

      <MessageList messages={messages} isConnecting={isConnecting} isRefreshing={isRefreshing} isSwitchingSession={isSwitchingSession} isRunning={isRunning} onSelectTool={onSelectTool} />

      <div className="relative z-40 shrink-0 bg-gradient-to-t from-background via-background/95 to-background/0 px-3 pb-3 pt-3 sm:px-5 sm:pb-4">
        <div className="mx-auto w-full max-w-4xl">
          <ChatInput
            isRunning={isRunning}
            commands={commands}
            state={state}
            stats={stats}
            settings={settings}
            models={models}
            status={status}
            prefillValue={prefillInput}
            disabled={isConnecting}
            onSubmit={onPrompt}
            onAbort={onAbort}
            onSteer={onSteer}
            onFollowUp={onFollowUp}
            onModelChange={(model) => onUpdateSettings({ model: model.id, provider: model.provider })}
            onExecuteCommand={onExecuteCommand}
            onRecordSafetyEvent={onRecordSafetyEvent}
            onConsumePrefill={onConsumePrefill}
          />
        </div>
      </div>
    </main>
  );
}
