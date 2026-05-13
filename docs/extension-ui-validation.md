# Extension UI Response 手工验证计划

## 目标

验证真实 pi extension UI request/response 闭环：confirm、select、input、editor、cancel、timeout、response write failure。

## 前置条件

- 只在用户明确要求时运行桌面验证命令。
- 推荐命令：`pnpm tauri dev`。
- 确认 Inspector 可见 Extension UI 面板。
- 确认前端事件映射：
  - `extension_ui_request` -> pending queue + dialog
  - `extension_ui_response` -> 直接写 RPC stdin，不走普通 request correlation
  - `extension_error` -> Inspector error list

## 验证矩阵

| 场景 | 触发 | 预期 |
| --- | --- | --- |
| confirm submit | extension 发 confirm request | 弹确认 dialog；点击确认后 pending 移除；extension 继续 |
| confirm cancel | extension 发 confirm request | 点击取消后 response value 为 cancel/false；pending 移除或 extension 处理取消 |
| select submit | extension 发 select request with options | 下拉/选项可见；提交值正确回写 |
| input submit | extension 发 input request with placeholder/prefill | 输入值正确回写 |
| editor submit | extension 发 editor request with prefill | 多行文本正确回写；prefill 可见 |
| timeout | extension request 带 timeout | 超时后 extension 不应永久卡住；UI pending 需可取消/重试 |
| response write failure | 停止 RPC 后提交 dialog | dialog 内显示错误；pending request 保留，便于重试/取消 |
| extension_error | extension 主动抛错 | Inspector Extension errors 显示错误来源与 message |

## Mock 快速检查

当前 mock commands 已覆盖：

- `ui-confirm`
- `ui-select`
- `ui-input`
- `ui-editor`

浏览器/mock 环境可先确认 dialog 与 Inspector pending UI。

## 真实 extension 建议步骤

1. 启动桌面 app。
2. 打开 Settings/Inspector，确认 RPC connected。
3. 触发真实 extension command，让 extension 发 `extension_ui_request`。
4. 对每类 method 执行 submit/cancel。
5. 观察：
   - dialog busy state
   - dialog error state
   - pending queue 数量
   - Inspector Extension UI 面板
   - extension 是否继续执行
6. 停止/断开 RPC 后提交一次 response，确认错误可见且 pending 不丢失。

## 验收标准

- 真实 extension UI 不会永久卡住。
- response payload id/method/value/error 与 request 对应。
- response 失败对用户可见。
- pending request 可重试或取消。
- `extension_ui_response` 未进入普通 RPC request correlation。
