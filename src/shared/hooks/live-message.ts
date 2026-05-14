import type { PiMessage, PiToolCall } from "@/shared/pi/types";

export function createAssistantMessage(id: string, createdAt: string): PiMessage {
  return { id, role: "assistant", content: "", createdAt, tools: [] };
}

export function ensureAssistantMessage(messages: PiMessage[], id: string, createdAt: string): PiMessage[] {
  return messages.some((message) => message.id === id) ? messages : [...messages, createAssistantMessage(id, createdAt)];
}

export function appendAssistantDelta(messages: PiMessage[], assistantId: string, delta: string): PiMessage[] {
  if (!delta) return messages;
  return messages.map((message) => (message.id === assistantId ? { ...message, content: `${message.content}${delta}` } : message));
}

export function upsertAssistantTool(
  messages: PiMessage[],
  assistantId: string,
  tool: PiToolCall,
  mergeTool: (current: PiToolCall, next: PiToolCall) => PiToolCall,
): PiMessage[] {
  return messages.map((message) => {
    if (message.id !== assistantId) return message;
    const tools = message.tools ?? [];
    const exists = tools.some((item) => item.id === tool.id);
    return {
      ...message,
      tools: exists ? tools.map((item) => (item.id === tool.id ? mergeTool(item, tool) : item)) : [...tools, tool],
    };
  });
}

export function reconcileFinalMessages(current: PiMessage[], assistantId: string | null, finalMessages: PiMessage[]): PiMessage[] {
  if (!assistantId) return [...current, ...finalMessages];
  const liveMessage = current.find((message) => message.id === assistantId);
  const withoutLive = current.filter((message) => message.id !== assistantId);
  const reconciled = finalMessages.map((message, index) => {
    if (index === 0 && message.role === "assistant") {
      return { ...message, id: assistantId, createdAt: liveMessage?.createdAt ?? message.createdAt, tools: liveMessage?.tools ?? message.tools };
    }
    return message;
  });
  return [...withoutLive, ...reconciled];
}
