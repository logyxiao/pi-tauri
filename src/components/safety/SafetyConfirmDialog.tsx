import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useI18n } from "@/shared/i18n";
import type { DangerousAction } from "@/shared/pi/types";

interface SafetyConfirmDialogProps {
  action: DangerousAction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SafetyConfirmDialog({ action, open, onOpenChange, onCancel, onConfirm }: SafetyConfirmDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("safety.title")}
        description={t("safety.description")}
      >
        <div className="space-y-4">
          <div className="rounded-none border border-danger/25 bg-danger/5 p-3 text-sm text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 font-semibold text-danger">
              <ShieldAlert size={16} /> {action?.kind ?? "danger"}: {action?.target ?? "unknown"}
            </div>
            <div>{action?.reason ?? t("safety.fallbackReason")}</div>
            <div className="mt-3 inline-flex rounded-none bg-danger/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-danger">
              {action?.severity ?? "high"} · {t("safety.confirmRequired")}
            </div>
          </div>
          <div className="rounded-none border border-border bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
            {t("safety.rpcNote")}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              {t("safety.block")}
            </Button>
            <Button variant="danger" onClick={onConfirm}>
              <ShieldAlert size={14} /> {t("safety.confirmExecute")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
