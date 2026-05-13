# 后续开发计划更新

## 当前最新状态

### 已完成主线能力

- 基础工程已完成：Tauri 2 + React 19 + TypeScript + Vite + Tailwind CSS 4 + Radix UI + lucide-react。
- `PiClient` 抽象已建立，浏览器环境使用 mock，Tauri 环境使用真实 `pi --mode rpc`。
- Rust RPC bridge 已支持 `pi_rpc_start` / `pi_rpc_send` / `pi_rpc_stop`，并将 JSONL stdout/stderr 映射为前端事件。
- 对话主流程已支持 prompt、abort、message streaming、tool execution start/update/end。
- 工具执行已透明展示：`ToolCallItem`、`ToolResultPanel`、Inspector selected tool 联动。
- 会话管理已完成基础闭环：list/switch/new/continue/name/delete/export/stats/session file path。
- LeftSidebar 已按 workspace folder tree 展示 session；`Open folder` 使用系统目录选择器；默认不扫描全部项目。
- 会话树基础能力已完成：`SessionTreePanel`、tree nodes、active branch path、branch summary、fork、clone、label/bookmark。
- 模型与设置基础能力已完成：model list/search/provider group、thinking level、auto compaction、auto retry、steering mode、follow-up mode、auth/sessionDir 展示。
- extension UI 基础闭环已完成：`extension_ui_request` pending queue、confirm/select/input/editor dialog、`extension_ui_response` 回写、mock commands、Inspector pending 展示。
- 文件树与预览、安全与权限、体验打磨阶段已完成基础实现。

### SDK sidecar 最新进展

- 已新增 ADR：`docs/sdk-sidecar-adr.md`
  - 决策：短期保留 Rust RPC bridge，新增 Node SDK sidecar 作为能力补强层。
  - 重点补齐：session tree cursor、label/bookmark、settings 持久化、auth 状态。
  - 不一次性替换当前 streaming/tool event pipeline。
- 已新增 SDK sidecar skeleton：`src-sidecar/pi-sdk-sidecar.mjs`
  - stdio JSONL request/response。
  - 动态 import `@earendil-works/pi-coding-agent`。
  - 已预留/实现协议入口：
    - `ping`
    - `sdk_session_tree`
    - `sdk_set_label`
    - `sdk_get_settings`
    - `sdk_update_settings`
    - `sdk_auth_status`
- 已新增 sidecar smoke 脚本：`scripts/pi-sdk-sidecar-smoke.mjs`
  - 启动 `src-sidecar/pi-sdk-sidecar.mjs`。
  - 发送 `ping`。
  - 输出 sidecar version 与 SDK available 状态。
  - 脚本命令：`pnpm pi:sdk-sidecar:smoke`。
  - 注意：仅用户明确要求时运行。
- `package.json` 已新增：
  - `pi:sdk-sidecar`
  - `pi:sdk-sidecar:smoke`
- Tauri/Rust 已预留 sidecar bridge：`src-tauri/src/lib.rs`
  - commands：
    - `pi_sdk_sidecar_start`
    - `pi_sdk_sidecar_send`
    - `pi_sdk_sidecar_stop`
  - events：
    - `pi-sdk-sidecar-message`
    - `pi-sdk-sidecar-error`
    - `pi-sdk-sidecar-stderr`
  - 已抽象 stdout/stderr reader：
    - `spawn_named_stdout_reader`
    - `spawn_named_stderr_reader`
  - sidecar 默认启动：`node` / `node.exe` + `src-sidecar/pi-sdk-sidecar.mjs`
  - 可用环境变量覆盖：
    - `PI_SDK_SIDECAR_BIN`
    - `PI_SDK_SIDECAR_SCRIPT`
- 前端已新增 sidecar client：`src/shared/pi/sdk-sidecar-client.ts`
  - 封装 Tauri command bridge。
  - 监听 sidecar message/error events。
  - 支持 request correlation、timeout、`ping()`、`dispose()`、30s status cache、基础错误分类。
