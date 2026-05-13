import { GitManagementPanel } from "@/components/git/GitManagementPanel";
import { useI18n } from "@/shared/i18n";
import type { PiSettings, PiState } from "@/shared/pi/types";

interface RightInspectorProps {
  state: PiState | null;
  settings: PiSettings | null;
  isRunning?: boolean;
  onRetry: () => Promise<void> | void;
}

export function RightInspector({ state, settings, isRunning = false, onRetry }: RightInspectorProps) {
  const { t } = useI18n();
  const cwd = state?.cwd ?? settings?.cwd ?? t("common.loading");

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-sidebar/70 lg:flex xl:w-96">
      <div className="min-h-0 flex-1 overflow-hidden">
        <GitManagementPanel cwd={cwd} model={state?.model} thinkingLevel={state?.thinkingLevel} isRunning={isRunning} onRefresh={onRetry} />
      </div>
    </aside>
  );
}
