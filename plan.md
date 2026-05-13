# 后续开发计划更新

## 当前已完成概览

### 阶段 0-3：基础工程、布局、pi RPC、工具可视化

- Tauri 2 + React + TypeScript + Vite 基础工程已完成。
- Tailwind CSS 4、Radix UI、lucide-react、基础 UI 封装已接入。
- `PiClient` 抽象、Mock client、Tauri RPC client 已建立。
- Rust bridge 已支持 `pi --mode rpc` 启动、JSONL stdout/stderr 事件转发。
- 中央对话流已支持 prompt、abort、streaming message、tool execution event。
- 工具调用可见：`ToolCallItem`、`ToolResultPanel`、Inspector selected tool 联动。

### 阶段 4：会话管理

- 已支持：
  - session list
  - switch session
  - new session
  - continue recent
  - set session name
  - delete session
  - export html
  - session stats
  - session file path
- LeftSidebar 已改为 workspace folder tree。
- 默认只加载当前 workspace。
- `Open folder` 使用系统目录选择器，用户选择目录后只加载该 workspace sessions。
- session item 已压缩为紧凑样式。
- 已移除 LeftSidebar 无用入口：
  - Pi Desktop 品牌文案
  - New session
  - Recent
  - Name
  - HTML
  - Session tree
  - search placeholder

### 阶段 5：会话树、fork、clone 基础版

- 已新增：
  - `PiSessionTree`
  - `PiSessionTreeNode`
  - `PiForkMessage`
- Tauri command：
  - `pi_session_tree`
  - `pi_set_session_label`
- RPC client：
  - `get_fork_messages`
  - `fork`
  - `clone`
- Inspector 已接入 `SessionTreePanel`。
- 支持 active branch path、branch summary 展示、fork、clone、label/bookmark。
- 当前 active leaf 仍为本地推断，后续需打磨。

### 阶段 6：模型与设置

- 模型列表、模型切换、thinking level 已完成。
- `ModelSelector` 支持搜索和 provider 分组。
- `SettingsDialog` 支持：
  - 模型搜索
  - provider 分组
  - thinking level
  - auto compaction
  - auto retry
  - steering mode
  - follow-up mode
  - auth status 展示
  - sessionDir 展示
- RPC 已接入：
  - `set_model`
  - `set_thinking_level`
  - `set_auto_compaction`
  - `set_auto_retry`
  - `set_steering_mode`
  - `set_follow_up_mode`
- auth probe、SettingsManager 持久化仍待后续。

### 阶段 7：extension UI 与命令系统基础

- 已完成：
  - `extension_error`
  - `extension_ui_request` 映射
  - extension messages/status/widget 展示
  - command palette
  - dangerous command confirm
  - `set_editor_text` 预填输入框
- 未完成：
  - `extension_ui_response` 回写闭环

### 阶段 8-10：已完成项保持

- 阶段 8 文件树与预览已完成。
- 阶段 9 安全与权限基础已完成。
- 阶段 10 体验打磨与验证已完成。
- 后续避免回退这些能力：
  - 文件预览路径限制
  - 危险操作显式确认
  - tool call 透明可见
  - Inspector 状态、安全、扩展、文件面板

---

## 剩余风险

0. 优先加入国际化适配，默认中文，英文。

1. **extension UI response 协议未闭环**
   - confirm/select/input/editor 当前能展示但不能回传用户选择。
   - extension 可能卡住等待 response。

2. **Session tree active cursor 不够准确**
   - 当前 active leaf 由本地解析推断。
   - 若 session JSONL 存在多分支、tree navigation、branch summary，可能与 pi 实际 cursor 不一致。

3. **fork/clone 后 session replacement 事件订阅需重点验证**
   - RPC fork/clone 会替换 session。
   - 前端必须确认消息、state、stats、tree、sessions 全部刷新。
   - 事件订阅不能重复注册或丢失。

4. **label/bookmark 当前直接 append JSONL**
   - 绕过 pi SDK/extension API。
   - 格式虽符合 session-format，但可能与未来 pi 内部实现有差异。
   - 后续优先切换 SDK/SettingsManager 或正式 RPC 能力。

5. **Settings 当前多为运行时设置**
   - auto compaction/retry/steering/follow-up 只通过 RPC 修改 runtime。
   - sessionDir、auth、default model 持久化仍未接入 SettingsManager。
   - 重启后可能恢复默认。

6. **auth status 只是静态/推断展示**
   - RPC 未暴露真实 auth probe。
   - 真实 provider key/token 状态只能通过 prompt 错误间接发现。

