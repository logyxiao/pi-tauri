import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPiClient } from "@/shared/pi/create-client";
import { useI18n } from "@/shared/i18n";
import type { PiClientEvent } from "@/shared/pi/client";
import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiExtensionUiResponse,
  PiFileEntry,
  PiFilePreview,
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

const WORKSPACE_PATHS_STORAGE_KEY = "pi-tauri.workspacePaths";
const SESSION_CACHE_STORAGE_KEY = "pi-tauri.sessions.cache";
const SESSION_MESSAGES_CACHE_PREFIX = "pi-tauri.sessionMessages.";
const SETTINGS_CACHE_STORAGE_KEY = "pi-tauri.settings.cache";

const nowLabel = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/$/, "");
}

function normalizeSessionKey(path: string) {
  return normalizePath(path).toLowerCase();
}

function isDeletedSession(session: PiSessionSummary, deletedKeys: Set<string>) {
  return Boolean(
    (session.filePath && deletedKeys.has(normalizeSessionKey(session.filePath))) ||
    (session.id && deletedKeys.has(normalizeSessionKey(session.id))),
  );
}

function filterDeletedSessions(sessions: PiSessionSummary[], deletedKeys: Set<string>) {
  if (!deletedKeys.size) return sessions;
  return sessions.filter((session) => !isDeletedSession(session, deletedKeys));
}

function mergeSessions(...groups: PiSessionSummary[][]): PiSessionSummary[] {
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

function isLowQualitySessionSummary(session: PiSessionSummary): boolean {
  return session.name === "Current session" || !session.cwd || session.cwd.toLowerCase() === "unknown cwd" || session.updatedAt === "current";
}

function isKnownCwd(cwd: string | undefined): cwd is string {
  return Boolean(cwd && cwd !== "unknown cwd" && cwd !== "Unknown cwd");
}

function findSessionByPath(sessions: PiSessionSummary[], sessionPath: string) {
  const target = normalizeSessionKey(sessionPath);
  return sessions.find((session) => normalizeSessionKey(session.filePath ?? session.id) === target || normalizeSessionKey(session.id) === target);
}

function applySessionOverride(state: PiState, session: PiSessionSummary | null): PiState {
  if (!session) return state;
  return {
    ...state,
    cwd: isKnownCwd(session.cwd) ? session.cwd : state.cwd,
    sessionFile: session.filePath ?? state.sessionFile,
    sessionId: session.id ?? state.sessionId,
    sessionName: session.name ?? state.sessionName,
  };
}

function loadPersistedWorkspacePaths(): string[] {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PATHS_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return Array.from(new Map(value.filter((item): item is string => typeof item === "string" && item.trim()).map((item) => [normalizePath(item), item.trim()])).values());
  } catch {
    return [];
  }
}

