import type { DangerousAction, DangerousActionKind, PiCommand, PiSafetyEvent, PiToolCall } from "./types";

const destructiveShellPattern = /\b(rm\s+-rf|del\s+\/|rd\s+\/s|format\b|mkfs\b|diskpart\b|shutdown\b|reboot\b|reset\b|git\s+reset\s+--hard|git\s+clean\s+-fd|Remove-Item\b.*-Recurse)\b/i;
const sensitivePathPattern = /(^|[\s"'])(~?\/?\.ssh|~?\/?\.aws|~?\/?\.config|~?\/?\.pi|C:\\Windows|C:\\Users\\[^\\]+\\AppData|\/etc|\/usr|\/bin|\/sbin)([\\/\s"']|$)/i;
const deletePattern = /\b(delete|remove|rm|del|unlink|rmdir|reset|clear|wipe|destroy)\b/i;
const writePattern = /\b(write|edit|overwrite|append|save|patch)\b/i;

export const defaultSafetyPolicy = {
  dangerousBashRequiresConfirm: true,
  destructiveFileChangeRequiresConfirm: true,
  sensitivePathRequiresConfirm: true,
  rpcToolLimitation:
    "RPC mode can label tool events after pi emits them. Pre-execution blocking for LLM tool calls requires SDK tool interception or an extension UI confirm bridge.",
};

export function detectDangerousCommand(command: PiCommand): DangerousAction | null {
  const haystack = [command.name, command.description, command.path].filter(Boolean).join(" ");
  if (command.dangerous || deletePattern.test(haystack) || destructiveShellPattern.test(haystack)) {
    return createDangerousAction("reset", command.name, command.description ?? "Command may reset, delete, or mutate local state.", "high");
  }
  return null;
}

export function detectDangerousTool(tool: PiToolCall): DangerousAction | null {
  const text = `${tool.name} ${tool.target} ${tool.summary} ${tool.output ?? ""}`;

  if (tool.name === "bash" && destructiveShellPattern.test(text)) {
    return createDangerousAction("bash", tool.target || tool.name, "Shell command looks destructive and should require explicit confirmation before execution.", "critical");
  }

  if ((tool.name === "write" || tool.name === "edit") && sensitivePathPattern.test(text)) {
    return createDangerousAction("sensitive_path", tool.target || tool.name, "Write/edit touches sensitive path.", "critical");
  }

  if ((tool.name === "write" || tool.name === "edit") && writePattern.test(text)) {
    return createDangerousAction(tool.name, tool.target || tool.name, "File mutation tool call. Review target and output.", "medium");
  }

  if (deletePattern.test(text)) {
    return createDangerousAction("delete", tool.target || tool.name, "Tool call appears to delete or reset state.", "high");
  }

  return null;
}

export function createSafetyEvent(action: DangerousAction, decision: PiSafetyEvent["decision"], source: PiSafetyEvent["source"]): PiSafetyEvent {
  return {
    id: crypto.randomUUID(),
    action,
    decision,
    source,
    createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

function createDangerousAction(
  kind: DangerousActionKind,
  target: string,
  reason: string,
  severity: DangerousAction["severity"],
): DangerousAction {
  return {
    id: crypto.randomUUID(),
    kind,
    target,
    reason,
    severity,
    requiresConfirmation: true,
  };
}
