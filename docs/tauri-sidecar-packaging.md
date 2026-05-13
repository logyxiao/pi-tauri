# Tauri SDK Sidecar 打包方案

## 当前状态

开发环境使用 Rust bridge 启动系统 Node：

```txt
node src-sidecar/pi-sdk-sidecar.mjs
```

可通过环境变量覆盖：

- `PI_SDK_SIDECAR_BIN`
- `PI_SDK_SIDECAR_SCRIPT`

此方案便于开发，但不适合生产包：依赖用户机器有 Node、源码路径存在、SDK 可解析。

## 候选方案

### 方案 A：外部 Node + JS 脚本

- 优点：实现最少；当前已有。
- 缺点：生产不可控；Node/依赖/路径易缺失。
- 适用：开发、内部验证。

### 方案 B：Tauri sidecar binary

- 用 `pkg`/`nexe`/Node SEA 将 `src-sidecar/pi-sdk-sidecar.mjs` 打成平台 binary。
- 在 `tauri.conf.json` 中配置 externalBin。
- Rust 使用 Tauri sidecar API 或解析 resource path 启动。
- 优点：生产可控；无需用户 Node。
- 缺点：打包复杂；SDK 动态 import 和 native deps 需处理；签名/平台矩阵增加。

### 方案 C：Node runtime bundle + JS resource

- 随 app 携带 Node runtime 与 sidecar JS/resources。
- Rust 启动 bundled node。
- 优点：保留 JS 灵活性。
- 缺点：体积大；签名和路径复杂。

### 方案 D：Rust 内直接实现所需能力

- 继续解析 JSONL/settings/auth 文件。
- 优点：无 Node sidecar。
- 缺点：偏离 pi SDK 官方能力；active cursor/label/settings API 难保证一致。

## 推荐

短期：保留方案 A，完成 SDK API 校准与功能验证。

中期：采用方案 B，生成 Tauri sidecar binary：

```txt
src-sidecar/pi-sdk-sidecar.mjs -> platform sidecar binary -> Tauri externalBin
```

保留 env override，方便开发/调试。

## 生产打包待办

1. 选择打包器：Node SEA / pkg / nexe。
2. 确认 `@earendil-works/pi-coding-agent` 动态 import 可被打包。
3. 配置平台 binary 名称：
   - Windows: `pi-sdk-sidecar-x86_64-pc-windows-msvc.exe`
   - macOS: `pi-sdk-sidecar-x86_64-apple-darwin` / arm64
   - Linux: `pi-sdk-sidecar-x86_64-unknown-linux-gnu`
4. 更新 `src-tauri/tauri.conf.json` externalBin。
5. Rust bridge 优先启动 bundled sidecar，失败 fallback env/system node。
6. 加入签名/notarization 流程。
7. smoke：packaged app 中 `ping` 成功。

## 验收标准

- dev 环境可继续用系统 Node。
- packaged app 无需用户安装 Node。
- SDK sidecar `ping`、`sdk_session_tree`、`sdk_set_label`、`sdk_get_settings` 可用。
- sidecar 启动失败时主 RPC 流程不受影响。
