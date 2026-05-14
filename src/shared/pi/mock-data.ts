import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiFileEntry,
  PiFilePreview,
  PiModel,
  PiMessage,
  PiSafetyEvent,
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
  {
    id: "t4",
    name: "bash",
    target: "rm -rf dist",
    status: "error",
    durationMs: 0,
    summary: "Blocked by safety policy before execution",
    output: "Dangerous bash requires explicit confirmation.",
    safety: {
      id: "danger-demo-bash",
      kind: "bash",
      target: "rm -rf dist",
      reason: "Recursive delete command detected.",
      severity: "critical",
      requiresConfirmation: true,
    },
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
  sdkSidecar: { available: false, error: "mock client" },
  persistedSettings: {},
  settingsWarning: "mock settings are not persisted",
  settingsSources: {
    model: "runtime",
    thinkingLevel: "runtime",
    sessionDir: "fallback",
    autoCompaction: "fallback",
    autoRetry: "fallback",
    steeringMode: "fallback",
    followUpMode: "fallback",
  },
  sessionFile: demoPiState.sessionFile,
  sessionDir: "~/.pi/agent/sessions",
  autoCompaction: true,
  autoRetry: true,
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  auth: [
    { provider: "anthropic", status: "configured", detail: "mock key present" },
    { provider: "openai", status: "unknown", detail: "not checked in mock" },
  ],
  extensionResources: [
    { id: "~/.pi/agent/extensions/mock-ui.ts", name: "mock-ui", path: "~/.pi/agent/extensions/mock-ui.ts", scope: "global", source: "auto", enabled: true, removable: true },
    { id: ".pi/extensions/shell-guard.ts", name: "shell-guard", path: ".pi/extensions/shell-guard.ts", scope: "project", source: "auto", enabled: true, removable: true },
    { id: "~/.pi/agent/extensions/old.ts", name: "old", path: "~/.pi/agent/extensions/old.ts", scope: "global", source: "auto", enabled: false, removable: true, disabledByPattern: true },
  ],
  skillResources: [
    { id: "~/.pi/agent/skills/caveman", name: "caveman", path: "~/.pi/agent/skills/caveman", scope: "global", source: "auto", enabled: true, removable: true },
    { id: ".agents/skills/code-review", name: "code-review", path: ".agents/skills/code-review", scope: "project", source: "auto", enabled: true, removable: true },
  ],
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
    name: "ui-confirm",
    description: "Mock extension confirm dialog",
    source: "extension",
    path: "~/.pi/agent/extensions/mock-ui.ts",
  },
  {
    name: "ui-select",
    description: "Mock extension select dialog",
    source: "extension",
    path: "~/.pi/agent/extensions/mock-ui.ts",
  },
  {
    name: "ui-input",
    description: "Mock extension input dialog",
    source: "extension",
    path: "~/.pi/agent/extensions/mock-ui.ts",
  },
  {
    name: "ui-editor",
    description: "Mock extension editor dialog",
    source: "extension",
    path: "~/.pi/agent/extensions/mock-ui.ts",
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
    safety: {
      id: "danger-demo-command",
      kind: "reset",
      target: "shell-reset",
      reason: "Command may reset shell helper state and clear working files.",
      severity: "high",
      requiresConfirmation: true,
    },
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
  {
    id: "ext-confirm-1",
    method: "confirm",
    title: "Mock extension confirm",
    message: "Allow extension to continue?",
    level: "info",
    source: "mock-extension.ts",
    createdAt: "22:36",
    expectsResponse: true,
  },
];

export const demoSafetyEvents: PiSafetyEvent[] = [
  {
    id: "safe-event-1",
    decision: "blocked",
    source: "command",
    createdAt: "22:37",
    action: {
      id: "danger-demo-command",
      kind: "reset",
      target: "/shell-reset",
      reason: "Dangerous command requires confirmation before execution.",
      severity: "high",
      requiresConfirmation: true,
    },
  },
  {
    id: "safe-event-2",
    decision: "flagged",
    source: "tool",
    createdAt: "22:38",
    action: {
      id: "danger-demo-bash",
      kind: "bash",
      target: "rm -rf dist",
      reason: "RPC tool event visible after pi emits it; SDK/extension interception required for pre-run blocking.",
      severity: "critical",
      requiresConfirmation: true,
    },
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

export const demoFiles: PiFileEntry[] = [
  { path: "README.md", name: "README.md", kind: "file", depth: 0, size: 4180 },
  { path: "design.md", name: "design.md", kind: "file", depth: 0, size: 12860 },
  { path: "plan.md", name: "plan.md", kind: "file", depth: 0, size: 15640 },
  { path: "src", name: "src", kind: "directory", depth: 0 },
  { path: "src/app", name: "app", kind: "directory", depth: 1 },
  { path: "src/app/App.tsx", name: "App.tsx", kind: "file", depth: 2, size: 198 },
  { path: "src/components", name: "components", kind: "directory", depth: 1 },
  { path: "src/components/layout/RightInspector.tsx", name: "RightInspector.tsx", kind: "file", depth: 2, size: 6120 },
  { path: "src/shared/pi/client.ts", name: "client.ts", kind: "file", depth: 2, size: 1680 },
  { path: "src/shared/pi/types.ts", name: "types.ts", kind: "file", depth: 2, size: 2410 },
  { path: "public", name: "public", kind: "directory", depth: 0 },
  { path: "public/vite.svg", name: "vite.svg", kind: "file", depth: 1, size: 1497 },
  { path: "dist/index.html", name: "index.html", kind: "file", depth: 1, size: 490 },
];

export const demoFilePreviews: Record<string, PiFilePreview> = {
  "README.md": {
    path: "README.md",
    name: "README.md",
    kind: "markdown",
    content: "# pi-tauri\n\n基于 **pi** 的桌面 AI 编程 Agent 应用。\n\n- Tauri 2 + React + TypeScript\n- pi RPC / SDK integration\n- Tools, sessions, extensions, file preview\n",
    size: 4180,
  },
  "design.md": {
    path: "design.md",
    name: "design.md",
    kind: "markdown",
    content: "# 设计总结与后续开发要点\n\n右侧 Inspector 承载工具调用详情、文件树、工作目录和产物预览。\n",
    size: 12860,
  },
  "src/components/layout/RightInspector.tsx": {
    path: "src/components/layout/RightInspector.tsx",
    name: "RightInspector.tsx",
    kind: "text",
    content: "export function RightInspector() {\n  return <aside>Tools, files, sessions, extensions</aside>;\n}\n",
    size: 6120,
  },
  "public/vite.svg": {
    path: "public/vite.svg",
    name: "vite.svg",
    kind: "image",
    mime: "image/svg+xml",
    size: 1497,
  },
  "dist/index.html": {
    path: "dist/index.html",
    name: "index.html",
    kind: "html",
    content: "<div id=\"root\"></div>\n<script type=\"module\" src=\"/src/main.tsx\"></script>\n",
    size: 490,
  },
};
