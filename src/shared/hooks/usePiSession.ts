import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPiClient } from "@/shared/pi/create-client";
import { useI18n } from "@/shared/i18n";
import { commandFeedbackContent, isRpcTimeoutError, mergeTransientCommandMessages, type CommandFeedbackState } from "@/shared/hooks/command-feedback";
import {
  normalizePath,
  loadPersistedSessionMessages,
  loadPersistedSessions,
  loadPersistedSettings,
  loadPersistedWorkspacePaths,
  persistMessagesForState,
  persistSessionMessages,
  persistSessions,
  persistSettings,
  persistWorkspacePaths,
  removePersistedSessionMessages,
} from "@/shared/hooks/session-cache";
import { applySessionOverride, filterDeletedSessions, findSessionByPath, isDeletedSession, isKnownCwd, isLowQualitySessionSummary, mergeSessions, normalizeSessionKey } from "@/shared/hooks/session-utils";
import { timed, logTimings, type TimingEntry } from "@/shared/hooks/timing";
import { extractToolCallsFromMessage, mergeToolCall, mergeToolLists } from "@/shared/hooks/tool-merge";
import { clearScheduledCacheWrite, scheduleSessionCacheWrite } from "@/shared/hooks/cache-scheduler";
import { appendAssistantDelta, createAssistantMessage, ensureAssistantMessage, reconcileFinalMessages, upsertAssistantTool } from "@/shared/hooks/live-message";
import { expirePendingExtensionMessages, markPendingExtensionMessage, removePendingExtensionMessage, upsertPendingExtensionMessage } from "@/shared/hooks/extension-pending";
import { createWarmSessionCacheQueue, type WarmSessionCacheQueue } from "@/shared/hooks/warm-session-cache";
import { loadSessionMessagesFromDb, loadSessionsFromDb, persistSessionMessagesToDb, persistSessionsToDb, removeSessionMessagesFromDb } from "@/shared/hooks/session-db-cache";
import { initialSessionPanelState, sessionPanelReducer } from "@/shared/hooks/session-panel-state";
import type { PiClientEvent } from "@/shared/pi/client";
import type {
  PiCommand,
  PiExtensionMessage,
  PiExtensionUiResponse,
  PiMessage,
  PiModel,
  PiSafetyEvent,
  PiSessionStats,
  PiSessionSummary,
  PiSettings,
  PiSettingsUpdate,
  PiState,
  PiToolCall,
} from "@/shared/pi/types";

export type PiSessionStatus = "connecting" | "ready" | "refreshing" | "running" | "error";

const nowLabel = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

async function pickWorkspaceFolder(title: string, promptLabel: string): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false, title });
    return typeof selected === "string" ? selected : null;
  }
  return window.prompt(promptLabel)?.trim() || null;
}