function persistWorkspacePaths(paths: string[]) {
  try {
    window.localStorage.setItem(WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // Ignore storage failures; workspace can still be opened for current run.
  }
}

function clearSessionCache() {
  try {
    window.localStorage.removeItem(SESSION_CACHE_STORAGE_KEY);
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(SESSION_MESSAGES_CACHE_PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
  }
}

function loadPersistedSessions(): PiSessionSummary[] {
  return [];
}

function persistSessions(sessions: PiSessionSummary[]) {
  try {
    const durableSessions = sessions.filter((session) => session.filePath && !isLowQualitySessionSummary(session));
    window.localStorage.setItem(SESSION_CACHE_STORAGE_KEY, JSON.stringify(durableSessions.slice(0, 200)));
    for (const session of sessions) {
      if (!session.filePath) continue;
      const cached = loadPersistedSessionMessages(session.filePath);
      if (cached.length) continue;
      window.localStorage.setItem(sessionMessagesCacheKey(session.filePath), JSON.stringify([]));
    }
  } catch {
    // Cache only; ignore storage failures.
  }
}

function sessionMessagesCacheKey(sessionPath: string): string {
  return `${SESSION_MESSAGES_CACHE_PREFIX}${encodeURIComponent(normalizePath(sessionPath))}`;
}

function loadPersistedSessionMessages(sessionPath: string): PiMessage[] {
  try {
    const raw = window.localStorage.getItem(sessionMessagesCacheKey(sessionPath));
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value.filter(isMessageLike).slice(-200);
  } catch {
    return [];
  }
}

function persistSessionMessages(sessionPath: string, messages: PiMessage[]) {
  try {
    window.localStorage.setItem(sessionMessagesCacheKey(sessionPath), JSON.stringify(messages.slice(-200)));
  } catch {
    // Cache only; ignore storage failures.
  }
}

function loadPersistedSettings(): PiSettings | null {
  try {
    const raw = window.localStorage.getItem(SETTINGS_CACHE_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return isSettingsLike(value) ? value : null;
  } catch {
    return null;
  }
}

function persistSettings(settings: PiSettings | null) {
  if (!settings) return;
  try {
    window.localStorage.setItem(SETTINGS_CACHE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Cache only; ignore storage failures.
  }
}

function persistMessagesForState(state: PiState | null, messages: PiMessage[]) {
  const sessionPath = state?.sessionFile ?? state?.sessionId;
  if (!sessionPath || !messages.length) return;
  persistSessionMessages(sessionPath, messages);
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

function isSessionSummaryLike(value: unknown): value is PiSessionSummary {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return typeof session.id === "string" && typeof session.name === "string" && typeof session.cwd === "string";
}

function isSettingsLike(value: unknown): value is PiSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Record<string, unknown>;
  return typeof settings.model === "string" && typeof settings.provider === "string" && typeof settings.cwd === "string";
}

interface TimingEntry {
  step: string;
  ms: number;
  ok: boolean;
}

async function timed<T>(entries: TimingEntry[], step: string, task: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await task();
    entries.push({ step, ms: Math.round(performance.now() - startedAt), ok: true });
    return result;
  } catch (error) {
    entries.push({ step, ms: Math.round(performance.now() - startedAt), ok: false });
    throw error;
  }
}

function logTimings(scope: string, entries: TimingEntry[], totalStartedAt: number) {
  const totalMs = Math.round(performance.now() - totalStartedAt);
  const rows = [...entries, { step: "total", ms: totalMs, ok: true }];
  const slowest = [...entries].sort((left, right) => right.ms - left.ms).slice(0, 3);
  const summary = slowest.map((entry) => `${entry.step}=${entry.ms}ms`).join(", ");
  console.info(`[pi-tauri timing] ${scope}: ${totalMs}ms${summary ? ` | slowest: ${summary}` : ""}`);
  console.table(rows);
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
  useEffect(() => clearSessionCache(), []);
  const [messages, setMessages] = useState<PiMessage[]>([]);
  const [state, setState] = useState<PiState | null>(null);
  const [stats, setStats] = useState<PiSessionStats | null>(null);
  const [sessions, setSessions] = useState<PiSessionSummary[]>(() => loadPersistedSessions());
  const [workspacePaths, setWorkspacePaths] = useState<string[]>(() => loadPersistedWorkspacePaths());
  const [models, setModels] = useState<PiModel[]>([]);
  const [settings, setSettings] = useState<PiSettings | null>(() => loadPersistedSettings());
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [extensionPanels, setExtensionPanels] = useState<PiExtensionPanel[]>([]);
  const [extensionMessages, setExtensionMessages] = useState<PiExtensionMessage[]>([]);
  const [pendingExtensionUi, setPendingExtensionUi] = useState<PiExtensionMessage[]>([]);
  const [extensionErrors, setExtensionErrors] = useState<PiExtensionError[]>([]);
  const [safetyEvents, setSafetyEvents] = useState<PiSafetyEvent[]>([]);
  const [files, setFiles] = useState<PiFileEntry[]>([]);
  const [filePreview, setFilePreview] = useState<PiFilePreview | null>(null);
  const [prefillInput, setPrefillInput] = useState("");
  const [status, setStatus] = useState<PiSessionStatus>("connecting");
  const [isSwitchingSession, setIsSwitchingSession] = useState(false);
  const [pendingSessionTarget, setPendingSessionTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const activeSessionOverrideRef = useRef<PiSessionSummary | null>(null);
  const deletedSessionKeysRef = useRef<Set<string>>(new Set());
  const typewriterQueueRef = useRef("");
  const typewriterTimerRef = useRef<number | null>(null);

  const stopTypewriter = useCallback(() => {
    if (typewriterTimerRef.current !== null) {
      window.clearTimeout(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
    typewriterQueueRef.current = "";
  }, []);

  const scheduleTypewriter = useCallback(() => {
    if (typewriterTimerRef.current !== null) return;
    typewriterTimerRef.current = window.setTimeout(() => {
      typewriterTimerRef.current = null;
      const assistantId = activeAssistantIdRef.current;
      if (!assistantId || !typewriterQueueRef.current) return;
      const chunkSize = typewriterQueueRef.current.length > 240 ? 8 : 3;
      const chunk = typewriterQueueRef.current.slice(0, chunkSize);
      typewriterQueueRef.current = typewriterQueueRef.current.slice(chunk.length);
      setMessages((current) =>
        current.map((message) => (message.id === assistantId ? { ...message, content: `${message.content}${chunk}` } : message)),
      );
      if (typewriterQueueRef.current) scheduleTypewriter();
    }, 18);
  }, []);

  const enqueueTypewriterDelta = useCallback((delta: string) => {
    if (!delta) return;
    typewriterQueueRef.current += delta;
    scheduleTypewriter();
  }, [scheduleTypewriter]);

  const flushTypewriter = useCallback(() => {
    const assistantId = activeAssistantIdRef.current;
    const queued = typewriterQueueRef.current;
    stopTypewriter();
    if (!assistantId || !queued) return;
    setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, content: `${message.content}${queued}` } : message)));
  }, [stopTypewriter]);

  useEffect(() => () => stopTypewriter(), [stopTypewriter]);

  useEffect(() => {
    persistWorkspacePaths(workspacePaths);
  }, [workspacePaths]);

  useEffect(() => {
    persistSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

  useEffect(() => {
    const sessionPath = state?.sessionFile ?? state?.sessionId;
    if (!sessionPath || !messages.length) return;
    persistSessionMessages(sessionPath, messages);
  }, [messages, state?.sessionFile, state?.sessionId]);

  const ensureLiveAssistantMessage = useCallback(() => {
    const existingId = activeAssistantIdRef.current;
    if (existingId) {
      setMessages((current) => current.some((message) => message.id === existingId) ? current : [...current, { id: existingId, role: "assistant", content: "", createdAt: nowLabel(), tools: [] }]);
      return existingId;
    }

    const assistantId = crypto.randomUUID();
    activeAssistantIdRef.current = assistantId;
    setMessages((current) => [...current, { id: assistantId, role: "assistant", content: "", createdAt: nowLabel(), tools: [] }]);
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
      for (const session of workspaceSessions.slice(0, 20)) {
        if (session.filePath) void warmSessionCache(session.filePath);
      }
      logTimings("workspaceSessions.refresh", timings, totalStartedAt);
    } catch {
      logTimings("workspaceSessions.refresh: failed", timings, totalStartedAt);
    }
  }, [client, workspacePaths]);

  const refresh = useCallback(async (scope = "refresh") => {
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
        nextExtensionMessages,
        nextExtensionErrors,
        nextSafetyEvents,
        nextFiles,
      ] = await Promise.all([
        timed(timings, "getMessages", () => client.getMessages()),
        timed(timings, "getState", () => client.getState()),
        timed(timings, "getSessionStats", () => client.getSessionStats()),
        timed(timings, "listSessions.current", () => client.listSessions()),
        timed(timings, "listModels", () => client.listModels()),
        timed(timings, "getSettings", () => client.getSettings()),
        timed(timings, "listCommands", () => client.listCommands()),
        timed(timings, "listExtensionPanels", () => client.listExtensionPanels()),
        timed(timings, "listExtensionMessages", () => client.listExtensionMessages()),
        timed(timings, "listExtensionErrors", () => client.listExtensionErrors()),
        timed(timings, "listSafetyEvents", () => client.listSafetyEvents()),
        timed(timings, "listFiles", () => client.listFiles()),
      ]);
      if (!activeAssistantIdRef.current) {
        setMessages(nextMessages);
        persistMessagesForState(nextState, nextMessages);
      }
      setState((current) => {
        const mergedState = applySessionOverride(nextState, activeSessionOverrideRef.current);
        return activeAssistantIdRef.current ? { ...(current ?? mergedState), ...mergedState, runState: "running" } : mergedState;
      });
      setStats(nextStats);
      setSessions((current) => filterDeletedSessions(mergeSessions(current, nextSessions), deletedSessionKeysRef.current));
      setModels(nextModels);
      setSettings(nextSettings);
      setCommands(nextCommands);
      setExtensionPanels(nextExtensionPanels);
      setExtensionMessages(nextExtensionMessages);
      setExtensionErrors(nextExtensionErrors);
      setSafetyEvents(nextSafetyEvents);
      setFiles(nextFiles);
      setError(null);
      setStatus(activeAssistantIdRef.current || nextState.runState === "running" ? "running" : "ready");
      logTimings(scope, timings, totalStartedAt);
      if (scope.startsWith("startup")) void refreshWorkspaceSessions();
    } catch (caught) {
      logTimings(`${scope}: failed`, timings, totalStartedAt);
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }, [client, refreshWorkspaceSessions, t]);

  const upsertTool = useCallback((tool: PiToolCall) => {
    const assistantId = ensureLiveAssistantMessage();
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== assistantId) return message;
        const tools = message.tools ?? [];
        const exists = tools.some((item) => item.id === tool.id);
        return {
          ...message,
          tools: exists ? tools.map((item) => (item.id === tool.id ? tool : item)) : [...tools, tool],
        };
      }),
    );
  }, [ensureLiveAssistantMessage]);

  const handleEvent = useCallback(
    (event: PiClientEvent) => {
      if (event.type === "agent_start") {
        stopTypewriter();
        ensureLiveAssistantMessage();
        setStatus("running");
        setError(null);
        setState((current) => (current ? { ...current, runState: "running" } : current));
        return;
      }

      if (event.type === "message_update") {
        const assistantId = ensureLiveAssistantMessage();
        if (event.delta) {
          enqueueTypewriterDelta(event.delta);
          return;
        }
        stopTypewriter();
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== assistantId) return message;
            if (event.message) {
              return {
                ...message,
                ...event.message,
                id: message.id,
                createdAt: message.createdAt,
                content: event.message.content,
                tools: message.tools,
              };
            }
            return message;
          }),
        );
        return;
      }

      if (
        event.type === "tool_execution_start" ||
        event.type === "tool_execution_update" ||
        event.type === "tool_execution_end"
      ) {
        upsertTool(event.tool);
        if (event.tool.safety) void refresh();
        return;
      }

      if (event.type === "extension_error") {
        setExtensionErrors((current) => [event.error, ...current.filter((item) => item.id !== event.error.id)].slice(0, 30));
        return;
      }

      if (event.type === "extension_ui_request") {
        setExtensionMessages((current) => [event.message, ...current.filter((item) => item.id !== event.message.id)].slice(0, 40));
        if (event.message.expectsResponse) {
          setPendingExtensionUi((current) => [...current.filter((item) => item.id !== event.message.id), event.message]);
        }
        if (event.panel) {
          setExtensionPanels((current) => {
            const next = current.filter((item) => item.key !== event.panel?.key);
            return event.panel?.lines.length ? [event.panel, ...next].slice(0, 12) : next;
          });
        }
        if (event.editorText) setPrefillInput(event.editorText);
        return;
      }

      if (event.type === "agent_end" || event.type === "aborted") {
        flushTypewriter();
        setStatus("ready");
        setState((current) => (current ? { ...current, runState: "idle" } : current));
        activeAssistantIdRef.current = null;
        void refresh();
      }
    },
    [enqueueTypewriterDelta, ensureLiveAssistantMessage, flushTypewriter, refresh, stopTypewriter, upsertTool],
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

    const userMessage: PiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: nowLabel(),
    };
    stopTypewriter();
    const assistantId = crypto.randomUUID();
    activeAssistantIdRef.current = assistantId;
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "", createdAt: nowLabel(), tools: [] }]);
    setStatus("running");
    setState((current) => (current ? { ...current, runState: "running" } : current));
    setError(null);

    try {
      await client.prompt(trimmed);
    } catch (caught) {
      activeAssistantIdRef.current = null;
      stopTypewriter();
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

  async function newSession() {
    try {
      activeSessionOverrideRef.current = null;
      await client.newSession();
      activeAssistantIdRef.current = null;
      setMessages([]);
      setFilePreview(null);
      setError(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function continueRecent() {
    try {
      activeSessionOverrideRef.current = null;
      await client.continueRecent();
      activeAssistantIdRef.current = null;
      setFilePreview(null);
      setError(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function warmSessionCache(sessionPath: string) {
    try {
      const cached = loadPersistedSessionMessages(sessionPath);
      if (cached.length) return;
      const messages = await client.readSessionMessages(sessionPath);
      if (messages.length) persistSessionMessages(sessionPath, messages);
    } catch {
      // Warm cache is best-effort.
    }
  }

  async function warmKnownSessionCaches(limit = 20) {
    const targets = sessions.map((session) => session.filePath).filter((path): path is string => Boolean(path)).slice(0, limit);
    for (const sessionPath of targets) {
      await warmSessionCache(sessionPath);
    }
  }

  async function switchSession(sessionPath: string) {
    const totalStartedAt = performance.now();
    const timings: TimingEntry[] = [];
    const targetSession = findSessionByPath(sessions, sessionPath) ?? null;
    const targetCwd = isKnownCwd(targetSession?.cwd) ? targetSession.cwd : null;
    const cachedMessages = loadPersistedSessionMessages(sessionPath);
    const hasCachedMessages = cachedMessages.length > 0;
    try {
      activeSessionOverrideRef.current = targetSession;
      setPendingSessionTarget(sessionPath);
      setIsSwitchingSession(!hasCachedMessages);
      setStatus("refreshing");
      if (targetCwd) setState((current) => (current ? { ...current, cwd: targetCwd, sessionFile: targetSession?.filePath ?? current.sessionFile, sessionId: targetSession?.id ?? current.sessionId, sessionName: targetSession?.name ?? current.sessionName } : current));
      setMessages(cachedMessages);
      await timed(timings, "switchSession.rpc", () => client.switchSession(sessionPath));

      const [nextMessages, nextState, nextStats, nextSessions] = await Promise.all([
        timed(timings, "switchSession.getMessages", () => client.getMessages()),
        timed(timings, "switchSession.getState", () => client.getState()),
        timed(timings, "switchSession.getSessionStats", () => client.getSessionStats()),
        timed(timings, "switchSession.listSessions.current", () => client.listSessions()),
      ]);

      activeAssistantIdRef.current = null;
      setMessages(nextMessages);
      persistMessagesForState(nextState, nextMessages);
      setState(applySessionOverride(nextState, targetSession));
      setStats(nextStats);
      setSessions((current) => filterDeletedSessions(mergeSessions(current, nextSessions), deletedSessionKeysRef.current));
      setFilePreview(null);
      setError(null);
      setStatus(nextState.runState === "running" ? "running" : "ready");
      setPendingSessionTarget(null);
      logTimings("switchSession.total", timings, totalStartedAt);
      void refresh("switchSession.backgroundRefresh");
    } catch (caught) {
      logTimings("switchSession.total: failed", timings, totalStartedAt);
      setPendingSessionTarget(null);
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    } finally {
      setIsSwitchingSession(false);
    }
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
      try {
        window.localStorage.removeItem(sessionMessagesCacheKey(sessionPath));
      } catch {
        // Ignore storage failures.
      }
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

  async function executeCommand(commandName: string, safetyEvent?: PiSafetyEvent) {
    try {
      setError(null);
      if (safetyEvent) {
        await client.recordSafetyEvent(safetyEvent);
        setSafetyEvents((current) => [safetyEvent, ...current.filter((item) => item.id !== safetyEvent.id)].slice(0, 20));
      }
      await client.executeCommand(commandName);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function recordSafetyEvent(event: PiSafetyEvent) {
    try {
      await client.recordSafetyEvent(event);
      setSafetyEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 20));
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  async function respondExtensionUi(response: PiExtensionUiResponse) {
    try {
      await client.respondExtensionUi(response);
      setPendingExtensionUi((current) => current.filter((item) => item.id !== response.id));
      setError(null);
    } catch (caught) {
      const message = errorMessage(caught, t("hook.unknownError"));
      setError(message);
      setStatus("error");
      throw new Error(message);
    }
  }

  async function previewFile(path: string) {
    try {
      setError(null);
      const preview = await client.readFile(path);
      setFilePreview(preview);
    } catch (caught) {
      setError(errorMessage(caught, t("hook.unknownError")));
      setStatus("error");
    }
  }

  function clearPrefillInput() {
    setPrefillInput("");
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
    extensionPanels,
    extensionMessages,
    pendingExtensionUi,
    extensionErrors,
    safetyEvents,
    files,
    filePreview,
    prefillInput,
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
    updateSettings,
    executeCommand,
    recordSafetyEvent,
    respondExtensionUi,
    previewFile,
    clearPrefillInput,
    clearError,
    refresh,
  };
}
