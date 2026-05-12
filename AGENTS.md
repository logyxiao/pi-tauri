# AGENTS.md

本文件为 pi / coding agent 项目上下文。开发本仓库时，请遵守以下规则。

## 项目目标

构建基于 **pi** 的桌面 AI 编程 Agent 应用。视觉参考 WorkAny，技术栈参考 Tauri + React + TypeScript + Tailwind，但 Agent 核心必须是 pi。

## 必读

- `README.md`
- `design.md`
- `plan.md`
- `agent.md`

## 核心原则

- 不是 Claude Desktop 克隆
- 不是纯聊天 UI
- 必须突出 pi：tools、sessions、tree、fork、clone、models、thinking、compaction、extensions、skills、prompts
- 工具执行透明可见
- 危险操作必须可确认、可中止
- UI 风格现代、克制、低饱和、生产力工具感

## 技术方向

- Desktop：Tauri 2
- Frontend：React 19 + TypeScript + Vite
- Style：Tailwind CSS 4 + CSS variables + OKLCH
- UI：Radix UI + lucide-react
- Agent：`@earendil-works/pi-coding-agent` SDK 或 `pi --mode rpc`

## pi 集成注意

SDK 路线：

- `createAgentSession()` 管单会话
- `createAgentSessionRuntime()` 管 session replacement
- session replacement 后重新订阅 events
- 自定义 cwd + 显式 tools 时用 `create*Tool(cwd)` 工厂

RPC 路线：

- JSONL 严格按 `\n` 分割
- commands 可带 id，responses 回 id
- events 无 id
- 支持 extension UI protocol

## UI 必须映射的 pi 事件

- `message_update`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `queue_update`
- `compaction_start/end`
- `auto_retry_start/end`
- `extension_error`

## 禁止

- 不把 pi 简化成普通 LLM API
- 不隐藏 tool calls
- 不忽略 session JSONL/tree/fork/clone
- 不照搬 Claude Desktop
- 不默认静默执行危险命令
