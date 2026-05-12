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
  PiSafetyEvent,
  PiSessionStats,
  PiSettings,
  PiSettingsUpdate,
  PiState,
  PiToolCall,
} from "@/shared/pi/types";

const nowLabel = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function usePiSession() {
  const client = useMemo(() => createPiClient(), []);
  const [messages, setMessages] = useState<PiMessage[]>([]);
  const [state, setState] = useState<PiState | null>(null);
  const [stats, setStats] = useState<PiSessionStats | null>(null);
  const [models, setModels] = useState<PiModel[]>([]);
  const [settings, setSettings] = useState<PiSettings | null>(null);
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [extensionPanels, setExtensionPanels] = useState<PiExtensionPanel[]>([]);
  const [extensionMessages, setExtensionMessages] = useState<PiExtensionMessage[]>([]);
  const [extensionErrors, setExtensionErrors] = useState<PiExtensionError[]>([]);
  const [files, setFiles] = useState<PiFileEntry[]>([]);
  const [filePreview, setFilePreview] = useState<PiFilePreview | null>(null);
  const [prefillInput, setPrefillInput] = useState("");
  const [safetyEvents, setSafetyEvents] = useState<PiSafetyEvent[]>([]);
  const activeAssistantIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const [
      nextMessages,
      nextState,
      nextStats,
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
    setStats(nextStats);
    setModels(nextModels);
    setSettings(nextSettings);
    setCommands(nextCommands);
    setExtensionPanels(nextExtensionPanels);
    setExtensionMessages(nextExtensionMessages);
    setExtensionErrors(nextExtensionErrors);
    setSafetyEvents(nextSafetyEvents);
    setFiles(nextFiles);
  }, [client]);

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
        setState((current) => (current ? { ...current, runState: "idle" } : current));
        activeAssistantIdRef.current = null;
        void refresh();
      }
    },
    [refresh, upsertTool],
  );

  useEffect(() => {
    void client.connect().then(refresh);
    return client.subscribe(handleEvent);
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
    await client.prompt(trimmed);
  }

  async function abort() {
    await client.abort();
  }

  async function newSession() {
    await client.newSession();
    activeAssistantIdRef.current = null;
    setMessages([]);
    await refresh();
  }

  async function updateSettings(update: PiSettingsUpdate) {
    const nextSettings = await client.updateSettings(update);
    setSettings(nextSettings);
    await refresh();
  }

  async function executeCommand(commandName: string, safetyEvent?: PiSafetyEvent) {
    if (safetyEvent) {
      await client.recordSafetyEvent(safetyEvent);
      setSafetyEvents((current) => [safetyEvent, ...current.filter((item) => item.id !== safetyEvent.id)].slice(0, 20));
    }
    await client.executeCommand(commandName);
    await refresh();
  }

  async function recordSafetyEvent(event: PiSafetyEvent) {
    await client.recordSafetyEvent(event);
    setSafetyEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 20));
  }

  async function previewFile(path: string) {
    const preview = await client.readFile(path);
    setFilePreview(preview);
  }

  function clearPrefillInput() {
    setPrefillInput("");
  }

  return {
    messages,
    state,
    stats,
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
    isRunning: state?.runState === "running",
    prompt,
    abort,
    newSession,
    updateSettings,
    executeCommand,
    recordSafetyEvent,
    previewFile,
    clearPrefillInput,
    refresh,
  };
}
