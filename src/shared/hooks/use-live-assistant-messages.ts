import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { appendAssistantDelta, createAssistantMessage, ensureAssistantMessage } from "@/shared/hooks/live-message";
import type { PiMessage } from "@/shared/pi/types";

const nowLabel = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function useLiveAssistantMessages(setMessages: Dispatch<SetStateAction<PiMessage[]>>) {
  const activeAssistantIdRef = useRef<string | null>(null);
  const liveDeltaBufferRef = useRef("");
  const liveDeltaRafRef = useRef<number | null>(null);

  const flushLiveAssistantDelta = useCallback(() => {
    const assistantId = activeAssistantIdRef.current;
    if (!assistantId) return;
    const delta = liveDeltaBufferRef.current;
    if (!delta) return;
    liveDeltaBufferRef.current = "";
    setMessages((current) => appendAssistantDelta(current, assistantId, delta));
  }, [setMessages]);

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
  }, [setMessages]);

  const clearLiveAssistant = useCallback(() => {
    activeAssistantIdRef.current = null;
    clearLiveAssistantDelta();
  }, [clearLiveAssistantDelta]);

  useEffect(() => clearLiveAssistantDelta, [clearLiveAssistantDelta]);

  return {
    activeAssistantIdRef,
    appendDeltaToLiveAssistant,
    clearLiveAssistant,
    clearLiveAssistantDelta,
    ensureLiveAssistantMessage,
    flushLiveAssistantDelta,
  };
}
