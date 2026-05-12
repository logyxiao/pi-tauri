import {
  demoCommands,
  demoExtensionErrors,
  demoExtensionMessages,
  demoExtensionPanels,
  demoMessages,
  demoModels,
  demoPiState,
  demoSafetyEvents,
  demoSessionStats,
  demoSettings,
} from "./mock-data";
import type { PiClient, PiClientEvent } from "./client";
import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiMessage,
  PiModel,
  PiSafetyEvent,
  PiSessionStats,
  PiSettings,
  PiSettingsUpdate,
  PiState,
  PiToolCall,
} from "./types";
import { createSafetyEvent, detectDangerousCommand, detectDangerousTool } from "./safety";

type Listener = (event: PiClientEvent) => void;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const nowLabel = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export class MockPiClient implements PiClient {
  private listeners = new Set<Listener>();
  private aborted = false;
  private messages: PiMessage[] = demoMessages;
  private state: PiState = demoPiState;
  private settings: PiSettings = demoSettings;
  private commands: PiCommand[] = demoCommands;
  private extensionPanels: PiExtensionPanel[] = demoExtensionPanels;
  private extensionMessages: PiExtensionMessage[] = demoExtensionMessages;
  private extensionErrors: PiExtensionError[] = demoExtensionErrors;
  private safetyEvents: PiSafetyEvent[] = demoSafetyEvents;

  async connect(): Promise<void> {
    await wait(80);
  }

  async prompt(message: string): Promise<void> {
    this.aborted = false;
    this.state = { ...this.state, runState: "running" };
    this.emit({ type: "agent_start" });

    const userMessage: PiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      createdAt: nowLabel(),
    };
    this.messages = [...this.messages, userMessage];

    const chunks = [
      "收到。当前是 mock PiClient PoC：",
      "已把输入框接到 pi client 抽象，",
      "并把事件流映射到 UI。",
      "下一步可替换为真实 `pi --mode rpc` 或 SDK sidecar。",
    ];

    let assistantContent = "";
    for (const delta of chunks) {
      if (this.aborted) return;
      await wait(180);
      assistantContent += delta;
      this.emit({ type: "message_update", delta });
    }

    const tool: PiToolCall = {
      id: crypto.randomUUID(),
      name: message.toLowerCase().includes("delete") ? "bash" : "bash",
      target: message.toLowerCase().includes("delete") ? "rm -rf dist" : "pi --mode rpc --no-session",
      status: "running",
      summary: message.toLowerCase().includes("delete") ? "Dangerous command flagged by safety policy" : "RPC smoke test placeholder",
      output: message.toLowerCase().includes("delete") ? "Safety policy requires confirmation for recursive delete." : "starting rpc client...",
    };
    const detectedToolSafety = detectDangerousTool(tool);
    const visibleTool = detectedToolSafety ? { ...tool, safety: detectedToolSafety } : tool;
    if (detectedToolSafety) this.safetyEvents = [createSafetyEvent(detectedToolSafety, "flagged", "tool"), ...this.safetyEvents].slice(0, 20);

    this.emit({ type: "tool_execution_start", tool: visibleTool });
    await wait(350);
    if (this.aborted) return;

    const updatedTool = detectedToolSafety
      ? { ...visibleTool, output: "Dangerous bash visible; pre-run blocking requires SDK/extension interception.", summary: "Safety policy flagged dangerous tool" }
      : { ...visibleTool, output: "get_state response parsed", summary: "JSONL reader ready" };
    this.emit({ type: "tool_execution_update", tool: updatedTool });
    await wait(280);
    if (this.aborted) return;

    const completedTool: PiToolCall = { ...updatedTool, status: "success", durationMs: 630, summary: "Mock tool execution complete" };
    this.emit({
      type: "tool_execution_end",
      tool: completedTool,
    });

    const assistantMessage: PiMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: assistantContent,
      createdAt: nowLabel(),
      tools: [completedTool],
    };
    this.messages = [...this.messages, assistantMessage];
    this.state = { ...this.state, runState: "idle", tokenCount: this.state.tokenCount + 512 };
    this.emit({ type: "agent_end" });
  }

  async steer(message: string): Promise<void> {
    await this.prompt(message);
  }

  async followUp(message: string): Promise<void> {
    await this.prompt(message);
  }

  async abort(): Promise<void> {
    this.aborted = true;
    this.state = { ...this.state, runState: "idle" };
    this.emit({ type: "aborted" });
  }

  async newSession(): Promise<void> {
    this.aborted = true;
    this.messages = [];
    this.state = { ...this.state, runState: "idle", tokenCount: 0, costUsd: 0 };
  }

  async getState(): Promise<PiState> {
    return this.state;
  }

  async getMessages(): Promise<PiMessage[]> {
    return this.messages;
  }

  async getSessionStats(): Promise<PiSessionStats> {
    return {
      ...demoSessionStats,
      userMessages: this.messages.filter((message) => message.role === "user").length,
      assistantMessages: this.messages.filter((message) => message.role === "assistant").length,
      totalMessages: this.messages.length,
      totalTokens: this.state.tokenCount,
      costUsd: this.state.costUsd,
    };
  }

  async listModels(): Promise<PiModel[]> {
    return demoModels;
  }

  async getSettings(): Promise<PiSettings> {
    return this.settings;
  }

  async updateSettings(update: PiSettingsUpdate): Promise<PiSettings> {
    const nextModel = update.model ? demoModels.find((model) => model.id === update.model) : undefined;
    this.settings = {
      ...this.settings,
      ...update,
      provider: update.provider ?? nextModel?.provider ?? this.settings.provider,
    };
    this.state = {
      ...this.state,
      model: nextModel ? `${nextModel.provider}/${nextModel.id}` : this.state.model,
      thinkingLevel: update.thinkingLevel ?? this.state.thinkingLevel,
    };
    return this.settings;
  }

  async listCommands(): Promise<PiCommand[]> {
    return this.commands;
  }

  async executeCommand(commandName: string): Promise<void> {
    const command = this.commands.find((item) => item.name === commandName);
    const action = command ? detectDangerousCommand(command) : null;
    if (action) this.safetyEvents = [createSafetyEvent(action, "allowed", "command"), ...this.safetyEvents].slice(0, 20);
    const summary = command ? `/${command.name} executed via mock client` : `/${commandName} executed via mock client`;
    const message: PiExtensionMessage = {
      id: crypto.randomUUID(),
      method: "notify",
      message: summary,
      level: command?.dangerous ? "warning" : "info",
      source: command?.path,
      createdAt: nowLabel(),
    };
    this.extensionMessages = [message, ...this.extensionMessages].slice(0, 20);
    this.emit({ type: "extension_ui_request", message });
    await this.prompt(`/${commandName}`);
  }

  async listExtensionPanels(): Promise<PiExtensionPanel[]> {
    return this.extensionPanels;
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

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: PiClientEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

export const mockPiClient = new MockPiClient();
