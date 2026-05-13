import type { PiMessage, PiToolCall } from "./types";
import { detectDangerousTool } from "./safety";
import { pickString } from "./model-settings-mapper";

export function mapSessionMessage(raw: unknown): PiMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  const id = message.id;
  const role = normalizeMessageRole(message.role);
  const content = message.content;
  const createdAt = message.createdAt;
  if (typeof id !== "string" || !role || typeof content !== "string" || typeof createdAt !== "string") return null;
  return {
    id,
    role,
    content,
    createdAt,
    contentBlocks: extractContentBlocks(message.contentBlocks),
    toolArgs: asRecord(message.toolArgs),
    toolDetails: asRecord(message.toolDetails),
    stopReason: pickString(message, ["stopReason"]),
    errorMessage: pickString(message, ["errorMessage"]),
    customType: pickString(message, ["customType"]),
    tokensBefore: typeof message.tokensBefore === "number" ? message.tokensBefore : undefined,
    toolName: pickString(message, ["toolName"]),
    toolCallId: pickString(message, ["toolCallId"]),
    isError: typeof message.isError === "boolean" ? message.isError : undefined,
    cancelled: typeof message.cancelled === "boolean" ? message.cancelled : undefined,
    truncated: typeof message.truncated === "boolean" ? message.truncated : undefined,
    fullOutputPath: pickString(message, ["fullOutputPath"]),
    excludeFromContext: typeof message.excludeFromContext === "boolean" ? message.excludeFromContext : undefined,
  };
}

export function mapAgentMessage(raw: unknown): PiMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  const role = normalizeMessageRole(message.role);
  if (!role) return null;

  return {
    id: crypto.randomUUID(),
    role,
    content: extractContentText(message.content),
    createdAt: formatTimestamp(message.timestamp),
    contentBlocks: extractContentBlocks(message.content),
    toolArgs: extractToolCallArgs(message.content, pickString(message, ["toolCallId"])),
    toolDetails: asRecord(message.details),
    stopReason: pickString(message, ["stopReason"]),
    errorMessage: pickString(message, ["errorMessage"]),
    customType: pickString(message, ["customType"]),
    tokensBefore: typeof message.tokensBefore === "number" ? message.tokensBefore : undefined,
    toolName: pickString(message, ["toolName"]),
    toolCallId: pickString(message, ["toolCallId"]),
    isError: typeof message.isError === "boolean" ? message.isError : undefined,
    cancelled: typeof message.cancelled === "boolean" ? message.cancelled : undefined,
    truncated: typeof message.truncated === "boolean" ? message.truncated : undefined,
    fullOutputPath: pickString(message, ["fullOutputPath"]),
    excludeFromContext: typeof message.excludeFromContext === "boolean" ? message.excludeFromContext : undefined,
  };
}

export function mapToolEvent(event: Record<string, unknown>, startTimes?: Map<string, number>): PiToolCall {
  const result = (event.result ?? event.partialResult) as Record<string, unknown> | undefined;
  const args = event.args as Record<string, unknown> | undefined;
  const name = String(event.toolName ?? "tool");
  const isStart = event.type === "tool_execution_start";
  const isEnd = event.type === "tool_execution_end";
  const isError = Boolean(event.isError);
  const id = String(event.toolCallId ?? crypto.randomUUID());
  if (isStart) startTimes?.set(id, performance.now());
  const startedAt = startTimes?.get(id);
  const durationMs = isEnd && startedAt !== undefined ? Math.max(0, Math.round(performance.now() - startedAt)) : undefined;
  if (isEnd) startTimes?.delete(id);

  const tool: PiToolCall = {
    id,
    name,
    target: extractToolTarget(name, args),
    status: isEnd ? (isError ? "error" : "success") : "running",
    summary: isEnd ? (isError ? "Tool failed" : "Tool complete") : "Tool running",
    output: extractContentText(result?.content),
    durationMs,
    args,
    details: result?.details && typeof result.details === "object" ? (result.details as Record<string, unknown>) : undefined,
    isError,
  };
  const safety = detectDangerousTool(tool);
  return safety ? { ...tool, safety } : tool;
}

function extractToolTarget(name: string, args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  if (name === "bash") return String(args.command ?? "");
  const path = pickArgString(args, ["path", "file_path", "filePath", "relativePath", "absolutePath", "target", "filename", "file"]);
  if (path) return path;
  if (typeof args.pattern === "string") return args.pattern;
  return JSON.stringify(args);
}

function pickArgString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const item = block as Record<string, unknown>;
      if (typeof item.text === "string") return item.text;
      if (item.type === "text" && typeof item.text === "string") return item.text;
      if (item.type === "thinking" || typeof item.thinking === "string") return "";
      if (item.type === "image") return "[image]";
      if (item.type === "toolCall") return "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeMessageRole(role: unknown): PiMessage["role"] | null {
  if (
    role === "user" ||
    role === "assistant" ||
    role === "system" ||
    role === "toolResult" ||
    role === "bashExecution" ||
    role === "custom" ||
    role === "branchSummary" ||
    role === "compactionSummary"
  ) {
    return role;
  }
  return null;
}

function extractContentBlocks(content: unknown): PiMessage["contentBlocks"] | undefined {
  if (!Array.isArray(content)) return undefined;
  const blocks = content.flatMap((block): NonNullable<PiMessage["contentBlocks"]> => {
    if (!block || typeof block !== "object") return [];
    const item = block as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string") return [{ type: "text", text: item.text }];
    if (item.type === "thinking" && typeof item.thinking === "string") return [{ type: "thinking", thinking: item.thinking, redacted: item.redacted === true }];
    if (item.type === "image") {
      return [
        {
          type: "image",
          data: typeof item.data === "string" ? item.data : undefined,
          mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
          url: typeof item.url === "string" ? item.url : undefined,
          alt: typeof item.alt === "string" ? item.alt : undefined,
        },
      ];
    }
    if (item.type === "toolCall" && typeof item.name === "string") {
      return [
        {
          type: "toolCall",
          id: typeof item.id === "string" ? item.id : undefined,
          name: item.name,
          arguments: item.arguments && typeof item.arguments === "object" ? (item.arguments as Record<string, unknown>) : undefined,
        },
      ];
    }
    const label = typeof item.type === "string" ? item.type : "unknown";
    return [{ type: "unknown", label, value: item }];
  });
  return blocks.length ? blocks : undefined;
}

function extractToolCallArgs(content: unknown, toolCallId?: string): Record<string, unknown> | undefined {
  if (!Array.isArray(content)) return undefined;
  const match = content.find((block) => {
    if (!block || typeof block !== "object") return false;
    const item = block as Record<string, unknown>;
    if (item.type !== "toolCall") return false;
    return !toolCallId || item.id === toolCallId;
  }) as Record<string, unknown> | undefined;
  const args = match?.arguments;
  return asRecord(args);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function formatTimestamp(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
