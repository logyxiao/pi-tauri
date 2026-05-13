import type { PiDeliveryMode, PiModel, PiState } from "./types";

export function mapStateResponse(data: unknown): PiState {
  const record = data as Record<string, unknown> | undefined;
  const model = record?.model as Record<string, unknown> | null | undefined;
  return {
    runState: record?.isStreaming ? "running" : "idle",
    cwd: (record?.cwd as string | undefined) ?? "unknown cwd",
    model: model ? `${model.provider as string}/${model.id as string}` : "no model",
    thinkingLevel: normalizeThinkingLevel(record?.thinkingLevel),
    tokenCount: Number((record?.messageCount as number | undefined) ?? 0),
    costUsd: 0,
    sessionFile: record?.sessionFile as string | undefined,
    sessionId: record?.sessionId as string | undefined,
    sessionName: record?.sessionName as string | undefined,
  };
}

export function mapModel(raw: unknown): PiModel | null {
  if (!raw || typeof raw !== "object") return null;
  const model = raw as Record<string, unknown>;
  const id = model.id ?? model.model;
  const provider = model.provider;
  if (typeof id !== "string" || typeof provider !== "string") return null;

  return {
    id,
    provider,
    name: typeof model.name === "string" ? model.name : id,
    api: model.api as string | undefined,
    reasoning: model.reasoning as boolean | undefined,
    contextWindow: nullableNumber(model.contextWindow) ?? undefined,
    maxTokens: nullableNumber(model.maxTokens) ?? undefined,
  };
}

export function modelFromState(state: PiState): PiModel {
  const [provider, id] = splitModelKey(state.model);
  return {
    id: id ?? state.model,
    provider: provider ?? "unknown",
    name: state.model,
    reasoning: state.thinkingLevel !== "off",
  };
}

export function inferAuthStatus(model: string) {
  const provider = splitModelKey(model)[0] ?? "unknown";
  return [
    {
      provider,
      status: "unknown" as const,
      detail: "RPC auth status not exposed; prompt run will surface auth errors.",
    },
  ];
}

export function splitModelKey(value: string | undefined): [string | undefined, string | undefined] {
  if (!value) return [undefined, undefined];
  const parts = value.split("/");
  if (parts.length >= 2) return [parts[0], parts.slice(1).join("/")];
  return [undefined, value];
}

export function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number") return value;
  return undefined;
}

export function pickString(settings: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = settings?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function pickBoolean(settings: Record<string, unknown> | undefined, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = settings?.[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

export function normalizeOptionalThinkingLevel(value: unknown): PiState["thinkingLevel"] | undefined {
  if (value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  return undefined;
}

export function normalizeDeliveryMode(value: unknown): PiDeliveryMode | undefined {
  if (value === "all" || value === "one-at-a-time") return value;
  return undefined;
}

function normalizeThinkingLevel(value: unknown): PiState["thinkingLevel"] {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  return "off";
}
