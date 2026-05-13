# ADR: SDK Sidecar for pi Desktop

## 状态

Proposed。当前应用主链路仍使用 `pi --mode rpc`。SDK sidecar 作为下一阶段补强方案，不立即替换 RPC。

已新增最小 stdio sidecar 骨架：`src-sidecar/pi-sdk-sidecar.mjs`。当前脚本提供协议入口与 SDK 动态加载，尚未接入 Tauri 调用链。

已新增 smoke 脚本：`scripts/pi-sdk-sidecar-smoke.mjs`，通过 `ping` 验证 sidecar 能启动并返回 SDK 可用状态。

`SdkSidecarClient` 已加入基础错误分类：`start-failed`、`send-failed`、`timeout`、`method-failed`、`sdk-unavailable`。

前端已新增 `src/shared/pi/sdk-sidecar-client.ts`，封装 Tauri sidecar bridge、request correlation、ping/dispose。`TauriPiRpcClient.getSessionTree()` 与 label 写入已优先尝试 SDK sidecar，失败 fallback Rust JSONL parser / 直写 label。SettingsDialog 已显示 SDK sidecar available/unavailable/version/error 状态，并在可用时尝试 `sdk_auth_status`。`updateSettings()` 已优先尝试 `sdk_update_settings` 写 persisted settings，失败继续执行 RPC runtime settings。

Tauri/Rust 已预留 sidecar bridge commands：

- `pi_sdk_sidecar_start`
- `pi_sdk_sidecar_send`
- `pi_sdk_sidecar_stop`

事件：

- `pi-sdk-sidecar-message`
- `pi-sdk-sidecar-error`
- `pi-sdk-sidecar-stderr`

## 背景

RPC 已满足 prompt、tool events、session switch、fork/clone、extension UI response 等主流程，但部分能力存在边界：

- session tree active cursor 只能从 JSONL leaf 推断，RPC 未暴露真实 cursor。
- label/bookmark 当前直接 append JSONL entry，虽符合格式，但不是正式 API。
- Settings 当前多为 runtime RPC 设置，重启后不保证持久。
- auth/API key 状态无法通过 RPC 精准探测。
- sessionDir/default model/compaction/retry 等更适合 `SettingsManager` 持久化。

pi SDK 文档提供的关键能力：

- `createAgentSessionRuntime()`：管理 new/resume/fork/clone/import 等 session replacement。
- `SessionManager.getLeafEntry()`：读取当前 leaf。
- `SessionManager.getPath()`：读取 root -> current leaf 路径。
- `SessionManager.getTree()`：读取 session tree。
- `SessionManager.appendLabelChange(id, label)` / `getLabel(id)`：正式 label/bookmark API。
- `SettingsManager`：读写全局/项目 settings。
- `AuthStorage` / `ModelRegistry`：auth 与 model 状态基础设施。

## 决策

短期保留 Rust RPC bridge，新增 Node SDK sidecar 作为“能力补强层”。

推荐混合架构：

```txt
React UI
  ├─ Tauri command: pi_rpc_*        -> 继续处理 streaming / prompt / tools / extension UI
  └─ Tauri sidecar / command bridge -> SDK sidecar: session tree / settings / auth / labels

Node SDK sidecar
  ├─ SessionManager
  ├─ SettingsManager
  ├─ AuthStorage
  └─ ModelRegistry
```

不建议一次性迁移所有 Agent runtime 到 SDK。原因：

- 当前 RPC event pipeline 已可用。
- streaming/tool visibility 已接入 UI。
- 一次性切换风险高。

## 首批 Sidecar API

### Session tree

```ts
sdk_session_tree(sessionFile: string): Promise<{
  sessionFile: string;
  parentSession?: string;
  activeLeafId?: string;
  activeLeafSource: "sdk";
  nodes: PiSessionTreeNode[];
}>;
```

实现：

- `const sm = SessionManager.open(sessionFile)`
- `const tree = sm.getTree()`
- `const leaf = sm.getLeafEntry()`
- `const path = sm.getPath()`
- `sm.getLabel(id)` 补 label

替换当前 `jsonl-inferred` cursor。

### Labels

```ts
sdk_set_label(sessionFile: string, entryId: string, label?: string): Promise<void>;
```

实现：

- `SessionManager.open(sessionFile).appendLabelChange(entryId, label)`

替换 Rust 直写 JSONL。

### Settings

```ts
sdk_get_settings(cwd: string): Promise<PiSettings>;
sdk_update_settings(cwd: string, update: PiSettingsUpdate): Promise<PiSettings>;
```

覆盖：

- `defaultProvider`
- `defaultModel`
- `defaultThinkingLevel`
- `sessionDir`
- `compaction.enabled`
- `retry.enabled`
- `steeringMode`
- `followUpMode`

### Auth status

```ts
sdk_auth_status(): Promise<PiAuthStatus[]>;
```

目标：展示 provider configured/missing/expired/unknown。

当前 skeleton：先检查常见 provider 环境变量，再尝试松散探测 SDK `AuthStorage` 的 `get/getAuth/getProvider/getCredentials/getApiKey` 等可能 API；真实 API 仍需 smoke 校准。

## 渐进迁移步骤

1. 新增 `src-sidecar/` Node 工程或 Tauri sidecar package。（已新增最小 `src-sidecar/pi-sdk-sidecar.mjs`）
2. 暴露最小 JSON RPC/stdio 协议。（已完成基础 stdin/stdout JSONL request/response；`pnpm pi:sdk-sidecar:smoke` 可 ping）
3. 先实现 read-only：`sdk_session_tree` + `sdk_get_settings` + `sdk_auth_status`。（已放入 sidecar skeleton，待真实 SDK API 校准）
4. UI 增加 feature detection：SDK sidecar 可用时优先 SDK，否则 fallback Rust JSONL/RPC。（已接入 session tree、label、settings read/update 与 auth status 尝试）
5. 迁移 label 写入到 SDK。
6. 迁移 settings 持久化到 SDK。
7. 评估是否将 session replacement 也迁移到 `createAgentSessionRuntime()`。

## 风险

- Node sidecar 打包、签名、路径解析复杂度上升。
- SDK 与 CLI/RPC 版本需保持一致。
- 同时运行 RPC process 与 SDK sidecar 可能出现 session 文件并发写入风险。
- label/settings 写入需避免在 agent streaming 中并发修改同一 session file。

## 缓解

- 首批 SDK sidecar 以 read-only 为主。
- label/settings 写入只在 agent idle 时允许；running 时提示稍后重试。
- 保留 RPC fallback。
- 在 UI 中展示 `activeLeafSource: sdk | jsonl-inferred`。

## 验收标准

- SDK sidecar 可在桌面环境启动。
- `SessionTreePanel` 显示 `activeLeafSource: sdk`。
- active branch 与 pi `/tree` 一致。
- label/bookmark 使用 SDK 写入，并能被 pi `/tree` 读取。
- Settings 重启后持久。
- auth status 能提前提示缺 key/auth。
