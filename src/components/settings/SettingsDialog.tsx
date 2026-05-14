import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppWindow, Brain, CircleCheck, Code2, Command, Loader2, PanelTop, Plus, RefreshCw, Settings, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ExtensionsPanel } from "@/components/extensions/ExtensionsPanel";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { cn } from "@/shared/lib/cn";
import { useI18n } from "@/shared/i18n";
import type { PiCommand, PiExtensionError, PiExtensionPanel, PiExtensionResource, PiModel, PiSettings, PiSettingsUpdate, PiSkillResource, PiState, PiThinkingLevel } from "@/shared/pi/types";
import { appFontOptions, detectFontAvailability, readStoredAppFontId, setStoredAppFont, type AppFontId } from "@/shared/ui/font-preferences";

const thinkingLevels: PiThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
type SettingsSection = "model" | "commands" | "extensionPanels" | "skills" | "app";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: PiState | null;
  settings: PiSettings | null;
  models: PiModel[];
  commands: PiCommand[];
  extensionPanels: PiExtensionPanel[];
  extensionErrors: PiExtensionError[];
  onUpdateSettings: (update: PiSettingsUpdate) => Promise<void> | void;
  onRefresh?: (scope?: string, options?: { forceModels?: boolean }) => Promise<void> | void;
}

interface ModelsJsonState {
  path: string;
  exists: boolean;
  content: string;
}

interface ModelsJsonConfig {
  providers: Record<string, ModelProviderConfig>;
}

interface CcSwitchSyncResult {
  path: string;
  ccSwitchDb: string;
  providers: number;
  models: number;
  enabled: number;
  content: string;
}

interface ModelProviderConfig {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  authHeader?: boolean;
  balanceApiKey?: string;
  balanceBaseUrl?: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  models?: ModelEntryConfig[];
  [key: string]: unknown;
}

