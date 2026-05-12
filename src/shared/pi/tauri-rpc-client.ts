import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PiClient, PiClientEvent, PiSessionListOptions, PromptOptions } from "./client";
import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiExtensionStatus,
  PiFileEntry,
  PiFilePreview,
  PiMessage,
  PiModel,
  PiSafetyEvent,
  PiSessionStats,
  PiSessionSummary,
  PiSettings,
  PiSettingsUpdate,
  PiState,
  PiToolCall,
} from "./types";
import { createSafetyEvent, detectDangerousCommand, detectDangerousTool } from "./safety";

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

  async listSessions(options: PiSessionListOptions = {}): Promise<PiSessionSummary[]> {
    const state = await this.getState();
    try {
      const sessions = await invoke<unknown[]>("pi_list_sessions", { cwd: options.allProjects ? "" : state.cwd });
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
    return {
      model,
      provider,
      thinkingLevel: state.thinkingLevel,
      cwd: state.cwd,
      clientMode: "tauri-rpc",
      sessionFile: state.sessionFile,
    };
  }

  async updateSettings(update: PiSettingsUpdate): Promise<PiSettings> {
    if (update.model) {
      const provider = update.provider ?? splitModelKey(update.model)[0];
      const modelId = splitModelKey(update.model)[1] ?? update.model;
      if (provider) await this.request({ type: "set_model", provider, modelId });
      else console.warn("pi rpc set_model skipped: provider missing", update);
    }

    if (update.thinkingLevel) {
      await this.request({ type: "set_thinking_level", level: update.thinkingLevel });
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
      if (assistantMessageEvent?.type === "text_delta") {
        this.emit({ type: "message_update", delta: String(assistantMessageEvent.delta ?? "") });
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
      const tool = mapToolEvent(event);
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

  private emit(event: PiClientEvent) {
    for (const listener of this.listeners) listener(event);
  }
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
    updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : "unknown",
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

function mapAgentMessage(raw: unknown): PiMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  const role = message.role;
  if (role !== "user" && role !== "assistant" && role !== "system") return null;

  return {
    id: crypto.randomUUID(),
    role,
    content: extractContentText(message.content),
    createdAt: formatTimestamp(message.timestamp),
  };
}

function mapToolEvent(event: Record<string, unknown>): PiToolCall {
  const result = (event.result ?? event.partialResult) as Record<string, unknown> | undefined;
  const args = event.args as Record<string, unknown> | undefined;
  const name = String(event.toolName ?? "tool");
  const isEnd = event.type === "tool_execution_end";
  const isError = Boolean(event.isError);

  const tool: PiToolCall = {
    id: String(event.toolCallId ?? crypto.randomUUID()),
    name,
    target: extractToolTarget(name, args),
    status: isEnd ? (isError ? "error" : "success") : "running",
    summary: isEnd ? (isError ? "Tool failed" : "Tool complete") : "Tool running",
    output: extractContentText(result?.content),
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
      if (typeof item.thinking === "string") return item.thinking;
      if (item.type === "toolCall") return `[tool:${String(item.name ?? "tool")}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== "number") return "--:--";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const tauriPiRpcClient = new TauriPiRpcClient();
