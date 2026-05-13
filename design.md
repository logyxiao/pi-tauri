# 设计总结与后续开发要点

> 当前仓库 `C:/Users/to/logyxiao/pi-tauri` 暂未包含源码文件，因此没有可直接审阅的既有页面实现。本文以目标方向为准：参考 WorkAny 的视觉与技术栈，结合 pi 的 SDK/RPC/会话体系，构建一个 **pi 桌面应用**，不是 Claude Desktop 克隆。

## 1. 设计风格总结

### 1.1 产品定位

目标应用应定位为：

- 桌面端 AI 编程 Agent 工作台
- 以 pi 为 Agent 核心，而非 Claude Desktop
- 面向代码项目、会话树、工具执行、模型切换、上下文管理
- 视觉参考 WorkAny 的克制布局，但配色跟随 pi.dev：`#ECE7E4` 纸感背景 + 细网格 + 低饱和蓝灰主色，生产力工具感

核心体验：

```txt
自然语言输入 → pi Agent 执行 → 实时流式输出 → 工具调用可视化 → 文件/代码/结果预览 → 会话管理/分支/模型切换
```

---

## 2. 视觉风格

### 2.1 总体气质

建议风格：

- 极简桌面应用
- 低饱和浅色为默认
- 深色模式完整支持
- 大圆角、轻阴影、细边框
- 代码工具气质强于聊天软件气质
- 类似 pi.dev / Linear / Notion / VS Code sidebar 混合风格，保留 pi.dev 的 terminal/card 边框感

避免方向：

- 不做 Claude Desktop 风格的纯聊天壳
- 不做强拟物或复杂装饰
- 不做营销站式渐变和大面积插画

### 2.2 色彩

推荐色彩系统：

- 背景：pi.dev 纸感暖灰 `#ECE7E4`
- 背景修饰：16px 小网格 + 80px 大网格，低透明线条
- 侧边栏：半透明暖灰面板
- 主色：pi.dev 式低饱和蓝灰，不使用橙色或琥珀色作为品牌主色
- 辅助强调：左侧 inset 竖线、细边框、monospace uppercase 按钮
- 状态色：绿色成功、黄绿色警告、红色错误、蓝色信息
- 暗色：黑灰偏蓝背景、低亮度网格、柔和蓝灰高亮

建议 CSS Token：

```css
--background: #ECE7E4;
--foreground: oklch(0.23 0.025 260);
--sidebar: oklch(0.94 0.006 250 / 0.82);
--primary: oklch(0.48 0.075 255);
--primary-foreground: oklch(0.98 0.004 250);
--accent: oklch(0.89 0.022 252 / 0.8);
--border: oklch(0.76 0.015 250 / 0.72);
--muted: oklch(0.91 0.008 250 / 0.75);
--muted-foreground: oklch(0.49 0.04 255);
--radius: 0.4rem;
```

### 2.3 字体

推荐：

- UI 字体：Inter / Geist / system-ui
- 代码字体：JetBrains Mono / Geist Mono
- 首页标题可用 serif，增加 WorkAny 式优雅感

pi 是 coding agent，代码和工具输出很多，必须保证 monospace 展示清晰。

### 2.4 圆角与阴影

风格建议：

- 主面板：`rounded-2xl`
- 输入框：`rounded-xl` 或 `rounded-2xl`
- 按钮：`rounded-lg` / `rounded-full`
- 阴影：轻阴影，不做重浮层

示例：

```css
box-shadow:
  0px 1px 4px 0px rgb(0 0 0 / 0.05),
  0px 1px 2px -1px rgb(0 0 0 / 0.05);
```

---

## 3. 布局方式

### 3.1 总体布局

推荐三栏布局：