- `TauriPiRpcClient` 已接入 SDK sidecar fallback：`src/shared/pi/tauri-rpc-client.ts`
  - `getSessionTree()`：优先 `sdk_session_tree`，失败 fallback Rust `pi_session_tree` JSONL parser。
  - `setSessionEntryLabel()`：优先 `sdk_set_label`，失败 fallback Rust `pi_set_session_label` 直写 JSONL。
  - `getSettings()`：ping sidecar 并写入 `settings.sdkSidecar`；sidecar 可用时尝试 `sdk_get_settings` / `sdk_auth_status`，失败 fallback RPC runtime / `inferAuthStatus()`。
  - `updateSettings()`：sidecar 可用时先尝试 `sdk_update_settings`，失败显示 persistence warning，并继续 RPC runtime settings。
- `PiSettings` 已增加 sidecar 状态字段：`src/shared/pi/types.ts`
  - `sdkSidecar.available`
  - `sdkSidecar.version`
  - `sdkSidecar.error`
- mock settings 已补充 sidecar unavailable 状态：`src/shared/pi/mock-data.ts`。
- SettingsDialog 已显示 SDK sidecar 状态：`src/components/settings/SettingsDialog.tsx`
  - available/unavailable
  - version
  - error
  - persisted settings key 数量与字段来源
  - persistence warning
- `src-tauri/capabilities/default.json` 已恢复为有效 JSON。

### 已修复问题

- 修复 `src/components/extensions/ExtensionsPanel.tsx` JSX closing tag 错误。
  - 原因：pending UI messages 区块重复嵌套一层 `<div className="space-y-2">`，导致 `</section>` 无对应 closing。
  - 处理：移除重复 `<div>`。
  - 影响：解决 Vite React Babel 报错：`Expected corresponding JSX closing tag for <div>`。

---

## 剩余风险

1. **SDK sidecar API 需校准真实 SDK 导出**
   - `src-sidecar/pi-sdk-sidecar.mjs` 当前按文档预期使用 `SessionManager.open()`、`getEntries()`、`getTree()`、`getPath()`、`getLeafEntry()`、`appendLabelChange()`、`SettingsManager`、`AuthStorage`。
   - 真实 SDK 版本可能 API 名称、构造方式、返回结构不同。
   - 需在用户明确允许验证时运行 smoke/手工命令确认。

2. **SDK sidecar 尚未正式打包为 Tauri sidecar**
   - 当前 Rust bridge 默认调用系统 `node` 和仓库内 `src-sidecar/pi-sdk-sidecar.mjs`。
   - 开发环境可用，生产打包需补 Tauri sidecar/binary/resource 策略。
   - Windows/macOS/Linux 路径、签名、更新都需单独处理。

3. **SDK sidecar 与 RPC process 并发写 session 文件风险**
   - 现在 `sdk_set_label` 与 RPC agent runtime 可能同时操作同一 session file。
   - 建议 running/streaming 时禁用 label 写入，或排队到 idle 后执行。

4. **session tree fallback 语义需明确展示**
   - SDK 成功时 `activeLeafSource: "sdk"`。
   - fallback 时仍为 Rust JSONL inferred。
   - UI 已有 label/cursor 风险提示，但需确认在 SDK 成功后提示不误导。

5. **label/bookmark fallback 仍会直写 JSONL**
   - SDK 不可用或失败时仍 fallback `pi_set_session_label`。
   - 这是可用性兜底，但不是正式能力。
   - 长期应以 SDK `appendLabelChange()` 或 pi 官方 RPC/extension API 为准。

6. **settings 持久化写入仍需真实 SDK 校准**
   - `sdk_get_settings` 只读合并已接入，SettingsDialog 已显示 persisted 来源。
   - `sdk_update_settings` skeleton 已接入，失败会显示 persistence warning 并继续 RPC runtime settings。
   - 真实 `SettingsManager` 写 API 未验证前，重启后保持能力仍不能确认。

