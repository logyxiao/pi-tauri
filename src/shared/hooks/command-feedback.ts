import type { PiMessage } from "@/shared/pi/types";

export type CommandFeedbackState = "running" | "done" | "timeout" | "error";

export function mergeTransientCommandMessages(current: PiMessage[], next: PiMessage[]): PiMessage[] {
  const nextIds = new Set(next.map((message) => message.id));
  const transient = current.filter((message) => isTransientCommandMessage(message) && !nextIds.has(message.id));
  return transient.length ? [...next, ...transient] : next;
}

export function commandFeedbackContent(commandName: string, state: CommandFeedbackState, detail?: string): string {
  const command = `/${commandName}`;
  if (state === "running") return `已发送 ${command}，正在执行…`;
  if (state === "done") return `${command} 执行完成。`;
  if (state === "timeout") return `${command} 已发送，但 pi 未在预期时间内返回完成信号。压缩可能仍在后台继续；UI 保持可用，可稍后刷新查看结果。`;
  return `${command} 执行失败：${detail ?? "未知错误"}`;
}

export function isRpcTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /pi rpc request timed out/i.test(message);
}

function isTransientCommandMessage(message: PiMessage): boolean {
  return message.role === "custom" && message.id.startsWith("command-");
}