export function usePiSession() {
  const { t } = useI18n();
  const client = useMemo(() => createPiClient(), []);
  const [messages, setMessages] = useState<PiMessage[]>([]);
  const [state, setState] = useState<PiState | null>(null);
  const [stats, setStats] = useState<PiSessionStats | null>(null);
  const [sessions, setSessions] = useState<PiSessionSummary[]>(() => loadPersistedSessions());
  const [workspacePaths, setWorkspacePaths] = useState<string[]>(() => loadPersistedWorkspacePaths());
  const [models, setModels] = useState<PiModel[]>([]);
  const [settings, setSettings] = useState<PiSettings | null>(() => loadPersistedSettings());
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [panelState, dispatchPanel] = useReducer(sessionPanelReducer, initialSessionPanelState);
  const [pendingExtensionUi, setPendingExtensionUi] = useState<PiExtensionMessage[]>([]);
  const [status, setStatus] = useState<PiSessionStatus>("connecting");
  const [isSwitchingSession, setIsSwitchingSession] = useState(false);
  const [pendingSessionTarget, setPendingSessionTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const activeSessionOverrideRef = useRef<PiSessionSummary | null>(null);
  const deletedSessionKeysRef = useRef<Set<string>>(new Set());
  const messagePersistTimerRef = useRef<number | null>(null);
  const liveDeltaBufferRef = useRef("");
  const liveDeltaRafRef = useRef<number | null>(null);
  const sessionEpochRef = useRef(0);
  const suppressRuntimeEventsRef = useRef(false);
  const warmSessionCacheQueueRef = useRef<WarmSessionCacheQueue | null>(null);

  const isCurrentEpoch = useCallback((epoch: number) => sessionEpochRef.current === epoch, []);

  const nextSessionEpoch = useCallback(() => {
    sessionEpochRef.current += 1;
    return sessionEpochRef.current;
  }, []);

  const flushLiveAssistantDelta = useCallback(() => {
    const assistantId = activeAssistantIdRef.current;
    if (!assistantId) return;
    const delta = liveDeltaBufferRef.current;
    if (!delta) return;
    liveDeltaBufferRef.current = "";
    setMessages((current) => appendAssistantDelta(current, assistantId, delta));
  }, []);

  const appendDeltaToLiveAssistant = useCallback((delta: string) => {
    if (!delta) return;
    liveDeltaBufferRef.current += delta;
    if (liveDeltaRafRef.current !== null) return;
    liveDeltaRafRef.current = window.requestAnimationFrame(() => {
      liveDeltaRafRef.current = null;
      flushLiveAssistantDelta();
    });
  }, [flushLiveAssistantDelta]);

  const clearLiveAssistantDelta = useCallback(() => {
    if (liveDeltaRafRef.current !== null) {
      window.cancelAnimationFrame(liveDeltaRafRef.current);
      liveDeltaRafRef.current = null;
    }
    liveDeltaBufferRef.current = "";
  }, []);

  useEffect(() => () => {
    messagePersistTimerRef.current = clearScheduledCacheWrite(messagePersistTimerRef.current);
    clearLiveAssistantDelta();
  }, [clearLiveAssistantDelta]);

  useEffect(() => {
    if (!pendingExtensionUi.some((item) => item.expiresAt && item.uiState !== "expired")) return;
    const timer = window.setInterval(() => {
      setPendingExtensionUi((current) => expirePendingExtensionMessages(current));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [pendingExtensionUi]);

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
  }, []);

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
  }, [messages, state?.sessionFile, state?.sessionId]);

  const ensureLiveAssistantMessage = useCallback(() => {
    const existingId = activeAssistantIdRef.current;
    if (existingId) {
      setMessages((current) => ensureAssistantMessage(current, existingId, nowLabel()));
      return existingId;
    }

    const assistantId = crypto.randomUUID();
    activeAssistantIdRef.current = assistantId;
    setMessages((current) => [...current, createAssistantMessage(assistantId, nowLabel())]);
    return assistantId;
  }, []);

  const refreshWorkspaceSessions = useCallback(async () => {
    if (!workspacePaths.length) return;
    const totalStartedAt = performance.now();
    const timings: TimingEntry[] = [];
    try {
      const workspaceSessions = (
        await timed(timings, "listSessions.workspaces", () =>
          Promise.all(
            workspacePaths.map(async (cwd) => {
              try {
                return await client.listSessions({ cwd });
              } catch {
                return [];
              }
            }),
          ),
        )
      ).flat();
      setSessions((current) => filterDeletedSessions(mergeSessions(current, workspaceSessions), deletedSessionKeysRef.current));
      warmSessionCacheQueueRef.current?.enqueue(workspaceSessions.slice(0, 20).map((session) => session.filePath).filter((path): path is string => Boolean(path)));
      logTimings("workspaceSessions.refresh", timings, totalStartedAt);
    } catch {
      logTimings("workspaceSessions.refresh: failed", timings, totalStartedAt);
    }
  }, [client, workspacePaths]);

  const refresh = useCallback(async (scope = "refresh", options: { forceModels?: boolean; targetCwd?: string; epoch?: number } = {}) => {
    const epoch = options.epoch ?? sessionEpochRef.current;
    const totalStartedAt = performance.now();
    const timings: TimingEntry[] = [];
    setStatus((current) => (current === "connecting" || current === "running" ? current : "refreshing"));
    try {
      const [
        nextMessages,
        nextState,
        nextStats,
        nextSessions,
        nextModels,
        nextSettings,
        nextCommands,
        nextExtensionPanels,
        nextExtensionStatuses,
        nextExtensionMessages,
        nextExtensionErrors,
        nextSafetyEvents,
        nextFiles,
      ] = await Promise.all([
        timed(timings, "getMessages", () => client.getMessages()),
        timed(timings, "getState", () => client.getState()),
        timed(timings, "getSessionStats", () => client.getSessionStats()),
        timed(timings, "listSessions.current", () => client.listSessions(options.targetCwd ? { cwd: options.targetCwd } : undefined)),
        timed(timings, "listModels", () => client.listModels({ force: options.forceModels })),
        timed(timings, "getSettings", () => client.getSettings()),
        timed(timings, "listCommands", () => client.listCommands()),
        timed(timings, "listExtensionPanels", () => client.listExtensionPanels()),
        timed(timings, "listExtensionStatuses", () => client.listExtensionStatuses()),
        timed(timings, "listExtensionMessages", () => client.listExtensionMessages()),
        timed(timings, "listExtensionErrors", () => client.listExtensionErrors()),
        timed(timings, "listSafetyEvents", () => client.listSafetyEvents()),
        timed(timings, "listFiles", () => client.listFiles({ depth: 1, limit: 80 })),
      ]);
      if (!isCurrentEpoch(epoch)) return;
      if (!activeAssistantIdRef.current) {
        setMessages((current) => mergeTransientCommandMessages(current, nextMessages));
        persistMessagesForState(nextState, nextMessages);
      }
      setState((current) => {
        const mergedState = applySessionOverride(nextState, activeSessionOverrideRef.current);
        const stableState = options.targetCwd && !isKnownCwd(mergedState.cwd) ? { ...mergedState, cwd: options.targetCwd } : mergedState;
        return activeAssistantIdRef.current ? { ...(current ?? stableState), ...stableState, runState: "running" } : stableState;
      });
      setStats(nextStats);
      const sessionsForMerge = options.targetCwd ? nextSessions.filter((session) => !isLowQualitySessionSummary(session)) : nextSessions;
      setSessions((current) => filterDeletedSessions(mergeSessions(current, sessionsForMerge), deletedSessionKeysRef.current));
      setModels(nextModels);
      setSettings(nextSettings);
      setCommands(nextCommands);
      dispatchPanel({ type: "setExtensionPanels", panels: nextExtensionPanels });
      dispatchPanel({ type: "setExtensionStatuses", statuses: nextExtensionStatuses });
      dispatchPanel({ type: "setExtensionMessages", messages: nextExtensionMessages });
      dispatchPanel({ type: "setExtensionErrors", errors: nextExtensionErrors });
      dispatchPanel({ type: "setSafetyEvents", events: nextSafetyEvents });
      dispatchPanel({ type: "setFiles", files: nextFiles });
      setError(null);
      setStatus(activeAssistantIdRef.current || nextState.runState === "running" ? "running" : "ready");
      logTimings(scope, timings, totalStartedAt);
      if (scope.startsWith("startup")) void refreshWorkspaceSessions();
    } catch (caught) {
      if (!isCurrentEpoch(epoch)) return;
      logTimings(`${scope}: failed`, timings, totalStartedAt);
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }, [client, isCurrentEpoch, refreshWorkspaceSessions, t]);

  const upsertTool = useCallback((tool: PiToolCall) => {
    const assistantId = ensureLiveAssistantMessage();
    setMessages((current) => upsertAssistantTool(current, assistantId, tool, mergeToolCall));
  }, [ensureLiveAssistantMessage]);

  const handleEvent = useCallback(
    (event: PiClientEvent) => {
      const eventEpoch = sessionEpochRef.current;
      const isRuntimeEvent =
        event.type === "agent_start" ||
        event.type === "message_update" ||
        event.type === "tool_execution_start" ||
        event.type === "tool_execution_update" ||
        event.type === "tool_execution_end" ||
        event.type === "agent_end" ||
        event.type === "aborted";
      if (isRuntimeEvent && suppressRuntimeEventsRef.current) return;
      if (event.type === "agent_start") {
        ensureLiveAssistantMessage();
        setStatus("running");
        setError(null);
        setState((current) => (current ? { ...current, runState: "running" } : current));
        return;
      }

      if (event.type === "message_update") {
        if (!isCurrentEpoch(eventEpoch)) return;
        const assistantId = ensureLiveAssistantMessage();
        if (event.message) {
          flushLiveAssistantDelta();
          const eventMessage = event.message;
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              return {
                ...message,
                ...eventMessage,
                id: message.id,
                createdAt: message.createdAt,
                tools: mergeToolLists(message.tools ?? [], extractToolCallsFromMessage(eventMessage, message.tools ?? [])),
              };
            }),
          );
          return;
        }
        if (event.delta) {
          appendDeltaToLiveAssistant(event.delta);
        }
        return;
      }

      if (
        event.type === "tool_execution_start" ||
        event.type === "tool_execution_update" ||
        event.type === "tool_execution_end"
      ) {
        if (!isCurrentEpoch(eventEpoch)) return;
        flushLiveAssistantDelta();
        upsertTool(event.tool);
        if (event.tool.safety) void refresh();
        return;
      }

      if (event.type === "extension_error") {
        dispatchPanel({ type: "upsertExtensionError", error: event.error });
        return;
      }

      if (event.type === "extension_ui_request") {
        dispatchPanel({ type: "upsertExtensionMessage", message: event.message });
        if (event.message.expectsResponse) {
          setPendingExtensionUi((current) => upsertPendingExtensionMessage(current, event.message));
        }
        if (event.panel) {
          dispatchPanel({ type: "upsertExtensionPanel", panel: event.panel });
        }
        if (event.status) {
          dispatchPanel({ type: "upsertExtensionStatus", status: event.status });
        }
        if (event.editorText) dispatchPanel({ type: "setPrefillInput", value: event.editorText });
        return;
      }

      if (event.type === "agent_end" || event.type === "aborted") {
        const assistantId = activeAssistantIdRef.current;
        flushLiveAssistantDelta();
        if (event.type === "agent_end" && event.messages?.length) {
          setMessages((current) => reconcileFinalMessages(current, assistantId, event.messages ?? []));
        }
        setStatus("ready");
        setState((current) => (current ? { ...current, runState: "idle" } : current));
        activeAssistantIdRef.current = null;
        void refresh("agentEnd.refresh", { epoch: eventEpoch });
      }
    },
    [appendDeltaToLiveAssistant, ensureLiveAssistantMessage, flushLiveAssistantDelta, isCurrentEpoch, refresh, upsertTool],
  );

  useEffect(() => {
    let disposed = false;
    const unsubscribe = client.subscribe(handleEvent);

    async function connect() {
      const totalStartedAt = performance.now();
      const timings: TimingEntry[] = [];
      setStatus("connecting");
      try {
        await timed(timings, "client.connect", () => client.connect());
        if (disposed) return;

        setError(null);
        setStatus("ready");
        logTimings("startup.critical", timings, totalStartedAt);

        void refresh("startup.backgroundRefresh");
      } catch (caught) {
        logTimings("startup.critical: failed", timings, totalStartedAt);
        if (disposed) return;
        setError(errorMessage(caught, t("hook.unknownError")));
        setStatus("error");
      }
    }

    void connect();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [client, handleEvent, refresh]);

  async function prompt(content: string) {
    const trimmed = content.trim();
    if (!trimmed || state?.runState === "running") return;
    const epoch = sessionEpochRef.current;

    const userMessage: PiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: nowLabel(),
    };
    const assistantId = crypto.randomUUID();
    activeAssistantIdRef.current = assistantId;
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "", createdAt: nowLabel(), tools: [] }]);
    setStatus("running");
    setState((current) => (current ? { ...current, runState: "running" } : current));
    setError(null);

    try {
      await client.prompt(trimmed);
    } catch (caught) {
      if (!isCurrentEpoch(epoch)) return;
      activeAssistantIdRef.current = null;
      clearLiveAssistantDelta();
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
      setState((current) => (current ? { ...current, runState: "error" } : current));
    }
  }

  async function abort() {
    try {
      await client.abort();
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function steer(content: string) {
    const trimmed = content.trim();
    if (!trimmed || state?.runState !== "running") return;
    try {
      await client.steer(trimmed);
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function followUp(content: string) {
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      await client.followUp(trimmed);
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function newSession(cwd?: string) {
    const epoch = nextSessionEpoch();
    try {
      suppressRuntimeEventsRef.current = true;
      activeSessionOverrideRef.current = null;
      await client.newSession(cwd ? { cwd } : undefined);
      if (!isCurrentEpoch(epoch)) return;
      activeAssistantIdRef.current = null;
      clearLiveAssistantDelta();
      if (cwd) setState((current) => (current ? { ...current, cwd, sessionName: undefined } : current));
      setMessages([]);
      dispatchPanel({ type: "setFilePreview", preview: null });
      setError(null);
      suppressRuntimeEventsRef.current = false;
      await refresh("newSession", cwd ? { targetCwd: cwd, epoch } : { epoch });
    } catch (caught) {
      if (!isCurrentEpoch(epoch)) return;
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    } finally {
      if (isCurrentEpoch(epoch)) suppressRuntimeEventsRef.current = false;
    }
  }

  async function continueRecent() {
    const epoch = nextSessionEpoch();
    try {
      suppressRuntimeEventsRef.current = true;
      activeSessionOverrideRef.current = null;
      await client.continueRecent();
      if (!isCurrentEpoch(epoch)) return;
      activeAssistantIdRef.current = null;
      clearLiveAssistantDelta();
      dispatchPanel({ type: "setFilePreview", preview: null });
      setError(null);
      suppressRuntimeEventsRef.current = false;
      await refresh("continueRecent", { epoch });
    } catch (caught) {
      if (!isCurrentEpoch(epoch)) return;
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    } finally {
      if (isCurrentEpoch(epoch)) suppressRuntimeEventsRef.current = false;
    }
  }

  async function warmSessionCache(sessionPath: string) {
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
  }

  async function switchSession(sessionPath: string) {
    const epoch = nextSessionEpoch();
    const totalStartedAt = performance.now();
    const timings: TimingEntry[] = [];
    const targetSession = findSessionByPath(sessions, sessionPath) ?? null;
    const targetCwd = isKnownCwd(targetSession?.cwd) ? targetSession.cwd : null;
    const cachedMessages = loadPersistedSessionMessages(sessionPath);
    const hasCachedMessages = cachedMessages.length > 0;
    try {
      suppressRuntimeEventsRef.current = true;
      activeSessionOverrideRef.current = targetSession;
      setPendingSessionTarget(sessionPath);
      setIsSwitchingSession(!hasCachedMessages);
      setStatus("refreshing");
      if (targetCwd) setState((current) => (current ? { ...current, cwd: targetCwd, sessionFile: targetSession?.filePath ?? current.sessionFile, sessionId: targetSession?.id ?? current.sessionId, sessionName: targetSession?.name ?? current.sessionName } : current));
      setMessages(cachedMessages);
      if (!cachedMessages.length) {
        void loadSessionMessagesFromDb(sessionPath).then((dbMessages) => {
          if (!isCurrentEpoch(epoch) || !dbMessages.length) return;
          setMessages(dbMessages);
        });
      }
      await timed(timings, "switchSession.rpc", () => client.switchSession(sessionPath));
      if (!isCurrentEpoch(epoch)) return;

      const [nextMessages, nextState, nextStats, nextSessions] = await Promise.all([
        timed(timings, "switchSession.getMessages", () => client.getMessages()),
        timed(timings, "switchSession.getState", () => client.getState()),
        timed(timings, "switchSession.getSessionStats", () => client.getSessionStats()),
        timed(timings, "switchSession.listSessions.current", () => client.listSessions()),
      ]);
      if (!isCurrentEpoch(epoch)) return;

      activeAssistantIdRef.current = null;
      clearLiveAssistantDelta();
      setMessages(nextMessages);
      persistMessagesForState(nextState, nextMessages);
      if (nextState.sessionFile || nextState.sessionId) void persistSessionMessagesToDb(nextState.sessionFile ?? nextState.sessionId ?? sessionPath, nextMessages);
      setState(applySessionOverride(nextState, targetSession));
      setStats(nextStats);
      setSessions((current) => filterDeletedSessions(mergeSessions(current, nextSessions), deletedSessionKeysRef.current));
      dispatchPanel({ type: "setFilePreview", preview: null });
      setError(null);
      setStatus(nextState.runState === "running" ? "running" : "ready");
      setPendingSessionTarget(null);
      suppressRuntimeEventsRef.current = false;
      logTimings("switchSession.total", timings, totalStartedAt);
      void refresh("switchSession.backgroundRefresh", { epoch });
    } catch (caught) {
      if (!isCurrentEpoch(epoch)) return;
      logTimings("switchSession.total: failed", timings, totalStartedAt);
      setPendingSessionTarget(null);
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    } finally {
      if (isCurrentEpoch(epoch)) {
        suppressRuntimeEventsRef.current = false;
        setIsSwitchingSession(false);
      }
    }
  }

  if (!warmSessionCacheQueueRef.current) {
    warmSessionCacheQueueRef.current = createWarmSessionCacheQueue({
      normalizeKey: normalizeSessionKey,
      warm: warmSessionCache,
    });
  }

  async function setSessionName(name: string) {
    try {
      await client.setSessionName(name);
      setError(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function deleteSession(sessionPath: string) {
    try {
      await client.deleteSession(sessionPath);
      deletedSessionKeysRef.current.add(normalizeSessionKey(sessionPath));
      setSessions((current) => current.filter((session) => !isDeletedSession(session, deletedSessionKeysRef.current)));
      removePersistedSessionMessages(sessionPath);
      void removeSessionMessagesFromDb(sessionPath);
      setError(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
      throw caught;
    }
  }

  async function exportHtml() {
    try {
      const outputPath = await client.exportHtml();
      setError(null);
      await refresh();
      return outputPath;
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
      return null;
    }
  }

  async function openWorkspaceFolder() {
    try {
      setError(null);
      const folder = await pickWorkspaceFolder(t("hook.openWorkspaceTitle"), t("hook.workspacePrompt"));
      if (!folder) return;
      const nextSessions = await client.listSessions({ cwd: folder });
      setWorkspacePaths((current) => (current.some((item) => normalizePath(item) === normalizePath(folder)) ? current : [...current, folder]));
      setSessions((current) => filterDeletedSessions(mergeSessions(current, nextSessions), deletedSessionKeysRef.current));
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  function removeWorkspaceFolder(cwd: string) {
    const normalized = normalizePath(cwd);
    setWorkspacePaths((current) => current.filter((item) => normalizePath(item) !== normalized));
    setSessions((current) => current.filter((session) => normalizePath(session.cwd || "") !== normalized));
  }

  function pinWorkspaceFolder(cwd: string) {
    const normalized = normalizePath(cwd);
    setWorkspacePaths((current) => {
      const target = current.find((item) => normalizePath(item) === normalized) ?? cwd;
      return [target, ...current.filter((item) => normalizePath(item) !== normalized)];
    });
  }


  async function updateSettings(update: PiSettingsUpdate) {
    try {
      const nextSettings = await client.updateSettings(update);
      setSettings(nextSettings);
      setError(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  function appendCommandFeedback(id: string, commandName: string, state: CommandFeedbackState, detail?: string) {
    const content = commandFeedbackContent(commandName, state, detail);
    setMessages((current) => {
      const nextMessage: PiMessage = {
        id,
        role: "custom",
        customType: state === "running" ? "command" : state === "done" ? "command done" : state === "timeout" ? "command pending" : "command error",
        content,
        createdAt: new Date().toISOString(),
      };
      return current.some((message) => message.id === id) ? current.map((message) => (message.id === id ? { ...message, ...nextMessage, createdAt: message.createdAt } : message)) : [...current, nextMessage];
    });
  }

  async function executeCommand(commandName: string, safetyEvent?: PiSafetyEvent) {
    const normalizedName = commandName.replace(/^\//, "");
    const feedbackId = `command-${normalizedName}-${Date.now()}`;
    appendCommandFeedback(feedbackId, normalizedName, "running");
    try {
      setError(null);
      if (safetyEvent) {
        await client.recordSafetyEvent(safetyEvent);
        dispatchPanel({ type: "upsertSafetyEvent", event: safetyEvent });
      }
      await client.executeCommand(normalizedName);
      appendCommandFeedback(feedbackId, normalizedName, "done");
      await refresh();
    } catch (caught) {
      if (normalizedName === "compact" && isRpcTimeoutError(caught)) {
        appendCommandFeedback(feedbackId, normalizedName, "timeout");
        void refresh();
        return;
      }
      appendCommandFeedback(feedbackId, normalizedName, "error", errorMessage(caught, t("hook.unknownError")));
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function recordSafetyEvent(event: PiSafetyEvent) {
    try {
      await client.recordSafetyEvent(event);
      dispatchPanel({ type: "upsertSafetyEvent", event });
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function respondExtensionUi(response: PiExtensionUiResponse) {
    try {
      setPendingExtensionUi((current) => markPendingExtensionMessage(current, response.id, "submitting"));
      await client.respondExtensionUi(response);
      setPendingExtensionUi((current) => removePendingExtensionMessage(current, response.id));
      setError(null);
    } catch (caught) {
      const message = errorMessage(caught, t("hook.unknownError"));
      setPendingExtensionUi((current) => markPendingExtensionMessage(current, response.id, "failed", message));
      setError(message);
      setStatus("error");
      throw new Error(message);
    }
  }

  async function previewFile(path: string) {
    try {
      setError(null);
      const preview = await client.readFile(path);
      dispatchPanel({ type: "setFilePreview", preview });
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function loadFiles(path?: string) {
    try {
      setError(null);
      const nextFiles = await client.listFiles(path ? { path, depth: 1, limit: 80 } : { depth: 1, limit: 80 });
      if (!path) {
        dispatchPanel({ type: "setFiles", files: nextFiles });
        return;
      }
      dispatchPanel({ type: "mergeFiles", parentPath: path, files: nextFiles });
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  function clearPrefillInput() {
    dispatchPanel({ type: "setPrefillInput", value: "" });
  }

  function clearError() {
    setError(null);
    setStatus((current) => (current === "error" ? "ready" : current));
  }

  return {
    messages,
    state,
    stats,
    sessions,
    workspacePaths,
    models,
    settings,
    commands,
    extensionPanels: panelState.extensionPanels,
    extensionStatuses: panelState.extensionStatuses,
    extensionMessages: panelState.extensionMessages,
    pendingExtensionUi,
    extensionErrors: panelState.extensionErrors,
    safetyEvents: panelState.safetyEvents,
    files: panelState.files,
    filePreview: panelState.filePreview,
    prefillInput: panelState.prefillInput,
    status,
    error,
    isConnecting: status === "connecting",
    isRefreshing: status === "refreshing",
    isSwitchingSession,
    pendingSessionTarget,
    isRunning: status === "running" || state?.runState === "running",
    prompt,
    abort,
    steer,
    followUp,
    newSession,
    continueRecent,
    switchSession,
    setSessionName,
    deleteSession,
    exportHtml,
    openWorkspaceFolder,
    removeWorkspaceFolder,
    pinWorkspaceFolder,
    updateSettings,
    executeCommand,
    recordSafetyEvent,
    respondExtensionUi,
    previewFile,
    loadFiles,
    clearPrefillInput,
    clearError,
    refresh,
  };
}
