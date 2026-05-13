import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiExtensionStatus,
  PiExtensionUiResponse,
  PiFileEntry,
  PiFilePreview,
  PiMessage,
  PiModel,
  PiForkMessage,
  PiSafetyEvent,
  PiSessionStats,
  PiSessionSummary,
  PiSessionTree,
  PiSettings,
  PiSettingsUpdate,
  PiState,
  PiToolCall,
} from "./types";

export type PiTextDeltaEvent = {
  type: "message_update";
  delta?: string;
  message?: PiMessage;
};

export type PiAgentStateEvent =
  | { type: "agent_start" | "aborted" }
  | { type: "agent_end"; messages?: PiMessage[] };

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

export interface PiSessionListOptions {
  cwd?: string;
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
  listSessions(options?: PiSessionListOptions): Promise<PiSessionSummary[]>;
  readSessionMessages(sessionPath: string): Promise<PiMessage[]>;
  getSessionTree(sessionPath?: string): Promise<PiSessionTree>;
  getForkMessages(): Promise<PiForkMessage[]>;
  forkSession(entryId: string): Promise<{ text?: string; cancelled?: boolean }>;
  cloneSession(): Promise<{ cancelled?: boolean }>;
  setSessionEntryLabel(entryId: string, label?: string): Promise<void>;
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
  respondExtensionUi(response: PiExtensionUiResponse): Promise<void>;
  subscribe(listener: (event: PiClientEvent) => void): () => void;
}
