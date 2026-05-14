import type { PiSessionSummary, PiState } from "@/shared/pi/types";
import { normalizePath } from "@/shared/hooks/session-cache";
import { isKnownCwd } from "@/shared/pi/cwd";

export function normalizeSessionKey(path: string) {
  return normalizePath(path).toLowerCase();
}

export function isDeletedSession(session: PiSessionSummary, deletedKeys: Set<string>) {
  return Boolean(
    (session.filePath && deletedKeys.has(normalizeSessionKey(session.filePath))) ||
    (session.id && deletedKeys.has(normalizeSessionKey(session.id))),
  );
}

export function filterDeletedSessions(sessions: PiSessionSummary[], deletedKeys: Set<string>) {
  if (!deletedKeys.size) return sessions;
  return sessions.filter((session) => !isDeletedSession(session, deletedKeys));
}

export function mergeSessions(...groups: PiSessionSummary[][]): PiSessionSummary[] {
  const merged = new Map<string, PiSessionSummary>();
  for (const group of groups) {
    for (const session of group) {
      const key = session.filePath ?? session.id;
      const previous = merged.get(key);
      if (previous && isLowQualitySessionSummary(session) && !isLowQualitySessionSummary(previous)) continue;
      merged.set(key, session);
    }
  }
  return Array.from(merged.values());
}

export function findSessionByPath(sessions: PiSessionSummary[], sessionPath: string) {
  const target = normalizeSessionKey(sessionPath);
  return sessions.find((session) => normalizeSessionKey(session.filePath ?? session.id) === target || normalizeSessionKey(session.id) === target);
}

export function applySessionOverride(state: PiState, session: PiSessionSummary | null): PiState {
  if (!session) return state;
  return {
    ...state,
    cwd: isKnownCwd(session.cwd) ? session.cwd : state.cwd,
    sessionFile: session.filePath ?? state.sessionFile,
    sessionId: session.id ?? state.sessionId,
    sessionName: session.name ?? state.sessionName,
  };
}

export function isLowQualitySessionSummary(session: PiSessionSummary): boolean {
  return session.name === "Current session" || !session.cwd || session.cwd.toLowerCase() === "unknown cwd" || session.updatedAt === "current";
}
