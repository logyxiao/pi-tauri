# Implementation Plan

## Goal
完善聊天面板消息流、气泡、输入框、交互和视觉，并把消息列表滚动条做成截图中右侧细轨道 + 分段刻度 + 深色胶囊滑块样式。

## Current Extra UX Refactor

用户反馈 Right Inspector 里模块大多无用。已直接重构为上下文型 Inspector，避免常驻 debug dashboard。

### Done

- `src/components/chat/MessageList.tsx`
  - 为 AI 回复接入 `react-markdown` + `remark-gfm`，支持常见 Markdown：标题、列表、引用、链接、代码块、表格。
  - AI 回复移除头像、名称和 header，只保留时间 + 内容卡片本身。
  - 新增右侧用户消息时间轴：仅展示用户发送的信息节点，节点改为更长更圆润的 pill，hover 展示附近最多 7 条用户消息摘要，click 跳转对应用户消息。
  - 时间轴根据滚动位置激活最近用户消息节点，active 节点更高更亮并带轻微 glow。
  - 精简 hover 预览：移除作者、时间、标题和数量，仅展示附近最多 7 条用户消息摘要；每条单行 truncate；扩大 hover 桥接区域避免鼠标移出即消失。
  - 时间轴节点和预览消息项都使用 cursor pointer；矩形节点支持 pointer down 快速跳转。
  - 时间轴跳转从 `scrollIntoView` 改为基于滚动容器 `scrollTo({ behavior: "auto" })` 的确定性快速定位，避免嵌套滚动容器下点击无效。
  - 重写消息列表结构：外层滚动区 + 居中窄内容列 + message stack。
  - 缩小 hero、empty cards、message bubble、meta 字体和间距。
  - user/assistant/system 分流：user 右侧紧凑气泡且移除头像和“你”称呼，保留时间显示；assistant 左侧紧凑内容卡片且移除头像/名称，保留时间显示；system 居中 muted 卡片。
  - 用户消息和 AI 回复气泡下方新增 icon-only 复制按钮，支持 Clipboard API + textarea fallback，复制后短暂切换为 Check icon。
  - RPC message content 映射只提取 `text` / `type === "text"` 内容，忽略 `thinking` 和 `toolCall` block。
  - AI 回复内 `[tool:` 行直接从正文剔除，不再渲染也不再聚合展示。
  - 空 assistant 消息在 map 阶段直接 return null；判断基于剔除 `[tool:` 行后的正文是否为空，不再依赖 `tools` 数组，避免仅有时间和空卡片的渲染。
  - avatar 缩小到 `size-7`，小屏隐藏。
  - tools 区域压缩为更轻的内嵌块，保留透明可点。
- `src/config/style/global.css`
  - 隐藏消息列表 native scrollbar，使用自定义用户消息时间轴替代滚动条。
- `src/components/status/GlobalLoadingOverlay.tsx`
  - 新增全局可复用全屏 loading overlay。
  - 使用 fixed modal 覆盖整界面、`aria-modal`、`cursor-wait`、拦截 pointer/key 事件，加载期间阻止底层操作。
  - 动画采用可复用 `PiLogo` SVG：π 字形、旋转轨道、脉冲节点；加载卡片项目名从 `pi desktop` 改为 `π`。
  - 项目图标替换为 π logo：新增 `public/pi.svg`，`index.html` favicon 指向 `/pi.svg`，覆盖 `public/tauri.svg` 兜底；重新生成 `src-tauri/icons/*` PNG/ICO/ICNS 应用图标。
- `src/components/layout/AppShell.tsx`
  - 程序启动 `isConnecting` 阶段挂载 `GlobalLoadingOverlay`，覆盖读取 session、文件、Git 状态、工具能力等初始化耗时阶段。
  - session 切换 `isSwitchingSession` 阶段也复用全屏 overlay，避免点击 session 后像卡住。
- `src/shared/i18n.tsx`
  - 新增 `loading.globalTitle` / `loading.globalDescription` 中英文文案。
- `src/components/extensions/ExtensionsPanel.tsx`
  - 修复 React duplicate key warning：pending/message/error 列表 key 加类型前缀和 index，避免扩展消息重复 id 导致渲染异常。
