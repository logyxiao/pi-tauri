import { useMemo, useState, type ReactNode } from "react";
import { AppWindow, Brain, Folder, HardDrive, KeyRound, Repeat, Search, Settings, Workflow } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/shared/lib/cn";
import { useI18n } from "@/shared/i18n";
import type { PiDeliveryMode, PiModel, PiSettings, PiSettingsUpdate, PiState, PiThinkingLevel } from "@/shared/pi/types";

const thinkingLevels: PiThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
type SettingsSection = "model" | "runtime" | "workspace" | "auth" | "app";

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
  const { t, locale, setLocale } = useI18n();
  const [modelQuery, setModelQuery] = useState("");
  const [activeSection, setActiveSection] = useState<SettingsSection>("model");
  const currentModelKey = modelKey(settings?.provider, settings?.model) ?? modelKeyFromState(state?.model);
  const currentThinking = settings?.thinkingLevel ?? state?.thinkingLevel ?? "off";
  const persistedKeys = settings?.persistedSettings ? Object.keys(settings.persistedSettings).length : 0;
  const groupedModels = useMemo(() => groupModels(filterModels(models, modelQuery)), [models, modelQuery]);
  const navItems: Array<{ id: SettingsSection; icon: ReactNode; label: string; description: string }> = [
    { id: "model", icon: <Brain size={15} />, label: t("settings.navModel"), description: t("settings.navModelDesc") },
    { id: "runtime", icon: <Workflow size={15} />, label: t("settings.navRuntime"), description: t("settings.navRuntimeDesc") },
    { id: "workspace", icon: <Folder size={15} />, label: t("settings.navWorkspace"), description: t("settings.navWorkspaceDesc") },
    { id: "auth", icon: <KeyRound size={15} />, label: t("settings.navAuth"), description: t("settings.navAuthDesc") },
    { id: "app", icon: <AppWindow size={15} />, label: t("settings.navApp"), description: t("settings.navAppDesc") },
  ];
  const activeNav = navItems.find((item) => item.id === activeSection) ?? navItems[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("settings.title")} description={t("settings.description")} className="w-[min(94vw,920px)] p-0">
        <div className="flex max-h-[min(78vh,760px)] min-h-[560px] overflow-hidden rounded-none border-t border-border/60">
          <aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar/70 p-3 sm:block">
            <div className="mb-3 rounded-none border border-border bg-surface/65 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("settings.title")}</div>
              <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{settings?.clientMode ?? t("common.loading")}</div>
            </div>
            <nav className="space-y-1" aria-label={t("settings.title")}>
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-3 rounded-none border px-3 py-2.5 text-left transition",
                    activeSection === item.id
                      ? "border-primary/35 bg-surface text-primary"
                      : "border-transparent hover:border-border hover:bg-surface/65",
                  )}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span className={cn("mt-0.5 text-muted-foreground", activeSection === item.id && "text-primary")}>{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-foreground">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{item.description}</span>
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-border bg-surface/45 p-3 sm:hidden">
              <select
                value={activeSection}
                className="h-10 w-full rounded-none border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary"
                onChange={(event) => setActiveSection(event.target.value as SettingsSection)}
              >
                {navItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>

            <div className="border-b border-border bg-surface/35 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="text-primary">{activeNav.icon}</span>
                {activeNav.label}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{sectionDescription(activeSection, t)}</p>
            </div>

            <div className="settings-panel-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
              {activeSection === "model" ? (
                <div className="space-y-4">
                  <section className="rounded-none border border-border bg-background/60 p-4">
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <Brain size={14} /> {t("settings.model")}
                    </div>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>{t("settings.searchModels")}</span>
                      <div className="flex h-10 items-center gap-2 rounded-none border border-border bg-surface px-3 text-muted-foreground">
                        <Search size={14} />
                        <input
                          value={modelQuery}
                          placeholder={t("settings.searchPlaceholder")}
                          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          onChange={(event) => setModelQuery(event.target.value)}
                        />
                      </div>
                    </label>

                    <label className="mt-3 block space-y-1 text-xs text-muted-foreground">
                      <span>{t("settings.activeModel")}</span>
                      <select
                        value={currentModelKey ?? ""}
                        className="h-10 w-full rounded-none border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary"
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
                      <span>{t("settings.thinkingLevel")}</span>
                      <select
                        value={currentThinking}
                        className="h-10 w-full rounded-none border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary"
                        onChange={(event) => void onUpdateSettings({ thinkingLevel: event.target.value as PiThinkingLevel })}
                      >
                        {thinkingLevels.map((level) => (
                          <option key={level} value={level}>{level}</option>
                        ))}
                      </select>
                    </label>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2">
                    <InfoCard icon={<Settings size={14} />} label={`${t("settings.activeModel")} · ${settings?.settingsSources?.model ?? "runtime"}`} value={currentModelKey ?? t("common.loading")} />
                    <InfoCard icon={<Settings size={14} />} label={`${t("settings.thinkingLevel")} · ${settings?.settingsSources?.thinkingLevel ?? "runtime"}`} value={currentThinking} />
                  </section>
                </div>
              ) : null}

              {activeSection === "runtime" ? (
                <section className="rounded-none border border-border bg-background/60 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <Workflow size={14} /> {t("settings.runtimeBehavior")}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ToggleCard icon={<Workflow size={14} />} label={t("settings.autoCompaction")} description={t("settings.autoCompactionDesc")} enabled={settings?.autoCompaction ?? true} onToggle={(enabled) => void onUpdateSettings({ autoCompaction: enabled })} />
                    <ToggleCard icon={<Repeat size={14} />} label={t("settings.autoRetry")} description={t("settings.autoRetryDesc")} enabled={settings?.autoRetry ?? true} onToggle={(enabled) => void onUpdateSettings({ autoRetry: enabled })} />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <SelectCard label={t("settings.steeringMode")} value={settings?.steeringMode ?? "one-at-a-time"} onChange={(value) => void onUpdateSettings({ steeringMode: value })} />
                    <SelectCard label={t("settings.followUpMode")} value={settings?.followUpMode ?? "one-at-a-time"} onChange={(value) => void onUpdateSettings({ followUpMode: value })} />
                  </div>
                </section>
              ) : null}

              {activeSection === "workspace" ? (
                <div className="space-y-4">
                  <section className="grid gap-3 sm:grid-cols-2">
                    <InfoCard icon={<Folder size={14} />} label="cwd" value={settings?.cwd ?? state?.cwd ?? t("common.loading")} />
                    <InfoCard icon={<Settings size={14} />} label={t("settings.clientMode")} value={settings?.clientMode ?? t("common.loading")} />
                    <InfoCard icon={<Settings size={14} />} label={t("settings.sdkSidecar")} value={settings?.sdkSidecar ? `${settings.sdkSidecar.available ? t("settings.available") : t("settings.unavailable")}${settings.sdkSidecar.version ? ` · ${settings.sdkSidecar.version}` : ""}${settings.sdkSidecar.error ? ` · ${settings.sdkSidecar.error}` : ""}` : t("common.loading")} />
                    <InfoCard icon={<HardDrive size={14} />} label={t("settings.persistedSettings")} value={settings?.sdkSidecar?.available ? `${persistedKeys} ${t("settings.persistedKeys")}` : t("settings.unavailable")} />
                    <InfoCard icon={<HardDrive size={14} />} label={`${t("settings.sessionDir")} · ${settings?.settingsSources?.sessionDir ?? "fallback"}`} value={settings?.sessionDir ?? t("settings.defaultSessionDir")} wide />
                    <InfoCard icon={<HardDrive size={14} />} label={t("settings.sessionFile")} value={settings?.sessionFile ?? state?.sessionFile ?? t("settings.noSessionFile")} wide />
                  </section>
                  {settings?.settingsWarning ? (
                    <section className="rounded-none border border-warning/25 bg-warning/10 p-3 text-xs leading-5 text-muted-foreground">
                      <div className="mb-1 font-semibold uppercase tracking-[0.14em] text-warning">{t("settings.persistenceWarning")}</div>
                      {settings.settingsWarning}
                    </section>
                  ) : null}
                </div>
              ) : null}

              {activeSection === "auth" ? (
                <section className="rounded-none border border-border bg-background/60 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <KeyRound size={14} /> {t("settings.authStatus")}
                  </div>
                  <div className="space-y-2">
                    {(settings?.auth?.length ? settings.auth : [{ provider: settings?.provider ?? t("common.unknown"), status: "unknown" as const, detail: t("settings.noAuthProbe") }]).map((item) => (
                      <div key={item.provider} className="flex items-center justify-between gap-3 rounded-none bg-surface p-3 text-xs">
                        <div className="min-w-0">
                          <div className="font-mono text-foreground">{item.provider}</div>
                          <div className="truncate text-muted-foreground">{item.detail ?? t("settings.statusUnavailable")}</div>
                        </div>
                        <span className="rounded-none border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{item.status}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {activeSection === "app" ? (
                <div className="space-y-4">
                  <section className="grid gap-3 sm:grid-cols-2">
                    <LocaleCard locale={locale} onChange={setLocale} />
                  </section>
                  <div className="rounded-none border border-border bg-muted/45 p-3 text-xs leading-5 text-muted-foreground">
                    {t("settings.note")}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function sectionDescription(section: SettingsSection, t: (key: string) => string): string {
  if (section === "model") return t("settings.sectionModelDesc");
  if (section === "runtime") return t("settings.sectionRuntimeDesc");
  if (section === "workspace") return t("settings.sectionWorkspaceDesc");
  if (section === "auth") return t("settings.sectionAuthDesc");
  return t("settings.sectionAppDesc");
}

function LocaleCard({ locale, onChange }: { locale: "zh-CN" | "en"; onChange: (locale: "zh-CN" | "en") => void }) {
  const { t } = useI18n();
  return (
    <label className="block rounded-none border border-border bg-background/60 p-3 text-xs text-muted-foreground sm:col-span-2">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]">{t("language.label")}</span>
      <select value={locale} className="h-9 w-full rounded-none border border-border bg-surface px-3 text-xs text-foreground outline-none transition focus:border-primary" onChange={(event) => onChange(event.target.value as "zh-CN" | "en")}>
        <option value="zh-CN">{t("language.zh")}</option>
        <option value="en">{t("language.en")}</option>
      </select>
    </label>
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
  const { t } = useI18n();
  return (
    <button className="rounded-none border border-border bg-surface p-3 text-left transition hover:border-primary/35" onClick={() => onToggle(!enabled)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{icon} {label}</div>
        <span className={enabled ? "rounded-none border border-primary/30 px-2 py-0.5 text-[10px] text-primary" : "rounded-none border border-border px-2 py-0.5 text-[10px] text-muted-foreground"}>{enabled ? t("common.on") : t("common.off")}</span>
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
    <label className="block rounded-none border border-border bg-surface p-3 text-xs text-muted-foreground">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</span>
      <select value={value} className="h-9 w-full rounded-none border border-border bg-background px-3 text-xs text-foreground outline-none transition focus:border-primary" onChange={(event) => onChange(event.target.value as PiDeliveryMode)}>
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
    <div className={wide ? "rounded-none border border-border bg-background/60 p-3 sm:col-span-2" : "rounded-none border border-border bg-background/60 p-3"}>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{icon} {label}</div>
      <div className="truncate font-mono text-xs text-foreground" title={value}>{value}</div>
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
