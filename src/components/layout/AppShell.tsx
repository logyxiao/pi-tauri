import { lazy, Suspense, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExtensionUiDialog } from "@/components/extensions/ExtensionUiDialog";
import { LeftSidebar } from "./LeftSidebar";
import { MainArea } from "./MainArea";

import { WindowTitlebar } from "./WindowTitlebar";

import { GlobalLoadingOverlay } from "@/components/status/GlobalLoadingOverlay";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useI18n } from "@/shared/i18n";
import { usePiSession } from "@/shared/hooks/usePiSession";
import type { PiToolCall } from "@/shared/pi/types";

const RightInspector = lazy(() => import("./RightInspector").then((module) => ({ default: module.RightInspector })));
const SettingsDialog = lazy(() => import("@/components/settings/SettingsDialog").then((module) => ({ default: module.SettingsDialog })));

export function AppShell() {
  const { t } = useI18n();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    messages,
    state,
    stats,
    sessions,
    workspacePaths,
    models,
    settings,
    commands,
    extensionPanels,
    pendingExtensionUi,
    extensionErrors,
    prefillInput,
    status,
    error,
    isConnecting,
    isRefreshing,
    isSwitchingSession,
    pendingSessionTarget,
    isRunning,
    prompt,
    abort,
    steer,
    followUp,
    newSession,
    switchSession,
    deleteSession,
    openWorkspaceFolder,
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
    setInspectorOpen(true);
    if (isPreviewableToolTarget(tool.target)) void previewFile(tool.target);
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="pi-grid-bg flex h-screen w-screen overflow-hidden text-foreground">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface/80 backdrop-blur-[1px]">
          <WindowTitlebar onRestartApp={() => void invoke("app_restart")} />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <LeftSidebar
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((value) => !value)}
              sessions={sessions}
              openedWorkspacePaths={workspacePaths}
              currentSessionId={pendingSessionTarget ?? state?.sessionId}
              onOpenWorkspaceFolder={openWorkspaceFolder}
              onSwitchSession={switchSession}
              onDeleteSession={deleteSession}
              onNewSession={newSession}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          <MainArea
            inspectorOpen={inspectorOpen}
            messages={messages}
            state={state}
            stats={stats}
            settings={settings}
            models={models}
            commands={commands}
            workspacePaths={workspacePaths}
            prefillInput={prefillInput}
            status={status}
            error={error}
            isConnecting={isConnecting}
            isRefreshing={isRefreshing}
            isSwitchingSession={isSwitchingSession}
            isRunning={isRunning}
            onPrompt={prompt}
            onAbort={abort}
            onSteer={steer}
            onFollowUp={followUp}
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
              <Suspense fallback={null}>
                <RightInspector
                  state={state}
                  settings={settings}
                  isRunning={isRunning}
                />
              </Suspense>
            ) : null}
          </div>
        </div>
      </div>
      <ExtensionUiDialog request={pendingExtensionUi[0] ?? null} onRespond={respondExtensionUi} />
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            state={state}
            settings={settings}
            models={models}
            commands={commands}
            extensionPanels={extensionPanels}
            extensionErrors={extensionErrors}
            onUpdateSettings={updateSettings}
            onRefresh={refresh}
          />
        </Suspense>
      ) : null}
      <GlobalLoadingOverlay
        open={isConnecting || isSwitchingSession}
        title={isSwitchingSession ? t("loading.session") : t("loading.globalTitle")}
        description={isSwitchingSession ? t("loading.sessionDescription") : t("loading.globalDescription")}
      />
    </TooltipProvider>
  );
}

function isPreviewableToolTarget(target: string): boolean {
  return Boolean(target) && !target.includes(" ") && /\.[\w-]+$/.test(target);
}