- `src/components/layout/LeftSidebar.tsx`
  - 工作区模块所有可点击控件补充 `cursor-pointer`：打开文件夹、设置、折叠/展开、项目折叠、session 切换、删除、collapsed project。
  - 侧边栏支持鼠标横向拖拽调整宽度，范围 220px–420px，折叠模式仍固定 4.5rem。
  - 修复点击当前选中文件夹无法收起的问题：folder open 状态只由 `closedProjects` 控制，不再被 selectedProject 强制展开。
- `src/shared/hooks/usePiSession.ts`
  - 为 `workspacePaths` 增加 localStorage 持久化：程序重启后自动恢复已打开工作区列表。
  - session 切换时新增 `isSwitchingSession` 状态和 `pendingSessionTarget` 乐观选中目标，点击 session item 后侧栏激活样式立即切换，不等待 RPC switch 完成。
  - session 激活样式增强：primary 边框、左侧 inset accent、浅 primary 背景、阴影、标题加粗 primary、meta 变 primary/75。
  - session 列表时间格式化：前端将 ISO / `unix-ms:` 统一显示为今日 HH:mm、昨日 Yesterday HH:mm、其它日期 Mon Day；排序支持 `unix-ms:`。
  - 修复删除 session 路径校验：`pi_delete_session` 改用统一 `safe_session_path()`；`safe_session_path()` 支持路径存在时 canonicalize，不存在时给出明确 `session file does not exist`，并用 normalize 后的字符串校验 sessions root，兼容 Windows 前缀。
  - session cache 持久化只保存有 filePath 且非 `Current session` / `unknown cwd` 的高质量 session，避免缓存 fallback session 导致删除不存在路径。
  - 根据计时结果确认首屏慢点为 `getSettings`（约 18.8s），而后台刷新约 1s。
  - 启动初始化改为只等待 `client.connect`，随后立即进入 ready；messages/state/stats/sessions/models/settings/commands/files/extensions 全部交给后台 refresh 补齐，最大限度缩短全屏阻塞时间。
  - `getSettings()` 中 SDK sidecar status/settings/auth 探测增加 1.2s 上限，超时直接 fallback runtime/env auth，避免 SDK sidecar/auth 探测拖慢首屏或 refresh。
  - sessions/settings 增加 localStorage cache，首屏可先展示上次数据，再由后台 refresh 修正。
  - session 切换改为关键数据优先：`switchSession.rpc` 后只等待 messages/state/stats/current sessions，立即结束全屏 overlay；settings/files/extensions 等交给 `switchSession.backgroundRefresh`。
  - 新增 session messages localStorage cache（每个 session 最多 200 条）：点击 session 时若有缓存，立即展示缓存消息并只显示 refreshing 状态，不再阻塞全屏 overlay；RPC 完成后用真实消息替换。
  - refresh / switchSession 拿到真实 messages 后立即按当前 sessionFile/sessionId 写入本地缓存；sessions cache 写入时为每条 session 预建 message cache key，后续可增量补齐。
  - 新增后台 session cache warmer：Tauri `pi_read_session_messages(sessionPath)` 直接解析 JSONL text 消息，不切换 RPC runtime；workspace sessions 刷新后后台预热前 20 条 session 消息缓存。
  - `listSessions.workspaces` 从主 refresh 拆出为 `workspaceSessions.refresh` 后台任务，并限制为 startup 后触发；session 切换不再刷新整个 workspace sessions 列表，避免侧栏列表抖动/重载。
  - 修复 session 列表被 current fallback 覆盖问题：refresh / switchSession 只 merge 当前 sessions，不替换整体列表；merge 时避免 `Current session` / `unknown cwd` / `updatedAt=current` 低质量 fallback 覆盖已有真实 session。
  - 新增性能计时日志：`startup.critical`、`startup.backgroundRefresh`、`switchSession.total`、`switchSession.refresh`，用 `console.info` 输出 slowest summary，并用 `console.table` 直接展开每一步耗时。
  - 恢复工作区 sessions 时单个 cwd 失败不阻塞整体 refresh。
