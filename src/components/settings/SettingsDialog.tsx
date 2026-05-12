import type { ReactNode } from "react";
import { Brain, Folder, HardDrive, Settings } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { PiModel, PiSettings, PiSettingsUpdate, PiState, PiThinkingLevel } from "@/shared/pi/types";

const thinkingLevels: PiThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: PiState | null;
  settings: PiSettings | null;
  models: PiModel[];
  onUpdateSettings: (update: PiSettingsUpdate) => Promise<void> | void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  state,
  settings,
  models,
  onUpdateSettings,
}: SettingsDialogProps) {
  const currentModel = settings?.model ?? modelIdFromState(state?.model);
  const currentThinking = settings?.thinkingLevel ?? state?.thinkingLevel ?? "off";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Pi settings"
        description="Configure pi model, thinking level, cwd, and current session context. Dangerous tool execution stays visible in run stream."
        className="w-[min(92vw,640px)]"
      >
        <div className="space-y-4">
          <section className="rounded-2xl border border-border bg-background/60 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Brain size={14} /> Model
            </div>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Active model</span>
              <select
                value={currentModel ?? ""}
                className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary"
                onChange={(event) => {
                  const next = models.find((model) => model.id === event.target.value);
                  if (!next) return;
                  void onUpdateSettings({ model: next.id, provider: next.provider });
                }}
              >
                {models.map((model) => (
                  <option key={`${model.provider}/${model.id}`} value={model.id}>
                    {model.provider}/{model.id} — {model.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block space-y-1 text-xs text-muted-foreground">
              <span>Thinking level</span>
              <select
                value={currentThinking}
                className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary"
                onChange={(event) => void onUpdateSettings({ thinkingLevel: event.target.value as PiThinkingLevel })}
              >
                {thinkingLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <InfoCard icon={<Folder size={14} />} label="cwd" value={settings?.cwd ?? state?.cwd ?? "loading..."} />
            <InfoCard icon={<Settings size={14} />} label="client mode" value={settings?.clientMode ?? "loading"} />
            <InfoCard icon={<HardDrive size={14} />} label="session file" value={settings?.sessionFile ?? state?.sessionFile ?? "no session file"} wide />
          </section>

          <div className="rounded-2xl border border-border bg-muted/45 p-3 text-xs leading-5 text-muted-foreground">
            pi 能力优先：model/thinking 直接影响 Agent 执行；工具调用继续在中央流和 Inspector 中透明展示。真实
            RPC 若某项设置不可用，将保留当前状态并在 console 中记录降级信息。
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface InfoCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  wide?: boolean;
}

function InfoCard({ icon, label, value, wide }: InfoCardProps) {
  return (
    <div className={wide ? "rounded-2xl border border-border bg-background/60 p-3 sm:col-span-2" : "rounded-2xl border border-border bg-background/60 p-3"}>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {icon} {label}
      </div>
      <div className="truncate font-mono text-xs text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

function modelIdFromState(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parts = value.split("/");
  return parts[parts.length - 1];
}
