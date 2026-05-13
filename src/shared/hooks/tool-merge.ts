import type { PiMessage, PiToolCall } from "@/shared/pi/types";

export function mergeToolLists(existing: PiToolCall[], incoming: PiToolCall[]): PiToolCall[] {
  const merged = new Map(existing.map((tool) => [tool.id, tool]));
  for (const tool of incoming) {
    const previous = merged.get(tool.id);
    merged.set(tool.id, previous ? mergeToolCall(previous, tool) : tool);
  }
  return Array.from(merged.values());
}

export function mergeToolCall(previous: PiToolCall, next: PiToolCall): PiToolCall {
  return {
    ...previous,
    ...next,
    target: isUsefulToolTarget(next.target, next.name) ? next.target : previous.target,
    args: next.args && Object.keys(next.args).length ? { ...(previous.args ?? {}), ...next.args } : previous.args,
    details: next.details && Object.keys(next.details).length ? { ...(previous.details ?? {}), ...next.details } : previous.details,
    output: next.output ?? previous.output,
    safety: next.safety ?? previous.safety,
  };
}

export function extractToolCallsFromMessage(message: PiMessage, existing: PiToolCall[]): PiToolCall[] {
  if (!message.contentBlocks?.length) return existing;
  const existingById = new Map(existing.map((tool) => [tool.id, tool]));
  return message.contentBlocks.flatMap((block) => {
    if (block.type !== "toolCall") return [];
    const id = block.id ?? `${block.name}:${JSON.stringify(block.arguments ?? {})}`;
    const previous = existingById.get(id);
    return [
      {
        id,
        name: block.name,
        target: extractToolTargetFromArgs(block.name, block.arguments) || previous?.target || "",
        status: previous?.status ?? "running",
        summary: previous?.summary ?? "Tool pending",
        output: previous?.output,
        args: block.arguments ?? previous?.args,
        details: previous?.details,
        durationMs: previous?.durationMs,
        isError: previous?.isError,
        safety: previous?.safety,
      },
    ];
  });
}

function extractToolTargetFromArgs(toolName: string, args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  if (toolName === "bash" && typeof args.command === "string") return args.command;
  for (const key of ["path", "file_path", "filePath", "relativePath", "absolutePath", "target", "filename", "file", "pattern"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function isUsefulToolTarget(target: string | undefined, toolName: string) {
  if (!target) return false;
  const trimmed = target.trim();
  return Boolean(trimmed && trimmed !== "unknown" && trimmed !== toolName);
}
