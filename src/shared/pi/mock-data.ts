import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiModel,
  PiMessage,
  PiSessionStats,
  PiSessionSummary,
  PiSettings,
  PiState,
  PiToolCall,
} from "./types";

export const demoSessions: PiSessionSummary[] = [
  {
    id: "s1",
    name: "构建 pi desktop shell",
    cwd: "C:/Users/to/logyxiao/pi-tauri",
    updatedAt: "2 min ago",
    model: "claude-sonnet-4.5",
    status: "running",
  },
  {
    id: "s2",
    name: "调研 SDK runtime",
    cwd: "~/projects/pi-lab",
    updatedAt: "Yesterday",
    model: "gpt-4o",
    status: "idle",
  },
  {
    id: "s3",
    name: "Extension UI bridge",
    cwd: "~/work/agent-ui",
    updatedAt: "Mon",
    model: "gemini-2.5-pro",
    status: "idle",
  },
];

export const demoTools: PiToolCall[] = [
  {
    id: "t1",
    name: "read",
    target: "design.md",
    status: "success",
    durationMs: 68,
    summary: "Loaded design context, 214 lines",
    output: "# 设计总结与后续开发要点\n...",
  },
  {
    id: "t2",
    name: "bash",
    target: "pnpm build",
    status: "running",
    summary: "Type-checking React shell",
    output: "vite v7.3.3 building...",
  },
  {
    id: "t3",
    name: "edit",
    target: "src/app/App.tsx",
    status: "success",
    durationMs: 143,
    summary: "Replaced Tauri starter page with AppShell",
    output: "+ AppShell\n+ LeftSidebar\n+ RightInspector",
  },
];

export const demoMessages: PiMessage[] = [
  {
    id: "m1",
    role: "user",
    createdAt: "22:31",
    content: "按照 plan.md 开始构建项目，同时每次完成修改 plan.md",
  },
  {
    id: "m2",
    role: "assistant",
    createdAt: "22:32",
    content:
      "已初始化 Tauri + React + TypeScript + Tailwind 基础壳。下一步打通 pi SDK/RPC PoC，让 prompt 能进入真实 pi event stream。",
    tools: demoTools,
  },
];

export const demoPiState: PiState = {
  runState: "running",
  cwd: "C:/Users/to/logyxiao/pi-tauri",
  model: "claude-sonnet-4.5",
  thinkingLevel: "medium",
  tokenCount: 18492,
  costUsd: 0.37,
  sessionFile: "~/.pi/agent/sessions/--pi-tauri--/demo.jsonl",
  sessionId: "demo-session",
};

export const demoModels: PiModel[] = [
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    api: "anthropic-messages",
    reasoning: true,
    contextWindow: 200000,
    maxTokens: 16384,
  },
  {
    id: "gpt-5-mini",
    name: "GPT-5 Mini",
    provider: "openai",
    api: "openai-responses",
    reasoning: true,
    contextWindow: 400000,
    maxTokens: 32768,
  },
  {
    id: "qwen2.5-coder:7b",
    name: "Qwen2.5 Coder 7B (Local)",
    provider: "ollama",
    api: "openai-completions",
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 8192,
  },
];

export const demoSettings: PiSettings = {
  model: demoModels[0].id,
  provider: demoModels[0].provider,
  thinkingLevel: demoPiState.thinkingLevel,
  cwd: demoPiState.cwd,
  clientMode: "mock",
  sessionFile: demoPiState.sessionFile,
};

export const demoSessionStats: PiSessionStats = {
  sessionFile: demoPiState.sessionFile,
  sessionId: demoPiState.sessionId,
  userMessages: 4,
  assistantMessages: 4,
  toolCalls: 8,
  toolResults: 8,
  totalMessages: 16,
  costUsd: 0.37,
  totalTokens: 18492,
  contextTokens: 18492,
  contextWindow: 200000,
  contextPercent: 9.2,
};

export const demoCommands: PiCommand[] = [
  {
    name: "help",
    description: "Show pi slash commands and usage hints",
    source: "builtin",
  },
  {
    name: "models",
    description: "List available models and current selection",
    source: "extension",
    path: "~/.pi/agent/extensions/models.ts",
  },
  {
    name: "sessions",
    description: "Summarize recent sessions and current branch",
    source: "prompt",
    location: "project",
    path: ".pi/prompts/sessions.md",
  },
  {
    name: "extensions",
    description: "Show loaded extensions and active UI widgets",
    source: "extension",
    path: "~/.pi/agent/extensions/ui.ts",
  },
  {
    name: "compact",
    description: "Compact current context and summarize retained state",
    source: "builtin",
  },
  {
    name: "shell-reset",
    description: "Reset shell helper state and clear working files",
    source: "extension",
    dangerous: true,
    path: "~/.pi/agent/extensions/shell-guard.ts",
  },
];

export const demoExtensionPanels: PiExtensionPanel[] = [
  {
    key: "review-widget",
    title: "Review widget",
    lines: ["pending files: 3", "dangerous bash blocked: 1", "next: confirm shell reset"],
    placement: "aboveEditor",
    source: "ui.ts",
  },
  {
    key: "queue-widget",
    title: "Queue",
    lines: ["follow-up: /compact", "steer: none"],
    placement: "belowEditor",
    source: "queue.ts",
  },
];

export const demoExtensionMessages: PiExtensionMessage[] = [
  {
    id: "ext-msg-1",
    method: "notify",
    message: "Extension loaded: ui.ts",
    level: "info",
    source: "ui.ts",
    createdAt: "22:34",
  },
  {
    id: "ext-msg-2",
    method: "setStatus",
    title: "shell-guard",
    message: "Waiting confirm for dangerous shell reset",
    level: "warning",
    source: "shell-guard.ts",
    createdAt: "22:35",
  },
];

export const demoExtensionErrors: PiExtensionError[] = [
  {
    id: "ext-err-1",
    extensionPath: "~/.pi/agent/extensions/demo.ts",
    event: "tool_call",
    message: "Failed to read cached review summary",
    createdAt: "22:36",
  },
];
