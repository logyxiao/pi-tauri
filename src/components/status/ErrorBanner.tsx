import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBannerProps {
  message: string | null;
  onRetry?: () => Promise<void> | void;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, onRetry, onDismiss }: ErrorBannerProps) {
  if (!message) return null;

  return (
    <div className="flex items-start gap-3 border-b border-danger/20 bg-danger/5 px-5 py-3 text-sm text-danger">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Pi client issue</div>
        <div className="mt-1 break-words text-xs leading-5 text-muted-foreground">
          {message} · UI 保持可用，可重试连接或继续查看已有 session/tool 状态。
        </div>
      </div>
      {onRetry ? (
        <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => void onRetry()}>
          <RefreshCw size={13} /> Retry
        </Button>
      ) : null}
      {onDismiss ? (
        <Button size="icon" variant="ghost" aria-label="Dismiss pi client error" onClick={onDismiss}>
          <X size={14} />
        </Button>
      ) : null}
    </div>
  );
}
