import type { PiExtensionMessage } from "@/shared/pi/types";

export type ExtensionUiState = NonNullable<PiExtensionMessage["uiState"]>;

export function toPendingExtensionMessage(message: PiExtensionMessage, now = Date.now()): PiExtensionMessage {
  return {
    ...message,
    uiState: "pending",
    uiError: undefined,
    expiresAt: message.timeoutMs ? now + message.timeoutMs : undefined,
  };
}

export function upsertPendingExtensionMessage(current: PiExtensionMessage[], message: PiExtensionMessage): PiExtensionMessage[] {
  return [...current.filter((item) => item.id !== message.id), toPendingExtensionMessage(message)];
}

export function markPendingExtensionMessage(current: PiExtensionMessage[], id: string, uiState: ExtensionUiState, uiError?: string): PiExtensionMessage[] {
  return current.map((item) => (item.id === id ? { ...item, uiState, uiError } : item));
}

export function removePendingExtensionMessage(current: PiExtensionMessage[], id: string): PiExtensionMessage[] {
  return current.filter((item) => item.id !== id);
}

export function expirePendingExtensionMessages(current: PiExtensionMessage[], now = Date.now()): PiExtensionMessage[] {
  let changed = false;
  const next = current.map((item) => {
    if (item.expiresAt && item.expiresAt <= now && item.uiState !== "expired") {
      changed = true;
      return { ...item, uiState: "expired" as const };
    }
    return item;
  });
  return changed ? next : current;
}
