# pi-tauri

基于 **pi** 的桌面 AI 编程 Agent 应用。项目目标是参考 WorkAny 的现代桌面应用风格，结合 pi 的 SDK/RPC、会话树、工具执行、扩展系统和模型管理能力，构建一个面向代码工作的桌面 Agent 工作台。

> 不是 Claude Desktop 克隆。核心体验必须围绕 pi：工具、会话、分支、模型、上下文、扩展。

## 项目目标

- 用自然语言驱动代码任务
- 实时展示 pi Agent 流式输出
- 可视化展示工具调用和结果
- 管理 pi JSONL 会话、分支、fork、clone、tree navigation
- 支持模型选择、thinking level、上下文压缩、自动重试
- 支持 pi extensions、skills、prompt templates、custom models
- 提供桌面端安全确认、工作目录管理和文件/代码预览

## 设计方向

视觉参考 WorkAny：

- 极简桌面应用
- 默认浅色，支持深色
- pi.dev 式纸感背景 `#ECE7E4` + 细网格修饰，主交互色用低饱和蓝灰，不用橙色/琥珀色
- 大圆角、轻阴影、细边框
- 左侧会话栏 + 中央执行流 + 右侧检查器
- 代码工具感强于普通聊天感

布局目标：

```txt
┌──────────────────────────────────────────────────────────────┐
│ Left Sidebar │              Main Chat/Run Area               │
│              │                          │ Right Inspector    │
│ Sessions     │ Messages / Tool Stream   │ Files / Tools      │
│ Projects     │ Input                     │ Session / Preview  │
└──────────────────────────────────────────────────────────────┘
```

详见：[`design.md`](./design.md)

## 技术栈

计划技术栈：

- Desktop：Tauri 2 + Rust
- Frontend：React 19 + TypeScript + Vite
- Styling：Tailwind CSS 4 + CSS Variables + OKLCH tokens
- UI：shadcn/ui（Radix UI primitives）+ lucide-react + 自定义业务组件
- Markdown：react-markdown + remark-gfm
- Code Highlight：Shiki 或 react-syntax-highlighter
- Agent：`@earendil-works/pi-coding-agent` SDK 或 `pi --mode rpc`
- Storage：pi JSONL sessions；必要时增加 SQLite/IndexedDB 索引缓存

## pi 集成方案

### 方案 A：Node sidecar + pi SDK（推荐）

前端通过 Tauri 调用本地 Node sidecar。sidecar 使用 pi SDK：

```ts
import {
  AuthStorage,
  createAgentSession,
  createAgentSessionRuntime,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
```

优点：

- 类型安全
- 直接订阅 AgentSession events
- 易定制 tools、settings、extensions、resource loading
- 适合长期产品化

### 方案 B：spawn `pi --mode rpc`

通过 stdin/stdout JSONL 与 pi 进程通信。

优点：

- 进程隔离
- 协议稳定
- 可从 Rust/Tauri 直接集成

关键要求：

- JSONL 必须严格按 `\n` 切分
- commands 可带 `id` 关联 response
- events 无 `id`
- extension UI protocol 需映射到桌面弹窗/通知

## 核心功能规划

### 已实现基础能力

- [x] Tauri + React + Tailwind 基础壳
- [x] AppShell 三栏布局
- [x] workspace folder tree + session 切换
- [x] 中央消息流和底部输入框
- [x] pi prompt / abort / get_state / get_messages
- [x] 工具调用列表：read/write/edit/bash/grep/find/ls
- [x] 文件树和代码预览
- [x] 模型选择、provider 分组搜索、thinking level
- [x] session tree / fork / clone / label 基础版
- [x] compaction/retry/steering/follow-up runtime 设置
- [x] extension UI request 基础映射与 response dialog 基础闭环
- [x] 权限确认和危险操作可视化

### 后续重点

- [ ] extension UI response 真实 extension 手工验证
- [ ] session tree active cursor 精准化
- [ ] SettingsManager 持久化设置
- [ ] auth/API key 真实状态探测
- [ ] SDK sidecar 评估
- [ ] 会话搜索与索引缓存

## 页面结构建议

```txt
src/
├── app/
│   ├── App.tsx
│   ├── router.tsx
│   └── pages/
│       ├── Home.tsx
│       ├── Session.tsx
│       ├── Library.tsx
│       └── Settings.tsx
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
    ├── style/
    └── index.ts
```

## pi 相关能力映射

| pi 能力 | 桌面 UI 映射 |
|---|---|
| `prompt` | 主输入框发送 |
| `steer` | 运行中插队指令 |
| `follow_up` | 完成后继续任务 |
| `abort` | 停止按钮 |
| `message_update` | 流式消息 |
| `tool_execution_*` | 工具调用行和详情 |
| `queue_update` | 待处理队列提示 |
| `compact` | 上下文压缩提示 |
| `switch_session` | 会话切换 |
| `fork` / `clone` | 会话分支操作 |
| `get_available_models` | 模型选择器 |
| `extension_ui_request` | Dialog / Toast / Status / Widget |
| `extension_ui_response` | confirm/select/input/editor 回写 |

## 开发原则

- pi 是核心，不伪装成 Claude Desktop
- 工具执行必须透明可见
- 危险操作必须可确认、可中止
- 会话树、fork、clone 是一级能力
- WorkAny 只作为视觉和工程风格参考
- UI 保持克制、稳定、生产力工具感

## 相关文档

- [`design.md`](./design.md)：设计风格与 pi 关键信息
- [`agent.md`](./agent.md)：给 coding agent 的开发约束
- [`plan.md`](./plan.md)：开发计划
- [`docs/sdk-sidecar-adr.md`](./docs/sdk-sidecar-adr.md)：SDK sidecar ADR 草案

## 开发约定

- 修改代码后默认不自动运行 build/lint/cargo check/git。
- 需要验证时由用户明确要求，再运行：`pnpm build`、`pnpm lint`、`pnpm pi:rpc:smoke`、`cd src-tauri && cargo check`。
- session JSONL、fork/clone、extension UI response 属于核心能力，改动时必须同步 `plan.md`。
