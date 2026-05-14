import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { clearScheduledCacheWrite, scheduleSessionCacheWrite } from "@/shared/hooks/cache-scheduler";
import {
  persistMessagesForState,
  persistSessionMessages,
  persistSessions,
  persistSettings,
  persistWorkspacePaths,
} from "@/shared/hooks/session-cache";
import { filterDeletedSessions, mergeSessions } from "@/shared/hooks/session-utils";
import { loadSessionsFromDb, persistSessionMessagesToDb, persistSessionsToDb } from "@/shared/hooks/session-db-cache";
import type { PiMessage, PiSessionSummary, PiSettings, PiState } from "@/shared/pi/types";

interface UseSessionPersistenceOptions {
  messages: PiMessage[];
  state: PiState | null;
  sessions: PiSessionSummary[];
  settings: PiSettings | null;
  workspacePaths: string[];
  setSessions: Dispatch<SetStateAction<PiSessionSummary[]>>;
  activeAssistantIdRef: MutableRefObject<string | null>;
  deletedSessionKeysRef: MutableRefObject<Set<string>>;
}

export function persistSessionStateMessages(state: PiState, messages: PiMessage[]) {
  persistMessagesForState(state, messages);
  const sessionPath = state.sessionFile ?? state.sessionId;
  if (sessionPath) void persistSessionMessagesToDb(sessionPath, messages);
}

export function useSessionPersistence({
  messages,
  state,
  sessions,
  settings,
  workspacePaths,
  setSessions,
  activeAssistantIdRef,
  deletedSessionKeysRef,
}: UseSessionPersistenceOptions) {
  const messagePersistTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    messagePersistTimerRef.current = clearScheduledCacheWrite(messagePersistTimerRef.current);
  }, []);

  useEffect(() => {
    persistWorkspacePaths(workspacePaths);
  }, [workspacePaths]);

  useEffect(() => {
    persistSessions(sessions);
    void persistSessionsToDb(sessions);
  }, [sessions]);

  useEffect(() => {
    let disposed = false;
    void loadSessionsFromDb().then((dbSessions) => {
      if (disposed || !dbSessions.length) return;
      setSessions((current) => filterDeletedSessions(mergeSessions(current, dbSessions), deletedSessionKeysRef.current));
    });
    return () => {
      disposed = true;
    };
  }, [deletedSessionKeysRef, setSessions]);

  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

  useEffect(() => {
    const sessionPath = state?.sessionFile ?? state?.sessionId;
    if (!sessionPath || !messages.length || activeAssistantIdRef.current) return;
    messagePersistTimerRef.current = scheduleSessionCacheWrite(messagePersistTimerRef.current, () => {
      messagePersistTimerRef.current = null;
      persistSessionMessages(sessionPath, messages);
      void persistSessionMessagesToDb(sessionPath, messages);
    });
    return () => {
      messagePersistTimerRef.current = clearScheduledCacheWrite(messagePersistTimerRef.current);
    };
  }, [activeAssistantIdRef, messages, state?.sessionFile, state?.sessionId]);
}
