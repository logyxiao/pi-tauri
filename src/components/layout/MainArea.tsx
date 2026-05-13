import { GitBranch, Loader2, PanelRight, PanelRightOpen, Zap } from "lucide-react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/model/ModelSelector";
import { ErrorBanner } from "@/components/status/ErrorBanner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/shared/i18n";
import type { PiCommand, PiMessage, PiModel, PiSafetyEvent, PiSettingsUpdate, PiState, PiToolCall } from "@/shared/pi/types";

interface MainAreaProps {
  inspectorOpen: boolean;
  messages: PiMessage[];
  state: PiState | null;
  models: PiModel[];
  commands: PiCommand[];
  prefillInput: string;
  status: string;
  error: string | null;
  isConnecting: boolean;
  isRefreshing: boolean;
  isRunning: boolean;
  onPrompt: (message: string) => Promise<void> | void;
  onAbort: () => Promise<void> | void;
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
  models,
  commands,
  prefillInput,
  status,
  error,
  isConnecting,
  isRefreshing,
  isRunning,
  onPrompt,
  onAbort,
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
      <header className="flex h-auto min-h-16 shrink-0 flex-col gap-3 border-b border-border bg-surface/55 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span>{t("main.title")}</span>
            <span className="rounded-sm border border-border bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
              {status}
            </span>
            {isRefreshing ? <Loader2 size={13} className="animate-spin text-primary" /> : null}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">cwd: {state?.cwd ?? t("main.cwdWaiting")}</div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost">
            <GitBranch size={15} /> {t("main.fork")}
          </Button>
          <Button size="sm" variant="ghost">
            <Zap size={15} /> {t("main.compact")}
          </Button>
          <ModelSelector
            state={state}
            models={models}
            onModelChange={(model) => onUpdateSettings({ model: model.id, provider: model.provider })}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={t("main.toggleInspector")} onClick={onToggleInspector}>
                {inspectorOpen ? <PanelRight size={17} /> : <PanelRightOpen size={17} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{inspectorOpen ? t("main.hideInspector") : t("main.showInspector")}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <ErrorBanner message={error} onRetry={onRefresh} onDismiss={onClearError} />

      <MessageList messages={messages} isConnecting={isConnecting} isRefreshing={isRefreshing} onSelectTool={onSelectTool} />

      <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-4 sm:px-6 sm:pb-6">
        <ChatInput
          isRunning={isRunning}
          commands={commands}
          prefillValue={prefillInput}
          disabled={isConnecting}
          onSubmit={onPrompt}
          onAbort={onAbort}
          onExecuteCommand={onExecuteCommand}
          onRecordSafetyEvent={onRecordSafetyEvent}
          onConsumePrefill={onConsumePrefill}
        />
      </div>
    </main>
  );
}
