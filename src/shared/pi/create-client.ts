import type { PiClient } from "./client";
import { mockPiClient } from "./mock-client";
import { tauriPiRpcClient } from "./tauri-rpc-client";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function createPiClient(): PiClient {
  const forced = import.meta.env.VITE_PI_CLIENT;
  if (forced === "mock") return mockPiClient;
  if (forced === "tauri") return tauriPiRpcClient;

  return window.__TAURI_INTERNALS__ ? tauriPiRpcClient : mockPiClient;
}