7. **真实桌面端手工验证不足**
   - `pnpm tauri dev` 与真实模型 prompt 尚需人工验证。
   - 文件选择器、RPC bridge、fork/clone、extension UI 需真实桌面流程验证。

8. **不要默认运行验证命令**
   - 用户偏好：修改后不自动 build/lint/cargo check。
   - 后续计划中只列验证命令，执行需用户明确要求。

---

## 下一阶段任务清单

## 阶段 7+：extension_ui_response 闭环

目标：让 extension confirm/select/input/editor UI 能展示、交互、回传 response，避免 extension 等待卡死。

### 1. 扩展 extension UI 类型

- Status: 已完成基础类型。
- File: `src/shared/pi/types.ts`
- Changes:
  - 扩展 `PiExtensionMessage`，保留原始 request id。
  - 增加 method payload：
    - `confirm`
    - `select`
    - `input`
    - `editor`
  - 新增 response 类型：
    - `PiExtensionUiResponse`
    - fields: `id`, `method`, `value`, `confirmed`, `cancelled`
- Acceptance:
  - TypeScript 能表达每类 extension UI request。
  - UI 不再只能显示 message 文本。

### 2. 完善 RPC event mapping

- Status: 已完成基础 mapping；`extension_ui_response` 直接写入 RPC stdin（该响应无普通 request/response id），避免误用 request correlation。
- File: `src/shared/pi/tauri-rpc-client.ts`
- Changes:
  - 在 `extension_ui_request` event 中保留 request id / method / params。
  - 新增 `respondExtensionUi(response)`。
  - 通过 RPC 发送：
    - `extension_ui_response`
- Acceptance:
  - confirm/select/input/editor response 能带 request id 回到 pi。
  - RPC response success/failure 可捕获并显示错误。

### 3. Mock client 支持 extension UI response

- Status: 已完成基础 response 记录；已增加 `ui-confirm` / `ui-select` / `ui-input` / `ui-editor` mock commands 用于浏览器侧手测。
- File: `src/shared/pi/mock-client.ts`
- Changes:
  - 增加 mock extension UI pending requests。
  - 实现 `respondExtensionUi()`。
  - 模拟 confirm/select/input/editor 完成状态。
- Acceptance:
  - 浏览器环境可测试 UI 闭环。
  - 不依赖真实 pi extension。

### 4. 新增 Extension UI Dialog

- Status: 已完成；已增加 busy/error 状态，response 失败时 dialog 内显示错误。
- New File: `src/components/extensions/ExtensionUiDialog.tsx`
- Changes:
  - 根据 request method 渲染：
    - confirm: confirm/cancel
    - select: options list
    - input: text input
    - editor: textarea/code-like editor
  - 支持 cancel。
  - submit 后调用 `onRespondExtensionUi()`。
- Acceptance:
  - 每种 method 都能完成一次交互。
  - cancel 可回传 cancelled。

### 5. hook 管理 pending extension UI

- Status: 已完成基础队列；response 失败会向 dialog 抛错并保留 pending request，便于用户重试/取消；Inspector Extension UI 面板显示 pending request 数量与等待项；已修复 pending UI 区块重复 `<div>` 导致 JSX closing tag 错误。
- File: `src/shared/hooks/usePiSession.ts`
- Changes:
  - 增加 `pendingExtensionUi` state。
  - event 到达时入队。
  - response 成功后出队。
  - 暴露 `respondExtensionUi()`。
- Acceptance:
  - 多个 pending request 可顺序处理。
  - response 后不残留过期 dialog。

### 6. AppShell 接入 dialog

- Status: 已完成。
- File: `src/components/layout/AppShell.tsx`
- Changes:
  - 渲染 `ExtensionUiDialog`。
  - 传入 pending request 与 respond handler。
- Acceptance:
  - 真实 extension UI request 能弹出桌面 dialog。
  - 完成后 pi 不再卡住等待。

### 阶段 7+ 验收标准

- extension confirm/select/input/editor 能显示。
- 用户操作能通过 `extension_ui_response` 回写。
- cancel 能回写 cancelled。
- Mock 与 Tauri RPC 路径都可用。
- response 失败时 Inspector 或 error banner 可见。

---

## 阶段 8+：已完成项保持与回归检查

目标：保护文件预览、安全策略、体验打磨，不因后续改动回退。

### 1. 文件预览保持只读与路径限制