7. **auth status 仍需真实 SDK 校准**
   - sidecar `sdk_auth_status` 已检查常见 provider 环境变量，并松散尝试 `AuthStorage` 可能 API。
   - 真实 provider key/token/expired 状态仍需对齐 SDK `AuthStorage` / `ModelRegistry` 具体 API。

8. **extension UI response 需真实桌面验证**
   - mock path 已可用。
   - 真实 extension confirm/select/input/editor、timeout/cancel、错误返回需手工验证。

9. **不要自动运行验证命令或 git 操作**
   - 用户明确偏好：修改后不自动执行 build/lint/cargo check/smoke/git。
   - 计划中只列命令；执行必须等待用户明确要求。

---

## 下一步执行顺序

### 1. 校准 SDK sidecar smoke 与真实 SDK API

- File: `src-sidecar/pi-sdk-sidecar.mjs`
- Actions:
  - 在用户明确要求时运行 `pnpm pi:sdk-sidecar:smoke`。
  - 若 `ping` 失败，检查项目依赖是否安装 `@earendil-works/pi-coding-agent`。
  - 若 `sdk_session_tree` 失败，按真实 SDK API 修正 `SessionManager` 打开方式和方法名。
  - 若 `sdk_set_label` 失败，修正 `appendLabelChange()` 调用签名。
- Acceptance:
  - `ping` 能返回 sidecar version。
  - SDK package available 状态准确。
  - 对真实 session file 调用 `sdk_session_tree` 能返回 `activeLeafSource: "sdk"`。

### 2. 完善 SDK sidecar client feature detection

- Status: 已完成基础版。`SdkSidecarClient` 已增加 30s cached status，`TauriPiRpcClient.getSettings()` 改为使用 `getStatus()`，避免 SettingsDialog 高频 ping/start；已增加 `SdkSidecarError` 错误分类：`start-failed`、`send-failed`、`timeout`、`method-failed`、`sdk-unavailable`。
- File: `src/shared/pi/sdk-sidecar-client.ts`
- Actions:
  - 增加 cached status，避免 SettingsDialog 每次打开都重复启动/ ping。（已完成）
  - 增加 request error 分类：start failed、timeout、SDK unavailable、method failed。（已完成基础分类）
  - 失败时保持 fallback，不影响 RPC 主流程。（已完成基础 fallback）
- Acceptance:
  - sidecar 不可用时 UI 不崩溃。
  - Inspector/Settings 能展示稳定错误信息。

### 3. 让 SessionTreePanel 明确显示 SDK/fallback 状态

- Status: 已完成基础 UI 区分。`SessionTreePanel` 根据 `activeLeafSource === "sdk"` 显示 SDK label mode 与 primary badge；fallback/JSONL inferred 显示 warning badge 与 direct JSONL 风险说明。
- File: `src/components/session/SessionTreePanel.tsx`
- Actions:
  - SDK 成功时显示 `Cursor source: SDK`。（已完成）
  - JSONL fallback 时显示 `Cursor source: JSONL inferred` 和风险说明。（已完成）
  - label mode 提示随 SDK/fallback 切换：SDK 成功时说明使用正式 API；fallback 时说明 direct JSONL append。（已完成）
- Acceptance:
  - 用户能看懂当前 tree/label 数据来源。
  - SDK 成功后不再误报“只能 JSONL inferred”。

### 4. 限制 running 状态下 label 写入

- Status: UI 层已完成。`RightInspector` 将当前 `status` 传入 `SessionTreePanel`；`SessionTreePanel` 在 running 时禁用 label 按钮并拦截 prompt，提示当前 Agent 运行中不可改 label。
- Files:
  - `src/components/layout/RightInspector.tsx`
  - `src/components/session/SessionTreePanel.tsx`
- Actions:
  - 获取当前 `isStreaming` / agent running 状态。（已通过 Inspector status 传入）
  - streaming 时禁用 label edit 或弹提示。（已完成）
  - 防止 SDK sidecar 与 RPC agent 同时写 session file。（UI 层已防护；client/Rust 层强制防护待后续）
- Acceptance:
  - agent running 时不会发起 label write。
  - idle 后 label 可正常写入。

