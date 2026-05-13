import { useState } from "react";
import { ExtensionUiDialog } from "@/components/extensions/ExtensionUiDialog";
import { LeftSidebar } from "./LeftSidebar";
import { MainArea } from "./MainArea";
import { RightInspector } from "./RightInspector";
import { WindowTitlebar } from "./WindowTitlebar";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePiSession } from "@/shared/hooks/usePiSession";
import type { PiToolCall } from "@/shared/pi/types";

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<PiToolCall | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const {
    messages,
    state,
    stats,
    sessionTree,
    forkMessages,
    sessions,
    workspacePaths,
    models,
    settings,
    commands,
    extensionPanels,
    extensionMessages,
    pendingExtensionUi,
    extensionErrors,
    safetyEvents,
    files,
    filePreview,
    prefillInput,
    status,
    error,
    isConnecting,
    isRefreshing,
    isRunning,
    prompt,
    abort,
    switchSession,
    deleteSession,
    openWorkspaceFolder,
    forkSession,
    cloneSession,
    setSessionEntryLabel,
    updateSettings,
    executeCommand,
    recordSafetyEvent,
    respondExtensionUi,
    previewFile,
    clearPrefillInput,
    clearError,
    refresh,
  } = usePiSession();

  function selectTool(tool: PiToolCall) {
    setSelectedTool(tool);
    setInspectorOpen(true);
    if (isPreviewableToolTarget(tool.target)) void selectFile(tool.target);
  }

  async function selectFile(path: string) {
    setSelectedFilePath(path);
    setInspectorOpen(true);
    await previewFile(path);
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="pi-grid-bg flex h-screen w-screen overflow-hidden text-foreground">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface/80 backdrop-blur-[1px]">
          <WindowTitlebar />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <LeftSidebar
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((value) => !value)}
              sessions={sessions}
              openedWorkspacePaths={workspacePaths}
              currentSessionId={state?.sessionId}
              onOpenWorkspaceFolder={openWorkspaceFolder}
              onSwitchSession={switchSession}
              onDeleteSession={deleteSession}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          <MainArea
            inspectorOpen={inspectorOpen}
            messages={messages}
            state={state}
            models={models}
            commands={commands}
            prefillInput={prefillInput}
            status={status}
            error={error}
            isConnecting={isConnecting}
            isRefreshing={isRefreshing}
            isRunning={isRunning}
            onPrompt={prompt}
            onAbort={abort}
            onRefresh={refresh}
            onClearError={clearError}
            onUpdateSettings={updateSettings}
            onExecuteCommand={executeCommand}
            onRecordSafetyEvent={recordSafetyEvent}
            onConsumePrefill={clearPrefillInput}
            onToggleInspector={() => setInspectorOpen((value) => !value)}
            onSelectTool={selectTool}
          />
            {inspectorOpen ? (
              <RightInspector
                selectedTool={selectedTool}
                messages={messages}
                state={state}
                stats={stats}
                sessionTree={sessionTree}
                forkMessages={forkMessages}
                settings={settings}
                commands={commands}
                extensionPanels={extensionPanels}
                extensionMessages={extensionMessages}
                pendingExtensionUi={pendingExtensionUi}
                extensionErrors={extensionErrors}
                safetyEvents={safetyEvents}
                files={files}
                filePreview={filePreview}
                selectedFilePath={selectedFilePath}
                error={error}
                status={status}
                onSelectFile={selectFile}
                onForkSession={forkSession}
                onCloneSession={cloneSession}
                onSetSessionEntryLabel={setSessionEntryLabel}
                onRetry={refresh}
              />
            ) : null}
          </div>
        </div>
      </div>
      <ExtensionUiDialog request={pendingExtensionUi[0] ?? null} onRespond={respondExtensionUi} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        state={state}
        settings={settings}
        models={models}
        onUpdateSettings={updateSettings}
      />
    </TooltipProvider>
  );
}

function isPreviewableToolTarget(target: string): boolean {
  return Boolean(target) && !target.includes(" ") && /\.[\w-]+$/.test(target);
}
