import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPiClient } from "@/shared/pi/create-client";
import type { PiClientEvent } from "@/shared/pi/client";
import type {
  PiCommand,
  PiExtensionError,
  PiExtensionMessage,
  PiExtensionPanel,
  PiFileEntry,
  PiFilePreview,
  PiMessage,
  PiModel,
  PiForkMessage,
  PiSafetyEvent,
  PiSessionStats,
  PiSessionSummary,
  PiSessionTree,
  PiSettings,
  PiSettingsUpdate,
  PiState,
  PiToolCall,
} from "@/shared/pi/types";

export type PiSessionStatus = "connecting" | "ready" | "refreshing" | "running" | "error";

const nowLabel = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown pi client error";
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/$/, "");
}

function mergeSessions(...groups: PiSessionSummary[][]): PiSessionSummary[] {
  const merged = new Map<string, PiSessionSummary>();
  for (const group of groups) {
    for (const session of group) {
      merged.set(session.filePath ?? session.id, session);
    }
  }
  return Array.from(merged.values());
}

async function pickWorkspaceFolder(): Promise<string | null> {
  if ("__TAURI_INTERNALS__" in window) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false, title: "Open workspace folder" });
    return typeof selected === "string" ? selected : null;
  }
  return window.prompt("Workspace folder path")?.trim() || null;
}

