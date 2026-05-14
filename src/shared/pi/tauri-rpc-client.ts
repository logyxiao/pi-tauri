import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PiClient, PiClientEvent, PiFileListOptions, PiNewSessionOptions, PiSessionListOptions, PromptOptions } from "./client";
import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiExtensionResource,
  PiExtensionStatus,
  PiSkillResource,
  PiExtensionUiResponse,
  PiFileEntry,
  PiFilePreview,
  PiForkMessage,
  PiMessage,
  PiModel,
  PiSafetyEvent,
  PiSessionStats,
  PiSessionSummary,
  PiSessionTree,
  PiSettings,
  PiSettingsUpdate,
  PiState,
} from "./types";
import { createSafetyEvent, detectDangerousCommand } from "./safety";
import { sdkSidecarClient } from "./sdk-sidecar-client";
import { builtinCommands, mapCommand, mergeCommands } from "./command-mapper";
import {
  inferAuthStatus,
  mapModel,
  mapStateResponse,
  modelFromState,
  normalizeDeliveryMode,
  normalizeOptionalThinkingLevel,
  nullableNumber,
  pickBoolean,
  pickString,
  splitModelKey,
} from "./model-settings-mapper";
import { mapAgentMessage, mapSessionMessage, mapToolEvent } from "./message-tool-mapper";

type RpcResponse = {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
};

type RpcMessage = RpcResponse | Record<string, unknown>;

type ModelsConfig = {
  providers?: Record<string, {
    enabled?: boolean;
    models?: Array<{
      id?: string;
      enabled?: boolean;
    }>;
  }>;
};

type PiSettingsJsonConfig = {
  enabledModels?: string[];
};