### 5. 接入 `sdk_get_settings` 只读合并

- Status: 已完成基础只读合并。`getSettings()` 在 sidecar 可用时调用 `sdk_get_settings`，读取 persisted model/provider/thinking/sessionDir/autoCompaction/autoRetry/steeringMode/followUpMode；失败 fallback RPC runtime/fallback 默认值。`PiSettings` 已增加 `persistedSettings` 与 `settingsSources`。SettingsDialog 显示 persisted key 数量，并在 model/thinking/sessionDir label 中标注 runtime/persisted/fallback 来源。
- Files:
  - `src/shared/pi/tauri-rpc-client.ts`
  - `src/shared/pi/types.ts`
  - `src/shared/pi/mock-data.ts`
  - `src/components/settings/SettingsDialog.tsx`
  - `src/shared/i18n.tsx`
- Actions:
  - sidecar 可用时调用 `sdk_get_settings`。（已完成）
  - 将 SDK persisted settings 与 RPC runtime state 合并展示。（已完成基础字段合并）
  - 标注字段来源：runtime / persisted / unknown。（已完成 runtime/persisted/fallback 基础标注）
- Acceptance:
  - SettingsDialog 能区分当前 runtime 设置与持久化设置。
  - sidecar 失败时仍显示现有 RPC settings。

### 6. 设计并实现 settings 持久化写入

- Status: 已完成 skeleton 与基础 UI warning。`src-sidecar/pi-sdk-sidecar.mjs` 新增 `sdk_update_settings`，尝试通过 `SettingsManager.updateSettings/update/setSettings/save` 写入 normalized persisted settings；`TauriPiRpcClient.updateSettings()` 在 sidecar 可用时先尝试 `sdk_update_settings`，失败记录 `settingsWarning` 并继续 RPC runtime settings。SettingsDialog 已显示 persistence warning。真实 `SettingsManager` 写 API 仍需 smoke/手工校准。
- Files:
  - `src-sidecar/pi-sdk-sidecar.mjs`
  - `src/shared/pi/tauri-rpc-client.ts`
  - `docs/sdk-sidecar-adr.md`
- Actions:
  - 校准 `SettingsManager` 写 API。（待验证）
  - 新增/修正 `sdk_update_settings`。（已完成 skeleton）
  - `updateSettings()` 先写 SDK persisted settings，再按需写 RPC runtime settings。（已完成）
  - 写失败时显示错误，避免用户误以为已持久化。（已完成基础 SettingsDialog warning）
- Acceptance:
  - default model/thinking/sessionDir/auto retry/auto compaction 等重启后保持。

### 7. 完善 auth status 探测

- Status: 已完成 skeleton。`sdk_auth_status` 先检查常见 provider 环境变量，再尝试松散探测 SDK `AuthStorage` 的 `get/getAuth/getProvider/getCredentials/getApiKey` 等可能 API。`PiAuthStatus` 已支持 `expired` 状态。真实 `AuthStorage` / `ModelRegistry` API 与可操作提示仍需校准。
- Files:
  - `src-sidecar/pi-sdk-sidecar.mjs`
  - `src/shared/pi/types.ts`
  - `src/shared/pi/tauri-rpc-client.ts`
  - `src/components/settings/SettingsDialog.tsx`
- Actions:
  - 对齐 SDK `AuthStorage` / `ModelRegistry` 真实 API。（skeleton 已做松散探测；待真实校准）
  - 返回 provider 级别状态：configured/missing/expired/unknown。（已支持 configured/missing/unknown/expired 类型；expired 真实判定待 SDK API）
  - SettingsDialog 显示可操作提示。（已有 detail 展示；更强操作 CTA 待后续）
- Acceptance:
  - 常用 provider 缺 key 时能提前提示。
  - 不需要等 prompt 失败才知道 auth 问题。

### 8. 真实 extension UI response 手工验证准备