- File: `src-tauri/src/lib.rs`
- Check:
  - `pi_list_files`
  - `pi_read_file`
  - `safe_join`
- Acceptance:
  - 绝对路径、`..` escape 仍被拒绝。
  - 大文本仍截断。
  - binary/image 不误读为文本。

### 2. 安全确认保持显式

- Files:
  - `src/components/safety/SafetyConfirmDialog.tsx`
  - `src/shared/pi/safety.ts`
  - `src/components/chat/ChatInput.tsx`
- Acceptance:
  - dangerous command 仍弹确认。
  - blocked/allowed 仍进入 SafetyPanel。
  - 不新增静默危险执行路径。

### 3. tool call 保持透明

- Files:
  - `src/components/tools/ToolCallItem.tsx`
  - `src/components/tools/ToolResultPanel.tsx`
  - `src/components/layout/RightInspector.tsx`
- Acceptance:
  - `tool_execution_*` 仍显示。
  - 点击 tool 仍联动 Inspector。
  - 文件 target 仍联动 preview。

---

## 阶段 11+：会话树 / fork / clone 后续打磨

目标：把阶段 5 基础版提升为可用的 pi session tree 工作流。

### 1. active cursor 准确化

- Status: 已完成 RPC 能力边界标注；精准 cursor 仍待 SDK `SessionManager.getLeafEntry()`。
- Files:
  - `src-tauri/src/lib.rs`
  - `src/shared/pi/tauri-rpc-client.ts`
  - `src/shared/pi/types.ts`
  - `src/components/session/SessionTreePanel.tsx`
- Changes:
  - 调研 pi RPC/SDK 是否暴露 current tree cursor / current branch leaf。
  - 若 RPC 无能力，评估用 SDK sidecar 的 `SessionManager.getTree()` / `getBranch()`。
  - 替换当前“最后 leaf 推断”。
  - 当前实现返回 `activeLeafSource: jsonl-inferred` 与说明文案，UI 显示 cursor 来源，避免误认为精准 cursor。
- Acceptance:
  - 多分支 session 中 active leaf 与 pi 实际一致。

### 2. SessionTreePanel 交互优化

- Status: 已完成基础交互优化。
- File: `src/components/session/SessionTreePanel.tsx`
- Changes:
  - 增加过滤：
    - default
    - no-tools
    - user-only
    - labeled-only
    - all
  - 增加 collapse/expand branch。
  - 标记 current branch path。
  - label 显示更明显。
- Acceptance:
  - 大型 session tree 可读。
  - labeled-only 可用于 bookmark 导航。

### 3. fork 前确认与 prompt preview

- Status: 已完成基础确认。
- File: `src/components/session/SessionTreePanel.tsx`
- Changes:
  - 点击 fork 前展示源 user message preview。
  - 用户确认后执行 fork。
- Acceptance:
  - 避免误 fork。
  - fork 来源明确。

### 4. clone 当前分支状态反馈

- Status: 已完成 UI loading 基础反馈；cancelled 原因沿用 hook error。
- Files:
  - `src/components/session/SessionTreePanel.tsx`
  - `src/shared/hooks/usePiSession.ts`
- Changes:
  - clone 执行中显示 loading。
  - clone cancelled 时显示明确原因。
  - clone success 后刷新 messages/tree/session list。
- Acceptance:
  - clone 后 UI 自动进入新 session。
  - 不需要手动 refresh。

### 5. label/bookmark 改为正式能力

- Status: 已完成能力边界调研与 UI 风险提示；正式迁移待 SDK sidecar。
- Files:
  - `src-tauri/src/lib.rs`
  - `src/shared/pi/tauri-rpc-client.ts`
  - `src/components/session/SessionTreePanel.tsx`
- Changes:
  - 调研 RPC/SDK 是否支持 `setLabel`。
  - RPC docs 暂未暴露 setLabel command；extension API 有 `pi.setLabel(entryId, label)`；SDK `SessionManager` 提供 `appendLabelChange(id, label)` / `getLabel(id)`。
  - 当前 UI 在 `jsonl-inferred` 模式展示 Label mode 提示，说明 labels 仍为直接 append JSONL entry。
  - 若 SDK 支持，迁移 away from direct JSONL append。
- Acceptance:
  - label 写入与 pi 官方行为一致。
  - `/tree` 与桌面 UI 标签一致。

### 6. parent session / fork lineage 展示

- Status: 已完成基础展示。
- Files:
  - `src-tauri/src/lib.rs`
  - `src/components/session/SessionTreePanel.tsx`
  - `src/shared/pi/types.ts`