```txt
┌──────────────────────────────────────────────────────────────┐
│ Left Sidebar │              Main Chat/Run Area               │
│              │                          │ Right Inspector    │
│ Sessions     │ Messages / Tool Stream   │ Files / Tools      │
│ Projects     │ Input                     │ Session / Preview  │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 左侧栏

用途：

- 当前工作目录 / 项目
- 会话列表
- 会话搜索
- 新建会话
- 恢复会话
- 分支/树入口
- 设置入口

视觉：

- 窄宽切换：折叠 56px，展开 280px 左右
- 浅灰背景
- 顶部 Logo + 应用名：`Pi Desktop` 或产品名
- 当前会话高亮
- 支持收藏 / 删除 / 重命名

### 3.3 主区域

首页空状态：

- 中央大标题
- 大输入框
- 快捷操作按钮
- 最近会话 / 最近项目

任务页：

- 用户消息
- assistant 流式文本
- thinking 区块，可折叠
- tool call 行
- tool result 展开面板
- 底部输入框

主区域应强化 pi 特征：

- 工具名使用 pi 内置工具名：`read`、`write`、`edit`、`bash`、`grep`、`find`、`ls`
- 支持 pi 的 steering / follow-up 队列
- 支持 abort
- 支持 compaction 状态
- 支持 session tree / branch

### 3.4 右侧栏

用途：

- 工具调用详情
- 文件树 / 工作目录
- 当前会话信息
- 模型与 token/cost
- 分支树
- 扩展 UI 请求
- 产物预览，如 HTML、Markdown、图片、代码文件

右栏默认可折叠。执行工具、打开文件、点击 tool call 时自动展开。

---

## 4. 组件使用

### 4.1 技术组件建议

参考 WorkAny 技术栈：

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Tauri 2
- shadcn/ui（Radix UI primitives）
- lucide-react
- react-markdown + remark-gfm
- react-syntax-highlighter 或 shiki
- clsx / tailwind-merge
- class-variance-authority

### 4.2 核心业务组件

建议组件拆分：

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
│   │   ├── LeftSidebar.tsx
│   │   ├── RightInspector.tsx
│   │   └── AppShell.tsx
│   ├── chat/
│   │   ├── ChatInput.tsx
│   │   ├── MessageList.tsx
│   │   ├── AssistantMessage.tsx
│   │   ├── UserMessage.tsx
│   │   └── ThinkingBlock.tsx
│   ├── tools/
│   │   ├── ToolCallItem.tsx
│   │   ├── ToolResultPanel.tsx
│   │   ├── BashResult.tsx
│   │   ├── FileReadResult.tsx
│   │   └── DiffResult.tsx
│   ├── sessions/
│   │   ├── SessionList.tsx
│   │   ├── SessionTree.tsx
│   │   └── SessionStats.tsx
│   ├── model/
│   │   ├── ModelSelector.tsx
│   │   └── ThinkingSelector.tsx
│   └── ui/
│       └── shadcn/ui primitives
```

### 4.3 UI 组件风格

- Button：pi.dev 风格，monospace uppercase、小尺寸、细边框、透明底、左侧 inset 强调线
- Dialog：Radix Dialog，设置、确认、模型选择
- Dropdown：模型、会话、工具菜单
- Tooltip：图标按钮说明
- Command Palette：命令、模型、会话搜索
- Tabs：设置页分类
- Sheet/Panel：右侧面板
- Toast：执行状态、错误、extension notify

---

## 5. 交互特点

### 5.1 输入交互

应支持：

- 多行输入
- `@file` 文件引用
- 图片粘贴 / 拖拽
- 文件附件
- Slash command：pi 扩展命令、prompt templates、skills
- Enter 发送
- Shift+Enter 换行
- 运行中可选择：
  - steer：当前轮工具结束后插队
  - follow-up：全部完成后执行

### 5.2 执行交互

pi 事件流应映射成 UI：

- `agent_start`：显示运行状态
- `message_update`：流式追加 assistant 文本/thinking/tool call delta
- `tool_execution_start`：新增工具执行行
- `tool_execution_update`：更新工具输出
- `tool_execution_end`：标记成功/失败
- `queue_update`：显示 pending steering/follow-up
- `compaction_start/end`：显示上下文压缩状态
- `auto_retry_start/end`：显示自动重试
- `extension_ui_request`：弹窗或通知

### 5.3 工具调用展示

建议 tool call 默认折叠，显示：

```txt
✓ bash  pnpm test                 2.3s
✓ read  src/app.tsx               120 lines
✕ edit  src/config.ts             oldText not found
```

展开后显示：

- 参数
- 输出
- 错误
- 文件路径
- diff
- 完整输出路径（如果被截断）

