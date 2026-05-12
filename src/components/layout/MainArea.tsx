import { GitBranch, PanelRight, PanelRightOpen, Zap } from "lucide-react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/model/ModelSelector";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PiCommand, PiMessage, PiModel, PiSafetyEvent, PiSettingsUpdate, PiState, PiToolCall } from "@/shared/pi/types";

interface MainAreaProps {
  inspectorOpen: boolean;
  messages: PiMessage[];
  state: PiState | null;
  models: PiModel[];
  commands: PiCommand[];
  prefillInput: string;
  isRunning: boolean;
  onPrompt: (message: string) => Promise<void> | void;
  onAbort: () => Promise<void> | void;
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
  isRunning,
  onPrompt,
  onAbort,
  onUpdateSettings,
  onExecuteCommand,
  onRecordSafetyEvent,
  onConsumePrefill,
  onToggleInspector,
  onSelectTool,
}: MainAreaProps) {
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-transparent">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface/55 px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span>构建 pi desktop shell</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {isRunning ? "running" : "idle"}
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">cwd: {state?.cwd ?? "loading..."}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost">
            <GitBranch size={15} /> Fork
          </Button>
          <Button size="sm" variant="ghost">
            <Zap size={15} /> Compact
          </Button>
          <ModelSelector
            state={state}
            models={models}
            onModelChange={(model) => onUpdateSettings({ model: model.id, provider: model.provider })}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Toggle inspector" onClick={onToggleInspector}>
                {inspectorOpen ? <PanelRight size={17} /> : <PanelRightOpen size={17} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{inspectorOpen ? "Hide inspector" : "Show inspector"}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <MessageList messages={messages} onSelectTool={onSelectTool} />

      <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-6">
        <ChatInput
          isRunning={isRunning}
          commands={commands}
          prefillValue={prefillInput}
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
