import { Loader2 } from "lucide-react";

interface LoadingPanelProps {
  label?: string;
}

export function LoadingPanel({ label = "Connecting to pi runtime..." }: LoadingPanelProps) {
  return (
    <div className="rounded-md border border-border bg-surface/70 p-4 text-sm text-muted-foreground">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em]">
        <Loader2 size={14} className="animate-spin text-primary" /> {label}
      </div>
      <div className="mt-2 text-xs leading-5">
        正在准备 pi RPC/session 状态。工具流、模型、commands 和 extensions 会在连接后同步。
      </div>
    </div>
  );
}
