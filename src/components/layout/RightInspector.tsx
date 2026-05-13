import { Activity, AlertTriangle, HardDrive, Loader2, Terminal } from "lucide-react";
import { ExtensionsPanel } from "@/components/extensions/ExtensionsPanel";
import { FilesPreviewPanel } from "@/components/files/FilesPreviewPanel";
import { SafetyPanel } from "@/components/safety/SafetyPanel";
import { SessionTreePanel } from "@/components/session/SessionTreePanel";
import { ToolResultPanel } from "@/components/tools/ToolResultPanel";
import { useI18n } from "@/shared/i18n";
import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiFileEntry,
  PiFilePreview,
  PiForkMessage,
  PiMessage,
  PiSafetyEvent,
  PiSessionStats,
  PiSessionTree,
  PiSettings,
  PiState,
  PiToolCall,
} from "@/shared/pi/types";

interface RightInspectorProps {
  selectedTool: PiToolCall | null;
  messages: PiMessage[];
  state: PiState | null;
  stats: PiSessionStats | null;
  sessionTree: PiSessionTree | null;
  forkMessages: PiForkMessage[];
  settings: PiSettings | null;
  commands: PiCommand[];
  extensionPanels: PiExtensionPanel[];
  extensionMessages: PiExtensionMessage[];
  pendingExtensionUi: PiExtensionMessage[];
  extensionErrors: PiExtensionError[];
  safetyEvents: PiSafetyEvent[];
  files: PiFileEntry[];
  filePreview: PiFilePreview | null;
  selectedFilePath: string | null;
  error: string | null;
  status: string;
  onSelectFile: (path: string) => Promise<void> | void;
  onForkSession: (entryId: string) => Promise<void> | void;
  onCloneSession: () => Promise<void> | void;
  onSetSessionEntryLabel: (entryId: string, label?: string) => Promise<void> | void;
  onRetry: () => Promise<void> | void;
}

export function RightInspector({
  selectedTool,
  messages,
  state,
  stats,
  sessionTree,
  forkMessages,
  settings,
  commands,
  extensionPanels,
  extensionMessages,
  pendingExtensionUi,
  extensionErrors,
  safetyEvents,
  files,
  filePreview,
  selectedFilePath,
  error,
  status,
  onSelectFile,
  onForkSession,
  onCloneSession,
  onSetSessionEntryLabel,
  onRetry,
}: RightInspectorProps) {
  const { t } = useI18n();
  const activeTools = messages.flatMap((message) => message.tools ?? []).slice(-6).reverse();
  const stateCards = [
    [t("inspector.tokens"), (stats?.totalTokens ?? state?.tokenCount ?? 0).toLocaleString()],
    [t("inspector.cost"), `$${(stats?.costUsd ?? state?.costUsd ?? 0).toFixed(4)}`],
    [t("inspector.run"), state?.runState ?? t("common.loading")],
    [t("inspector.thinking"), state?.thinkingLevel ?? "off"],
    [t("inspector.client"), settings?.clientMode ?? t("common.loading")],
    [t("inspector.status"), status],
  ];

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-surface lg:flex xl:w-80">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Activity size={16} className="text-primary" /> {t("inspector.title")}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("inspector.subtitle")}</p>
      </div>

      <div className="space-y-4 overflow-auto p-4">
        {error ? (
          <div className="rounded-2xl border border-danger/20 bg-danger/5 p-3 text-xs leading-5 text-danger">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <AlertTriangle size={14} /> {t("inspector.clientError")}
            </div>
            <div className="break-words text-muted-foreground">{error}</div>
            <button className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-danger" onClick={() => void onRetry()}>
              <Loader2 size={11} /> {t("inspector.retryRefresh")}
            </button>
          </div>
        ) : null}

        {extensionErrors.length ? (
          <div className="rounded-2xl border border-danger/20 bg-danger/5 p-3 text-xs leading-5 text-danger">
            {t("inspector.extensionError", { message: extensionErrors[0].message })}
          </div>
        ) : null}

        {selectedTool ? (
          <section className="rounded-2xl border border-primary/25 bg-primary/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              <Terminal size={14} /> {t("inspector.selectedTool")}
            </div>
            <ToolResultPanel tool={selectedTool} />
            {selectedTool.safety ? (
              <div className="mt-3 rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs leading-5 text-danger">
                {selectedTool.safety.severity}: {selectedTool.safety.reason}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-2xl border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <HardDrive size={14} /> {t("inspector.state")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {stateCards.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface p-3">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="mt-1 truncate text-sm font-semibold">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2 rounded-xl bg-surface p-3 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3">
              <span>{t("inspector.session")}</span>
              <span className="truncate font-mono text-foreground">{state?.sessionName ?? state?.sessionId ?? t("common.unknown")}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>{t("inspector.messages")}</span>
              <span className="font-mono text-foreground">{stats?.totalMessages ?? 0}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>{t("inspector.tools")}</span>
              <span className="font-mono text-foreground">{stats?.toolCalls ?? 0}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>{t("inspector.model")}</span>
              <span className="truncate font-mono text-foreground">{settings?.model ?? state?.model ?? t("common.unknown")}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>{t("inspector.context")}</span>
              <span className="font-mono text-foreground">
                {stats?.contextPercent == null ? "n/a" : `${stats.contextPercent.toFixed(1)}%`}
              </span>
            </div>
            <div className="truncate font-mono text-[11px]" title={state?.sessionFile ?? stats?.sessionFile}>
              {state?.sessionFile ?? stats?.sessionFile ?? t("inspector.noSessionFile")}
            </div>
          </div>
        </section>

        <SafetyPanel events={safetyEvents} />

        <FilesPreviewPanel
          cwd={state?.cwd ?? settings?.cwd ?? "loading..."}
          files={files}
          preview={filePreview}
          selectedPath={selectedFilePath}
          onSelectFile={onSelectFile}
        />

        <ExtensionsPanel
          commands={commands}
          extensionPanels={extensionPanels}
          extensionMessages={extensionMessages}
          pendingExtensionUi={pendingExtensionUi}
          extensionErrors={extensionErrors}
        />

        <section className="rounded-2xl border border-border bg-background/60 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Terminal size={14} /> {t("inspector.activeTools")}
          </div>
          <div className="space-y-2">
            {activeTools.length ? (
              activeTools.map((tool) => (
                <div key={tool.id} className="rounded-xl border border-border bg-surface p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{tool.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{tool.status}</span>
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{tool.target}</div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">{tool.summary}</div>
                </div>
              ))
            ) : (
              <div className="rounded-xl bg-surface p-3 text-xs text-muted-foreground">{t("inspector.noActiveTools")}</div>
            )}
          </div>
        </section>

        <SessionTreePanel
          tree={sessionTree}
          forkMessages={forkMessages}
          onForkSession={onForkSession}
          onCloneSession={onCloneSession}
          onSetLabel={onSetSessionEntryLabel}
          runState={status}
        />
      </div>
    </aside>
  );
}
