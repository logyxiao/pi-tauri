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

export type PiTextDeltaEvent = {
  type: "message_update";
  delta: string;
};

export type PiAgentStateEvent = {
  type: "agent_start" | "agent_end" | "aborted";
};

export type PiToolEvent =
  | { type: "tool_execution_start"; tool: PiToolCall }
  | { type: "tool_execution_update"; tool: PiToolCall }
  | { type: "tool_execution_end"; tool: PiToolCall };

export type PiExtensionErrorEvent = {
  type: "extension_error";
  error: PiExtensionError;
};

export type PiExtensionUiEvent = {
  type: "extension_ui_request";
  message: PiExtensionMessage;
  panel?: PiExtensionPanel;
  status?: PiExtensionStatus;
  editorText?: string;
};

export type PiClientEvent = PiTextDeltaEvent | PiAgentStateEvent | PiToolEvent | PiExtensionErrorEvent | PiExtensionUiEvent;

export interface PromptOptions {
  streamingBehavior?: "steer" | "followUp";
}

export interface PiClient {
  connect(): Promise<void>;
  prompt(message: string, options?: PromptOptions): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  newSession(): Promise<void>;
  continueRecent(): Promise<void>;
  switchSession(sessionPath: string): Promise<void>;
  setSessionName(name: string): Promise<void>;
  deleteSession(sessionPath: string): Promise<void>;
  exportHtml(outputPath?: string): Promise<string | null>;
  listSessions(): Promise<PiSessionSummary[]>;
  getState(): Promise<PiState>;
  getMessages(): Promise<PiMessage[]>;
  getSessionStats(): Promise<PiSessionStats>;
  listModels(): Promise<PiModel[]>;
  getSettings(): Promise<PiSettings>;
  updateSettings(settings: PiSettingsUpdate): Promise<PiSettings>;
  listCommands(): Promise<PiCommand[]>;
  executeCommand(commandName: string): Promise<void>;
  listExtensionPanels(): Promise<PiExtensionPanel[]>;
  listExtensionMessages(): Promise<PiExtensionMessage[]>;
  listExtensionErrors(): Promise<PiExtensionError[]>;
  listSafetyEvents(): Promise<PiSafetyEvent[]>;
  recordSafetyEvent(event: PiSafetyEvent): Promise<void>;
  listFiles(): Promise<PiFileEntry[]>;
  readFile(path: string): Promise<PiFilePreview>;
  subscribe(listener: (event: PiClientEvent) => void): () => void;
}