- Changes:
  - 解析 session entry 的 `parentSession`。
  - 在 UI 显示 fork/clone 来源。
- Acceptance:
  - 用户能看出当前 session 来自哪个 session file。

### 阶段 11+ 验收标准

- 大型多分支 session tree 可阅读、可过滤。
- active branch 显示准确。
- fork/clone 来源清晰。
- fork/clone 后 UI 自动进入新 session。
- label/bookmark 与 pi 官方 tree 行为一致。

---

## SDK / SettingsManager 后续路线

目标：补齐 RPC 不擅长的设置持久化、session tree 精准状态、auth 状态。

### 1. 评估 SDK sidecar 架构

- Status: 已形成 ADR 草案：`docs/sdk-sidecar-adr.md`；已新增最小 stdio sidecar skeleton：`src-sidecar/pi-sdk-sidecar.mjs`；已新增 smoke 脚本：`scripts/pi-sdk-sidecar-smoke.mjs`；Tauri 已预留 sidecar start/send/stop bridge commands；前端 `SdkSidecarClient` 已接入 session tree/label fallback；SettingsDialog 已显示 SDK sidecar 状态并尝试 `sdk_auth_status`。
- Decision: 短期保留 Rust RPC bridge，新增 Node SDK sidecar 作为能力补强层；优先补 session tree cursor、label、settings、auth，不一次性替换 streaming/tool event pipeline。
- New Files:
  - `docs/sdk-sidecar-adr.md`
  - `src-sidecar/pi-sdk-sidecar.mjs`
- Changes:
  - 调研 `@earendil-works/pi-coding-agent` SDK：
    - `createAgentSessionRuntime()`
    - `SessionManager`
    - `SettingsManager`
    - auth storage
  - 设计 Tauri 与 Node sidecar 通信协议。
- Acceptance:
  - 形成 SDK sidecar ADR。
  - 明确继续 RPC 还是混合 SDK/RPC。
  - sidecar skeleton 支持 JSONL stdin/stdout、`ping`、`sdk_session_tree`、`sdk_set_label`、`sdk_get_settings`、`sdk_auth_status` 协议入口。
  - `pnpm pi:sdk-sidecar:smoke` 可验证 sidecar ping（仅在用户明确要求时运行）。
  - Tauri commands `pi_sdk_sidecar_start` / `pi_sdk_sidecar_send` / `pi_sdk_sidecar_stop` 已预留，事件为 `pi-sdk-sidecar-message` / `pi-sdk-sidecar-error` / `pi-sdk-sidecar-stderr`。
  - `src/shared/pi/sdk-sidecar-client.ts` 支持 request correlation；`TauriPiRpcClient.getSessionTree()` 优先 `sdk_session_tree`，失败 fallback `pi_session_tree`；label 优先 `sdk_set_label`，失败 fallback `pi_set_session_label`；settings 显示 sidecar ping 状态并在可用时尝试 `sdk_auth_status`。

### 2. SettingsManager 持久化

- Files:
  - `src/shared/pi/client.ts`
  - `src/shared/pi/tauri-rpc-client.ts`
  - future SDK sidecar files
- Changes:
  - 持久化：
    - defaultProvider
    - defaultModel
    - defaultThinkingLevel
    - sessionDir
    - compaction settings
    - retry settings
    - steering/followUp mode
- Acceptance:
  - 重启应用后设置保持。
  - 项目级 `.pi/settings.json` 与全局 settings 行为明确。

### 3. auth/API key 状态

- Changes:
  - 读取 provider auth 状态。
  - 展示 configured/missing/expired。
  - 提供跳转配置入口。
- Acceptance:
  - 用户能在桌面 UI 看出模型不可用原因。
  - prompt 前可提前发现缺 key/auth。

---

## 真实桌面手工验证计划

目标：验证浏览器 mock 之外的真实桌面能力。

### 手工验证清单

1. 启动桌面
   - Command: `pnpm tauri dev`
   - Check:
     - 窗口正常启动
     - Rust RPC bridge 正常启动
     - `pi-rpc-message` 无异常刷屏

2. Open folder
   - Check:
     - 系统目录选择器打开
     - 选择 folder 后 LeftSidebar 显示 workspace 节点
     - 无 session folder 也显示空状态
     - Windows 路径匹配正常

3. 真实 session switch
   - Check:
     - 点击 session 后 messages/state/stats/tree 刷新
     - Inspector session file 正确

