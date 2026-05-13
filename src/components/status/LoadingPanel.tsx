import { Loader2 } from "lucide-react";
import { useI18n } from "@/shared/i18n";

interface LoadingPanelProps {
  label?: string;
}

export function LoadingPanel({ label }: LoadingPanelProps) {
  const { t } = useI18n();

  return (
    <div className="rounded-none border border-border bg-surface/70 p-4 text-sm text-muted-foreground">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em]">
        <Loader2 size={14} className="animate-spin text-primary" /> {label ?? t("loading.connecting")}
      </div>
      <div className="mt-2 text-xs leading-5">
        {t("loading.description")}
      </div>
    </div>
  );
}