interface ModelEntryConfig {
  id?: string;
  name?: string;
  api?: string;
  enabled?: boolean;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

interface ProviderProbeResult {
  status: string;
  modelCount?: number;
  balance?: string;
  balanceSource?: string;
  detail?: string;
}

interface ProviderTestResult {
  status: string;
  modelCount?: number;
  url?: string;
  latencyMs?: number;
  detail?: string;
}

interface ProviderBalanceSnapshot {
  balance: string;
  source?: string;
  checkedAt: string;
}

const PROVIDER_BALANCE_STORAGE_KEY = "pi-tauri.providerBalances";

export function SettingsDialog({
  open,
  onOpenChange,
  state,
  settings,
  models,
  commands,
  extensionPanels,
  extensionErrors,
  onUpdateSettings,
  onRefresh,
}: SettingsDialogProps) {
  const { t, locale, setLocale } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSection>("model");
  const [modelsJson, setModelsJson] = useState<ModelsJsonState | null>(null);
  const [modelsJsonDraft, setModelsJsonDraft] = useState("");
  const [modelsJsonStatus, setModelsJsonStatus] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [extensionActionStatus, setExtensionActionStatus] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [skillActionStatus, setSkillActionStatus] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [busyExtensionPath, setBusyExtensionPath] = useState<string | null>(null);
  const [busySkillPath, setBusySkillPath] = useState<string | null>(null);
  const [modelsJsonBusy, setModelsJsonBusy] = useState(false);
  const [ccSwitchSyncBusy, setCcSwitchSyncBusy] = useState(false);
  const [providerProbeBusy, setProviderProbeBusy] = useState(false);
  const [providerProbe, setProviderProbe] = useState<ProviderProbeResult | null>(null);
  const [providerTestBusy, setProviderTestBusy] = useState(false);
  const [providerTest, setProviderTest] = useState<ProviderTestResult | null>(null);
  const [providerBalances, setProviderBalances] = useState<Record<string, ProviderBalanceSnapshot>>(() => readStoredProviderBalances());
  const [defaultFontId, setDefaultFontId] = useState<AppFontId>(() => readStoredAppFontId());
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const currentModelKey = modelKey(settings?.provider, settings?.model) ?? modelKeyFromState(state?.model);
  const currentThinking = settings?.thinkingLevel ?? state?.thinkingLevel ?? "off";
  const modelOptions = useMemo<SearchableSelectOption[]>(() => models.map((model) => ({
    value: modelKey(model.provider, model.id) ?? model.id,
    label: `${model.id} — ${model.name}`,
    description: model.provider,
    group: model.provider,
  })), [models]);
  const navItems: Array<{ id: SettingsSection; icon: ReactNode; label: string; description: string }> = [
    { id: "model", icon: <Brain size={15} />, label: t("settings.navModel"), description: t("settings.navModelDesc") },
    { id: "commands", icon: <Command size={15} />, label: t("settings.navCommands"), description: t("settings.navCommandsDesc") },
    { id: "extensionPanels", icon: <PanelTop size={15} />, label: t("settings.navExtensionPanels"), description: t("settings.navExtensionPanelsDesc") },
    { id: "skills", icon: <Sparkles size={15} />, label: t("settings.navSkills"), description: t("settings.navSkillsDesc") },
    { id: "app", icon: <AppWindow size={15} />, label: t("settings.navApp"), description: t("settings.navAppDesc") },
  ];
  const activeNav = navItems.find((item) => item.id === activeSection) ?? navItems[0];
  const modelsConfig = useMemo(() => parseModelsJsonConfig(modelsJsonDraft), [modelsJsonDraft]);
  const providerIds = Object.keys(modelsConfig?.providers ?? {});
  const filteredProviderIds = providerIds.filter((providerId) => providerId.toLowerCase().includes(providerQuery.trim().toLowerCase()));
  const activeProviderId = selectedProviderId && providerIds.includes(selectedProviderId) ? selectedProviderId : providerIds[0] ?? null;
  const activeProvider = activeProviderId ? modelsConfig?.providers[activeProviderId] : undefined;
  const activeProviderBalanceKey = activeProviderId && activeProvider ? providerBalanceKey(activeProviderId, activeProvider.baseUrl) : null;
  const activeProviderLastBalance = activeProviderBalanceKey ? providerBalances[activeProviderBalanceKey] ?? providerBalances[providerBalanceKey(activeProviderId ?? "")] : undefined;
  const modelsJsonSummary = useMemo(() => summarizeModelsConfig(modelsConfig, t), [modelsConfig, t]);

  useEffect(() => {
    setProviderProbe(null);
    setProviderTest(null);
  }, [activeProviderId]);

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

  function updateModelsConfig(mutator: (draft: ModelsJsonConfig) => void) {
    const draft = modelsConfig ? cloneModelsConfig(modelsConfig) : { providers: {} };
    mutator(draft);
    setModelsJsonDraft(JSON.stringify(draft, null, 2));
  }

  async function persistModelsConfig(draft: ModelsJsonConfig, providerId?: string) {
    const content = JSON.stringify(draft, null, 2);
    setModelsJsonDraft(content);
    setModelsJsonBusy(true);
    setModelsJsonStatus({ kind: "idle", text: "" });
    try {
      const saved = await invoke<ModelsJsonState>("pi_models_json_write", { content });
      setModelsJson(saved);
      setModelsJsonDraft(saved.content);
      if (providerId) {
        await syncProviderModelSelection(providerId, draft.providers[providerId]);
      }
      setModelsJsonStatus({ kind: "success", text: t("settings.modelsJsonSaved") });
      await onRefresh?.("settings.modelsJsonSaved", { forceModels: true });
    } catch (error) {
      setModelsJsonStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setModelsJsonBusy(false);
    }
  }

  async function updateModelsConfigAndSave(mutator: (draft: ModelsJsonConfig) => void, providerId?: string) {
    const draft = modelsConfig ? cloneModelsConfig(modelsConfig) : { providers: {} };
    mutator(draft);
    await persistModelsConfig(draft, providerId);
  }

  async function syncProviderModelSelection(providerId: string, provider?: ModelProviderConfig) {
    if (!provider) return;
    const modelIds = (provider.models ?? []).map((model) => model.id?.trim()).filter((id): id is string => Boolean(id));
    const disabledModels = (provider.models ?? [])
      .filter((model) => model.enabled === false)
      .map((model) => model.id?.trim())
      .filter((id): id is string => Boolean(id));
    const disabledSet = new Set(disabledModels);
    const enabledModels = modelIds.filter((id) => !disabledSet.has(id));
    await invoke("pi_settings_set_provider_model_selection", {
      providerId,
      providerEnabled: providerEnabled(provider),
      enabledModels,
      disabledModels,
      legacyModelsToRemove: modelIds,
    });
  }

  function addProvider() {
    void updateModelsConfigAndSave((draft) => {
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
    void updateModelsConfigAndSave((draft) => {
      if (!draft.providers[providerId] || draft.providers[normalized]) return;
      draft.providers[normalized] = draft.providers[providerId];
      delete draft.providers[providerId];
      setSelectedProviderId(normalized);
    });
  }

  function deleteProvider(providerId: string) {
    void updateModelsConfigAndSave((draft) => {
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

  function commitProvider(providerId: string, update: Partial<ModelProviderConfig>) {
    void updateModelsConfigAndSave((draft) => {
      draft.providers[providerId] = { ...(draft.providers[providerId] ?? {}), ...update };
    }, providerId);
  }

  function addModel(providerId: string) {
    void updateModelsConfigAndSave((draft) => {
      const provider = draft.providers[providerId];
      if (!provider) return;
      provider.models = [...(provider.models ?? []), { id: "new-model", name: "New Model", enabled: true, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 32000 }];
    }, providerId);
  }

  function updateModel(providerId: string, index: number, next: ModelEntryConfig) {
    void updateModelsConfigAndSave((draft) => {
      const provider = draft.providers[providerId];
      if (!provider?.models?.[index]) return;
      provider.models[index] = next;
    }, providerId);
  }

  function updateModelDraft(providerId: string, index: number, next: ModelEntryConfig) {
    updateModelsConfig((draft) => {
      const provider = draft.providers[providerId];
      if (!provider?.models?.[index]) return;
      provider.models[index] = next;
    });
  }

  function deleteModel(providerId: string, index: number) {
    void updateModelsConfigAndSave((draft) => {
      const provider = draft.providers[providerId];
      if (!provider?.models) return;
      provider.models = provider.models.filter((_, itemIndex) => itemIndex !== index);
    }, providerId);
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
      const ids = await invoke<string[]>("pi_fetch_provider_models", { baseUrl: provider.baseUrl, apiKey: provider.apiKey || null, headers: provider.headers ?? null, authHeader: provider.authHeader ?? true });
      if (!ids.length) throw new Error(t("settings.modelsFetchEmpty"));
      let addedModels = 0;
      let nextContent = modelsJsonDraft;
      updateModelsConfig((draft) => {
        const target = draft.providers[providerId];
        if (!target) return;
        const existing = new Set((target.models ?? []).map((model) => model.id).filter(Boolean));
        const next = ids.filter((id) => !existing.has(id)).map((id) => ({ id, name: id, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 32000 }));
        addedModels = next.length;
        target.models = [...(target.models ?? []), ...next];
        nextContent = JSON.stringify(draft, null, 2);
      });
      const saved = await invoke<ModelsJsonState>("pi_models_json_write", { content: nextContent });
      setModelsJson(saved);
      setModelsJsonDraft(saved.content);
      const selectedProvider = parseModelsJsonConfig(saved.content)?.providers[providerId];
      await syncProviderModelSelection(providerId, selectedProvider);
      await onRefresh?.("settings.fetchProviderModels", { forceModels: true });
      setModelsJsonStatus({ kind: "success", text: t("settings.modelsFetchSuccess", { count: ids.length, added: addedModels, enabled: selectedProvider ? 1 : 0 }) });
    } catch (error) {
      setModelsJsonStatus({ kind: "error", text: `${t("settings.modelsFetchFailed")}: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setModelsJsonBusy(false);
    }
  }

  async function syncCcSwitchModels() {
    setCcSwitchSyncBusy(true);
    setModelsJsonStatus({ kind: "idle", text: "" });
    try {
      const result = await invoke<CcSwitchSyncResult>("pi_sync_cc_switch_models");
      setModelsJson({ path: result.path, exists: true, content: result.content });
      setModelsJsonDraft(result.content);
      const parsed = parseModelsJsonConfig(result.content);
      setSelectedProviderId(Object.keys(parsed?.providers ?? {})[0] ?? null);
      await onRefresh?.("settings.syncCcSwitchModels", { forceModels: true });
      setModelsJsonStatus({ kind: "success", text: t("settings.ccSwitchSyncSuccess", { providers: result.providers, models: result.models, enabled: result.enabled }) });
    } catch (error) {
      setModelsJsonStatus({ kind: "error", text: `${t("settings.ccSwitchSyncFailed")}: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setCcSwitchSyncBusy(false);
    }
  }

  async function setProviderEnabled(providerId: string, enabled: boolean) {
    const provider = modelsConfig?.providers[providerId];
    if (!modelsConfig || !provider) return;
    const draft = cloneModelsConfig(modelsConfig);
    draft.providers[providerId] = { ...draft.providers[providerId], enabled };
    const content = JSON.stringify(draft, null, 2);
    setModelsJsonBusy(true);
    setModelsJsonStatus({ kind: "idle", text: "" });
    try {
      const saved = await invoke<ModelsJsonState>("pi_models_json_write", { content });
      setModelsJson(saved);
      setModelsJsonDraft(saved.content);
      await syncProviderModelSelection(providerId, draft.providers[providerId]);
      setModelsJsonStatus({ kind: "success", text: enabled ? t("settings.providerEnabled") : t("settings.providerDisabled") });
      await onRefresh?.("settings.providerEnabled", { forceModels: true });
    } catch (error) {
      setModelsJsonStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setModelsJsonBusy(false);
    }
  }

  async function probeProvider(providerId: string) {
    const provider = modelsConfig?.providers[providerId];
    if (!provider?.baseUrl) {
      setModelsJsonStatus({ kind: "error", text: t("settings.modelsFetchMissingUrl") });
      return;
    }
    setProviderProbeBusy(true);
    setProviderProbe(null);
    setModelsJsonStatus({ kind: "idle", text: "" });
    try {
      const result = await invoke<ProviderProbeResult>("pi_probe_provider", { baseUrl: provider.baseUrl, apiKey: provider.apiKey || null, headers: provider.headers ?? null, authHeader: provider.authHeader ?? true, balanceBaseUrl: provider.balanceBaseUrl || null, balanceApiKey: provider.balanceApiKey || null });
      setProviderProbe(result);
      if (result.balance) {
        const snapshot = { balance: balanceWithDefaultUnit(result.balance), source: result.balanceSource, checkedAt: new Date().toISOString() };
        setProviderBalances((current) => {
          const next = {
            ...current,
            [providerBalanceKey(providerId, provider.baseUrl)]: snapshot,
            [providerBalanceKey(providerId)]: snapshot,
          };
          writeStoredProviderBalances(next);
          return next;
        });
      }
    } catch (error) {
      setModelsJsonStatus({ kind: "error", text: `${t("settings.providerProbeFailed")}: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setProviderProbeBusy(false);
    }
  }

  async function testProvider(providerId: string) {
    const provider = modelsConfig?.providers[providerId];
    if (!provider?.baseUrl) {
      setModelsJsonStatus({ kind: "error", text: t("settings.modelsFetchMissingUrl") });
      return;
    }
    setProviderTestBusy(true);
    setProviderTest(null);
    setModelsJsonStatus({ kind: "idle", text: "" });
    try {
      const result = await invoke<ProviderTestResult>("pi_test_provider", { baseUrl: provider.baseUrl, apiKey: provider.apiKey || null, headers: provider.headers ?? null, authHeader: provider.authHeader ?? true });
      setProviderTest(result);
    } catch (error) {
      setModelsJsonStatus({ kind: "error", text: `${t("settings.providerTestFailed")}: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setProviderTestBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("settings.title")} description={t("settings.description")} className="w-[min(96vw,1120px)] bg-card p-4 sm:p-5">
        <div className="flex max-h-[min(86vh,880px)] min-h-[680px] overflow-hidden rounded-none border border-border/60 bg-surface/45">
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
                        <ButtonLike disabled={ccSwitchSyncBusy || modelsJsonBusy} onClick={() => void syncCcSwitchModels()} icon={ccSwitchSyncBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />} label={ccSwitchSyncBusy ? t("settings.ccSwitchSyncing") : t("settings.syncCcSwitch")} />
                        <ButtonLike disabled={modelsJsonBusy} onClick={() => void loadModelsJson()} icon={<RefreshCw />} label={t("common.refresh")} />
                      </div>
                    </div>

                    {modelsConfig ? (
                      <div className="grid min-h-[620px] md:grid-cols-[240px_minmax(0,1fr)]">
                        <aside className="flex min-h-0 flex-col border-r border-border bg-sidebar/45">
                          <div className="border-b border-border p-2.5">
                            <input className="h-8 w-full rounded-none border border-border bg-background/70 px-2.5 text-xs outline-none focus:border-primary/45" placeholder={t("settings.searchProviders")} value={providerQuery} onChange={(event) => setProviderQuery(event.currentTarget.value)} />
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                            {filteredProviderIds.map((providerId) => {
                              const provider = modelsConfig.providers[providerId];
                              const selected = providerId === activeProviderId;
                              const enabled = providerEnabled(provider);
                              return (
                                <div
                                  key={providerId}
                                  className={cn("mb-1 flex h-12 w-full items-center gap-2 rounded-none border px-2 text-left transition", selected ? "border-primary/35 bg-surface text-primary" : "border-transparent hover:border-border hover:bg-surface/70")}
                                >
                                  <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" onClick={() => setSelectedProviderId(providerId)}>
                                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[10px] font-semibold uppercase">{providerId.slice(0, 2)}</span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-xs font-semibold">{providerId}</span>
                                      <span className="block truncate text-[10px] text-muted-foreground">{provider.models?.length ?? 0} {t("settings.models")}</span>
                                    </span>
                                  </button>
                                  <ToggleSwitch checked={enabled} disabled={modelsJsonBusy} label={enabled ? t("settings.providerEnabled") : t("settings.providerDisabled")} onChange={(next) => void setProviderEnabled(providerId, next)} />
                                </div>
                              );
                            })}
                          </div>
                          <div className="border-t border-border p-2">
                            <ButtonLike className="w-full justify-center" onClick={() => addProvider()} icon={<Plus />} label={t("settings.addProvider")} />
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
                                      <span className={cn("rounded-none px-2 py-0.5 text-[11px]", providerEnabled(activeProvider) ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{providerEnabled(activeProvider) ? t("settings.providerEnabled") : t("settings.providerDisabled")}</span>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">{activeProvider.models?.length ?? 0} {t("settings.models")}</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-muted-foreground">{providerEnabled(activeProvider) ? t("settings.providerEnabled") : t("settings.providerDisabled")}</span>
                                  <ToggleSwitch checked={providerEnabled(activeProvider)} disabled={modelsJsonBusy} label={providerEnabled(activeProvider) ? t("settings.providerEnabled") : t("settings.providerDisabled")} onChange={(next) => void setProviderEnabled(activeProviderId, next)} />
                                  <ButtonLike onClick={() => deleteProvider(activeProviderId)} icon={<Trash2 />} label={t("common.delete")} />
                                </div>
                              </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <TextField label={t("settings.apiKey")} value={activeProvider.apiKey ?? ""} placeholder="OPENAI_API_KEY" onChange={(value) => updateProvider(activeProviderId, { apiKey: value })} onCommit={(value) => commitProvider(activeProviderId, { apiKey: value })} />
                                <TextField label={t("settings.apiType")} value={activeProvider.api ?? "openai-completions"} placeholder="openai-completions" onChange={(value) => updateProvider(activeProviderId, { api: value })} onCommit={(value) => commitProvider(activeProviderId, { api: value })} />
                                <TextField wide label={t("settings.apiUrl")} value={activeProvider.baseUrl ?? ""} placeholder="https://api.openai.com/v1" onChange={(value) => updateProvider(activeProviderId, { baseUrl: value })} onCommit={(value) => commitProvider(activeProviderId, { baseUrl: value })} />
                              </div>
                              <div className="rounded-none border border-border bg-surface/45 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("settings.providerProbe")}</div>
                                    {providerTest ? <div className="mt-1 text-xs text-muted-foreground">{providerTestSummary(providerTest, t)}</div> : null}
                                    {activeProviderLastBalance ? <BalanceLine balance={activeProviderLastBalance.balance} checkedAt={activeProviderLastBalance.checkedAt} locale={locale} /> : null}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <ButtonLike title={t("settings.providerTestIdle")} disabled={providerTestBusy || !activeProvider.baseUrl} onClick={() => void testProvider(activeProviderId)} icon={providerTestBusy ? <Loader2 className="animate-spin" /> : <CircleCheck />} label={providerTestBusy ? t("settings.providerTesting") : t("settings.providerTestAction")} />
                                    <ButtonLike title={t("settings.providerProbeIdle")} disabled={providerProbeBusy || !activeProvider.baseUrl} onClick={() => void probeProvider(activeProviderId)} icon={providerProbeBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />} label={providerProbeBusy ? t("settings.providerProbing") : t("settings.providerProbeAction")} />
                                  </div>
                                </div>
                                {providerTest?.url ? <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground" title={providerTest.url}>{providerTest.url}</div> : null}
                              </div>

                              <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("settings.availableModels")}</div>
                                  <div className="flex items-center gap-2">
                                    <ButtonLike disabled={modelsJsonBusy || !activeProvider.baseUrl} onClick={() => void fetchProviderModels(activeProviderId)} icon={modelsJsonBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />} label={modelsJsonBusy ? t("settings.fetchingModels") : t("settings.fetchModels")} />
                                    <ButtonLike onClick={() => addModel(activeProviderId)} icon={<Plus />} label={t("settings.addModel")} />
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
                                      onChange={(next) => updateModelDraft(activeProviderId, index, next)}
                                      onCommit={(next) => updateModel(activeProviderId, index, next)}
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
                        <textarea className="h-72 w-full resize-y rounded-none border border-border bg-background/80 p-3 font-mono text-xs leading-5 text-foreground outline-none focus:border-primary/50" spellCheck={false} value={modelsJsonDraft} placeholder={t("settings.modelsJsonPlaceholder")} onChange={(event) => setModelsJsonDraft(event.currentTarget.value)} onBlur={() => {
                          const parsed = parseModelsJsonConfig(modelsJsonDraft);
                          if (parsed) void persistModelsConfig(parsed);
                        }} />
                      </div>
                    )}
                    <div className="border-t border-border p-3 text-xs leading-5 text-muted-foreground">{t("settings.modelsJsonHelp")}</div>
                    {modelsJsonStatus.kind !== "idle" ? (
                      <div className={cn("m-3 rounded-none border px-3 py-2 text-xs", modelsJsonStatus.kind === "success" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}>{modelsJsonStatus.text}</div>
                    ) : null}
                  </section>
                </div>
              ) : null}



              {activeSection === "commands" ? (
                <ExtensionsPanel commands={commands} extensionPanels={extensionPanels} extensionErrors={extensionErrors} sections={["commands"]} />
              ) : null}

              {activeSection === "extensionPanels" ? (
                <ExtensionsPanel
                  commands={commands}
                  extensionPanels={extensionPanels}
                  extensionErrors={extensionErrors}
                  extensionResources={(settings?.extensionResources ?? []) as PiExtensionResource[]}
                  actionStatus={extensionActionStatus}
                  busyPath={busyExtensionPath}
                  sections={["resources", "panels", "errors"]}
                  onToggleExtension={async (resource) => {
                    setBusyExtensionPath(resource.path);
                    setExtensionActionStatus({ kind: "idle", text: "" });
                    try {
                      await invoke("pi_extension_set_enabled", { path: resource.path, enabled: !resource.enabled });
                      setExtensionActionStatus({ kind: "success", text: resource.enabled ? t("extension.disabled") : t("extension.enabled") });
                      await onRefresh?.();
                    } catch (error) {
                      setExtensionActionStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
                    } finally {
                      setBusyExtensionPath(null);
                    }
                  }}
                  onDeleteExtension={async (resource) => {
                    if (!window.confirm(t("extension.deleteConfirm", { name: resource.name }))) return;
                    setBusyExtensionPath(resource.path);
                    setExtensionActionStatus({ kind: "idle", text: "" });
                    try {
                      await invoke("pi_extension_delete", { path: resource.path });
                      setExtensionActionStatus({ kind: "success", text: t("extension.deleted") });
                      await onRefresh?.();
                    } catch (error) {
                      setExtensionActionStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
                    } finally {
                      setBusyExtensionPath(null);
                    }
                  }}
                />
              ) : null}


              {activeSection === "skills" ? (
                <ExtensionsPanel
                  commands={commands.filter((command) => command.source === "skill")}
                  extensionPanels={[]}
                  extensionErrors={[]}
                  extensionResources={(settings?.skillResources ?? []) as PiSkillResource[]}
                  actionStatus={skillActionStatus}
                  busyPath={busySkillPath}
                  sections={["resources", "commands"]}
                  onToggleExtension={async (resource) => {
                    setBusySkillPath(resource.path);
                    setSkillActionStatus({ kind: "idle", text: "" });
                    try {
                      await invoke("pi_skill_set_enabled", { path: resource.path, enabled: !resource.enabled });
                      setSkillActionStatus({ kind: "success", text: resource.enabled ? t("skill.disabled") : t("skill.enabled") });
                      await onRefresh?.();
                    } catch (error) {
                      setSkillActionStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
                    } finally {
                      setBusySkillPath(null);
                    }
                  }}
                  onDeleteExtension={async (resource) => {
                    if (!window.confirm(t("skill.deleteConfirm", { name: resource.name }))) return;
                    setBusySkillPath(resource.path);
                    setSkillActionStatus({ kind: "idle", text: "" });
                    try {
                      await invoke("pi_skill_delete", { path: resource.path });
                      setSkillActionStatus({ kind: "success", text: t("skill.deleted") });
                      await onRefresh?.();
                    } catch (error) {
                      setSkillActionStatus({ kind: "error", text: error instanceof Error ? error.message : String(error) });
                    } finally {
                      setBusySkillPath(null);
                    }
                  }}
                />
              ) : null}

              {activeSection === "app" ? (
                <div className="space-y-4">
                  <section className="grid gap-3 sm:grid-cols-2">
                    <LocaleCard locale={locale} onChange={setLocale} />
                    <FontCard
                      locale={locale}
                      value={defaultFontId}
                      onChange={(fontId) => {
                        setDefaultFontId(fontId);
                        setStoredAppFont(fontId);
                      }}
                    />
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
  if (section === "commands") return t("settings.sectionCommandsDesc");
  if (section === "extensionPanels") return t("settings.sectionExtensionPanelsDesc");
  if (section === "skills") return t("settings.sectionSkillsDesc");
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

function providerTestSummary(result: ProviderTestResult, t: (key: string, vars?: Record<string, string | number>) => string) {
  if (typeof result.modelCount === "number" && typeof result.latencyMs === "number") {
    return t("settings.providerTestSuccess", { count: result.modelCount, latency: result.latencyMs });
  }
  if (typeof result.modelCount === "number") {
    return t("settings.providerProbeModels", { count: result.modelCount });
  }
  return result.detail ?? t("settings.providerTestOk");
}

function providerEnabled(provider: ModelProviderConfig) {
  return provider.enabled !== false;
}

function BalanceLine({ balance, checkedAt, locale }: { balance: string; checkedAt: string; locale: "zh-CN" | "en" }) {
  return (
    <div className="mt-2 inline-flex max-w-full items-center gap-2 border border-success/25 bg-success/10 px-2 py-1 text-[11px] text-success">
      <span className="shrink-0 font-semibold">{locale === "zh-CN" ? "剩余" : "Remaining"}</span>
      <span className="min-w-0 truncate font-mono text-success">{remainingBalanceText(balance)}</span>
      <span className="shrink-0 text-muted-foreground">{formatProviderBalanceTime(checkedAt, locale)}</span>
    </div>
  );
}

function ToggleSwitch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "relative h-4 w-7 shrink-0 cursor-pointer border transition disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-success/45 bg-success/20" : "border-border bg-muted/70",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className={cn("absolute top-1/2 size-2.5 -translate-y-1/2 border bg-card transition", checked ? "left-3.5 border-success" : "left-0.5 border-muted-foreground/40")} />
    </button>
  );
}

function providerBalanceKey(providerId: string, baseUrl?: string) {
  return `${providerId}::${baseUrl?.trim() ?? ""}`;
}

function balanceWithDefaultUnit(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "0 USD";
  return /\b(USD|CNY|RMB|EUR|GBP|JPY|AUD|CAD|HKD|USDT)\b|[$¥€￥]/i.test(trimmed) ? trimmed : `${trimmed} USD`;
}

function remainingBalanceText(value: string) {
  const normalized = balanceWithDefaultUnit(value);
  const firstPart = normalized.split("·")[0]?.trim() ?? normalized;
  const [, right] = firstPart.split(/[:：]/);
  return formatBalanceAmount((right ?? firstPart).trim());
}

function formatBalanceAmount(value: string) {
  return value.replace(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/, (match) => {
    const number = Number(match.replace(/,/g, ""));
    return Number.isFinite(number) ? number.toFixed(1) : match;
  });
}

function readStoredProviderBalances(): Record<string, ProviderBalanceSnapshot> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROVIDER_BALANCE_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredProviderBalances(value: Record<string, ProviderBalanceSnapshot>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROVIDER_BALANCE_STORAGE_KEY, JSON.stringify(value));
}

function formatProviderBalanceTime(value: string, locale: "zh-CN" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale);
}

function TextField({ label, value, placeholder, wide, onChange, onCommit }: { label: string; value: string; placeholder?: string; wide?: boolean; onChange: (value: string) => void; onCommit?: (value: string) => void }) {
  return (
    <label className={cn("block text-xs text-muted-foreground", wide && "sm:col-span-2")}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em]">{label}</span>
      <input className="h-9 w-full rounded-none border border-border bg-background/70 px-3 text-xs text-foreground outline-none transition focus:border-primary/45" value={value} placeholder={placeholder} onChange={(event) => onChange(event.currentTarget.value)} onBlur={(event) => onCommit?.(event.currentTarget.value)} />
    </label>
  );
}

function ModelRow({ model, onChange, onCommit, onDelete }: { model: ModelEntryConfig; onChange: (model: ModelEntryConfig) => void; onCommit: (model: ModelEntryConfig) => void; onDelete: () => void }) {
  const { t } = useI18n();
  const enabled = model.enabled !== false;
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(0,1fr)_2rem] items-center gap-2 px-3 py-2.5">
      <button
        type="button"
        className={cn("relative h-5 w-9 cursor-pointer rounded-full transition", enabled ? "bg-primary" : "bg-muted")}
        onClick={() => onCommit({ ...model, enabled: !enabled })}
        aria-label={t("settings.toggleModel")}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition", enabled ? "right-0.5" : "left-0.5")} />
      </button>
      <input className="h-8 min-w-0 rounded-none border border-transparent bg-transparent px-2 text-sm font-semibold text-foreground outline-none focus:border-primary/45" value={model.id ?? ""} placeholder="model-id" onChange={(event) => onChange({ ...model, id: event.currentTarget.value })} onBlur={(event) => onCommit({ ...model, id: event.currentTarget.value })} />
      <input className="h-8 min-w-0 rounded-none border border-transparent bg-transparent px-2 text-xs text-muted-foreground outline-none focus:border-primary/45" value={model.name ?? ""} placeholder={t("settings.modelName")} onChange={(event) => onChange({ ...model, name: event.currentTarget.value })} onBlur={(event) => onCommit({ ...model, name: event.currentTarget.value })} />
      <Button type="button" size="icon" variant="danger" className="justify-self-end" onClick={onDelete} aria-label={t("common.delete")}><Trash2 /></Button>
    </div>
  );
}

function ButtonLike({ label, icon, primary, disabled, className, title, onClick }: { label: string; icon: ReactNode; primary?: boolean; disabled?: boolean; className?: string; title?: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={primary ? "primary" : "secondary"}
      title={title}
      className={cn(primary ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15" : "border-border bg-surface/80 text-muted-foreground hover:border-primary/35 hover:text-foreground", className)}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

function LocaleCard({ locale, onChange }: { locale: "zh-CN" | "en"; onChange: (locale: "zh-CN" | "en") => void }) {
  const { t } = useI18n();
  return (
    <label className="block rounded-none border border-border bg-card/70 p-3 text-xs text-muted-foreground">
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

function FontCard({ locale, value, onChange }: { locale: "zh-CN" | "en"; value: AppFontId; onChange: (fontId: AppFontId) => void }) {
  const { t } = useI18n();
  const active = appFontOptions.find((option) => option.id === value) ?? appFontOptions[0];
  const availability = detectFontAvailability(active);
  return (
    <label className="block rounded-none border border-border bg-card/70 p-3 text-xs text-muted-foreground">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]">{t("settings.defaultFont")}</span>
      <SearchableSelect
        value={value}
        options={appFontOptions.map((option) => ({
          value: option.id,
          label: option.label[locale],
          description: option.description[locale],
        }))}
        searchPlaceholder={t("common.search")}
        emptyText={t("common.noResults")}
        onChange={(next) => onChange(next as AppFontId)}
      />
      <div className="mt-2 text-[11px] leading-5 text-muted-foreground">{active.description[locale]}</div>
      <div className={cn("mt-2 text-[11px] leading-5", availability === "fallback" ? "text-warning" : "text-muted-foreground")}>
        {availability === "available" ? t("settings.fontAvailable") : availability === "fallback" ? t("settings.fontFallback") : t("settings.fontUnknown")}
      </div>
      <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground" title={active.stack}>{active.stack}</div>
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


