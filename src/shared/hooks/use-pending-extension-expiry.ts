import { useEffect, type Dispatch, type SetStateAction } from "react";
import { expirePendingExtensionMessages } from "@/shared/hooks/extension-pending";
import type { PiExtensionMessage } from "@/shared/pi/types";

export function usePendingExtensionExpiry(
  pendingExtensionUi: PiExtensionMessage[],
  setPendingExtensionUi: Dispatch<SetStateAction<PiExtensionMessage[]>>,
) {
  useEffect(() => {
    if (!pendingExtensionUi.some((item) => item.expiresAt && item.uiState !== "expired")) return;
    const timer = window.setInterval(() => {
      setPendingExtensionUi((current) => expirePendingExtensionMessages(current));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [pendingExtensionUi, setPendingExtensionUi]);
}
