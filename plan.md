# 开发计划

本文记录 `pi-tauri` 后续开发计划。目标是构建一个基于 pi 的桌面 AI 编程 Agent 应用，参考 WorkAny 的页面风格和技术栈，但产品核心围绕 pi。

## 阶段 0：项目初始化

目标：搭建可运行基础工程。

任务：

- [x] 初始化 Tauri 2 + React + TypeScript + Vite 项目
- [x] 接入 Tailwind CSS 4
- [x] 配置路径别名 `@/*`
- [x] 添加 ESLint / Prettier
- [x] 添加基础目录结构
- [x] 添加基础主题 token
- [x] 添加 shadcn/ui 基础配置
- [x] 添加 Radix UI 基础依赖
- [x] 添加 lucide-react

建议目录：

```txt
src/
├── app/
├── components/
├── shared/
└── config/
src-tauri/
src-sidecar/ 或 src-api/
```

验收标准：

- [x] `pnpm build` 前端构建通过
- [x] `cargo check` Tauri Rust 编译检查通过
- [ ] `pnpm tauri dev` 可启动桌面窗口
- [x] 首页显示基础 AppShell

---

## 阶段 1：视觉基础与布局

目标：实现克制生产力风格桌面壳，布局参考 WorkAny，视觉跟随 pi.dev 纸感网格背景与按钮风格。

任务：

- [x] 建立 shadcn/ui 兼容 CSS variables：background、foreground、card、popover、sidebar、primary、secondary、accent、border、input、muted
- [x] 支持 light / dark token（暂未做切换 UI）
- [x] 实现 `AppShell`
- [x] 实现 `LeftSidebar`
- [x] 实现 `RightInspector`
- [x] 实现中央空状态首页
- [x] 实现大输入框 `ChatInput`
- [x] 实现基础按钮组件
- [x] 实现 Dialog、Dropdown、Tooltip 业务封装

页面结构：

```txt
LeftSidebar + MainArea + RightInspector
```

验收标准：

- [x] 页面布局稳定
- [x] 侧栏可折叠
- [x] 右侧检查器可隐藏/显示
- [x] 视觉接近 pi.dev 配色体系：`#ECE7E4` 纸感背景、细网格、低饱和蓝灰主色、细边框、轻阴影

---

## 阶段 2：pi 集成 PoC

目标：打通最小 pi 调用链路。

优先方案：Node sidecar + pi SDK。

备选方案：Tauri/Rust 或 Node sidecar spawn `pi --mode rpc`。

任务：

- [x] 选定 PoC 集成路线：Tauri/Rust spawn `pi --mode rpc`（长期 SDK sidecar 仍可后续评估）
- [x] 实现 pi client 接口抽象
- [x] 支持发送 prompt（mock + Tauri RPC client）
- [x] 支持 abort（mock + Tauri RPC client）
- [x] 支持获取 state（mock + RPC smoke + Tauri RPC client）
- [x] 支持获取 messages（mock + Tauri RPC client）
- [x] 订阅/接收事件流（mock + Tauri RPC client）
- [x] 将 `message_update` 映射到 UI（mock + Tauri RPC client）
- [x] 将 `agent_start/end` 映射到运行状态（mock + Tauri RPC client）

建议抽象：

```ts
interface PiClient {
  connect(): Promise<void>;
  prompt(message: string, options?: PromptOptions): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<PiState>;
  getMessages(): Promise<PiMessage[]>;
  subscribe(listener: (event: PiEvent) => void): () => void;
}
```

验收标准：

- [x] 用户在输入框输入 prompt 后，mock pi client 返回流式文本
- [x] UI 显示运行状态
- [x] 停止按钮可 abort 当前任务
- [x] `pi --mode rpc --no-session --offline` 的 `get_state` smoke test 通过
- [x] 真实 pi RPC prompt 流接入 UI（Tauri 环境使用 `TauriPiRpcClient`）
- [ ] 在桌面窗口中手工验证真实模型 prompt（需要有效模型/auth）

---

## 阶段 3：工具调用可视化

目标：把 pi 工具执行做成一级 UI。

任务：

- [x] 处理 `tool_execution_start`（mock event stream）
- [x] 处理 `tool_execution_update`（mock event stream）
- [x] 处理 `tool_execution_end`（mock event stream）
- [x] 实现 `ToolCallItem`（demo + RPC event 数据版）
- [x] 实现 `ToolResultPanel`
- [x] 实现 bash 输出展示（通用 output 面板）
- [x] 实现 read/write/edit 文件展示（通用 output 面板）
- [x] 实现 grep/find/ls 结果展示（通用 output 面板）
- [x] 支持工具行折叠/展开
- [x] 点击工具行在右侧检查器显示详情