4. 真实 prompt
   - Check:
     - 有效 provider/model 下可发 prompt
     - message_update streaming 正常
     - tool_execution_* 正常
     - abort 正常

5. fork/clone
   - Check:
     - fork user message 成功进入新 session
     - clone 当前分支成功进入新 session
     - fork/clone cancelled 能显示错误或取消状态

6. extension UI
   - Check:
     - confirm/select/input/editor request 能弹窗
     - response 后 extension 继续执行

7. Settings
   - Check:
     - model 切换生效
     - thinking level 生效
     - auto compaction/retry RPC 不报错
     - steering/follow-up mode RPC 不报错

---

## 文档同步计划

### 1. README 更新

- Status: 已部分同步当前能力概览、后续重点、extension UI response 映射与开发约定。
- File: `README.md`
- Add:
  - 当前能力概览
  - 桌面运行方式
  - pi RPC requirement
  - Open folder/session 管理说明
  - extension UI 支持状态
- Acceptance:
  - 新开发者能按 README 启动桌面并理解当前功能范围。

### 2. agent.md 更新

- Status: 已同步当前阶段目标、extension UI response 约定、pending queue、默认不自动验证/git 偏好。
- File: `agent.md`
- Add:
  - 当前 PiClient 能力边界
  - RPC vs future SDK sidecar 决策状态
  - session tree/fork/clone 注意点
- Acceptance:
  - 后续 agent 不会把 pi 当普通 chat API。

### 3. design.md 更新

- Status: 已同步当前落地范围与 extension UI dialog/response 交互规范。
- File: `design.md`
- Add:
  - LeftSidebar workspace tree 设计
  - Inspector SessionTreePanel 设计
  - extension UI dialog 交互规范
- Acceptance:
  - UI 后续调整有设计依据。

### 4. AGENTS.md 更新

- Status: 已同步默认不自动 build/lint/cargo check/git、extension_ui_response 优先项与事件映射。
- File: `AGENTS.md`
- Add:
  - 修改后默认不自动 build/lint/cargo check，除非用户明确要求
  - 危险操作必须确认
  - extension_ui_response 是阶段 7+ 优先项
- Acceptance:
  - 后续 coding agent 行为符合用户偏好。

---

## 验证策略

### 默认策略

- 修改代码后不自动运行验证命令。
- 只在用户明确要求时运行：
  - `pnpm build`
  - `pnpm lint`
  - `pnpm pi:rpc:smoke`
  - `cd src-tauri && cargo check`
  - `git diff --check`

### 建议验证矩阵

1. TypeScript/UI 层改动
   - Suggested:
     - `pnpm build`
     - `pnpm lint`

2. Rust/Tauri command 改动
   - Suggested:
     - `cd src-tauri && cargo check`
     - `pnpm tauri dev` 手工验证

3. RPC protocol 改动
   - Suggested:
     - `pnpm pi:rpc:smoke`
     - 桌面真实 RPC 手工验证

4. Session JSONL 解析/写入改动
   - Suggested:
     - 使用真实 session file 手工验证
     - 备份 session 文件后测试 label/fork/clone

5. extension UI response 改动
   - Suggested:
     - mock extension request
     - 真实 extension confirm/select/input/editor 流程

---

## 推荐下一步执行顺序

1. 阶段 7+：实现 `extension_ui_response` 闭环。（已开始：类型/client/hook/Dialog/RPC response 基础接入；Inspector Extension UI 已显示 pending dialogs）
2. 手工运行 `pnpm tauri dev`，验证真实 RPC 与 Open folder/session switch。
3. 阶段 11+：打磨 SessionTreePanel 和 active cursor。（已开始：filter、collapse/expand、active branch 标记、fork preview confirm、clone/fork loading、parentSession lineage 展示、cursor source 标注、label mode 风险提示）
4. 评估 SDK sidecar + SettingsManager。（ADR 草案已写入 `docs/sdk-sidecar-adr.md`；最小 sidecar skeleton 已写入 `src-sidecar/pi-sdk-sidecar.mjs`；smoke 脚本已写入 `scripts/pi-sdk-sidecar-smoke.mjs`；Tauri bridge commands 已预留；前端 SdkSidecarClient 已接入 session tree/label/status/auth）
5. 同步 README / agent.md / design.md / AGENTS.md。（已同步当前阶段状态、extension UI response 约定、默认不自动验证/git 的开发偏好）
6. 按需执行验证命令，由用户明确触发。