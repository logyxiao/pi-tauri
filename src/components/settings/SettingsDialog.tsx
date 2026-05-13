import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, AppWindow, Brain, Code2, Command, Folder, HardDrive, Loader2, PanelTop, Plus, RefreshCw, Repeat, Save, Settings, ShieldAlert, Trash2, Workflow } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ExtensionsPanel } from "@/components/extensions/ExtensionsPanel";
import { SafetyPanel } from "@/components/safety/SafetyPanel";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { cn } from "@/shared/lib/cn";
import { useI18n } from "@/shared/i18n";
import type { PiCommand, PiDeliveryMode, PiExtensionError, PiExtensionPanel, PiModel, PiSafetyEvent, PiSettings, PiSettingsUpdate, PiState, PiThinkingLevel } from "@/shared/pi/types";

const thinkingLevels: PiThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
type SettingsSection = "model" | "runtime" | "workspace" | "commands" | "extensionPanels" | "extensionErrors" | "safety" | "app";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: PiState | null;
  settings: PiSettings | null;
  models: PiModel[];
  commands: PiCommand[];
  extensionPanels: PiExtensionPanel[];
  extensionErrors: PiExtensionError[];
  safetyEvents: PiSafetyEvent[];
  onUpdateSettings: (update: PiSettingsUpdate) => Promise<void> | void;
  onRefresh?: () => Promise<void> | void;
}

interface ModelsJsonState {
  path: string;
  exists: boolean;
  content: string;
}

interface ModelsJsonConfig {
  providers: Record<string, ModelProviderConfig>;
}

interface ModelProviderConfig {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: ModelEntryConfig[];
  [key: string]: unknown;
}