工具行样式：

```txt
✓ bash  pnpm test                 2.3s
✓ read  src/app.tsx               120 lines
✕ edit  src/config.ts             oldText not found
```

验收标准：

- 每个 tool call 都可见
- 成功/失败/运行中状态明确
- 输出可展开
- 长输出有截断提示和完整路径

---

## 阶段 4：会话管理

目标：支持 pi 原生 session 能力。

任务：

- [ ] 列出当前项目 sessions
- [x] 新建 session（`PiClient.newSession` + RPC `new_session` + UI 按钮）
- [ ] 切换 session
- [ ] 继续最近 session
- [ ] 设置 session name
- [ ] 删除 session（确认）
- [x] 显示 session stats（`get_session_stats` + Inspector State）
- [x] 显示 session file path（State 区块）
- [ ] 支持 export html

SDK 重点：

- `SessionManager.create()`
- `SessionManager.continueRecent()`
- `SessionManager.open()`
- `SessionManager.list()`
- `createAgentSessionRuntime()`

RPC 重点：

- `new_session`
- `switch_session`
- `get_state`
- `get_session_stats`
- `export_html`
- `set_session_name`

验收标准：

- [ ] 左侧可切换历史会话
- [x] 新建 session 后主区域清空/刷新 messages
- [ ] 切换后主区域更新消息
- [x] session replacement 后事件订阅仍由统一 client/hook 保持

---

## 阶段 5：会话树、fork、clone

目标：体现 pi 区别于普通聊天应用的核心能力。

任务：

- [ ] 解析 session JSONL tree
- [ ] 实现 `SessionTree`
- [ ] 支持 branch path 展示
- [ ] 支持 fork 指定 user message
- [ ] 支持 clone 当前分支
- [ ] 支持 label/bookmark
- [ ] 支持 branch summary 展示

RPC 重点：

- `get_fork_messages`
- `fork`
- `clone`

SDK 重点：

- `runtime.fork(entryId)`
- `session.navigateTree()`
- `SessionManager.getTree()`
- `SessionManager.getBranch()`

验收标准：

- 用户可以看到会话树
- 可以从历史节点 fork
- 可以 clone 当前分支
- fork/clone 后 UI 正常进入新 session

---

## 阶段 6：模型与设置

目标：实现 pi 配置管理 UI。

任务：

- [x] 模型选择器 UI 骨架（demo 数据版）
- [x] 模型列表（mock + RPC `get_available_models`，失败 graceful fallback）
- [x] 模型切换（Dropdown 列表 + RPC `set_model`）
- [ ] 模型搜索/provider 分组
- [x] thinking level 切换（Settings dialog + RPC `set_thinking_level`）
- [x] 默认 provider/model 配置（PiClient settings 抽象，mock 可交互，RPC 同步当前 state）
- [ ] API key / auth 状态展示
- [ ] sessionDir 配置
- [ ] compaction 配置
- [ ] retry 配置
- [ ] steering/followUp mode 配置
- [x] extensions/skills/prompts 配置入口（右侧 Inspector 命令/扩展面板；themes 待后续）

RPC 重点：

- `get_available_models`
- `set_model`
- `cycle_model`
- `set_thinking_level`
- `cycle_thinking_level`
- `set_auto_compaction`
- `set_auto_retry`

SDK 重点：

- `ModelRegistry`
- `AuthStorage`
- `SettingsManager`

验收标准：

- [x] 用户能切换模型（mock 完整；RPC 使用 `set_model`）
- [x] 用户能切换 thinking level（mock 完整；RPC 使用 `set_thinking_level`）
- [x] 设置持久化或同步到 pi settings（当前为运行时同步；长期持久化待 SDK/SettingsManager）

---

## 阶段 7：extension UI 与命令系统

目标：支持 pi extension 生态。

任务：

- [x] 支持 extension notify（RPC event 映射为 UI messages，Inspector 可见）
- [ ] 支持 extension confirm dialog（协议已识别，response 回写待实现）
- [ ] 支持 extension select dialog（协议已识别，response 回写待实现）
- [ ] 支持 extension input dialog（协议已识别，response 回写待实现）
- [ ] 支持 extension editor dialog（协议已识别，response 回写待实现）
- [x] 支持 setStatus 显示（作为 extension UI message/status 记录）
- [x] 支持 setWidget 显示（Inspector Extension UI 面板）
- [x] 支持 setTitle（作为 extension UI message 记录）
- [x] 支持 set_editor_text（预填 ChatInput）
- [x] 命令面板显示 extension commands / prompts / skills（`get_commands` + mock fallback）
- [x] 命令执行危险确认（dangerous command confirm dialog）
- [x] `extension_error` 可见（Inspector banner + errors 列表）

