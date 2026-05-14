import type { PiExtensionError, PiExtensionMessage, PiExtensionPanel, PiExtensionStatus, PiFileEntry, PiFilePreview, PiSafetyEvent } from "@/shared/pi/types";

export interface SessionPanelState {
  extensionPanels: PiExtensionPanel[];
  extensionStatuses: PiExtensionStatus[];
  extensionMessages: PiExtensionMessage[];
  extensionErrors: PiExtensionError[];
  safetyEvents: PiSafetyEvent[];
  files: PiFileEntry[];
  filePreview: PiFilePreview | null;
  prefillInput: string;
}

export type SessionPanelAction =
  | { type: "setExtensionPanels"; panels: PiExtensionPanel[] }
  | { type: "setExtensionStatuses"; statuses: PiExtensionStatus[] }
  | { type: "setExtensionMessages"; messages: PiExtensionMessage[] }
  | { type: "setExtensionErrors"; errors: PiExtensionError[] }
  | { type: "upsertExtensionError"; error: PiExtensionError }
  | { type: "upsertExtensionMessage"; message: PiExtensionMessage }
  | { type: "upsertExtensionPanel"; panel: PiExtensionPanel }
  | { type: "upsertExtensionStatus"; status: PiExtensionStatus }
  | { type: "setSafetyEvents"; events: PiSafetyEvent[] }
  | { type: "upsertSafetyEvent"; event: PiSafetyEvent }
  | { type: "setFiles"; files: PiFileEntry[] }
  | { type: "mergeFiles"; parentPath: string; files: PiFileEntry[] }
  | { type: "setFilePreview"; preview: PiFilePreview | null }
  | { type: "setPrefillInput"; value: string };

export const initialSessionPanelState: SessionPanelState = {
  extensionPanels: [],
  extensionStatuses: [],
  extensionMessages: [],
  extensionErrors: [],
  safetyEvents: [],
  files: [],
  filePreview: null,
  prefillInput: "",
};

export function sessionPanelReducer(state: SessionPanelState, action: SessionPanelAction): SessionPanelState {
  switch (action.type) {
    case "setExtensionPanels":
      return { ...state, extensionPanels: action.panels };
    case "setExtensionStatuses":
      return { ...state, extensionStatuses: action.statuses };
    case "setExtensionMessages":
      return { ...state, extensionMessages: action.messages };
    case "setExtensionErrors":
      return { ...state, extensionErrors: action.errors };
    case "upsertExtensionError":
      return { ...state, extensionErrors: [action.error, ...state.extensionErrors.filter((item) => item.id !== action.error.id)].slice(0, 30) };
    case "upsertExtensionMessage":
      return { ...state, extensionMessages: [action.message, ...state.extensionMessages.filter((item) => item.id !== action.message.id)].slice(0, 40) };
    case "upsertExtensionPanel": {
      const next = state.extensionPanels.filter((item) => item.key !== action.panel.key);
      return { ...state, extensionPanels: action.panel.lines.length ? [action.panel, ...next].slice(0, 12) : next };
    }
    case "upsertExtensionStatus": {
      const next = state.extensionStatuses.filter((item) => item.key !== action.status.key);
      return { ...state, extensionStatuses: action.status.text ? [action.status, ...next].slice(0, 12) : next };
    }
    case "setSafetyEvents":
      return { ...state, safetyEvents: action.events };
    case "upsertSafetyEvent":
      return { ...state, safetyEvents: [action.event, ...state.safetyEvents.filter((item) => item.id !== action.event.id)].slice(0, 20) };
    case "setFiles":
      return { ...state, files: action.files };
    case "mergeFiles":
      return { ...state, files: mergeLoadedFiles(state.files, action.parentPath, action.files) };
    case "setFilePreview":
      return { ...state, filePreview: action.preview };
    case "setPrefillInput":
      return { ...state, prefillInput: action.value };
  }
}

function mergeLoadedFiles(current: PiFileEntry[], parentPath: string, loaded: PiFileEntry[]): PiFileEntry[] {
  const normalizedParent = normalizePath(parentPath);
  const parent = current.find((entry) => normalizePath(entry.path) === normalizedParent);
  const parentDepth = parent?.depth ?? 0;
  const children = loaded
    .filter((entry) => normalizePath(entry.path) !== normalizedParent)
    .map((entry) => ({ ...entry, depth: parentDepth + 1 + entry.depth }));
  const withoutOldChildren = current.filter((entry) => {
    const normalized = normalizePath(entry.path);
    return !normalized.startsWith(`${normalizedParent}/`);
  });
  const insertAt = Math.max(withoutOldChildren.findIndex((entry) => normalizePath(entry.path) === normalizedParent), 0) + 1;
  return [...withoutOldChildren.slice(0, insertAt), ...children, ...withoutOldChildren.slice(insertAt)];
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/$/, "");
}
