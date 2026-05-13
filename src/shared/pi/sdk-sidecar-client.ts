import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SdkSidecarErrorKind = "start-failed" | "send-failed" | "timeout" | "method-failed" | "sdk-unavailable";

export class SdkSidecarError extends Error {
  constructor(
    public readonly kind: SdkSidecarErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SdkSidecarError";
  }
}

type SdkSidecarResponse = {
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
};

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class SdkSidecarClient {
  private connected = false;
  private pending = new Map<string, Pending>();
  private unlistenMessage: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;
  private cachedStatus: { available: boolean; version?: string; error?: string; checkedAt: number } | null = null;

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      this.unlistenMessage = await listen<SdkSidecarResponse>("pi-sdk-sidecar-message", (event) => this.handleMessage(event.payload));
      this.unlistenError = await listen<unknown>("pi-sdk-sidecar-error", (event) => console.warn("pi sdk sidecar error", event.payload));
      await invoke("pi_sdk_sidecar_start");
      this.connected = true;
    } catch (error) {
      this.connected = false;
      this.unlistenMessage?.();
      this.unlistenError?.();
      this.unlistenMessage = null;
      this.unlistenError = null;
      throw new SdkSidecarError("start-failed", `Failed to start SDK sidecar: ${errorMessage(error)}`, error);
    }
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.connect();
    const id = crypto.randomUUID();
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      window.setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new SdkSidecarError("timeout", `SDK sidecar request timed out: ${method}`));
      }, 15_000);
    });
    try {
      await invoke("pi_sdk_sidecar_send", { message: JSON.stringify({ id, method, params }) });
    } catch (error) {
      this.pending.delete(id);
      throw new SdkSidecarError("send-failed", `Failed to send SDK sidecar request ${method}: ${errorMessage(error)}`, error);
    }
    return response as Promise<T>;
  }

  async ping(): Promise<{ version: string; sdkAvailable: boolean }> {
    return this.request("ping");
  }

  async getStatus(force = false): Promise<{ available: boolean; version?: string; error?: string }> {
    const cacheTtl = 30_000;
    if (!force && this.cachedStatus && Date.now() - this.cachedStatus.checkedAt < cacheTtl) {
      return this.cachedStatus;
    }
    try {
      const result = await this.ping();
      this.cachedStatus = {
        available: result.sdkAvailable,
        version: result.version,
        error: result.sdkAvailable ? undefined : "SDK package unavailable",
        checkedAt: Date.now(),
      };
      return this.cachedStatus;
    } catch (error) {
      const sdkError = error instanceof SdkSidecarError ? error : new SdkSidecarError("sdk-unavailable", errorMessage(error), error);
      this.cachedStatus = {
        available: false,
        error: `${sdkError.kind}: ${sdkError.message}`,
        checkedAt: Date.now(),
      };
      return this.cachedStatus;
    }
  }

  async dispose(): Promise<void> {
    this.unlistenMessage?.();
    this.unlistenError?.();
    this.unlistenMessage = null;
    this.unlistenError = null;
    this.pending.clear();
    this.cachedStatus = null;
    this.connected = false;
    await invoke("pi_sdk_sidecar_stop");
  }

  private handleMessage(response: SdkSidecarResponse) {
    if (!response.id) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new SdkSidecarError("method-failed", response.error ?? `SDK sidecar request failed: ${pending.method}`));
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export const sdkSidecarClient = new SdkSidecarClient();