RPC 重点：

- `extension_ui_request`
- `extension_ui_response`
- `get_commands`

验收标准：

- [ ] extension 需要用户确认时，桌面 app 能弹窗响应并回写 `extension_ui_response`
- [x] extension notify 能显示在 Inspector UI messages
- [x] commands 可通过命令面板执行

---

## 阶段 8：文件树与预览

目标：提供右侧工作区能力。

任务：

- [ ] 显示 cwd
- [ ] 文件树
- [ ] 打开文件预览
- [ ] Markdown 预览
- [ ] 代码高亮
- [ ] 图片预览
- [ ] HTML 预览
- [ ] diff 展示
- [ ] 从 tool call 跳转文件

验收标准：

- 右侧检查器能作为工作目录/产物浏览器
- 工具调用产生/读取的文件能快速查看

---

## 阶段 9：安全与权限

目标：桌面端安全默认。

任务：

- [ ] bash 危险命令确认
- [ ] 写入敏感路径确认
- [ ] 删除会话确认
- [ ] 删除文件确认
- [ ] 权限设置页
- [ ] 可配置安全策略
- [ ] 显示当前 cwd 和即将执行命令

可用方式：

- SDK extension 拦截 `tool_call`
- RPC extension UI confirm
- 自定义 pi extension 包

验收标准：

- 危险命令不会静默执行
- 用户能明确允许或拒绝

---

## 阶段 10：打包与发布

目标：跨平台桌面可用。

任务：

- [ ] Tauri 打包配置
- [ ] sidecar 打包
- [ ] macOS build
- [ ] Windows build
- [ ] Linux build
- [ ] 自动更新策略调研
- [ ] 版本号和 changelog
- [ ] 图标与应用元信息

验收标准：

- 三平台至少一个可安装包可运行
- pi sidecar/SDK/RPC 能在打包环境中正常工作

---

## 技术风险

### Node sidecar 打包

Tauri 默认不内置 Node。若使用 pi SDK，需要规划 Node sidecar 或打包为独立二进制。

处理方向：

- Node sidecar + pkg/esbuild
- 或使用 RPC 模式调用全局 pi
- 或调研嵌入 Node runtime

### session replacement

切换/new/fork/clone 后，旧 session 失效。

处理方向：

- 中央 PiClient 管 runtime
- replacement 后统一重订阅
- UI store 清理旧状态

### extension UI

RPC/SDK 下 extension UI 与桌面 UI 需要桥接。

处理方向：

- 统一 `ExtensionUiRequest` store
- Dialog resolve 后回写 SDK/RPC

### 工具输出大文本

长输出会影响性能。

处理方向：

- 虚拟列表
- 默认折叠
- 截断展示
- 完整输出按需读取

## 当前进度记录

### 2026-05-12

已完成：

