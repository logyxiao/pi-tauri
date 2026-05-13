import { AlertTriangle, Loader2, Terminal } from "lucide-react";
import { ExtensionsPanel } from "@/components/extensions/ExtensionsPanel";
import { FilesPreviewPanel } from "@/components/files/FilesPreviewPanel";
import { GitManagementPanel } from "@/components/git/GitManagementPanel";
import { SafetyPanel } from "@/components/safety/SafetyPanel";
import { ToolResultPanel } from "@/components/tools/ToolResultPanel";
import { useI18n } from "@/shared/i18n";
import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiFileEntry,
  PiFilePreview,
  PiMessage,
  PiSafetyEvent,
  PiSettings,
  PiState,
  PiToolCall,
} from "@/shared/pi/types";

interface RightInspectorProps {
  selectedTool: PiToolCall | null;
  messages: PiMessage[];
  state: PiState | null;
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
  onSelectFile: (path: string) => Promise<void> | void;
  onRetry: () => Promise<void> | void;
}

export function RightInspector({
  selectedTool,
  messages,
  state,
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
  onSelectFile,
  onRetry,
}: RightInspectorProps) {
  const { t } = useI18n();
  const activeTools = messages.flatMap((message) => message.tools ?? []).filter((tool) => tool.status === "running").slice(-3).reverse();
  const hasExtensionActivity = pendingExtensionUi.length > 0 || extensionErrors.length > 0 || extensionPanels.length > 0;
  const hasFileContext = Boolean(selectedFilePath || filePreview);
  const hasSafetyActivity = safetyEvents.length > 0;
  const hasSecondaryContext = Boolean(selectedTool || activeTools.length || hasFileContext || hasExtensionActivity || hasSafetyActivity || error);
  const cwd = state?.cwd ?? settings?.cwd ?? t("common.loading");

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-surface lg:flex xl:w-96">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <GitManagementPanel cwd={cwd} onRefresh={onRetry} />

        {hasSecondaryContext ? (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            {error ? (
              <div className="border border-danger/20 bg-danger/5 p-3 text-xs leading-5 text-danger">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <AlertTriangle size={14} /> {t("inspector.clientError")}
                </div>
                <div className="break-words text-muted-foreground">{error}</div>
                <button className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-danger" onClick={() => void onRetry()}>
                  <Loader2 size={11} /> {t("inspector.retryRefresh")}
                </button>
              </div>
            ) : null}

            {pendingExtensionUi.length ? (
              <div className="border border-primary/25 bg-primary/5 p-3 text-xs leading-5 text-primary">
                <div className="font-semibold uppercase tracking-[0.14em]">{t("extension.pending")}</div>
                <div className="mt-1 text-muted-foreground">{pendingExtensionUi[0].title ?? pendingExtensionUi[0].method}</div>
              </div>
            ) : null}

            {selectedTool ? (
              <section className="border border-primary/25 bg-primary/5 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                  <Terminal size={14} /> {t("inspector.selectedTool")}
                </div>
                <ToolResultPanel tool={selectedTool} />
                {selectedTool.safety ? (
                  <div className="mt-3 border border-danger/20 bg-danger/5 p-3 text-xs leading-5 text-danger">
                    {selectedTool.safety.severity}: {selectedTool.safety.reason}
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTools.length ? (
              <section className="border border-border bg-background/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <Terminal size={14} /> {t("inspector.activeTools")}
                </div>
                <div className="space-y-1.5">
                  {activeTools.map((tool) => (
                    <div key={tool.id} className="flex items-center gap-2 bg-surface px-2 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate font-mono text-foreground">{tool.name}</span>
                      <span className="bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{tool.status}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {hasSafetyActivity ? <SafetyPanel events={safetyEvents} /> : null}

            {hasFileContext ? (
              <FilesPreviewPanel cwd={cwd} files={files} preview={filePreview} selectedPath={selectedFilePath} onSelectFile={onSelectFile} />
            ) : null}

            {hasExtensionActivity ? (
              <ExtensionsPanel
                commands={commands}
                extensionPanels={extensionPanels}
                extensionMessages={extensionMessages}
                pendingExtensionUi={pendingExtensionUi}
                extensionErrors={extensionErrors}
              />
            ) : null}
          </div>
        ) : null}

      </div>
    </aside>
  );
}