- `src/components/chat/MessageList.tsx`
  - session 切换期间显示 LoadingPanel：`正在加载 session...`。
  - 消息列表在加载/切换完成后自动滚动到底部，并同步更新时间轴 active item。
  - 消息列表底部 padding 增加到 `pb-36`，并压缩输入框外层底部间距，避免时间轴跳转后的用户消息被底部输入框遮挡。
  - 时间轴 hover 浮层改为从节点向上展开（`bottom-0` + 高 z-index），避免靠近底部时被 ChatInput 覆盖。
- `src/components/tools/ToolCallItem.tsx`
  - 工具调用 item 压缩：更小 padding、字体、status badge、icon。
- `src/components/layout/MainArea.tsx`
  - Header 压缩为 48px 高度，字体改为 `text-xs` / `text-[10px]`。
  - 去除 header 中 fork/compact 文字按钮。
  - 去除 header 中 ModelSelector；仅保留 title/status/cwd 和 Inspector icon。
  - Inspector toggle 改为纯 icon，无按钮背景/边框。
- `src/components/model/ModelSelector.tsx`
  - 增加 `compact` 模式。
  - compact 模式去除 Brain icon、边框、背景和大写按钮感，只显示模型文本、thinking 和 chevron。
- `src/components/chat/ChatInput.tsx`
  - 输入框整体从 `rounded-3xl/min-h-24` 压缩到 `rounded-2xl/min-h-20`。
  - 将 ModelSelector compact 模式移动到输入框右侧操作区，放在统计按钮左侧。
  - 移除输入框内 `/ 打开 pi 命令` 与 `Shift+Enter 换行` 两个提示 chip，减少视觉噪音。
  - 统一 compact model selector 模型名与 thinking 字体为 `text-[9px] leading-none`，避免模型名过大、medium 过小。
  - 文件/图片按钮改为纯 icon-only，无圆形边框/背景，并通过 tooltip 显示说明。
  - 发送按钮改为纯 icon-only，无按钮背景，并通过 tooltip 显示说明。
  - 移除输入框内停止按钮；running 时发送按钮 disabled。
  - 发送按钮旁新增数据图标 `BarChart3`。
  - 鼠标移入显示运行数据 tooltip：状态、上下文、tokens、费用、模型、thinking。
  - 数据来自 `state` / `stats` / `settings`，由 `MainArea` 从 `AppShell` 透传。
- `src/components/layout/MainArea.tsx`
  - 新增 `stats` / `settings` props，并传给 `ChatInput`。
- `src/components/layout/AppShell.tsx`
  - 给 `MainArea` 传入 `stats` / `settings`。
- `src/components/layout/RightInspector.tsx`
  - 移除顶部 compact chips，避免运行数据重复展示。
  - Inspector 只保留上下文对象详情。
  - 删除常驻大块 state/debug 区。
  - selected tool 仍最高优先展示，保留 tool args/result/safety。
  - active tools 只在存在 running tools 时显示 mini list。
  - SafetyPanel 仅在有 safety event 时显示；selected tool safety 留在 tool detail 内联展示。
  - FilesPreviewPanel 仅在已选文件/preview 时展开；未选文件但有 workspace files 时折叠为 details。
  - ExtensionsPanel 仅在 pending extension UI、extension panel 或 extension error 存在时显示。
  - SessionTreePanel 改为 details 折叠区；无其它上下文时默认展开。
  - 无上下文时显示空状态：提示点击 tool/file/session node 查看详情。
  - 底部保留最小 session summary，不再展示 session file path 大块信息。
- `src/shared/i18n.tsx`
  - 更新 `inspector.subtitle`。
  - 新增 `inspector.empty`。
  - 新增 `composerStats.*` 数据 tooltip 文案。

### Acceptance

- Inspector 默认不再堆空模块。
- 工具透明性仍保留：选中 tool 时完整详情可见。
- Extension/Safety 只在有事时出现。
- File/session tree 不再抢占首屏空间。
- UI 更像生产力上下文面板，而不是 debug dashboard。

## Tasks
1. **阶段 0：确认当前布局边界和视觉目标**
   - File: `src/components/layout/MainArea.tsx`
   - Changes: 确认 `main` 纵向布局：header、error、MessageList、input。保持 `MessageList` 为唯一滚动区域，输入框固定底部，不让 body/window 滚动。
   - Acceptance: 长消息列表只在消息区滚动；header/input 不滚动；Inspector 开关不破坏宽度。

