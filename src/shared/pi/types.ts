export type PiRunState = "idle" | "running" | "aborting" | "error";

export type PiToolStatus = "running" | "success" | "error";

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type DangerousActionKind = "bash" | "write" | "edit" | "delete" | "reset" | "sensitive_path" | "command";

export interface DangerousAction {
  id: string;
  kind: DangerousActionKind;
  target: string;
  reason: string;
  severity: "medium" | "high" | "critical";
  requiresConfirmation: boolean;
}

export interface PiSafetyEvent {
  id: string;
  action: DangerousAction;
  decision: "allowed" | "blocked" | "flagged";
  source: "command" | "tool" | "rpc-limitation";
  createdAt: string;
}

export interface PiModel {
  id: string;
  name: string;
  provider: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface PiSettings {
  model?: string;
  provider?: string;
  thinkingLevel: PiThinkingLevel;
  cwd: string;
  clientMode: "mock" | "tauri-rpc";
  sessionFile?: string;
}

export interface PiSettingsUpdate {
  model?: string;
  provider?: string;
  thinkingLevel?: PiThinkingLevel;
}

export interface PiSessionSummary {
  id: string;
  name: string;
  cwd: string;
  updatedAt: string;
  model: string;
  status: "idle" | "running";
  filePath?: string;
  messageCount?: number;
}

export interface PiFileEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
  depth: number;
  size?: number;
  modifiedAt?: string;
}

export interface PiFilePreview {
  path: string;
  name: string;
  kind: "text" | "markdown" | "image" | "html" | "binary" | "missing";
  content?: string;
  size?: number;
  truncated?: boolean;
  mime?: string;
}

export interface PiToolCall {
  id: string;
  name: "read" | "write" | "edit" | "bash" | "grep" | "find" | "ls" | string;
  target: string;
  status: PiToolStatus;
  durationMs?: number;
  summary: string;
  output?: string;
  safety?: DangerousAction;
}

export interface PiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  tools?: PiToolCall[];
}

export interface PiState {
  runState: PiRunState;
  cwd: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  tokenCount: number;
  costUsd: number;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
}

export interface PiSessionStats {
  sessionFile?: string;
  sessionId?: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  costUsd: number;
  totalTokens: number;
  contextTokens?: number | null;
  contextWindow?: number | null;
  contextPercent?: number | null;
}

export interface PiCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin";
  location?: "user" | "project" | "path";
  path?: string;
  dangerous?: boolean;
  safety?: DangerousAction;
}

export interface PiExtensionPanel {
  key: string;
  title: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
  source?: string;
}

export interface PiExtensionStatus {
  key: string;
  text: string;
  source?: string;
}

export interface PiExtensionMessage {
  id: string;
  method: "notify" | "setStatus" | "setWidget" | "setTitle" | "set_editor_text" | "confirm" | "select" | "input" | "editor";
  title?: string;
  message?: string;
  level?: "info" | "warning" | "error";
  source?: string;
  createdAt: string;
}

export interface PiExtensionError {
  id: string;
  extensionPath?: string;
  event?: string;
  message: string;
  createdAt: string;
}