type PendingRequest = {
  resolve: (value: RpcResponse) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

type Listener = (event: PiClientEvent) => void;

function modelEnabledBySettings(model: PiModel, patterns: string[]): boolean {
  const exact = `${model.provider}/${model.id}`;
  const wildcard = `${model.provider}/*`;
  return patterns.some((pattern) => pattern === exact || pattern === wildcard || pattern === model.id);
}

export class TauriPiRpcClient implements PiClient {
  private connected = false;
  private rpcCwd: string | null = null;
  private listeners = new Set<Listener>();
  private pending = new Map<string, PendingRequest>();
  private unlistenMessage: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;
  private extensionPanels = new Map<string, PiExtensionPanel>();
  private extensionMessages: PiExtensionMessage[] = [];
  private extensionErrors: PiExtensionError[] = [];
  private extensionStatuses = new Map<string, PiExtensionStatus>();
  private safetyEvents: PiSafetyEvent[] = [];
  private settingsWarning: string | undefined;
  private toolStartTimes = new Map<string, number>();
  private stateCache: { value: PiState; expiresAt: number } | null = null;
  private stateRequest: Promise<PiState> | null = null;
  private modelsCache: { value: PiModel[]; expiresAt: number } | null = null;
  private modelsRequest: Promise<PiModel[]> | null = null;
  private commandsCache: { value: PiCommand[]; expiresAt: number } | null = null;
  private commandsRequest: Promise<PiCommand[]> | null = null;

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.startRpc();
  }

  private async startRpc(cwd?: string): Promise<void> {
    this.unlistenMessage = await listen<RpcMessage>("pi-rpc-message", (event) => this.handleRpcMessage(event.payload));
    this.unlistenError = await listen<unknown>("pi-rpc-error", (event) => {
      console.error("pi rpc error", event.payload);
    });

    const normalizedCwd = normalizeOptionalCwd(cwd);
    await invoke("pi_rpc_start", { cwd: normalizedCwd });
    this.connected = true;
    this.rpcCwd = normalizedCwd;
  }

  private async reconnect(cwd?: string): Promise<void> {
    this.rejectPendingRequests("pi rpc reconnecting");
    this.toolStartTimes.clear();
    this.invalidateStateCache();
    this.invalidateCapabilityCaches();
    this.unlistenMessage?.();
    this.unlistenError?.();
    this.unlistenMessage = null;
    this.unlistenError = null;
    this.connected = false;
    this.rpcCwd = null;
    await invoke("pi_rpc_stop");
    await this.startRpc(cwd);
  }

  async prompt(message: string, options?: PromptOptions): Promise<void> {
    this.invalidateStateCache();
    await this.request({ type: "prompt", message, streamingBehavior: options?.streamingBehavior });
  }

  async steer(message: string): Promise<void> {
    this.invalidateStateCache();
    await this.request({ type: "steer", message });
  }

  async followUp(message: string): Promise<void> {
    this.invalidateStateCache();
    await this.request({ type: "follow_up", message });
  }

  async abort(): Promise<void> {
    this.invalidateStateCache();
    await this.request({ type: "abort" });
    this.emit({ type: "aborted" });
  }

  async newSession(options: PiNewSessionOptions = {}): Promise<void> {
    if (options.cwd && normalizeOptionalCwd(options.cwd) !== this.rpcCwd) {
      await this.reconnect(options.cwd);
    }
    this.invalidateStateCache();
    await this.request({ type: "new_session" });
  }

  async continueRecent(): Promise<void> {
    const sessions = await this.listSessions();
    const recent = sessions[0];
    if (recent?.filePath) await this.switchSession(recent.filePath);
    else await this.newSession();
  }

  async switchSession(sessionPath: string): Promise<void> {
    this.invalidateStateCache();
    await this.request({ type: "switch_session", sessionPath });
  }

  async setSessionName(name: string): Promise<void> {
    this.invalidateStateCache();
    await this.request({ type: "set_session_name", name });
  }

  async deleteSession(sessionPath: string): Promise<void> {
    await invoke("pi_delete_session", { sessionPath });
  }

  async exportHtml(outputPath?: string): Promise<string | null> {
    const response = await this.request(outputPath ? { type: "export_html", outputPath } : { type: "export_html" });
    const data = response.data as Record<string, unknown> | undefined;
    return (data?.outputPath as string | undefined) ?? (data?.path as string | undefined) ?? null;
  }

  async readSessionMessages(sessionPath: string): Promise<PiMessage[]> {
    const messages = await invoke<unknown[]>("pi_read_session_messages", { sessionPath });
    return messages.map(mapSessionMessage).filter((message): message is PiMessage => Boolean(message));
  }

  async listSessions(options: PiSessionListOptions = {}): Promise<PiSessionSummary[]> {
    const state = await this.getState();
    const hasExplicitCwd = options.cwd !== undefined;
    const cwd = options.cwd ?? state.cwd;
    const fallback = hasExplicitCwd ? [] : currentSessionFallback(state);
    if (!isUsableCwd(cwd)) return fallback;
    try {
      const sessions = await invoke<unknown[]>("pi_list_sessions", { cwd });
      return sessions.map(mapSessionSummary).filter((session): session is PiSessionSummary => Boolean(session));
    } catch (error) {
      if (!isMissingCwdError(error)) console.warn("pi session list unavailable", error);
      return fallback;
    }
  }

  async getSessionTree(sessionPath?: string): Promise<PiSessionTree> {
    const state = await this.getState();
    const target = sessionPath ?? state.sessionFile;
    if (!target) return { nodes: [] };
    try {
      return await sdkSidecarClient.request<PiSessionTree>("sdk_session_tree", { sessionFile: target });
    } catch (error) {
      console.warn("pi sdk sidecar session tree unavailable, falling back to jsonl parser", error);
      return invoke<PiSessionTree>("pi_session_tree", { sessionPath: target });
    }
  }

  async getForkMessages(): Promise<PiForkMessage[]> {
    const response = await this.request({ type: "get_fork_messages" });
    const data = response.data as Record<string, unknown> | undefined;
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    return messages.map(mapForkMessage).filter((message): message is PiForkMessage => Boolean(message));
  }

  async forkSession(entryId: string): Promise<{ text?: string; cancelled?: boolean }> {
    const response = await this.request({ type: "fork", entryId });
    return (response.data as { text?: string; cancelled?: boolean } | undefined) ?? {};
  }

  async cloneSession(): Promise<{ cancelled?: boolean }> {
    const response = await this.request({ type: "clone" });
    return (response.data as { cancelled?: boolean } | undefined) ?? {};
  }

  async setSessionEntryLabel(entryId: string, label?: string): Promise<void> {
    const state = await this.getState();
    if (!state.sessionFile) throw new Error("No active session file for label update");
    try {
      await sdkSidecarClient.request("sdk_set_label", { sessionFile: state.sessionFile, entryId, label: label?.trim() || null });
    } catch (error) {
      console.warn("pi sdk sidecar label unavailable, falling back to jsonl append", error);
      await invoke("pi_set_session_label", { sessionPath: state.sessionFile, targetId: entryId, label: label?.trim() || null });
    }
  }

  async getState(): Promise<PiState> {
    const now = Date.now();
    if (this.stateCache && this.stateCache.expiresAt > now) return this.stateCache.value;
    if (this.stateRequest) return this.stateRequest;

    this.stateRequest = this.request({ type: "get_state" })
      .then((response) => {
        const state = mapStateResponse(response.data);
        this.stateCache = { value: state, expiresAt: Date.now() + 250 };
        return state;
      })
      .finally(() => {
        this.stateRequest = null;
      });
    return this.stateRequest;
  }

  async getMessages(): Promise<PiMessage[]> {
    const response = await this.request({ type: "get_messages" });
    const data = response.data as { messages?: unknown[] } | undefined;
    return (data?.messages ?? []).map(mapAgentMessage).filter((message): message is PiMessage => Boolean(message));
  }

  async getSessionStats(): Promise<PiSessionStats> {
    const response = await this.request({ type: "get_session_stats" });
    const data = response.data as Record<string, unknown> | undefined;
    const tokens = data?.tokens as Record<string, unknown> | undefined;
    const contextUsage = data?.contextUsage as Record<string, unknown> | undefined;

    return {
      sessionFile: data?.sessionFile as string | undefined,
      sessionId: data?.sessionId as string | undefined,
      userMessages: Number(data?.userMessages ?? 0),
      assistantMessages: Number(data?.assistantMessages ?? 0),
      toolCalls: Number(data?.toolCalls ?? 0),
      toolResults: Number(data?.toolResults ?? 0),
      totalMessages: Number(data?.totalMessages ?? 0),
      costUsd: Number(data?.cost ?? 0),
      totalTokens: Number(tokens?.total ?? 0),
      contextTokens: nullableNumber(contextUsage?.tokens),
      contextWindow: nullableNumber(contextUsage?.contextWindow),
      contextPercent: nullableNumber(contextUsage?.percent),
    };
  }

  async listModels(options: { force?: boolean } = {}): Promise<PiModel[]> {
    if (options.force) {
      this.modelsCache = null;
      this.modelsRequest = null;
    }
    const now = Date.now();
    if (this.modelsCache && this.modelsCache.expiresAt > now) return this.modelsCache.value;
    if (this.modelsRequest) return this.modelsRequest;
    this.modelsRequest = this.loadModels().finally(() => {
      this.modelsRequest = null;
    });
    return this.modelsRequest;
  }

  private async loadModels(): Promise<PiModel[]> {
    try {
      const response = await this.request({ type: "get_available_models" });
      const data = response.data as { models?: unknown[] } | undefined;
      const rawModels = (data?.models ?? []).map(mapModel).filter((model): model is PiModel => Boolean(model));
      if (rawModels.length) {
        const models = await this.filterConfiguredModels(rawModels);
        this.modelsCache = { value: models, expiresAt: Date.now() + 30_000 };
        return models;
      }
    } catch (error) {
      console.warn("pi rpc get_available_models unavailable", error);
    }

    const state = await this.getState();
    const fallback = [modelFromState(state)];
    this.modelsCache = { value: fallback, expiresAt: Date.now() + 5_000 };
    return fallback;
  }

  private async filterConfiguredModels(models: PiModel[]): Promise<PiModel[]> {
    const [modelsConfig, settingsConfig] = await Promise.all([
      this.readModelsConfig().catch((error) => {
        console.warn("models.json filtering unavailable", error);
        return null;
      }),
      this.readPiSettingsConfig().catch((error) => {
        console.warn("settings.json model filtering unavailable", error);
        return null;
      }),
    ]);
    const enabledPatterns = settingsConfig?.enabledModels?.map((item) => item.trim()).filter(Boolean) ?? [];
    const providers = modelsConfig?.providers ?? {};
    return models.filter((model) => {
      if (enabledPatterns.length && !modelEnabledBySettings(model, enabledPatterns)) return false;
      const provider = providers[model.provider];
      if (!provider) return model.enabled !== false;
      if (provider.enabled === false) return false;
      const configuredModel = provider.models?.find((item) => item.id === model.id);
      return configuredModel?.enabled !== false && model.enabled !== false;
    });
  }

  private async readModelsConfig(): Promise<ModelsConfig | null> {
    const state = await invoke<{ content?: string }>("pi_models_json_read");
    const content = state.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as ModelsConfig;
    return parsed && typeof parsed === "object" ? parsed : null;
  }

  private async readPiSettingsConfig(): Promise<PiSettingsJsonConfig | null> {
    const state = await invoke<{ content?: string }>("pi_settings_json_read");
    const content = state.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as PiSettingsJsonConfig;
    return parsed && typeof parsed === "object" ? parsed : null;
  }

  async getSettings(): Promise<PiSettings> {
    const state = await this.getState();
    const [provider, model] = splitModelKey(state.model);
    const sdkSidecar = await withTimeout(this.getSdkSidecarStatus(), 1_200, { available: false, error: "SDK sidecar status timed out" });
    const persistedSettings = sdkSidecar.available
      ? await withTimeout(sdkSidecarClient.request<Record<string, unknown>>("sdk_get_settings", { cwd: state.cwd }), 1_200)
          .catch((error) => {
            console.warn("pi sdk sidecar settings unavailable", error);
            return undefined;
          })
      : undefined;
    const persistedModel = pickString(persistedSettings, ["model", "defaultModel"]);
    const persistedProvider = pickString(persistedSettings, ["provider", "defaultProvider"]);
    const persistedThinkingLevel = normalizeOptionalThinkingLevel(pickString(persistedSettings, ["thinkingLevel", "defaultThinkingLevel"]));
    const persistedSessionDir = pickString(persistedSettings, ["sessionDir", "sessionDirectory"]);
    const persistedAutoCompaction = pickBoolean(persistedSettings, ["autoCompaction", "compactionEnabled"]);
    const persistedAutoRetry = pickBoolean(persistedSettings, ["autoRetry", "retryEnabled"]);
    const persistedSteeringMode = normalizeDeliveryMode(pickString(persistedSettings, ["steeringMode"]));
    const persistedFollowUpMode = normalizeDeliveryMode(pickString(persistedSettings, ["followUpMode"]));
    const [extensionResources, skillResources] = await Promise.all([
      this.listExtensionResources(state.cwd).catch((error) => {
        console.warn("pi extension resources unavailable", error);
        return [];
      }),
      this.listSkillResources(state.cwd).catch((error) => {
        console.warn("pi skill resources unavailable", error);
        return [];
      }),
    ]);
    const auth = sdkSidecar.available
      ? await withTimeout(sdkSidecarClient.request<PiSettings["auth"]>("sdk_auth_status"), 1_200, inferAuthStatus(state.model)).catch(() => inferAuthStatus(state.model))
      : inferAuthStatus(state.model);
    return {
      model: persistedModel ?? model,
      provider: persistedProvider ?? provider,
      thinkingLevel: persistedThinkingLevel ?? state.thinkingLevel,
      cwd: state.cwd,
      clientMode: "tauri-rpc",
      sdkSidecar,
      persistedSettings: persistedSettings ?? {},
      settingsWarning: this.settingsWarning,
      settingsSources: {
        model: persistedModel || persistedProvider ? "persisted" : "runtime",
        thinkingLevel: persistedThinkingLevel ? "persisted" : "runtime",
        sessionDir: persistedSessionDir ? "persisted" : state.sessionFile ? "runtime" : "fallback",
        autoCompaction: typeof persistedAutoCompaction === "boolean" ? "persisted" : "fallback",
        autoRetry: typeof persistedAutoRetry === "boolean" ? "persisted" : "fallback",
        steeringMode: persistedSteeringMode ? "persisted" : "fallback",
        followUpMode: persistedFollowUpMode ? "persisted" : "fallback",
      },
      sessionFile: state.sessionFile,
      sessionDir: persistedSessionDir ?? (state.sessionFile ? dirname(state.sessionFile) : undefined),
      autoCompaction: persistedAutoCompaction ?? true,
      autoRetry: persistedAutoRetry ?? true,
      steeringMode: persistedSteeringMode ?? "one-at-a-time",
      followUpMode: persistedFollowUpMode ?? "one-at-a-time",
      auth,
      extensionResources,
      skillResources,
    };
  }

  private async listExtensionResources(cwd: string): Promise<PiExtensionResource[]> {
    return invoke<PiExtensionResource[]>("pi_extension_resources", { cwd });
  }

  private async listSkillResources(cwd: string): Promise<PiSkillResource[]> {
    return invoke<PiSkillResource[]>("pi_skill_resources", { cwd });
  }

  async updateSettings(update: PiSettingsUpdate): Promise<PiSettings> {
    this.invalidateStateCache();
    this.invalidateCapabilityCaches();
    const state = await this.getState();
    const sdkSidecar = await this.getSdkSidecarStatus();
    if (sdkSidecar.available) {
      await sdkSidecarClient
        .request("sdk_update_settings", { cwd: state.cwd, update })
        .then(() => {
          this.settingsWarning = undefined;
        })
        .catch((error) => {
          this.settingsWarning = `Persisted settings update failed; runtime settings were still applied. ${error instanceof Error ? error.message : String(error)}`;
          console.warn("pi sdk sidecar persisted settings update unavailable", error);
        });
    } else if (sdkSidecar.error) {
      this.settingsWarning = `Persisted settings unavailable; runtime settings only. ${sdkSidecar.error}`;
    }

    if (update.model) {
      const provider = update.provider ?? splitModelKey(update.model)[0];
      const modelId = splitModelKey(update.model)[1] ?? update.model;
      if (provider) await this.request({ type: "set_model", provider, modelId });
      else console.warn("pi rpc set_model skipped: provider missing", update);
    }

    if (update.thinkingLevel) {
      await this.request({ type: "set_thinking_level", level: update.thinkingLevel });
    }

    if (typeof update.autoCompaction === "boolean") {
      await this.request({ type: "set_auto_compaction", enabled: update.autoCompaction });
    }

    if (typeof update.autoRetry === "boolean") {
      await this.request({ type: "set_auto_retry", enabled: update.autoRetry });
    }

    if (update.steeringMode) {
      await this.request({ type: "set_steering_mode", mode: update.steeringMode });
    }

    if (update.followUpMode) {
      await this.request({ type: "set_follow_up_mode", mode: update.followUpMode });
    }

    return this.getSettings();
  }

  async listCommands(): Promise<PiCommand[]> {
    const now = Date.now();
    if (this.commandsCache && this.commandsCache.expiresAt > now) return this.commandsCache.value;
    if (this.commandsRequest) return this.commandsRequest;
    this.commandsRequest = this.loadCommands().finally(() => {
      this.commandsRequest = null;
    });
    return this.commandsRequest;
  }

  private async loadCommands(): Promise<PiCommand[]> {
    try {
      const response = await this.request({ type: "get_commands" });
      const data = response.data as { commands?: unknown[] } | undefined;
      const commands = (data?.commands ?? []).map(mapCommand).filter((item): item is PiCommand => Boolean(item));
      const merged = commands.length ? mergeCommands(builtinCommands, commands) : builtinCommands;
      this.commandsCache = { value: merged, expiresAt: Date.now() + 10_000 };
      return merged;
    } catch (error) {
      console.warn("pi rpc get_commands unavailable", error);
    }

    this.commandsCache = { value: builtinCommands, expiresAt: Date.now() + 5_000 };
    return builtinCommands;
  }

  async executeCommand(commandName: string): Promise<void> {
    this.invalidateStateCache();
    const normalizedName = commandName.replace(/^\//, "");
    const commands = await this.listCommands();
    const command = commands.find((item) => item.name === normalizedName);
    const action = command ? detectDangerousCommand(command) : null;
    if (action) this.safetyEvents = [createSafetyEvent(action, "allowed", "command"), ...this.safetyEvents].slice(0, 20);

    if (normalizedName === "compact") {
      await this.request({ type: "compact" }, { timeoutMs: 180_000 });
      return;
    }
    if (normalizedName === "cycle-model") {
      await this.request({ type: "cycle_model" });
      return;
    }
    if (normalizedName === "cycle-thinking") {
      await this.request({ type: "cycle_thinking_level" });
      return;
    }
    if (normalizedName === "abort-retry") {
      await this.request({ type: "abort_retry" });
      return;
    }
    if (normalizedName === "abort-bash") {
      await this.request({ type: "abort_bash" });
      return;
    }
    if (normalizedName === "export-html") {
      await this.request({ type: "export_html" });
      return;
    }

    await this.prompt(`/${normalizedName}`);
  }

  async listExtensionPanels(): Promise<PiExtensionPanel[]> {
    return [...this.extensionPanels.values()];
  }

  async listExtensionStatuses(): Promise<PiExtensionStatus[]> {
    return [...this.extensionStatuses.values()];
  }

  async listExtensionMessages(): Promise<PiExtensionMessage[]> {
    return this.extensionMessages;
  }

  async listExtensionErrors(): Promise<PiExtensionError[]> {
    return this.extensionErrors;
  }

  async listSafetyEvents(): Promise<PiSafetyEvent[]> {
    return this.safetyEvents;
  }

  async recordSafetyEvent(event: PiSafetyEvent): Promise<void> {
    this.safetyEvents = [event, ...this.safetyEvents.filter((item) => item.id !== event.id)].slice(0, 20);
  }

  async listFiles(options: PiFileListOptions = {}): Promise<PiFileEntry[]> {
    const state = await this.getState();
    if (!isUsableCwd(state.cwd)) return [];
    try {
      const entries = await invoke<unknown[]>("pi_list_files", { cwd: state.cwd, path: options.path, depth: options.depth, limit: options.limit });
      return entries.map(mapFileEntry).filter((entry): entry is PiFileEntry => Boolean(entry));
    } catch (error) {
      if (!isMissingCwdError(error)) console.warn("pi file list unavailable", error);
      return [];
    }
  }

  async readFile(path: string): Promise<PiFilePreview> {
    const state = await this.getState();
    try {
      const preview = await invoke<unknown>("pi_read_file", { cwd: state.cwd, path });
      return mapFilePreview(preview, path);
    } catch (error) {
      console.warn("pi file preview unavailable", error);
      return {
        path,
        name: path.split(/[\\/]/).pop() ?? path,
        kind: "missing",
        content: error instanceof Error ? error.message : "Preview unavailable.",
      };
    }
  }

  async respondExtensionUi(response: PiExtensionUiResponse): Promise<void> {
    const payload: Record<string, unknown> = { type: "extension_ui_response", id: response.id };
    if (response.cancelled) payload.cancelled = true;
    else if (response.method === "confirm") payload.confirmed = Boolean(response.confirmed);
    else payload.value = response.value ?? "";
    await this.connect();
    await invoke("pi_rpc_send", { message: JSON.stringify(payload) });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    this.unlistenMessage?.();
    this.unlistenError?.();
    this.unlistenMessage = null;
    this.unlistenError = null;
    this.rejectPendingRequests("pi rpc disposed");
    this.toolStartTimes.clear();
    this.connected = false;
    this.rpcCwd = null;
    await invoke("pi_rpc_stop");
  }

  private invalidateStateCache() {
    this.stateCache = null;
    this.stateRequest = null;
  }

  private invalidateCapabilityCaches() {
    this.modelsCache = null;
    this.modelsRequest = null;
    this.commandsCache = null;
    this.commandsRequest = null;
  }

  private async request(command: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<RpcResponse> {
    await this.connect();
    const id = crypto.randomUUID();
    const payload = { id, ...command };
    const timeoutMs = options.timeoutMs ?? 30_000;

    const response = new Promise<RpcResponse>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`pi rpc request timed out: ${String(command.type)}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeoutId });
    });

    try {
      await invoke("pi_rpc_send", { message: JSON.stringify(payload) });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        window.clearTimeout(pending.timeoutId);
        this.pending.delete(id);
      }
      throw error;
    }
    return response.then((result) => {
      if (!result.success) throw new Error(result.error ?? `pi rpc command failed: ${result.command}`);
      return result;
    });
  }

  private handleRpcMessage(message: RpcMessage) {
    if (message.type === "response") {
      this.resolveResponse(message as RpcResponse);
      return;
    }

    this.mapEvent(message);
  }

  private resolveResponse(response: RpcResponse) {
    if (!response.id) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    window.clearTimeout(pending.timeoutId);
    if (response.success) pending.resolve(response);
    else pending.reject(new Error(response.error ?? `pi rpc command failed: ${response.command}`));
  }

  private rejectPendingRequests(reason: string) {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private mapEvent(event: Record<string, unknown>) {
    if (event.type === "agent_start") {
      this.emit({ type: "agent_start" });
      return;
    }

    if (event.type === "agent_end") {
      const messages = Array.isArray(event.messages) ? event.messages.map(mapAgentMessage).filter((message): message is PiMessage => Boolean(message)) : undefined;
      this.emit({ type: "agent_end", messages });
      return;
    }

    if (event.type === "message_update") {
      const assistantMessageEvent = event.assistantMessageEvent as Record<string, unknown> | undefined;
      const mappedMessage = mapAgentMessage(event.message);
      if (assistantMessageEvent?.type === "text_delta") {
        this.emit({ type: "message_update", delta: String(assistantMessageEvent.delta ?? ""), message: mappedMessage ?? undefined });
      } else if (mappedMessage) {
        this.emit({ type: "message_update", message: mappedMessage });
      }
      return;
    }

    if (event.type === "extension_error") {
      const error: PiExtensionError = {
        id: crypto.randomUUID(),
        extensionPath: event.extensionPath as string | undefined,
        event: event.event as string | undefined,
        message: String(event.error ?? event.message ?? "Extension error"),
        createdAt: nowLabel(),
      };
      this.extensionErrors = [error, ...this.extensionErrors].slice(0, 30);
      this.emit({ type: "extension_error", error });
      return;
    }

    if (event.type === "extension_ui_request") {
      this.handleExtensionUiRequest(event);
      return;
    }

    if (
      event.type === "tool_execution_start" ||
      event.type === "tool_execution_update" ||
      event.type === "tool_execution_end"
    ) {
      const tool = mapToolEvent(event, this.toolStartTimes);
      if (tool.safety) {
        this.safetyEvents = [createSafetyEvent(tool.safety, "flagged", "rpc-limitation"), ...this.safetyEvents].slice(0, 20);
      }
      const type = event.type as "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
      this.emit({ type, tool });
    }
  }

  private handleExtensionUiRequest(event: Record<string, unknown>) {
    const method = String(event.method ?? "notify") as PiExtensionMessage["method"];
    const message: PiExtensionMessage = {
      id: String(event.id ?? crypto.randomUUID()),
      method,
      title: event.title as string | undefined,
      message: (event.message as string | undefined) ?? (event.statusText as string | undefined),
      level: normalizeNotifyType(event.notifyType),
      source: (event.extensionPath as string | undefined) ?? (event.statusKey as string | undefined),
      createdAt: nowLabel(),
      options: Array.isArray(event.options) ? event.options.map((item) => String(item)) : undefined,
      placeholder: event.placeholder as string | undefined,
      prefill: event.prefill as string | undefined,
      timeoutMs: typeof event.timeout === "number" ? event.timeout : undefined,
      expectsResponse: method === "confirm" || method === "select" || method === "input" || method === "editor",
    };

    let panel: PiExtensionPanel | undefined;
    let status: PiExtensionStatus | undefined;
    let editorText: string | undefined;

    if (method === "setWidget") {
      panel = {
        key: String(event.widgetKey ?? event.id ?? crypto.randomUUID()),
        title: String(event.widgetKey ?? "widget"),
        lines: Array.isArray(event.widgetLines) ? event.widgetLines.map((line) => String(line)) : [],
        placement: event.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor",
        source: event.extensionPath as string | undefined,
      };
      if (panel.lines.length) this.extensionPanels.set(panel.key, panel);
      else this.extensionPanels.delete(panel.key);
    }

    if (method === "setStatus") {
      status = {
        key: String(event.statusKey ?? event.id ?? crypto.randomUUID()),
        text: String(event.statusText ?? ""),
        source: event.extensionPath as string | undefined,
      };
      if (status.text) this.extensionStatuses.set(status.key, status);
      else this.extensionStatuses.delete(status.key);
    }

    if (method === "set_editor_text") {
      editorText = String(event.text ?? "");
    }

    this.extensionMessages = [message, ...this.extensionMessages].slice(0, 40);
    this.emit({ type: "extension_ui_request", message, panel, status, editorText });
  }

  private async getSdkSidecarStatus(): Promise<{ available: boolean; version?: string; error?: string }> {
    return sdkSidecarClient.getStatus();
  }

  private emit(event: PiClientEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

function currentSessionFallback(state: PiState): PiSessionSummary[] {
  if (!state.sessionFile) return [];
  return [
    {
      id: state.sessionId ?? state.sessionFile,
      name: state.sessionName ?? "Current session",
      cwd: state.cwd,
      updatedAt: "current",
      model: state.model,
      status: state.runState === "running" ? "running" : "idle",
      filePath: state.sessionFile,
    },
  ];
}

function isUsableCwd(cwd: string | undefined): cwd is string {
  return Boolean(cwd && cwd.trim() && cwd !== "unknown cwd" && cwd !== "Unknown cwd");
}

function normalizeOptionalCwd(cwd: string | undefined): string | null {
  if (!isUsableCwd(cwd)) return null;
  return cwd.replace(/\\/g, "/").replace(/\/$/, "");
}

function isMissingCwdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to resolve cwd|os error 2|系统找不到指定的文件/i.test(message);
}

function mapForkMessage(raw: unknown): PiForkMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  return typeof message.entryId === "string" && typeof message.text === "string"
    ? { entryId: message.entryId, text: message.text }
    : null;
}

function mapSessionSummary(raw: unknown): PiSessionSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const session = raw as Record<string, unknown>;
  const id = session.id;
  const name = session.name;
  const cwd = session.cwd;
  if (typeof id !== "string" || typeof name !== "string" || typeof cwd !== "string") return null;
  const updatedAtMs = parseSessionTimestampMs(session.updatedAt);
  return {
    id,
    name,
    cwd,
    updatedAt: formatSessionTimestamp(session.updatedAt),
    updatedAtMs,
    model: typeof session.model === "string" ? session.model : "unknown",
    status: session.status === "running" ? "running" : "idle",
    filePath: typeof session.filePath === "string" ? session.filePath : undefined,
    messageCount: typeof session.messageCount === "number" ? session.messageCount : undefined,
  };
}

function mapFileEntry(raw: unknown): PiFileEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.path !== "string" || typeof entry.name !== "string") return null;
  const kind = entry.kind === "directory" ? "directory" : "file";
  return {
    path: entry.path,
    name: entry.name,
    kind,
    depth: typeof entry.depth === "number" ? entry.depth : 0,
    size: nullableNumber(entry.size) ?? undefined,
    modifiedAt: typeof entry.modifiedAt === "string" ? entry.modifiedAt : undefined,
  };
}

function mapFilePreview(raw: unknown, fallbackPath: string): PiFilePreview {
  if (!raw || typeof raw !== "object") {
    return { path: fallbackPath, name: fallbackPath.split(/[\\/]/).pop() ?? fallbackPath, kind: "missing" };
  }
  const preview = raw as Record<string, unknown>;
  const path = typeof preview.path === "string" ? preview.path : fallbackPath;
  const kind = normalizeFilePreviewKind(preview.kind);
  return {
    path,
    name: typeof preview.name === "string" ? preview.name : path.split(/[\\/]/).pop() ?? path,
    kind,
    content: typeof preview.content === "string" ? preview.content : undefined,
    size: nullableNumber(preview.size) ?? undefined,
    truncated: typeof preview.truncated === "boolean" ? preview.truncated : undefined,
    mime: typeof preview.mime === "string" ? preview.mime : undefined,
  };
}

function normalizeFilePreviewKind(value: unknown): PiFilePreview["kind"] {
  if (value === "text" || value === "markdown" || value === "image" || value === "html" || value === "binary") return value;
  return "missing";
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function normalizeNotifyType(value: unknown): PiExtensionMessage["level"] {
  if (value === "warning" || value === "error") return value;
  return "info";
}

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback?: T): Promise<T> {
  const hasFallback = arguments.length >= 3;
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (hasFallback) resolve(fallback as T);
      else reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function parseSessionTimestampMs(value: unknown): number | undefined {
  if (typeof value !== "string" || !value || value === "unknown" || value === "current") return undefined;
  const normalized = value.startsWith("unix-ms:") ? Number(value.slice("unix-ms:".length)) : Date.parse(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function formatSessionTimestamp(value: unknown): string {
  if (typeof value !== "string" || !value || value === "unknown" || value === "current") return typeof value === "string" ? value : "unknown";
  const normalized = parseSessionTimestampMs(value);
  if (normalized === undefined) return value;
  const date = new Date(normalized);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const tauriPiRpcClient = new TauriPiRpcClient();
