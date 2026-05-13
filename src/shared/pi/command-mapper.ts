import type { PiCommand } from "./types";
import { detectDangerousCommand } from "./safety";

export const builtinCommands: PiCommand[] = [
  { name: "compact", description: "Compact current context now", source: "builtin" },
  { name: "cycle-model", description: "Switch to next available model", source: "builtin" },
  { name: "cycle-thinking", description: "Switch to next thinking level", source: "builtin" },
  { name: "abort-retry", description: "Abort active auto-retry", source: "builtin" },
  { name: "abort-bash", description: "Abort active bash command", source: "builtin" },
  { name: "export-html", description: "Export current session to HTML", source: "builtin" },
  { name: "help", description: "Show available slash commands and pi usage hints", source: "builtin" },
  { name: "models", description: "List available models and current selection", source: "builtin" },
  { name: "sessions", description: "Show session summary", source: "builtin" },
  { name: "extensions", description: "Show loaded extensions and UI widgets", source: "builtin" },
];

export function mergeCommands(...groups: PiCommand[][]): PiCommand[] {
  const merged = new Map<string, PiCommand>();
  for (const group of groups) {
    for (const command of group) {
      merged.set(`${command.source}:${command.name}:${command.path ?? ""}`, command);
    }
  }
  return Array.from(merged.values());
}

export function mapCommand(raw: unknown): PiCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const command = raw as Record<string, unknown>;
  if (typeof command.name !== "string") return null;
  const sourceInfo = command.sourceInfo && typeof command.sourceInfo === "object" ? (command.sourceInfo as Record<string, unknown>) : undefined;
  const mapped: PiCommand = {
    name: command.name,
    description: typeof command.description === "string" ? command.description : undefined,
    source: normalizeCommandSource(command.source),
    location: normalizeCommandLocation(command.location ?? sourceInfo?.location ?? sourceInfo?.scope),
    path: typeof command.path === "string" ? command.path : typeof sourceInfo?.path === "string" ? sourceInfo.path : undefined,
    dangerous: /delete|reset|shell|batch|wipe|remove/i.test(command.name),
  };
  const safety = detectDangerousCommand(mapped);
  return safety ? { ...mapped, dangerous: true, safety } : mapped;
}

function normalizeCommandSource(value: unknown): PiCommand["source"] {
  if (value === "extension" || value === "prompt" || value === "skill") return value;
  return "builtin";
}

function normalizeCommandLocation(value: unknown): PiCommand["location"] | undefined {
  if (value === "user" || value === "project" || value === "path") return value;
  if (value === "temporary") return "path";
  return undefined;
}