interface ModelEntryConfig {
  id?: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export function SettingsDialog({
  open,
  onOpenChange,
  state,
  settings,
  models,
  commands,
  extensionPanels,
  extensionErrors,
  safetyEvents,
  onUpdateSettings,
  onRefresh,
}: SettingsDialogProps) {
  const { t, locale, setLocale } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSection>("model");
  const [modelsJson, setModelsJson] = useState<ModelsJsonState | null>(null);
  const [modelsJsonDraft, setModelsJsonDraft] = useState("");
  const [modelsJsonStatus, setModelsJsonStatus] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [modelsJsonBusy, setModelsJsonBusy] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const currentModelKey = modelKey(settings?.provider, settings?.model) ?? modelKeyFromState(state?.model);
  const currentThinking = settings?.thinkingLevel ?? state?.thinkingLevel ?? "off";
  const persistedKeys = settings?.persistedSettings ? Object.keys(settings.persistedSettings).length : 0;
  const modelOptions = useMemo<SearchableSelectOption[]>(() => models.map((model) => ({
    value: modelKey(model.provider, model.id) ?? model.id,
    label: `${model.id} — ${model.name}`,
    description: model.provider,
    group: model.provider,
  })), [models]);
  const navItems: Array<{ id: SettingsSection; icon: ReactNode; label: string; description: string }> = [
    { id: "model", icon: <Brain size={15} />, label: t("settings.navModel"), description: t("settings.navModelDesc") },
    { id: "runtime", icon: <Workflow size={15} />, label: t("settings.navRuntime"), description: t("settings.navRuntimeDesc") },
    { id: "workspace", icon: <Folder size={15} />, label: t("settings.navWorkspace"), description: t("settings.navWorkspaceDesc") },
    { id: "commands", icon: <Command size={15} />, label: t("settings.navCommands"), description: t("settings.navCommandsDesc") },
    { id: "extensionPanels", icon: <PanelTop size={15} />, label: t("settings.navExtensionPanels"), description: t("settings.navExtensionPanelsDesc") },
    { id: "extensionErrors", icon: <AlertTriangle size={15} />, label: t("settings.navExtensionErrors"), description: t("settings.navExtensionErrorsDesc") },
    { id: "safety", icon: <ShieldAlert size={15} />, label: t("settings.navSafety"), description: t("settings.navSafetyDesc") },
    { id: "app", icon: <AppWindow size={15} />, label: t("settings.navApp"), description: t("settings.navAppDesc") },
  ];
  const activeNav = navItems.find((item) => item.id === activeSection) ?? navItems[0];
  const modelsJsonDirty = modelsJson ? modelsJsonDraft !== modelsJson.content : false;
  const modelsConfig = useMemo(() => parseModelsJsonConfig(modelsJsonDraft), [modelsJsonDraft]);
  const providerIds = Object.keys(modelsConfig?.providers ?? {});
  const filteredProviderIds = providerIds.filter((providerId) => providerId.toLowerCase().includes(providerQuery.trim().toLowerCase()));
  const activeProviderId = selectedProviderId && providerIds.includes(selectedProviderId) ? selectedProviderId : providerIds[0] ?? null;
  const activeProvider = activeProviderId ? modelsConfig?.providers[activeProviderId] : undefined;
  const modelsJsonSummary = useMemo(() => summarizeModelsConfig(modelsConfig, t), [modelsConfig, t]);

  useEffect(() => {
    if (!open || activeSection !== "model" || modelsJson) return;
    void loadModelsJson();
  }, [activeSection, modelsJson, open]);

  async function loadModelsJson() {
    setModelsJsonBusy(true);
    setModelsJsonStatus({ kind: "idle", text: "" });
    try {
      const next = await invoke<ModelsJsonState>("pi_models_json_read");
      setModelsJson(next);
      setModelsJsonDraft(next.content);
      const parsed = parseModelsJsonConfig(next.content);
      setSelectedProviderId(Object.keys(parsed?.providers ?? {})[0] ?? null);
    } catch (error) {
      setModelsJsonStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setModelsJsonBusy(false);
    }
  }

  async function saveModelsJson() {
    setModelsJsonBusy(true);
    setModelsJsonStatus({ kind: "idle", text: "" });
    try {
      const next = await invoke<ModelsJsonState>("pi_models_json_write", { content: modelsJsonDraft });
      setModelsJson(next);
      setModelsJsonDraft(next.content);
      setModelsJsonStatus({ kind: "success", text: t("settings.modelsJsonSaved") });
      await onRefresh?.();
    } catch (error) {
      setModelsJsonStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setModelsJsonBusy(false);
    }
  }

  function updateModelsConfig(mutator: (draft: ModelsJsonConfig) => void) {
    const draft = modelsConfig ? cloneModelsConfig(modelsConfig) : { providers: {} };
    mutator(draft);
    setModelsJsonDraft(JSON.stringify(draft, null, 2));
  }

  function addProvider() {
    updateModelsConfig((draft) => {
      const base = "custom-provider";
      let id = base;
      let index = 1;
      while (draft.providers[id]) id = `${base}-${index++}`;
      draft.providers[id] = { baseUrl: "", api: "openai-completions", apiKey: "", models: [] };
      setSelectedProviderId(id);
    });
  }

  function renameProvider(providerId: string, nextId: string) {
    const normalized = nextId.trim();
    if (!normalized || normalized === providerId) return;
    updateModelsConfig((draft) => {
      if (!draft.providers[providerId] || draft.providers[normalized]) return;
      draft.providers[normalized] = draft.providers[providerId];
      delete draft.providers[providerId];
      setSelectedProviderId(normalized);
    });
  }

  function deleteProvider(providerId: string) {
    updateModelsConfig((draft) => {
      delete draft.providers[providerId];
      const nextId = Object.keys(draft.providers)[0] ?? null;
      setSelectedProviderId(nextId);
    });
  }

  function updateProvider(providerId: string, update: Partial<ModelProviderConfig>) {
    updateModelsConfig((draft) => {
      draft.providers[providerId] = { ...(draft.providers[providerId] ?? {}), ...update };
    });
  }

  function addModel(providerId: string) {
    updateModelsConfig((draft) => {
      const provider = draft.providers[providerId];
      if (!provider) return;
      provider.models = [...(provider.models ?? []), { id: "new-model", name: "New Model", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 32000 }];
    });
  }

  function updateModel(providerId: string, index: number, next: ModelEntryConfig) {
    updateModelsConfig((draft) => {
      const provider = draft.providers[providerId];
      if (!provider?.models?.[index]) return;
      provider.models[index] = next;
    });
  }

  function deleteModel(providerId: string, index: number) {
    updateModelsConfig((draft) => {
      const provider = draft.providers[providerId];
      if (!provider?.models) return;
      provider.models = provider.models.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function fetchProviderModels(providerId: string) {
    const provider = modelsConfig?.providers[providerId];
    if (!provider?.baseUrl) {
      setModelsJsonStatus({ kind: "error", text: t("settings.modelsFetchMissingUrl") });
      return;
    }
    setModelsJsonBusy(true);
    setModelsJsonStatus({ kind: "success", text: t("settings.fetchingModels") });
    try {
      const ids = await invoke<string[]>("pi_fetch_provider_models", { baseUrl: provider.baseUrl, apiKey: provider.apiKey || null });
      if (!ids.length) throw new Error(t("settings.modelsFetchEmpty"));
      let addedModels = 0;
      updateModelsConfig((draft) => {
        const target = draft.providers[providerId];
        if (!target) return;
        const existing = new Set((target.models ?? []).map((model) => model.id).filter(Boolean));
        const next = ids.filter((id) => !existing.has(id)).map((id) => ({ id, name: id, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 32000 }));
        addedModels = next.length;
        target.models = [...(target.models ?? []), ...next];
      });
      const enabled = await invoke<{ added: number; path: string; enabledModels: string[] }>("pi_settings_enable_models", { models: ids });
      setModelsJsonStatus({ kind: "success", text: t("settings.modelsFetchSuccess", { count: ids.length, added: addedModels, enabled: enabled.added }) });
    } catch (error) {
      setModelsJsonStatus({ kind: "error", text: `${t("settings.modelsFetchFailed")}: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setModelsJsonBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("settings.title")} description={t("settings.description")} className="w-[min(94vw,920px)] bg-card p-4 sm:p-5">
        <div className="flex max-h-[min(78vh,760px)] min-h-[560px] overflow-hidden rounded-none border border-border/60 bg-surface/45">
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
                    "flex w-full cursor-pointer items-start gap-3 rounded-none border px-3 py-2.5 text-left transition",
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
              <SearchableSelect
                value={activeSection}
                options={navItems.map((item) => ({ value: item.id, label: item.label, description: item.description }))}
                searchPlaceholder={t("common.search")}
                emptyText={t("common.noResults")}
                onChange={(value) => setActiveSection(value as SettingsSection)}
              />
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
                  <section className="rounded-none border border-border bg-card/70 p-4">
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <Brain size={14} /> {t("settings.model")}
                    </div>
                    <label className="block space-y-1 text-xs text-muted-foreground">
                      <span>{t("settings.activeModel")}</span>
                      <SearchableSelect
                        value={currentModelKey ?? ""}
                        options={modelOptions}
                        placeholder={t("settings.activeModel")}
                        searchPlaceholder={t("settings.searchPlaceholder")}
                        emptyText={t("model.noMatch")}
                        onChange={(value) => {
                          const next = models.find((model) => modelKey(model.provider, model.id) === value);
                          if (!next) return;
                          void onUpdateSettings({ model: next.id, provider: next.provider });
                        }}
                      />
                    </label>

                    <label className="mt-3 block space-y-1 text-xs text-muted-foreground">
                      <span>{t("settings.thinkingLevel")}</span>
                      <SearchableSelect
                        value={currentThinking}
                        options={thinkingLevels.map((level) => ({ value: level, label: thinkingLevelLabel(level, t) }))}
                        searchPlaceholder={t("common.search")}
                        emptyText={t("common.noResults")}
                        onChange={(value) => void onUpdateSettings({ thinkingLevel: value as PiThinkingLevel })}
                      />
                    </label>
                  </section>

                  <section className="grid gap-3 sm:grid-cols-2">
                    <InfoCard icon={<Settings size={14} />} label={`${t("settings.activeModel")} · ${sourceLabel(settings?.settingsSources?.model, t)}`} value={currentModelKey ?? t("common.loading")} />
                    <InfoCard icon={<Settings size={14} />} label={`${t("settings.thinkingLevel")} · ${sourceLabel(settings?.settingsSources?.thinkingLevel, t)}`} value={thinkingLevelLabel(currentThinking, t)} />
                  </section>

                  <section className="overflow-hidden rounded-none border border-border bg-card/80 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/55 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          <Code2 size={13} /> {t("settings.modelsJson")}
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={modelsJson?.path ?? undefined}>
                          {modelsJson?.path ?? t("settings.modelsJsonPathLoading")}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{modelsJsonSummary}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <ButtonLike disabled={modelsJsonBusy} onClick={() => void loadModelsJson()} icon={<RefreshCw size={13} />} label={t("common.refresh")} />
                        <ButtonLike disabled={modelsJsonBusy || !modelsJsonDirty || !modelsConfig} onClick={() => void saveModelsJson()} icon={<Save size={13} />} label={t("common.save")} primary />
                      </div>
                    </div>

                    {modelsConfig ? (
                      <div className="grid min-h-[520px] md:grid-cols-[220px_minmax(0,1fr)]">
                        <aside className="flex min-h-0 flex-col border-r border-border bg-sidebar/45">
                          <div className="border-b border-border p-2.5">
                            <input className="h-8 w-full rounded-none border border-border bg-background/70 px-2.5 text-xs outline-none focus:border-primary/45" placeholder={t("settings.searchProviders")} value={providerQuery} onChange={(event) => setProviderQuery(event.currentTarget.value)} />
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                            {filteredProviderIds.map((providerId) => {
                              const provider = modelsConfig.providers[providerId];
                              const selected = providerId === activeProviderId;
                              return (
                                <button
                                  key={providerId}
                                  type="button"
                                  className={cn("mb-1 flex h-10 w-full cursor-pointer items-center gap-2 rounded-none border px-2.5 text-left transition", selected ? "border-primary/35 bg-surface text-primary" : "border-transparent hover:border-border hover:bg-surface/70")}
                                  onClick={() => setSelectedProviderId(providerId)}
                                >
                                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[10px] font-semibold uppercase">{providerId.slice(0, 2)}</span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-semibold">{providerId}</span>
                                    <span className="block truncate text-[10px] text-muted-foreground">{provider.models?.length ?? 0} {t("settings.models")}</span>
                                  </span>
                                  <span className={cn("size-2 rounded-full", provider.apiKey ? "bg-success" : "bg-muted-foreground/30")} />
                                </button>
                              );
                            })}
                          </div>
                          <div className="border-t border-border p-2">
                            <ButtonLike className="w-full justify-center" onClick={() => addProvider()} icon={<Plus size={12} />} label={t("settings.addProvider")} />
                          </div>
                        </aside>

                        <div className="min-w-0 p-4">
                          {activeProviderId && activeProvider ? (
                            <div className="space-y-4">
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold uppercase">{activeProviderId.slice(0, 2)}</span>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                      <input className="h-8 w-48 rounded-none border border-transparent bg-transparent px-1 outline-none focus:border-primary/45" value={activeProviderId} onChange={(event) => renameProvider(activeProviderId, event.currentTarget.value)} />
                                      <span className="rounded-none bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{activeProvider.apiKey ? t("settings.configured") : t("settings.unconfigured")}</span>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">{activeProvider.models?.length ?? 0} {t("settings.models")}</div>
                                  </div>
                                </div>
                                <ButtonLike onClick={() => deleteProvider(activeProviderId)} icon={<Trash2 size={12} />} label={t("common.delete")} />
                              </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <TextField label={t("settings.apiKey")} value={activeProvider.apiKey ?? ""} placeholder="OPENAI_API_KEY" onChange={(value) => updateProvider(activeProviderId, { apiKey: value })} />
                                <TextField label={t("settings.apiType")} value={activeProvider.api ?? "openai-completions"} placeholder="openai-completions" onChange={(value) => updateProvider(activeProviderId, { api: value })} />
                                <TextField wide label={t("settings.apiUrl")} value={activeProvider.baseUrl ?? ""} placeholder="https://api.openai.com/v1" onChange={(value) => updateProvider(activeProviderId, { baseUrl: value })} />
                              </div>

                              <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("settings.availableModels")}</div>
                                  <div className="flex items-center gap-2">
                                    <ButtonLike disabled={modelsJsonBusy || !activeProvider.baseUrl} onClick={() => void fetchProviderModels(activeProviderId)} icon={modelsJsonBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} label={modelsJsonBusy ? t("settings.fetchingModels") : t("settings.fetchModels")} />
                                    <ButtonLike onClick={() => addModel(activeProviderId)} icon={<Plus size={12} />} label={t("settings.addModel")} />
                                  </div>
                                </div>
                                <div className="overflow-hidden rounded-none border border-border bg-background/35">
                                  <div className="grid grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(0,1fr)_2rem] items-center gap-2 border-b border-border bg-surface/45 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                    <span>{t("common.on")}</span>
                                    <span>{t("settings.modelId")}</span>
                                    <span>{t("settings.modelName")}</span>
                                    <span />
                                  </div>
                                  <div className="divide-y divide-border">
                                  {(activeProvider.models ?? []).map((model, index) => (
                                    <ModelRow
                                      key={`${activeProviderId}-${index}`}
                                      model={model}
                                      onChange={(next) => updateModel(activeProviderId, index, next)}
                                      onDelete={() => deleteModel(activeProviderId, index)}
                                    />
                                  ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex h-full min-h-[320px] items-center justify-center text-xs text-muted-foreground">{t("settings.noProviders")}</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4">
                        <textarea className="h-72 w-full resize-y rounded-none border border-border bg-background/80 p-3 font-mono text-xs leading-5 text-foreground outline-none focus:border-primary/50" spellCheck={false} value={modelsJsonDraft} placeholder={t("settings.modelsJsonPlaceholder")} onChange={(event) => setModelsJsonDraft(event.currentTarget.value)} />
                      </div>
                    )}
                    <div className="border-t border-border p-3 text-xs leading-5 text-muted-foreground">{t("settings.modelsJsonHelp")}</div>
                    {modelsJsonStatus.kind !== "idle" ? (
                      <div className={cn("m-3 rounded-none border px-3 py-2 text-xs", modelsJsonStatus.kind === "success" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}>{modelsJsonStatus.text}</div>
                    ) : null}
                  </section>
                </div>
              ) : null}

              {activeSection === "runtime" ? (
                <section className="rounded-none border border-border bg-card/70 p-4">
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
                    <InfoCard icon={<HardDrive size={14} />} label={`${t("settings.sessionDir")} · ${sourceLabel(settings?.settingsSources?.sessionDir, t)}`} value={settings?.sessionDir ?? t("settings.defaultSessionDir")} wide />
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

              {activeSection === "commands" ? (
                <ExtensionsPanel commands={commands} extensionPanels={extensionPanels} extensionErrors={extensionErrors} sections={["commands"]} />
              ) : null}

              {activeSection === "extensionPanels" ? (
                <ExtensionsPanel commands={commands} extensionPanels={extensionPanels} extensionErrors={extensionErrors} sections={["panels"]} />
              ) : null}

              {activeSection === "extensionErrors" ? (
                <ExtensionsPanel commands={commands} extensionPanels={extensionPanels} extensionErrors={extensionErrors} sections={["errors"]} />
              ) : null}

              {activeSection === "safety" ? (
                <SafetyPanel events={safetyEvents} />
              ) : null}

              {activeSection === "app" ? (
                <div className="space-y-4">
                  <section className="grid gap-3 sm:grid-cols-2">
                    <LocaleCard locale={locale} onChange={setLocale} />
                  </section>
                  <div className="rounded-none border border-border bg-card/60 p-3 text-xs leading-5 text-muted-foreground">
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
  if (section === "commands") return t("settings.sectionCommandsDesc");
  if (section === "extensionPanels") return t("settings.sectionExtensionPanelsDesc");
  if (section === "extensionErrors") return t("settings.sectionExtensionErrorsDesc");
  if (section === "safety") return t("settings.sectionSafetyDesc");
  return t("settings.sectionAppDesc");
}

function sourceLabel(source: string | undefined, t: (key: string) => string) {
  if (source === "runtime") return t("settings.sourceRuntime");
  if (source === "persisted") return t("settings.sourcePersisted");
  if (source === "fallback") return t("settings.sourceFallback");
  if (source === "unknown") return t("common.unknown");
  return t("settings.sourceRuntime");
}

function thinkingLevelLabel(level: PiThinkingLevel, t: (key: string) => string) {
  return t(`settings.thinking.${level}`);
}

function parseModelsJsonConfig(content: string): ModelsJsonConfig | null {
  try {
    const parsed = JSON.parse(content) as ModelsJsonConfig;
    if (!parsed || typeof parsed !== "object" || !parsed.providers || typeof parsed.providers !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function cloneModelsConfig(config: ModelsJsonConfig): ModelsJsonConfig {
  return JSON.parse(JSON.stringify(config)) as ModelsJsonConfig;
}

function summarizeModelsConfig(config: ModelsJsonConfig | null, t: (key: string, vars?: Record<string, string | number>) => string) {
  if (!config) return t("settings.modelsJsonInvalid");
  const providers = Object.keys(config.providers);
  const modelCount = providers.reduce((total, provider) => total + (config.providers[provider].models?.length ?? 0), 0);
  return t("settings.modelsJsonSummary", { providers: providers.length, models: modelCount });
}

function TextField({ label, value, placeholder, wide, onChange }: { label: string; value: string; placeholder?: string; wide?: boolean; onChange: (value: string) => void }) {
  return (
    <label className={cn("block text-xs text-muted-foreground", wide && "sm:col-span-2")}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em]">{label}</span>
      <input className="h-9 w-full rounded-none border border-border bg-background/70 px-3 text-xs text-foreground outline-none transition focus:border-primary/45" value={value} placeholder={placeholder} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function ModelRow({ model, onChange, onDelete }: { model: ModelEntryConfig; onChange: (model: ModelEntryConfig) => void; onDelete: () => void }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(0,1fr)_2rem] items-center gap-2 px-3 py-2.5">
      <button
        type="button"
        className={cn("relative h-5 w-9 cursor-pointer rounded-full transition", model.id ? "bg-primary" : "bg-muted")}
        onClick={() => onChange({ ...model, id: model.id ? "" : "new-model" })}
        aria-label={t("settings.toggleModel")}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition", model.id ? "right-0.5" : "left-0.5")} />
      </button>
      <input className="h-8 min-w-0 rounded-none border border-transparent bg-transparent px-2 text-sm font-semibold text-foreground outline-none focus:border-primary/45" value={model.id ?? ""} placeholder="model-id" onChange={(event) => onChange({ ...model, id: event.currentTarget.value })} />
      <input className="h-8 min-w-0 rounded-none border border-transparent bg-transparent px-2 text-xs text-muted-foreground outline-none focus:border-primary/45" value={model.name ?? ""} placeholder={t("settings.modelName")} onChange={(event) => onChange({ ...model, name: event.currentTarget.value })} />
      <button type="button" className="flex size-7 cursor-pointer items-center justify-center justify-self-end text-muted-foreground transition hover:text-destructive" onClick={onDelete} aria-label={t("common.delete")}><Trash2 size={13} /></button>
    </div>
  );
}

function ButtonLike({ label, icon, primary, disabled, className, onClick }: { label: string; icon: ReactNode; primary?: boolean; disabled?: boolean; className?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-none border px-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45",
        primary ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15" : "border-border bg-surface/80 text-muted-foreground hover:border-primary/35 hover:text-foreground",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function LocaleCard({ locale, onChange }: { locale: "zh-CN" | "en"; onChange: (locale: "zh-CN" | "en") => void }) {
  const { t } = useI18n();
  return (
    <label className="block rounded-none border border-border bg-card/70 p-3 text-xs text-muted-foreground sm:col-span-2">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]">{t("language.label")}</span>
      <SearchableSelect
        value={locale}
        options={[{ value: "zh-CN", label: t("language.zh") }, { value: "en", label: t("language.en") }]}
        searchPlaceholder={t("common.search")}
        emptyText={t("common.noResults")}
        onChange={(value) => onChange(value as "zh-CN" | "en")}
      />
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
    <button className="cursor-pointer rounded-none border border-border bg-surface/80 p-3 text-left transition hover:border-primary/35" onClick={() => onToggle(!enabled)}>
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
  const { t } = useI18n();
  return (
    <label className="block rounded-none border border-border bg-surface/80 p-3 text-xs text-muted-foreground">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</span>
      <SearchableSelect
        value={value}
        options={[{ value: "one-at-a-time", label: t("settings.deliveryOneAtATime") }, { value: "all", label: t("settings.deliveryAll") }]}
        searchPlaceholder={t("common.search")}
        emptyText={t("common.noResults")}
        onChange={(next) => onChange(next as PiDeliveryMode)}
      />
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
    <div className={wide ? "rounded-none border border-border bg-card/70 p-3 sm:col-span-2" : "rounded-none border border-border bg-card/70 p-3"}>
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