- 初始化 Tauri 2 + React + TypeScript + Vite 项目
- 接入 Tailwind CSS 4、Radix 依赖、lucide-react
- 配置 `@/*` 路径别名
- 添加 ESLint / Prettier
- 建立 `src/app`、`src/components`、`src/shared`、`src/config` 目录
- 建立 pi.dev 式 `#ECE7E4` 纸感网格 CSS token 和 light/dark token
- 新增 `components.json`，接入 shadcn/ui 组件生成约定
- `Button` 调整为 shadcn/ui + CVA + Radix Slot 风格，保留现有 `primary/secondary/ghost/danger` 兼容 variant
- 实现基础 `AppShell`、`LeftSidebar`、`MainArea`、`RightInspector`
- 实现 demo 版 `ChatInput`、`MessageList`、`ToolCallItem`、`ModelSelector`
- 更新 Tauri app 名称、窗口尺寸、Rust command 占位
- `pnpm build` 通过
- `pnpm lint` 通过
- `cargo check` 通过（修正 Rust lib crate 名称引用）
- 完成侧栏折叠、右侧检查器开关
- 添加 Dialog、Dropdown、Tooltip UI 封装
- 实现 `PiClient` 接口抽象和 `MockPiClient`
- 输入框接入 `usePiSession`，支持 prompt / abort / streaming text
- UI 已映射 mock `agent_start`、`message_update`、`tool_execution_*`、`agent_end`
- 添加 `scripts/pi-rpc-smoke.mjs`，验证 `pi --mode rpc --no-session --offline` JSONL `get_state`
- 添加 `pnpm pi:rpc:smoke` 脚本
- 添加 Tauri Rust RPC bridge：`pi_rpc_start`、`pi_rpc_send`、`pi_rpc_stop`
- Rust bridge spawn `pi --mode rpc --no-session --offline`，读取 stdout JSONL 并 emit `pi-rpc-message`
- 添加 `TauriPiRpcClient`，支持 request/response correlation 和 event mapping
- 添加 `createPiClient()`，Tauri 环境自动使用真实 RPC，浏览器环境回退 mock
- 实现 `ToolResultPanel`，工具行支持展开/折叠查看 output
- `ToolCallItem` 支持 demo/RPC tool event 通用展示
- 实现 selected tool 状态上提：`AppShell` 管理选中工具
- 点击工具行自动打开右侧 Inspector，并在 Selected tool 区块显示详情
- 开始阶段 4：新增 `PiClient.newSession()`
- Mock client 支持清空 messages/state
- Tauri RPC client 支持发送 `new_session`
- `usePiSession` 增加 `refresh()` 和 `newSession()`
- `AppShell` 上提 pi session 状态，LeftSidebar 的 New session 按钮已接入
- 新增 `PiSessionStats` 类型和 `PiClient.getSessionStats()`
- Mock/RPC client 支持 `get_session_stats`
- `usePiSession.refresh()` 同步 messages/state/stats
- RightInspector State 区块改为真实 state/stats，显示 tokens/cost/messages/tools/context/sessionFile
- 阶段 6：新增 `PiModel` / `PiSettings` / `PiSettingsUpdate` / `PiThinkingLevel` 类型
- `PiClient` 新增 `listModels()`、`getSettings()`、`updateSettings()`
- Mock client 返回 demo models/settings，并支持 model/thinking 交互更新
- Tauri RPC client 接入 `get_available_models`、`set_model`、`set_thinking_level`，失败时回退当前 state
- `usePiSession.refresh()` 同步 models/settings
- `ModelSelector` 改为真实模型下拉列表，不再硬编码单模型
- 新增 `SettingsDialog`，展示 cwd/model/thinking/clientMode/sessionFile，并允许切换模型/thinking
- LeftSidebar 设置按钮接入 Settings dialog；RightInspector 显示 client/model
- 阶段 7：新增 `PiCommand`、`PiExtensionPanel`、`PiExtensionMessage`、`PiExtensionError` 类型
- `PiClient` 新增 `listCommands()`、`executeCommand()`、`listExtensionPanels()`、`listExtensionMessages()`、`listExtensionErrors()`
- Mock client 提供 demo slash commands、extension widgets/messages/errors，并支持 mock command execution
- Tauri RPC client 接入 `get_commands`，支持 extension_error 和 extension_ui_request 映射；缺失时 graceful fallback 到内置命令
- 新增 `CommandPalette`，ChatInput 输入 `/` 显示 commands，Tab 填入，Enter 执行
- ChatInput 对 dangerous command 弹确认 Dialog，避免静默执行 delete/reset/shell/batch 类命令
- 新增 `ExtensionsPanel`，RightInspector 显示 commands、extension panels、UI messages、extension errors
- `set_editor_text` 可预填 ChatInput；`extension_error` 在 Inspector 顶部可见
- Diff cleanup：检查阶段 6/7 worker 改动，未发现编译级冲突；移除 RightInspector 对 demoTools 的固定依赖，Active tools 改为从真实 messages 派生
- Diff cleanup：修复 mock prompt 持久化，agent_end refresh 后保留 assistant 内容和工具结果
- Diff cleanup：更新 MessageList 过期 mock-only 文案为 Tauri RPC + mock fallback
- `pnpm build` / `pnpm lint` / `pnpm pi:rpc:smoke` / `cargo check` 再次通过

## 当前下一步

建议立即执行：

1. 运行/验证 `pnpm tauri dev`，手工检查真实 RPC 模型切换和 thinking level
2. 增强模型搜索、provider 分组、不可用模型提示
3. 接入 auth/API key 状态展示
4. 接入 auto compaction / auto retry / steering / followUp 设置
5. 评估长期 SDK sidecar + `SettingsManager` 持久化路线
