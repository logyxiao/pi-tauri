import { GitBranch, Loader2 } from "lucide-react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { ErrorBanner } from "@/components/status/ErrorBanner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/shared/i18n";
import { cn } from "@/shared/lib/cn";
import type { PiCommand, PiMessage, PiModel, PiSafetyEvent, PiSessionStats, PiSettings, PiSettingsUpdate, PiState, PiToolCall } from "@/shared/pi/types";

interface MainAreaProps {
  inspectorOpen: boolean;
  messages: PiMessage[];
  state: PiState | null;
  stats: PiSessionStats | null;
  settings: PiSettings | null;
  models: PiModel[];
  commands: PiCommand[];
  prefillInput: string;
  status: string;
  error: string | null;
  isConnecting: boolean;
  isRefreshing: boolean;
  isSwitchingSession: boolean;
  isRunning: boolean;
  onPrompt: (message: string) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  onClearError: () => void;
  onUpdateSettings: (update: PiSettingsUpdate) => Promise<void> | void;
  onExecuteCommand: (commandName: string, safetyEvent?: PiSafetyEvent) => Promise<void> | void;
  onRecordSafetyEvent: (event: PiSafetyEvent) => Promise<void> | void;
  onConsumePrefill: () => void;
  onToggleInspector: () => void;
  onSelectTool: (tool: PiToolCall) => void;
}

export function MainArea({
  inspectorOpen,
  messages,
  state,
  stats,
  settings,
  models,
  commands,
  prefillInput,
  status,
  error,
  isConnecting,
  isRefreshing,
  isSwitchingSession,
  isRunning,
  onPrompt,
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

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-transparent">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/45 px-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="truncate">{t("main.title")}</span>
            <span className="rounded-none bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-primary">
              {status}
            </span>
            {isRefreshing ? <Loader2 size={11} className="animate-spin text-primary" /> : null}
          </div>
          <div className="mt-0.5 max-w-[52vw] truncate font-mono text-[10px] text-muted-foreground">{state?.cwd ?? t("main.cwdWaiting")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  "inline-flex size-8 items-center justify-center transition hover:text-primary",
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

      <MessageList messages={messages} isConnecting={isConnecting} isRefreshing={isRefreshing} isSwitchingSession={isSwitchingSession} onSelectTool={onSelectTool} />

      <div className="shrink-0 bg-gradient-to-t from-background via-background/95 to-background/0 px-3 pb-3 pt-3 sm:px-5 sm:pb-4">
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
