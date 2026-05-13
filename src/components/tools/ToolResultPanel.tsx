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
  const title = isBash ? `tool result · bash` : `tool result · ${tool.name}`;
  const subtitle = isBash ? tool.target : tool.target || tool.name;

  return (
    <div className="mt-0 overflow-hidden rounded-none border-t border-border bg-background/75">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] font-medium leading-5">
          <Icon size={12} className="shrink-0 text-primary" />
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{title}</span>
          <span className="truncate font-mono text-foreground">{subtitle}</span>
        </div>
        <span className="rounded-none bg-muted px-1.5 py-0 text-[10px] leading-5 text-muted-foreground">{tool.status}</span>
      </div>

      {tool.summary ? <div className="px-2 py-1 font-mono text-[11px] leading-5 text-muted-foreground">{tool.summary}</div> : null}

      {tool.output ? (
        <pre className="max-h-72 overflow-auto border-t border-border bg-surface p-2 font-mono text-[11px] leading-5 text-foreground">
          {tool.output}
        </pre>
      ) : (
        <div className="border-t border-border px-2 py-1.5 font-mono text-[11px] text-muted-foreground">{t("tool.noOutput")}</div>
      )}
    </div>
  );
}
