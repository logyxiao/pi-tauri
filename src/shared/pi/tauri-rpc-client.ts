import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PiClient, PiClientEvent, PiSessionListOptions, PromptOptions } from "./client";
import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiExtensionStatus,
  PiExtensionUiResponse,
  PiFileEntry,
  PiFilePreview,
  PiForkMessage,
  PiDeliveryMode,
  PiMessage,
  PiModel,
  PiSafetyEvent,
  PiSessionStats,
  PiSessionSummary,
  PiSessionTree,
  PiSettings,
  PiSettingsUpdate,
  PiState,
  PiToolCall,
} from "./types";
import { createSafetyEvent, detectDangerousCommand, detectDangerousTool } from "./safety";
import { sdkSidecarClient } from "./sdk-sidecar-client";

type RpcResponse = {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
};

type RpcMessage = RpcResponse | Record<string, unknown>;

type PendingRequest = {
  resolve: (value: RpcResponse) => void;
  reject: (error: Error) => void;
};

type Listener = (event: PiClientEvent) => void;

const builtinFallbackCommands: PiCommand[] = [
  { name: "help", description: "Show available slash commands", source: "builtin" },
  { name: "models", description: "List available models", source: "builtin" },
  { name: "sessions", description: "Show session summary", source: "builtin" },
  { name: "extensions", description: "Show extension status", source: "builtin" },
  { name: "compact", description: "Compact current context", source: "builtin" },
];

export class TauriPiRpcClient implements PiClient {
  private connected = false;
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

  async connect(): Promise<void> {
    if (this.connected) return;

    this.unlistenMessage = await listen<RpcMessage>("pi-rpc-message", (event) => this.handleRpcMessage(event.payload));
    this.unlistenError = await listen<unknown>("pi-rpc-error", (event) => {
      console.error("pi rpc error", event.payload);
    });

    await invoke("pi_rpc_start");
    this.connected = true;
  }

  async prompt(message: string, options?: PromptOptions): Promise<void> {
    await this.request({ type: "prompt", message, streamingBehavior: options?.streamingBehavior });
  }

  async steer(message: string): Promise<void> {
    await this.request({ type: "steer", message });
  }

  async followUp(message: string): Promise<void> {
    await this.request({ type: "follow_up", message });
  }

  async abort(): Promise<void> {
    await this.request({ type: "abort" });
    this.emit({ type: "aborted" });
  }

  async newSession(): Promise<void> {
    await this.request({ type: "new_session" });
  }

  async continueRecent(): Promise<void> {
    const sessions = await this.listSessions();
    const recent = sessions[0];
    if (recent?.filePath) await this.switchSession(recent.filePath);
    else await this.newSession();
  }

  async switchSession(sessionPath: string): Promise<void> {
    await this.request({ type: "switch_session", sessionPath });
  }

