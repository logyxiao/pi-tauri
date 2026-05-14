import { GitManagementPanel } from "@/components/git/GitManagementPanel";
import { FilesPreviewPanel } from "@/components/files/FilesPreviewPanel";
import { useI18n } from "@/shared/i18n";
import { displayCwd } from "@/shared/pi/cwd";
import type { PiFileEntry, PiFilePreview, PiSettings, PiState } from "@/shared/pi/types";

interface RightInspectorProps {
  state: PiState | null;
  settings: PiSettings | null;
  isRunning?: boolean;
  files: PiFileEntry[];
  filePreview: PiFilePreview | null;
  onPreviewFile: (path: string) => Promise<void> | void;
  onLoadFiles: (path?: string) => Promise<void> | void;
}

export function RightInspector({ state, settings, isRunning = false, files, filePreview, onPreviewFile, onLoadFiles }: RightInspectorProps) {
  const { t } = useI18n();
  const cwd = displayCwd(state?.cwd ?? settings?.cwd, t("common.loading"));

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-sidebar/70 lg:flex xl:w-96">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <FilesPreviewPanel cwd={cwd} files={files} preview={filePreview} selectedPath={filePreview?.path} onSelectFile={onPreviewFile} onLoadDirectory={onLoadFiles} />
        <GitManagementPanel cwd={cwd} model={state?.model} provider={settings?.provider} thinkingLevel={state?.thinkingLevel ?? settings?.thinkingLevel} isRunning={isRunning} />
      </div>
    </aside>
  );
}