### 5.4 会话交互

必须体现 pi 会话能力：

- 新建会话
- 继续最近会话
- 切换会话
- fork
- clone
- tree navigation
- set session name
- label/bookmark
- HTML export
- token/cost/session stats

这部分是区分 Claude Desktop 壳的关键。

### 5.5 安全交互

桌面 app 不应默认静默执行危险操作。建议：

- bash 危险命令确认
- 写入敏感路径确认
- 删除会话确认
- Native shell 执行权限提示
- 明确展示 cwd
- 设置中允许开启/关闭权限门禁

---

## 6. 技术栈相关信息

### 6.1 推荐应用栈

```txt
Desktop: Tauri 2 + Rust sidecar/capabilities
Frontend: React 19 + TypeScript + Vite
Styling: Tailwind CSS 4 + CSS variables + oklch tokens
UI: shadcn/ui (Radix UI primitives) + lucide-react + custom components
Agent: @earendil-works/pi-coding-agent SDK 或 pi --mode rpc
Storage: pi JSONL sessions + app settings，可叠加 SQLite/IndexedDB 做索引缓存
```

### 6.2 pi 集成方案

有两条路线：

#### 方案 A：Node sidecar + pi SDK（推荐）

桌面前端通过 Tauri 调用本地 Node sidecar。sidecar 使用：

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
- 可直接订阅 `AgentSessionEvent`
- 可自定义 ResourceLoader、tools、extensions、settings
- 更适合长期产品化

注意：

- Tauri 不直接运行 Node SDK，需 sidecar 或内嵌 Node 方案
- Session replacement 后必须重新订阅新 session
- 自定义 cwd + 显式 tools 时必须使用 `create*Tool(cwd)` 工厂

#### 方案 B：启动 `pi --mode rpc`

Tauri/Rust 或 Node sidecar spawn pi 进程，通过 stdin/stdout JSONL 通信。

优点：

- 进程隔离
- 协议清晰
- 非 Node 客户端可用

缺点：

- 类型集成弱于 SDK
- 需处理 JSONL framing
- extension UI 需实现 sub-protocol

RPC 关键点：

- 每行一个 JSON，严格按 `\n` 分割
- 不要用会按 Unicode separator 切行的通用 readline
- 命令带 `id` 可关联 response
- events 无 `id`
- 支持 `prompt`、`steer`、`follow_up`、`abort`、`get_state`、`get_messages`、`set_model`、`compact`、`switch_session`、`fork`、`clone` 等

---

## 7. pi 文档关键信息梳理

### 7.1 pi 基础定位

pi 是 minimal terminal coding harness，可扩展而非大而全。核心模式：

- interactive TUI
- print/json
- RPC
- SDK embedding

默认工具：

- `read`
- `write`
- `edit`
- `bash`

其他内置工具还包括：

- `grep`
- `find`
- `ls`

pi 不内置 MCP、sub-agent、plan mode、permission popup、todo、background bash。理念是通过 extensions/skills/packages 自行扩展。

### 7.2 配置目录

默认目录：

```txt
~/.pi/agent/
```

重要文件：

```txt
~/.pi/agent/settings.json
~/.pi/agent/models.json
~/.pi/agent/auth.json
~/.pi/agent/sessions/
~/.pi/agent/extensions/
~/.pi/agent/skills/
~/.pi/agent/prompts/
~/.pi/agent/themes/
```

项目配置：

```txt
.pi/settings.json
.pi/extensions/
.pi/skills/
.pi/prompts/
.pi/themes/
AGENTS.md
.pi/SYSTEM.md
.pi/APPEND_SYSTEM.md
```

### 7.3 模型与认证

支持：

- Anthropic
- OpenAI
- Azure OpenAI
- DeepSeek
- Gemini
- Vertex
- Bedrock
- Mistral
- Groq
- Cerebras
- OpenRouter
- Vercel AI Gateway
- xAI
- ZAI
- Kimi / MiniMax / MiMo 等

认证来源优先级：

1. runtime override
2. `auth.json`
3. 环境变量
4. models.json fallback resolver

自定义模型配置：`~/.pi/agent/models.json`

支持 API：

