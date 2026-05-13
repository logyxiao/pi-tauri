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

export type PiDeliveryMode = "all" | "one-at-a-time";

export interface PiAuthStatus {
  provider: string;
  status: "unknown" | "configured" | "missing" | "expired";
  detail?: string;
}

export type PiSettingsFieldSource = "runtime" | "persisted" | "fallback" | "unknown";

export interface PiSettings {
  model?: string;
  provider?: string;
  thinkingLevel: PiThinkingLevel;
  cwd: string;
  clientMode: "mock" | "tauri-rpc";
  sdkSidecar?: {
    available: boolean;
    version?: string;
    error?: string;
  };
  persistedSettings?: Record<string, unknown>;
  settingsWarning?: string;
  settingsSources?: Partial<Record<"model" | "thinkingLevel" | "sessionDir" | "autoCompaction" | "autoRetry" | "steeringMode" | "followUpMode", PiSettingsFieldSource>>;
  sessionFile?: string;
  sessionDir?: string;
  autoCompaction?: boolean;
  autoRetry?: boolean;
  steeringMode?: PiDeliveryMode;
  followUpMode?: PiDeliveryMode;
  auth?: PiAuthStatus[];
}

export interface PiSettingsUpdate {
  model?: string;
  provider?: string;
  thinkingLevel?: PiThinkingLevel;
  autoCompaction?: boolean;
  autoRetry?: boolean;
  steeringMode?: PiDeliveryMode;
  followUpMode?: PiDeliveryMode;
}

export interface PiSessionSummary {
  id: string;
  name: string;
  cwd: string;
  updatedAt: string;
  updatedAtMs?: number;
  model: string;
  status: "idle" | "running";
  filePath?: string;
  messageCount?: number;
}

export type PiSessionTreeNodeType =
  | "session"
  | "message"
  | "model_change"
  | "thinking_level_change"
  | "compaction"
  | "branch_summary"
  | "custom"
  | "unknown";

export interface PiSessionTreeNode {
  id: string;
  parentId?: string;
  type: PiSessionTreeNodeType;
  role?: "user" | "assistant" | "system" | "toolResult" | "custom";
  title: string;
  timestamp?: string;
  label?: string;
  summary?: string;
  depth: number;
  childrenCount: number;
  isLeaf: boolean;
}

export type PiSessionTreeCursorSource = "sdk" | "rpc" | "jsonl-inferred" | "unknown";

export interface PiSessionTree {
  sessionFile?: string;
  parentSession?: string;
  nodes: PiSessionTreeNode[];
  activeLeafId?: string;
  activeLeafSource?: PiSessionTreeCursorSource;
  activeLeafNote?: string;
}

export interface PiForkMessage {
  entryId: string;
  text: string;
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
  args?: Record<string, unknown>;
  details?: Record<string, unknown>;
  isError?: boolean;
  safety?: DangerousAction;
}

export type PiMessageRole = "user" | "assistant" | "system" | "toolResult" | "bashExecution" | "custom" | "branchSummary" | "compactionSummary";

export type PiMessageContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; redacted?: boolean }
  | { type: "image"; data?: string; mimeType?: string; url?: string; alt?: string }
  | { type: "toolCall"; id?: string; name: string; arguments?: Record<string, unknown> }
  | { type: "unknown"; label: string; value?: unknown };

export interface PiMessage {
  id: string;
  role: PiMessageRole;
  content: string;
  createdAt: string;
  contentBlocks?: PiMessageContentBlock[];
  toolArgs?: Record<string, unknown>;
  toolDetails?: Record<string, unknown>;
  stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted" | string;
  errorMessage?: string;
  customType?: string;
  tokensBefore?: number;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  cancelled?: boolean;
  truncated?: boolean;
  fullOutputPath?: string;
  excludeFromContext?: boolean;
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

export type PiExtensionUiMethod = "notify" | "setStatus" | "setWidget" | "setTitle" | "set_editor_text" | "confirm" | "select" | "input" | "editor";

export interface PiExtensionMessage {
  id: string;
  method: PiExtensionUiMethod;
  title?: string;
  message?: string;
  level?: "info" | "warning" | "error";
  source?: string;
  createdAt: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeoutMs?: number;
  expectsResponse?: boolean;
}

export interface PiExtensionUiResponse {
  id: string;
  method: PiExtensionUiMethod;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

export interface PiExtensionError {
  id: string;
  extensionPath?: string;
  event?: string;
  message: string;
  createdAt: string;
}