  async setSessionName(name: string): Promise<void> {
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
    try {
      const sessions = await invoke<unknown[]>("pi_list_sessions", { cwd: options.cwd ?? state.cwd });
      return sessions.map(mapSessionSummary).filter((session): session is PiSessionSummary => Boolean(session));
    } catch (error) {
      console.warn("pi session list unavailable", error);
      return state.sessionFile
        ? [
            {
              id: state.sessionId ?? state.sessionFile,
              name: state.sessionName ?? "Current session",
              cwd: state.cwd,
              updatedAt: "current",
              model: state.model,
              status: state.runState === "running" ? "running" : "idle",
              filePath: state.sessionFile,
            },
          ]
        : [];
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
    const response = await this.request({ type: "get_state" });
    const data = response.data as Record<string, unknown> | undefined;
    const model = data?.model as Record<string, unknown> | null | undefined;

    return {
      runState: data?.isStreaming ? "running" : "idle",
      cwd: (data?.cwd as string | undefined) ?? "unknown cwd",
      model: model ? `${model.provider as string}/${model.id as string}` : "no model",
      thinkingLevel: normalizeThinkingLevel(data?.thinkingLevel),
      tokenCount: Number((data?.messageCount as number | undefined) ?? 0),
      costUsd: 0,
      sessionFile: data?.sessionFile as string | undefined,
      sessionId: data?.sessionId as string | undefined,
      sessionName: data?.sessionName as string | undefined,
    };
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

  async listModels(): Promise<PiModel[]> {
    try {
      const response = await this.request({ type: "get_available_models" });
      const data = response.data as { models?: unknown[] } | undefined;
      const models = (data?.models ?? []).map(mapModel).filter((model): model is PiModel => Boolean(model));
      if (models.length) return models;
    } catch (error) {
      console.warn("pi rpc get_available_models unavailable", error);
    }

    const state = await this.getState();
    return [modelFromState(state)];
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
    };
  }

  async updateSettings(update: PiSettingsUpdate): Promise<PiSettings> {
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
    try {
      const response = await this.request({ type: "get_commands" });
      const data = response.data as { commands?: unknown[] } | undefined;
      const commands = (data?.commands ?? []).map(mapCommand).filter((item): item is PiCommand => Boolean(item));
      if (commands.length) return commands;
    } catch (error) {
      console.warn("pi rpc get_commands unavailable", error);
    }

    return builtinFallbackCommands;
  }

  async executeCommand(commandName: string): Promise<void> {
    const commands = await this.listCommands();
    const command = commands.find((item) => item.name === commandName);
    const action = command ? detectDangerousCommand(command) : null;
    if (action) this.safetyEvents = [createSafetyEvent(action, "allowed", "command"), ...this.safetyEvents].slice(0, 20);
    await this.prompt(`/${commandName}`);
  }

  async listExtensionPanels(): Promise<PiExtensionPanel[]> {
    return [...this.extensionPanels.values()];
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

  async listFiles(): Promise<PiFileEntry[]> {
    const state = await this.getState();
    try {
      const entries = await invoke<unknown[]>("pi_list_files", { cwd: state.cwd });
      return entries.map(mapFileEntry).filter((entry): entry is PiFileEntry => Boolean(entry));
    } catch (error) {
      console.warn("pi file list unavailable", error);
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
    this.pending.clear();
    this.toolStartTimes.clear();
    this.connected = false;
    await invoke("pi_rpc_stop");
  }

  private async request(command: Record<string, unknown>): Promise<RpcResponse> {
    await this.connect();
    const id = crypto.randomUUID();
    const payload = { id, ...command };

    const response = new Promise<RpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      window.setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`pi rpc request timed out: ${String(command.type)}`));
      }, 30_000);
    });

    await invoke("pi_rpc_send", { message: JSON.stringify(payload) });
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
    if (response.success) pending.resolve(response);
    else pending.reject(new Error(response.error ?? `pi rpc command failed: ${response.command}`));
  }

  private mapEvent(event: Record<string, unknown>) {
    if (event.type === "agent_start") {
      this.emit({ type: "agent_start" });
      return;
    }

    if (event.type === "agent_end") {
      this.emit({ type: "agent_end" });
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
  return {
    id,
    name,
    cwd,
    updatedAt: formatSessionTimestamp(session.updatedAt),
    model: typeof session.model === "string" ? session.model : "unknown",
    status: session.status === "running" ? "running" : "idle",
    filePath: typeof session.filePath === "string" ? session.filePath : undefined,
    messageCount: typeof session.messageCount === "number" ? session.messageCount : undefined,
  };
}

function mapCommand(raw: unknown): PiCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const command = raw as Record<string, unknown>;
  if (typeof command.name !== "string") return null;
  const mapped: PiCommand = {
    name: command.name,
    description: typeof command.description === "string" ? command.description : undefined,
    source: normalizeCommandSource(command.source),
    location: normalizeCommandLocation(command.location),
    path: typeof command.path === "string" ? command.path : undefined,
    dangerous: /delete|reset|shell|batch|wipe|remove/i.test(command.name),
  };
  const safety = detectDangerousCommand(mapped);
  return safety ? { ...mapped, dangerous: true, safety } : mapped;
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

function mapModel(raw: unknown): PiModel | null {
  if (!raw || typeof raw !== "object") return null;
  const model = raw as Record<string, unknown>;
  const id = model.id ?? model.model;
  const provider = model.provider;
  if (typeof id !== "string" || typeof provider !== "string") return null;

  return {
    id,
    provider,
    name: typeof model.name === "string" ? model.name : id,
    api: model.api as string | undefined,
    reasoning: model.reasoning as boolean | undefined,
    contextWindow: nullableNumber(model.contextWindow) ?? undefined,
    maxTokens: nullableNumber(model.maxTokens) ?? undefined,
  };
}

function modelFromState(state: PiState): PiModel {
  const [provider, id] = splitModelKey(state.model);
  return {
    id: id ?? state.model,
    provider: provider ?? "unknown",
    name: state.model,
    reasoning: state.thinkingLevel !== "off",
  };
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function inferAuthStatus(model: string) {
  const provider = splitModelKey(model)[0] ?? "unknown";
  return [
    {
      provider,
      status: "unknown" as const,
      detail: "RPC auth status not exposed; prompt run will surface auth errors.",
    },
  ];
}

function splitModelKey(value: string | undefined): [string | undefined, string | undefined] {
  if (!value) return [undefined, undefined];
  const parts = value.split("/");
  if (parts.length >= 2) return [parts[0], parts.slice(1).join("/")];
  return [undefined, value];
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number") return value;
  return undefined;
}

function pickString(settings: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = settings?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function pickBoolean(settings: Record<string, unknown> | undefined, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = settings?.[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function normalizeOptionalThinkingLevel(value: unknown): PiState["thinkingLevel"] | undefined {
  if (value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  return undefined;
}

function normalizeDeliveryMode(value: unknown): PiDeliveryMode | undefined {
  if (value === "all" || value === "one-at-a-time") return value;
  return undefined;
}

function normalizeThinkingLevel(value: unknown): PiState["thinkingLevel"] {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return "off";
}

function normalizeCommandSource(value: unknown): PiCommand["source"] {
  if (value === "extension" || value === "prompt" || value === "skill") return value;
  return "builtin";
}

function normalizeCommandLocation(value: unknown): PiCommand["location"] | undefined {
  if (value === "user" || value === "project" || value === "path") return value;
  return undefined;
}

function normalizeNotifyType(value: unknown): PiExtensionMessage["level"] {
  if (value === "warning" || value === "error") return value;
  return "info";
}

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function mapSessionMessage(raw: unknown): PiMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  const id = message.id;
  const role = normalizeMessageRole(message.role);
  const content = message.content;
  const createdAt = message.createdAt;
  if (typeof id !== "string" || !role || typeof content !== "string" || typeof createdAt !== "string") return null;
  return {
    id,
    role,
    content,
    createdAt,
    contentBlocks: extractContentBlocks(message.contentBlocks),
    toolArgs: asRecord(message.toolArgs),
    toolDetails: asRecord(message.toolDetails),
    stopReason: pickString(message, ["stopReason"]),
    errorMessage: pickString(message, ["errorMessage"]),
    customType: pickString(message, ["customType"]),
    tokensBefore: typeof message.tokensBefore === "number" ? message.tokensBefore : undefined,
    toolName: pickString(message, ["toolName"]),
    toolCallId: pickString(message, ["toolCallId"]),
    isError: typeof message.isError === "boolean" ? message.isError : undefined,
    cancelled: typeof message.cancelled === "boolean" ? message.cancelled : undefined,
    truncated: typeof message.truncated === "boolean" ? message.truncated : undefined,
    fullOutputPath: pickString(message, ["fullOutputPath"]),
    excludeFromContext: typeof message.excludeFromContext === "boolean" ? message.excludeFromContext : undefined,
  };
}

function mapAgentMessage(raw: unknown): PiMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  const role = normalizeMessageRole(message.role);
  if (!role) return null;

  return {
    id: crypto.randomUUID(),
    role,
    content: extractContentText(message.content),
    createdAt: formatTimestamp(message.timestamp),
    contentBlocks: extractContentBlocks(message.content),
    toolArgs: extractToolCallArgs(message.content, pickString(message, ["toolCallId"])),
    toolDetails: asRecord(message.details),
    stopReason: pickString(message, ["stopReason"]),
    errorMessage: pickString(message, ["errorMessage"]),
    customType: pickString(message, ["customType"]),
    tokensBefore: typeof message.tokensBefore === "number" ? message.tokensBefore : undefined,
    toolName: pickString(message, ["toolName"]),
    toolCallId: pickString(message, ["toolCallId"]),
    isError: typeof message.isError === "boolean" ? message.isError : undefined,
    cancelled: typeof message.cancelled === "boolean" ? message.cancelled : undefined,
    truncated: typeof message.truncated === "boolean" ? message.truncated : undefined,
    fullOutputPath: pickString(message, ["fullOutputPath"]),
    excludeFromContext: typeof message.excludeFromContext === "boolean" ? message.excludeFromContext : undefined,
  };
}

function mapToolEvent(event: Record<string, unknown>, startTimes?: Map<string, number>): PiToolCall {
  const result = (event.result ?? event.partialResult) as Record<string, unknown> | undefined;
  const args = event.args as Record<string, unknown> | undefined;
  const name = String(event.toolName ?? "tool");
  const isStart = event.type === "tool_execution_start";
  const isEnd = event.type === "tool_execution_end";
  const isError = Boolean(event.isError);
  const id = String(event.toolCallId ?? crypto.randomUUID());
  if (isStart) startTimes?.set(id, performance.now());
  const startedAt = startTimes?.get(id);
  const durationMs = isEnd && startedAt !== undefined ? Math.max(0, Math.round(performance.now() - startedAt)) : undefined;
  if (isEnd) startTimes?.delete(id);

  const tool: PiToolCall = {
    id,
    name,
    target: extractToolTarget(name, args),
    status: isEnd ? (isError ? "error" : "success") : "running",
    summary: isEnd ? (isError ? "Tool failed" : "Tool complete") : "Tool running",
    output: extractContentText(result?.content),
    durationMs,
    args,
    details: result?.details && typeof result.details === "object" ? (result.details as Record<string, unknown>) : undefined,
    isError,
  };
  const safety = detectDangerousTool(tool);
  return safety ? { ...tool, safety } : tool;
}

function extractToolTarget(name: string, args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  if (name === "bash") return String(args.command ?? "");
  if (typeof args.path === "string") return args.path;
  if (typeof args.pattern === "string") return args.pattern;
  return JSON.stringify(args);
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const item = block as Record<string, unknown>;
      if (typeof item.text === "string") return item.text;
      if (item.type === "text" && typeof item.text === "string") return item.text;
      if (item.type === "thinking" || typeof item.thinking === "string") return "";
      if (item.type === "image") return "[image]";
      if (item.type === "toolCall") return "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeMessageRole(role: unknown): PiMessage["role"] | null {
  if (
    role === "user" ||
    role === "assistant" ||
    role === "system" ||
    role === "toolResult" ||
    role === "bashExecution" ||
    role === "custom" ||
    role === "branchSummary" ||
    role === "compactionSummary"
  ) {
    return role;
  }
  return null;
}

function extractContentBlocks(content: unknown): PiMessage["contentBlocks"] | undefined {
  if (!Array.isArray(content)) return undefined;
  const blocks = content.flatMap((block): NonNullable<PiMessage["contentBlocks"]> => {
    if (!block || typeof block !== "object") return [];
    const item = block as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string") return [{ type: "text", text: item.text }];
    if (item.type === "thinking" && typeof item.thinking === "string") return [{ type: "thinking", thinking: item.thinking, redacted: item.redacted === true }];
    if (item.type === "image") {
      return [
        {
          type: "image",
          data: typeof item.data === "string" ? item.data : undefined,
          mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
          url: typeof item.url === "string" ? item.url : undefined,
          alt: typeof item.alt === "string" ? item.alt : undefined,
        },
      ];
    }
    if (item.type === "toolCall" && typeof item.name === "string") {
      return [
        {
          type: "toolCall",
          id: typeof item.id === "string" ? item.id : undefined,
          name: item.name,
          arguments: item.arguments && typeof item.arguments === "object" ? (item.arguments as Record<string, unknown>) : undefined,
        },
      ];
    }
    const label = typeof item.type === "string" ? item.type : "unknown";
    return [{ type: "unknown", label, value: item }];
  });
  return blocks.length ? blocks : undefined;
}

function extractToolCallArgs(content: unknown, toolCallId?: string): Record<string, unknown> | undefined {
  if (!Array.isArray(content)) return undefined;
  const match = content.find((block) => {
    if (!block || typeof block !== "object") return false;
    const item = block as Record<string, unknown>;
    if (item.type !== "toolCall") return false;
    return !toolCallId || item.id === toolCallId;
  }) as Record<string, unknown> | undefined;
  const args = match?.arguments;
  return asRecord(args);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
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

function formatSessionTimestamp(value: unknown): string {
  if (typeof value !== "string" || !value || value === "unknown" || value === "current") return typeof value === "string" ? value : "unknown";
  const normalized = value.startsWith("unix-ms:") ? Number(value.slice("unix-ms:".length)) : Date.parse(value);
  if (!Number.isFinite(normalized)) return value;
  const date = new Date(normalized);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== "number") return "--:--";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const tauriPiRpcClient = new TauriPiRpcClient();