- Status: 已完成文档准备。新增 `docs/extension-ui-validation.md`，覆盖 confirm/select/input/editor、cancel、timeout、response write failure、extension_error，并明确 `extension_ui_response` 直接写 RPC stdin，不进入普通 request correlation。真实桌面验证待用户明确允许运行。
- Files:
  - `docs/extension-ui-validation.md`
  - `src/components/extensions/ExtensionUiDialog.tsx`
  - `src/shared/hooks/usePiSession.ts`
  - `src/shared/pi/tauri-rpc-client.ts`
- Actions:
  - 准备 confirm/select/input/editor 真实 extension 测试步骤。（已完成）
  - 覆盖 cancel、timeout、response write failure。（已完成）
  - 确认 `extension_ui_response` 直接写 RPC stdin，不进入普通 request correlation。（已写入验证计划）
- Acceptance:
  - 真实 pi extension UI 不再卡住等待。
  - response 错误对用户可见，pending request 可重试/取消。

### 9. Tauri sidecar 打包方案

- Status: 已完成方案文档。新增 `docs/tauri-sidecar-packaging.md`，比较外部 Node、Tauri sidecar binary、Node runtime bundle、Rust 直实现；推荐短期保留外部 Node，SDK API 校准后中期采用 Tauri sidecar binary，并保留 env override。
- Files:
  - `docs/tauri-sidecar-packaging.md`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
  - `src-sidecar/pi-sdk-sidecar.mjs`
  - `package.json`
- Actions:
  - 决定 Node sidecar 打包方式：外部 node、内嵌 node、编译 binary、或 Tauri sidecar bundle。（已形成推荐方案：中期 Tauri sidecar binary）
  - 处理生产路径查找、签名、平台差异。（已列待办）
  - 保留开发环境 env override。（已保留）
- Acceptance:
  - dev 和 packaged app 都能启动 SDK sidecar。

### 10. 文档同步

- Status: 已完成本轮同步。`README.md` 增加 extension validation / Tauri sidecar packaging 文档入口；`agent.md`、`AGENTS.md`、`design.md`、`docs/sdk-sidecar-adr.md`、`plan.md` 已同步 RPC + SDK 混合架构、sidecar 状态、验证/打包计划与不自动验证/git 约束。
- Files:
  - `README.md`
  - `agent.md`
  - `AGENTS.md`
  - `design.md`
  - `docs/sdk-sidecar-adr.md`
  - `docs/extension-ui-validation.md`
  - `docs/tauri-sidecar-packaging.md`
  - `plan.md`
- Actions:
  - 同步 SDK sidecar 当前状态。（已完成）
  - 标明 RPC + SDK 混合架构。（已完成）
  - 标明不自动执行验证/git 操作。（已完成）
- Acceptance:
  - 新 agent 读取文档后能理解当前架构与风险。

---

## 验证策略（仅用户明确要求时执行）

- TypeScript/Vite：`pnpm build`
- ESLint：`pnpm lint`
- pi RPC smoke：`pnpm pi:rpc:smoke`
- SDK sidecar smoke：`pnpm pi:sdk-sidecar:smoke`
- Tauri/Rust：`cd src-tauri && cargo check`
- 真实桌面：`pnpm tauri dev`

默认不自动运行上述命令，不自动执行 git status/diff/add/commit。

---

## 推荐立即下一步

当前可编码计划已完成到 skeleton / 文档 / fallback / UI 可见层。剩余工作依赖用户明确允许验证或真实 SDK API 校准：

1. 运行 `pnpm pi:sdk-sidecar:smoke` 校准 sidecar 基础可用性。
2. 按 smoke 结果修正 `src-sidecar/pi-sdk-sidecar.mjs` 中真实 `SessionManager` / `SettingsManager` / `AuthStorage` API。
3. 运行 `pnpm tauri dev` 做真实 extension UI response 手工验证，步骤见 `docs/extension-ui-validation.md`。
4. 决定生产打包器并落地 Tauri sidecar binary，方案见 `docs/tauri-sidecar-packaging.md`。
5. 在用户明确要求时运行 `pnpm build`、`pnpm lint`、`cd src-tauri && cargo check`。