- `openai-completions`
- `openai-responses`
- `anthropic-messages`
- `google-generative-ai`

### 7.4 SDK 重点

最小调用：

```ts
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

session.subscribe((event) => {
  // map event to UI
});

await session.prompt('What files are here?');
```

需要切换/恢复/fork 会话时，用 runtime：

```ts
createAgentSessionRuntime(...)
runtime.newSession()
runtime.switchSession(path)
runtime.fork(entryId)
```

重要规则：

- `AgentSession` 管单个会话
- `AgentSessionRuntime` 管会话替换
- session 被替换后，旧订阅失效，需要重新订阅
- extensions 也需要重新 bind

### 7.5 Session 格式

pi sessions 是 JSONL，树结构：

```txt
~/.pi/agent/sessions/--<cwd-path>--/<timestamp>_<uuid>.jsonl
```

核心 entry：

- `session`
- `message`
- `model_change`
- `thinking_level_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `session_info`

消息类型：

- `user`
- `assistant`
- `toolResult`
- `bashExecution`
- `custom`
- `branchSummary`
- `compactionSummary`

UI 应能解析/展示这些结构，特别是 tree/fork/branch。

### 7.6 Extensions 重点

Extensions 是 TypeScript 模块。能力：

- 注册工具：`pi.registerTool()`
- 注册命令：`pi.registerCommand()`
- 监听事件：`pi.on()`
- 修改/拦截 tool call
- 自定义 UI 请求
- 自定义渲染
- 注册 provider
- 自定义 autocomplete、footer、status、widgets

桌面 app 必须支持 extension UI RPC/SDK 映射：

- `select`
- `confirm`
- `input`
- `editor`
- `notify`
- `setStatus`
- `setWidget`
- `setTitle`
- `set_editor_text`

当前设计约定：

- `confirm/select/input/editor` 进入 `ExtensionUiDialog`，阻塞等待用户响应。
- `extension_ui_response` 直接写回 RPC stdin，不走普通 command request correlation。
- pending dialog 同时在 Inspector / Extension UI 面板显示，避免用户只靠弹窗感知阻塞。
- `notify/setStatus/setWidget/setTitle/set_editor_text` 为 fire-and-forget：分别映射为消息、状态、Widget、标题记录、输入框预填。

### 7.7 Settings 重点

全局 + 项目合并：

```txt
~/.pi/agent/settings.json
.pi/settings.json
```

关键设置：

- `defaultProvider`
- `defaultModel`
- `defaultThinkingLevel`
- `hideThinkingBlock`
- `theme`
- `compaction.enabled`
- `retry.enabled`
- `steeringMode`
- `followUpMode`
- `transport`
- `sessionDir`
- `enabledModels`
- `terminal.showImages`
- `images.autoResize`
- `shellPath`
- `shellCommandPrefix`
- `packages`
- `extensions`
- `skills`
- `prompts`
- `themes`

桌面 app 设置页应围绕这些字段组织。

---

## 8. 后续开发建议

### 8.1 已落地基础范围

当前已落地：

1. Tauri + React + Tailwind 基础壳
2. workspace folder tree + session 切换
3. 中央聊天/执行流
4. pi RPC client
5. prompt / abort / get_state / get_messages
6. 工具调用展示
7. 模型选择 + provider 搜索分组
8. 设置页：model/thinking/compaction/retry/delivery/sessionDir/auth status 展示
9. session tree/fork/clone/label 基础版
10. extension UI request/response dialog 基础闭环
11. 文件树与代码预览

### 8.2 下一阶段

1. extension UI response 真实 extension 手工验证
2. session tree active cursor 精准化与过滤
3. SDK sidecar + SettingsManager 评估
4. auth/API key 真实状态探测
5. settings 持久化
5. HTML/Markdown/image artifact preview
6. 权限确认 extension
7. 会话搜索与索引

### 8.3 关键设计原则

- 布局可参考 WorkAny，但品牌主色跟随 pi.dev violet/indigo，交互必须体现 pi 原生能力
- 不是 Claude Desktop：不要只做聊天窗口
- 把 pi 的工具、会话树、扩展、模型、上下文管理做成一级功能
- 保持简洁桌面工具感
- 所有危险执行透明可见、可中止、可确认
