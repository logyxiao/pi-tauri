# Agent 开发说明

本文为参与本项目开发的 coding agent 使用。目标：构建一个基于 **pi** 的桌面应用，视觉参考 WorkAny，但产品能力必须围绕 pi。

## 项目定位

- 项目名：`pi-tauri`
- 目标：桌面端 pi Agent 工作台
- 不是 Claude Desktop 克隆
- 不是纯聊天 UI
- 核心是 pi 的会话、工具、模型、扩展、上下文管理

## 必读文件

开发前先读：

1. `README.md`
2. `design.md`
3. `plan.md`
4. 本文件 `agent.md`

涉及 pi 能力时，还需阅读 pi 官方文档：

- `README.md`
- `docs/sdk.md`
- `docs/rpc.md`
- `docs/extensions.md`
- `docs/models.md`
- `docs/settings.md`
- `docs/session-format.md`
- `examples/sdk/README.md`

## 设计约束

视觉方向：

- WorkAny 风格
- 极简、低饱和、浅色优先
- 支持深色模式
- 大圆角、轻阴影、细边框
- 生产力工具感，不做营销感

布局方向：

```txt
Left Sidebar + Main Chat/Run Area + Right Inspector
```

必须体现 pi，而不是普通聊天壳：

- 工具调用可视化
- 会话树
- fork / clone
- model / thinking level
- compaction
- extension UI
- skills / prompts
- settings / models.json / sessions

## 技术约束

优先技术栈：

- Tauri 2
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Radix UI
- lucide-react
- `@earendil-works/pi-coding-agent`

推荐 pi 集成路线：

1. 首选：Node sidecar + pi SDK
2. 备选：spawn `pi --mode rpc`

如果选择 SDK：

- 使用 `createAgentSession()` 管理单会话
- 使用 `createAgentSessionRuntime()` 管理新建、切换、fork、clone
- session replacement 后必须重新订阅事件
- 自定义 cwd + 显式 tools 时，必须使用 `create*Tool(cwd)` 工厂

如果选择 RPC：

- 严格按 `\n` 切 JSONL
- 不用会按 Unicode separator 切行的通用 readline
- commands 带 `id`，responses 回同 id
- events 不带 id
- 必须支持 extension UI protocol

## 文件结构建议

```txt
src/
├── app/
├── components/
│   ├── layout/
│   ├── chat/
│   ├── tools/
│   ├── sessions/
│   ├── model/
│   └── ui/
├── shared/
│   ├── pi/
│   ├── hooks/
│   ├── db/
│   └── lib/
└── config/
```

## 组件原则

- 组件小而清晰
- UI primitives 与业务组件分离
- pi event 解析逻辑放到 `shared/pi` 或 hooks
- 工具展示组件按 tool 类型拆分
- 不把全部逻辑塞进页面组件

建议命名：

- `AppShell`
- `LeftSidebar`
- `RightInspector`
- `ChatInput`
- `MessageList`
- `AssistantMessage`
- `ToolCallItem`
- `ToolResultPanel`
- `SessionTree`
- `ModelSelector`
- `ThinkingSelector`

## pi 事件映射

实现 UI 时优先映射这些事件：

- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `queue_update`
- `compaction_start`
- `compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `extension_error`
- `extension_ui_request`（RPC 路线）

## UI 状态模型建议

至少维护：

- current session
- session list
- messages
- active tool calls
- selected tool call
- current model
- thinking level
- isStreaming
- queue state
- compaction state
- retry state
- right inspector tab
- cwd / project path
- extension UI dialogs

## 安全要求

桌面 app 不能隐藏危险行为。

必须考虑：

- bash 危险命令确认
- 删除文件/会话确认
- 写敏感路径确认
- 显示当前 cwd
- 显示执行命令
- 支持 abort
- 错误要可见

## 代码风格

- TypeScript 严格类型优先
- 避免 `any`，必要时局部隔离
- React 组件保持纯净
- 业务状态集中在 hooks/store
- 样式使用 Tailwind + CSS variables
- 不硬编码颜色，使用 tokens
- 所有用户可见文案后续需可 i18n

## 禁止事项

- 不做 Claude Desktop 风格纯聊天界面
- 不隐藏 tool calls
- 不绕过 pi session 体系自建聊天历史作为主存储
- 不把 pi 当普通 LLM API 用
- 不默认静默执行危险 bash
- 不忽略 session replacement 后重订阅问题
- 不把 WorkAny 的 AI Runtime 直接照搬；本项目核心是 pi

## 当前阶段目标

当前仓库仍是规划阶段。优先顺序：

1. 建立 Tauri + React 项目骨架
2. 建立视觉 token 和 AppShell
3. 做 pi 集成 PoC（SDK sidecar 或 RPC）
4. 打通 prompt → event stream → UI
5. 再做完整会话管理和扩展协议