2. **阶段 1：重构消息列表容器和滚动语义**
   - File: `src/components/chat/MessageList.tsx`
   - Changes: 给最外层滚动容器增加专用类名，例如 `message-list-scrollbar chat-scroll-region`；拆出内部内容容器，例如 `mx-auto w-full max-w-3xl ...`，避免滚动条受 `max-w-3xl` 限制，滚动条贴近聊天面板右边。
   - Acceptance: 滚动条出现在消息面板右缘，不在 3xl 内容列旁；内容宽度仍居中。

3. **阶段 1：实现截图样式滚动条**
   - File: `src/config/style/global.css`
   - Changes: 保留全局滚动条基础样式，但新增消息列表专用样式，覆盖 `*` 规则。
   - Acceptance: Chromium/WebView2 中看到右侧细竖线、多个短灰色刻度、当前滑块为深色圆角胶囊；Firefox 降级为 thin + thumb/track 颜色。

4. **阶段 2：消息气泡视觉改造**
   - File: `src/components/chat/MessageList.tsx`
   - Changes: user 右对齐、assistant 左对齐、system muted 卡片；内容 `whitespace-pre-wrap break-words`。
   - Acceptance: 用户/assistant 视觉层级清楚；长文本、长路径、空 content 都不溢出。

5. **阶段 2：工具调用嵌入优化**
   - File: `src/components/chat/MessageList.tsx`
   - Changes: 工具列表保持透明可见，放在 assistant 气泡下方或气泡内独立区域；增加标题/计数如需要。
   - Acceptance: tool calls 仍可点击 `onSelectTool`；视觉次级但不隐藏。

6. **阶段 2：空状态和 hero 收敛**
   - File: `src/components/chat/MessageList.tsx`
   - Changes: 空状态减少装饰，突出 prompt 起手建议与 pi 能力入口。
   - Acceptance: 空状态简洁，不像营销页。

7. **阶段 3：输入框视觉打磨**
   - File: `src/components/chat/ChatInput.tsx`
   - Changes: composer 更紧凑，发送/abort 状态明确，slash command 面板不被裁切。
   - Acceptance: Enter/Shift+Enter、slash commands、danger confirm 逻辑不变。

8. **阶段 3：主区域底部间距与遮挡检查**
   - File: `src/components/layout/MainArea.tsx`
   - Changes: 确保输入框固定底部但不遮挡最后消息。
   - Acceptance: 最后一条消息能完全滚到输入框上方。

9. **阶段 4：暗色与响应式检查**
   - Files: `src/components/chat/MessageList.tsx`, `src/config/style/global.css`
   - Changes: dark 模式滚动条、气泡色变量覆盖；移动端气泡宽度不溢出。
   - Acceptance: 360px、768px、1440px 宽度可用；light/dark 对比度足够。

## Files to Modify
- `src/components/chat/MessageList.tsx`
- `src/components/chat/ChatInput.tsx`
- `src/components/layout/MainArea.tsx`
- `src/components/layout/RightInspector.tsx`
- `src/config/style/global.css`
- `src/shared/i18n.tsx`

## Risks
- 截图滚动条 tick 只能用 CSS gradient 模拟；Firefox 只能降级。
- 改消息气泡时不能隐藏 `ToolCallItem`，否则违反 pi tool 透明原则。
- `ChatInput` 已有 slash command、危险命令确认、prefill 消费；视觉重构不能改坏键盘路径。
- Inspector 改为上下文型后，调试信息减少；必要 debug 信息应放 Settings/开发模式，不要常驻。

## Validation
- 手动：长消息列表只在消息区滚动，header/input 固定。
- 手动：滚动条右侧细线、间隔短刻度、深色圆角滑块。
- 手动：light/dark 对比度足够。
- 手动：发送 prompt；Enter 发送、Shift+Enter 换行。
- 手动：slash command 与危险命令确认仍正常。
- 手动：tool 可点击进入 Inspector，Inspector 只显示相关上下文。
- 不自动运行 build/lint/cargo check，除非用户另行要求。
