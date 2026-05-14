import { useCallback, useRef } from "react";
import { loadPersistedSessionMessages, persistSessionMessages } from "@/shared/hooks/session-cache";
import { loadSessionMessagesFromDb, persistSessionMessagesToDb } from "@/shared/hooks/session-db-cache";
import { normalizeSessionKey } from "@/shared/hooks/session-utils";
import { createWarmSessionCacheQueue, type WarmSessionCacheQueue } from "@/shared/hooks/warm-session-cache";
import type { PiClient } from "@/shared/pi/client";

export function useWarmSessionCache(client: PiClient) {
  const warmSessionCacheQueueRef = useRef<WarmSessionCacheQueue | null>(null);

  const warmSessionCache = useCallback(async (sessionPath: string) => {
    try {
      const cached = loadPersistedSessionMessages(sessionPath);
      if (cached.length) return;
      const dbMessages = await loadSessionMessagesFromDb(sessionPath);
      if (dbMessages.length) {
        persistSessionMessages(sessionPath, dbMessages);
        return;
      }
      const messages = await client.readSessionMessages(sessionPath);
      if (messages.length) persistSessionMessages(sessionPath, messages);
      if (messages.length) void persistSessionMessagesToDb(sessionPath, messages);
    } catch {
      // Warm cache is best-effort.
    }
  }, [client]);

  if (!warmSessionCacheQueueRef.current) {
    warmSessionCacheQueueRef.current = createWarmSessionCacheQueue({
      normalizeKey: normalizeSessionKey,
      warm: warmSessionCache,
    });
  }

  return warmSessionCacheQueueRef.current;
}