export function usePiSession() {
  const client = useMemo(() => createPiClient(), []);
  const [messages, setMessages] = useState<PiMessage[]>([]);
  const [state, setState] = useState<PiState | null>(null);
  const [stats, setStats] = useState<PiSessionStats | null>(null);
  const [sessionTree, setSessionTree] = useState<PiSessionTree | null>(null);
  const [forkMessages, setForkMessages] = useState<PiForkMessage[]>([]);
  const [sessions, setSessions] = useState<PiSessionSummary[]>([]);
  const [workspacePaths, setWorkspacePaths] = useState<string[]>([]);
  const [models, setModels] = useState<PiModel[]>([]);
  const [settings, setSettings] = useState<PiSettings | null>(null);
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [extensionPanels, setExtensionPanels] = useState<PiExtensionPanel[]>([]);
  const [extensionMessages, setExtensionMessages] = useState<PiExtensionMessage[]>([]);
  const [extensionErrors, setExtensionErrors] = useState<PiExtensionError[]>([]);
  const [safetyEvents, setSafetyEvents] = useState<PiSafetyEvent[]>([]);
  const [files, setFiles] = useState<PiFileEntry[]>([]);
  const [filePreview, setFilePreview] = useState<PiFilePreview | null>(null);
  const [prefillInput, setPrefillInput] = useState("");
  const [status, setStatus] = useState<PiSessionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus((current) => (current === "connecting" || current === "running" ? current : "refreshing"));
    try {
      const [
        nextMessages,
        nextState,
        nextStats,
        nextTree,
        nextForkMessages,
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
        client.getMessages(),
        client.getState(),
        client.getSessionStats(),
        client.getSessionTree().catch(() => ({ nodes: [] })),
        client.getForkMessages().catch(() => []),
        client.listSessions(),
        client.listModels(),
        client.getSettings(),
        client.listCommands(),
        client.listExtensionPanels(),
        client.listExtensionMessages(),
        client.listExtensionErrors(),
        client.listSafetyEvents(),
        client.listFiles(),
      ]);
      setMessages(nextMessages);
      setState(nextState);
      const workspaceSessions = workspacePaths.length
        ? (await Promise.all(workspacePaths.map((cwd) => client.listSessions({ cwd })))).flat()
        : [];
      setStats(nextStats);
      setSessionTree(nextTree);
      setForkMessages(nextForkMessages);
      setSessions(mergeSessions(nextSessions, workspaceSessions));
      setModels(nextModels);
      setSettings(nextSettings);
      setCommands(nextCommands);
      setExtensionPanels(nextExtensionPanels);
      setExtensionMessages(nextExtensionMessages);
      setExtensionErrors(nextExtensionErrors);
      setSafetyEvents(nextSafetyEvents);
      setFiles(nextFiles);
      setError(null);
      setStatus(nextState.runState === "running" ? "running" : "ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }, [client, workspacePaths]);

  const upsertTool = useCallback((tool: PiToolCall) => {
    const assistantId = activeAssistantIdRef.current;
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
  }, []);

  const handleEvent = useCallback(
    (event: PiClientEvent) => {
      if (event.type === "agent_start") {
        const assistantId = crypto.randomUUID();
        activeAssistantIdRef.current = assistantId;
        setStatus("running");
        setError(null);
        setState((current) => (current ? { ...current, runState: "running" } : current));
        setMessages((current) => [
          ...current,
          { id: assistantId, role: "assistant", content: "", createdAt: nowLabel(), tools: [] },
        ]);
        return;
      }

      if (event.type === "message_update") {
        const assistantId = activeAssistantIdRef.current;
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: `${message.content}${event.delta}` } : message,
          ),
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
        setStatus("ready");
        setState((current) => (current ? { ...current, runState: "idle" } : current));
        activeAssistantIdRef.current = null;
        void refresh();
      }
    },
    [refresh, upsertTool],
  );

  useEffect(() => {
    let disposed = false;
    const unsubscribe = client.subscribe(handleEvent);

    async function connect() {
      setStatus("connecting");
      try {
        await client.connect();
        if (disposed) return;
        await refresh();
      } catch (caught) {
        if (disposed) return;
        setError(errorMessage(caught));
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
    setMessages((current) => [...current, userMessage]);
    setError(null);

    try {
      await client.prompt(trimmed);
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function abort() {
    try {
      await client.abort();
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function newSession() {
    try {
      await client.newSession();
      activeAssistantIdRef.current = null;
      setMessages([]);
      setFilePreview(null);
      setError(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function continueRecent() {
    try {
      await client.continueRecent();
      activeAssistantIdRef.current = null;
      setFilePreview(null);
      setError(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function switchSession(sessionPath: string) {
    try {
      await client.switchSession(sessionPath);
      activeAssistantIdRef.current = null;
      setFilePreview(null);
      setError(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function setSessionName(name: string) {
    try {
      await client.setSessionName(name);
      setError(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function deleteSession(sessionPath: string) {
    try {
      await client.deleteSession(sessionPath);
      setError(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function exportHtml() {
    try {
      const outputPath = await client.exportHtml();
      setError(null);
      await refresh();
      return outputPath;
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
      return null;
    }
  }

  async function openWorkspaceFolder() {
    try {
      setError(null);
      const folder = await pickWorkspaceFolder();
      if (!folder) return;
      const nextSessions = await client.listSessions({ cwd: folder });
      setWorkspacePaths((current) => (current.some((item) => normalizePath(item) === normalizePath(folder)) ? current : [...current, folder]));
      setSessions((current) => mergeSessions(current, nextSessions));
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function forkSession(entryId: string) {
    try {
      const result = await client.forkSession(entryId);
      activeAssistantIdRef.current = null;
      setFilePreview(null);
      setError(result.cancelled ? "Fork cancelled by extension." : null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function cloneSession() {
    try {
      const result = await client.cloneSession();
      activeAssistantIdRef.current = null;
      setFilePreview(null);
      setError(result.cancelled ? "Clone cancelled by extension." : null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function setSessionEntryLabel(entryId: string, label?: string) {
    try {
      await client.setSessionEntryLabel(entryId, label);
      setError(null);
      setSessionTree(await client.getSessionTree().catch(() => ({ nodes: [] })));
    } catch (caught) {
      setError(errorMessage(caught));
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
      setError(errorMessage(caught));
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
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function recordSafetyEvent(event: PiSafetyEvent) {
    try {
      await client.recordSafetyEvent(event);
      setSafetyEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 20));
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }

  async function previewFile(path: string) {
    try {
      setError(null);
      const preview = await client.readFile(path);
      setFilePreview(preview);
    } catch (caught) {
      setError(errorMessage(caught));
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
    sessionTree,
    forkMessages,
    sessions,
    workspacePaths,
    models,
    settings,
    commands,
    extensionPanels,
    extensionMessages,
    extensionErrors,
    safetyEvents,
    files,
    filePreview,
    prefillInput,
    status,
    error,
    isConnecting: status === "connecting",
    isRefreshing: status === "refreshing",
    isRunning: status === "running" || state?.runState === "running",
    prompt,
    abort,
    newSession,
    continueRecent,
    switchSession,
    setSessionName,
    deleteSession,
    exportHtml,
    openWorkspaceFolder,
    forkSession,
    cloneSession,
    setSessionEntryLabel,
    updateSettings,
    executeCommand,
    recordSafetyEvent,
    previewFile,
    clearPrefillInput,
    clearError,
    refresh,
  };
}
