import type { PiMessage, PiSessionSummary, PiSettings, PiState } from "@/shared/pi/types";

const WORKSPACE_PATHS_STORAGE_KEY = "pi-tauri.workspacePaths";
const SESSION_CACHE_STORAGE_KEY = "pi-tauri.sessions.cache";
const SESSION_MESSAGES_CACHE_PREFIX = "pi-tauri.sessionMessages.";
const SETTINGS_CACHE_STORAGE_KEY = "pi-tauri.settings.cache";
const CACHE_VERSION = 1;
const SESSION_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const SESSION_MESSAGES_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

interface CacheEnvelope<T> {
  version: number;
  savedAt: number;
  value: T;
}

export function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/$/, "");
}

export function loadPersistedWorkspacePaths(): string[] {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PATHS_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return Array.from(new Map(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => [normalizePath(item), item.trim()])).values());
  } catch {
    return [];
  }
}

export function persistWorkspacePaths(paths: string[]) {
  try {
    window.localStorage.setItem(WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // Ignore storage failures; workspace can still be opened for current run.
  }
}

export function clearSessionCache() {
  try {
    window.localStorage.removeItem(SESSION_CACHE_STORAGE_KEY);
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(SESSION_MESSAGES_CACHE_PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
  }
}

export function loadPersistedSessions(): PiSessionSummary[] {
  try {
    const value = readCacheEnvelope<unknown>(SESSION_CACHE_STORAGE_KEY, SESSION_CACHE_TTL_MS);
    if (!Array.isArray(value)) return [];
    return value.filter(isSessionSummaryLike).slice(0, 200);
  } catch {
    return [];
  }
}

export function persistSessions(sessions: PiSessionSummary[]) {
  try {
    const durableSessions = sessions.filter((session) => session.filePath && !isLowQualitySessionSummary(session));
    writeCacheEnvelope(SESSION_CACHE_STORAGE_KEY, durableSessions.slice(0, 200));
  } catch {
    // Cache only; ignore storage failures.
  }
}

export function loadPersistedSessionMessages(sessionPath: string): PiMessage[] {
  try {
    const value = readCacheEnvelope<unknown>(sessionMessagesCacheKey(sessionPath), SESSION_MESSAGES_CACHE_TTL_MS);
    if (!Array.isArray(value)) return [];
    return value.filter(isMessageLike).slice(-200);
  } catch {
    return [];
  }
}

export function persistSessionMessages(sessionPath: string, messages: PiMessage[]) {
  try {
    writeCacheEnvelope(sessionMessagesCacheKey(sessionPath), messages.slice(-200));
  } catch {
    // Cache only; ignore storage failures.
  }
}

export function removePersistedSessionMessages(sessionPath: string) {
  try {
    window.localStorage.removeItem(sessionMessagesCacheKey(sessionPath));
  } catch {
    // Cache only; ignore storage failures.
  }
}

export function loadPersistedSettings(): PiSettings | null {
  try {
    const raw = window.localStorage.getItem(SETTINGS_CACHE_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return isSettingsLike(value) ? value : null;
  } catch {
    return null;
  }
}

export function persistSettings(settings: PiSettings | null) {
  if (!settings) return;
  try {
    window.localStorage.setItem(SETTINGS_CACHE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Cache only; ignore storage failures.
  }
}

export function persistMessagesForState(state: PiState | null, messages: PiMessage[]) {
  const sessionPath = state?.sessionFile ?? state?.sessionId;
  if (!sessionPath || !messages.length) return;
  persistSessionMessages(sessionPath, messages);
}

function sessionMessagesCacheKey(sessionPath: string): string {
  return `${SESSION_MESSAGES_CACHE_PREFIX}${encodeURIComponent(normalizePath(sessionPath))}`;
}

function readCacheEnvelope<T>(key: string, ttlMs: number): T | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (isCacheEnvelope<T>(parsed)) {
    if (parsed.version !== CACHE_VERSION || Date.now() - parsed.savedAt > ttlMs) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  }
  return parsed as T;
}

function writeCacheEnvelope<T>(key: string, value: T) {
  const envelope: CacheEnvelope<T> = {
    version: CACHE_VERSION,
    savedAt: Date.now(),
    value,
  };
  window.localStorage.setItem(key, JSON.stringify(envelope));
}

function isCacheEnvelope<T>(value: unknown): value is CacheEnvelope<T> {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Record<string, unknown>;
  return typeof envelope.version === "number" && typeof envelope.savedAt === "number" && "value" in envelope;
}

function isLowQualitySessionSummary(session: PiSessionSummary): boolean {
  return session.name === "Current session" || !session.cwd || session.cwd.toLowerCase() === "unknown cwd" || session.updatedAt === "current";
}

function isSessionSummaryLike(value: unknown): value is PiSessionSummary {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.id === "string" &&
    typeof session.name === "string" &&
    typeof session.cwd === "string" &&
    typeof session.updatedAt === "string" &&
    typeof session.model === "string" &&
    (session.status === "idle" || session.status === "running")
  );
}

function isMessageLike(value: unknown): value is PiMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  const role = message.role;
  return (
    typeof message.id === "string" &&
    (role === "user" || role === "assistant" || role === "system" || role === "toolResult" || role === "bashExecution" || role === "custom" || role === "branchSummary" || role === "compactionSummary") &&
    typeof message.content === "string" &&
    typeof message.createdAt === "string"
  );
}

function isSettingsLike(value: unknown): value is PiSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Record<string, unknown>;
  return typeof settings.model === "string" && typeof settings.provider === "string" && typeof settings.cwd === "string";
}
