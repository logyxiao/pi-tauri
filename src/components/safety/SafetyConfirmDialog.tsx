import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { DangerousAction } from "@/shared/pi/types";

interface SafetyConfirmDialogProps {
  action: DangerousAction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SafetyConfirmDialog({ action, open, onOpenChange, onCancel, onConfirm }: SafetyConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Confirm dangerous action"
        description="Dangerous pi commands and local mutations must be visible and explicitly confirmed. Nothing runs until you confirm."
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-danger/25 bg-danger/5 p-3 text-sm text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 font-semibold text-danger">
              <ShieldAlert size={16} /> {action?.kind ?? "danger"}: {action?.target ?? "unknown"}
            </div>
            <div>{action?.reason ?? "This operation may mutate or delete local state."}</div>
            <div className="mt-3 inline-flex rounded-full bg-danger/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-danger">
              {action?.severity ?? "high"} · confirmation required
            </div>
          </div>
          <div className="rounded-xl border border-border bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
            Current RPC PoC blocks dangerous slash commands at UI layer. LLM tool-call preflight blocking needs SDK tool interception or a pi extension confirm bridge; until then, dangerous tool events are flagged in stream and Safety inspector.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Block
            </Button>
            <Button variant="danger" onClick={onConfirm}>
              <ShieldAlert size={14} /> Confirm execute
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
