import { useMemo, useState, type ReactNode } from "react";
import { Brain, Folder, HardDrive, KeyRound, Repeat, Search, Settings, Workflow } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { PiDeliveryMode, PiModel, PiSettings, PiSettingsUpdate, PiState, PiThinkingLevel } from "@/shared/pi/types";

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
  const [modelQuery, setModelQuery] = useState("");
  const currentModelKey = modelKey(settings?.provider, settings?.model) ?? modelKeyFromState(state?.model);
  const currentThinking = settings?.thinkingLevel ?? state?.thinkingLevel ?? "off";
  const groupedModels = useMemo(() => groupModels(filterModels(models, modelQuery)), [models, modelQuery]);

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
              <span>Search models</span>
              <div className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-muted-foreground">
                <Search size={14} />
                <input
                  value={modelQuery}
                  placeholder="provider, name, model id..."
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  onChange={(event) => setModelQuery(event.target.value)}
                />
              </div>
            </label>

            <label className="mt-3 block space-y-1 text-xs text-muted-foreground">
              <span>Active model</span>
              <select
                value={currentModelKey ?? ""}
                className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary"
                onChange={(event) => {
                  const next = models.find((model) => modelKey(model.provider, model.id) === event.target.value);
                  if (!next) return;
                  void onUpdateSettings({ model: next.id, provider: next.provider });
                }}
              >
                {groupedModels.map((group) => (
                  <optgroup key={group.provider} label={`${group.provider} (${group.models.length})`}>
                    {group.models.map((model) => (
                      <option key={modelKey(model.provider, model.id)} value={modelKey(model.provider, model.id)}>
                        {model.id} — {model.name}
                      </option>
                    ))}
                  </optgroup>
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

          <section className="rounded-2xl border border-border bg-background/60 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Workflow size={14} /> Runtime behavior
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleCard
                icon={<Workflow size={14} />}
                label="auto compaction"
                description="Compact context when window nears limit."
                enabled={settings?.autoCompaction ?? true}
                onToggle={(enabled) => void onUpdateSettings({ autoCompaction: enabled })}
              />
              <ToggleCard
                icon={<Repeat size={14} />}
                label="auto retry"
                description="Retry transient provider errors."
                enabled={settings?.autoRetry ?? true}
                onToggle={(enabled) => void onUpdateSettings({ autoRetry: enabled })}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SelectCard
                label="steering mode"
                value={settings?.steeringMode ?? "one-at-a-time"}
                onChange={(value) => void onUpdateSettings({ steeringMode: value })}
              />
              <SelectCard
                label="follow-up mode"
                value={settings?.followUpMode ?? "one-at-a-time"}
                onChange={(value) => void onUpdateSettings({ followUpMode: value })}
              />
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <InfoCard icon={<Folder size={14} />} label="cwd" value={settings?.cwd ?? state?.cwd ?? "loading..."} />
            <InfoCard icon={<Settings size={14} />} label="client mode" value={settings?.clientMode ?? "loading"} />
            <InfoCard
              icon={<Settings size={14} />}
              label="SDK sidecar"
              value={settings?.sdkSidecar ? `${settings.sdkSidecar.available ? "available" : "unavailable"}${settings.sdkSidecar.version ? ` · ${settings.sdkSidecar.version}` : ""}${settings.sdkSidecar.error ? ` · ${settings.sdkSidecar.error}` : ""}` : "loading"}
            />
            <InfoCard icon={<HardDrive size={14} />} label="session dir" value={settings?.sessionDir ?? "default ~/.pi/agent/sessions"} wide />
            <InfoCard icon={<HardDrive size={14} />} label="session file" value={settings?.sessionFile ?? state?.sessionFile ?? "no session file"} wide />
          </section>

          <section className="rounded-2xl border border-border bg-background/60 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <KeyRound size={14} /> Auth status
            </div>
            <div className="space-y-2">
              {(settings?.auth?.length ? settings.auth : [{ provider: settings?.provider ?? "unknown", status: "unknown" as const, detail: "No auth probe available." }]).map((item) => (
                <div key={item.provider} className="flex items-center justify-between gap-3 rounded-xl bg-surface p-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono text-foreground">{item.provider}</div>
                    <div className="truncate text-muted-foreground">{item.detail ?? "status unavailable"}</div>
                  </div>
                  <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{item.status}</span>
                </div>
              ))}
            </div>
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

interface ToggleCardProps {
  icon: ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

function ToggleCard({ icon, label, description, enabled, onToggle }: ToggleCardProps) {
  return (
    <button
      className="rounded-2xl border border-border bg-surface p-3 text-left transition hover:border-primary/35"
      onClick={() => onToggle(!enabled)}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {icon} {label}
        </div>
        <span className={enabled ? "rounded-full border border-primary/30 px-2 py-0.5 text-[10px] text-primary" : "rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"}>
          {enabled ? "on" : "off"}
        </span>
      </div>
      <div className="text-xs leading-5 text-muted-foreground">{description}</div>
    </button>
  );
}

interface SelectCardProps {
  label: string;
  value: PiDeliveryMode;
  onChange: (value: PiDeliveryMode) => void;
}

function SelectCard({ label, value, onChange }: SelectCardProps) {
  return (
    <label className="block rounded-2xl border border-border bg-surface p-3 text-xs text-muted-foreground">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</span>
      <select
        value={value}
        className="h-9 w-full rounded-xl border border-border bg-background px-3 text-xs text-foreground outline-none transition focus:border-primary"
        onChange={(event) => onChange(event.target.value as PiDeliveryMode)}
      >
        <option value="one-at-a-time">one-at-a-time</option>
        <option value="all">all</option>
      </select>
    </label>
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

function modelKey(provider: string | undefined, model: string | undefined): string | undefined {
  if (!provider || !model) return undefined;
  return `${provider}/${model}`;
}

function modelKeyFromState(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.includes("/") ? value : undefined;
}

function filterModels(models: PiModel[], query: string): PiModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter((model) => [model.provider, model.id, model.name, model.api].filter(Boolean).join(" ").toLowerCase().includes(q));
}

function groupModels(models: PiModel[]): Array<{ provider: string; models: PiModel[] }> {
  const groups = new Map<string, PiModel[]>();
  for (const model of models) groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  return Array.from(groups.entries())
    .map(([provider, providerModels]) => ({
      provider,
      models: [...providerModels].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider));
}
