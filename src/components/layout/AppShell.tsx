import { useState } from "react";
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
  const {
    messages,
    state,
    stats,
    models,
    settings,
    commands,
    extensionPanels,
    extensionMessages,
    extensionErrors,
    safetyEvents,
    prefillInput,
    isRunning,
    prompt,
    abort,
    newSession,
    updateSettings,
    executeCommand,
    recordSafetyEvent,
    clearPrefillInput,
  } = usePiSession();

  async function startNewSession() {
    setSelectedTool(null);
    await newSession();
  }

  function selectTool(tool: PiToolCall) {
    setSelectedTool(tool);
    setInspectorOpen(true);
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
              onNewSession={() => void startNewSession()}
              onOpenSettings={() => setSettingsOpen(true)}
            />
            <MainArea
              inspectorOpen={inspectorOpen}
              messages={messages}
              state={state}
              models={models}
              commands={commands}
              prefillInput={prefillInput}
              isRunning={isRunning}
              onPrompt={prompt}
              onAbort={abort}
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
                settings={settings}
                commands={commands}
                extensionPanels={extensionPanels}
                extensionMessages={extensionMessages}
                extensionErrors={extensionErrors}
                safetyEvents={safetyEvents}
              />
            ) : null}
          </div>
        </div>
      </div>
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
