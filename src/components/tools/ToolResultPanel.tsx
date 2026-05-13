import { FileText, Terminal } from "lucide-react";
import { useI18n } from "@/shared/i18n";
import type { PiToolCall } from "@/shared/pi/types";

interface ToolResultPanelProps {
  tool: PiToolCall;
}

export function ToolResultPanel({ tool }: ToolResultPanelProps) {
  const { t } = useI18n();
  const isBash = tool.name === "bash";
  const Icon = isBash ? Terminal : FileText;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background/75">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <Icon size={14} className="shrink-0 text-primary" />
          <span className="truncate font-mono">{tool.target || tool.name}</span>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{tool.status}</span>
      </div>

      <div className="px-3 py-2 text-xs leading-5 text-muted-foreground">{tool.summary}</div>

      {tool.output ? (
        <pre className="max-h-72 overflow-auto border-t border-border bg-surface p-3 font-mono text-[11px] leading-5 text-foreground">
          {tool.output}
        </pre>
      ) : (
        <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground">{t("tool.noOutput")}</div>
      )}
    </div>
  );
}
