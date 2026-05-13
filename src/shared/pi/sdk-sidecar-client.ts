import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type SdkSidecarResponse = {
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class SdkSidecarClient {
  private connected = false;
  private pending = new Map<string, Pending>();
  private unlistenMessage: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;

  async connect(): Promise<void> {
    if (this.connected) return;
    this.unlistenMessage = await listen<SdkSidecarResponse>("pi-sdk-sidecar-message", (event) => this.handleMessage(event.payload));
    this.unlistenError = await listen<unknown>("pi-sdk-sidecar-error", (event) => console.warn("pi sdk sidecar error", event.payload));
    await invoke("pi_sdk_sidecar_start");
    this.connected = true;
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.connect();
    const id = crypto.randomUUID();
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      window.setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`pi sdk sidecar request timed out: ${method}`));
      }, 15_000);
    });
    await invoke("pi_sdk_sidecar_send", { message: JSON.stringify({ id, method, params }) });
    return response as Promise<T>;
  }

  async ping(): Promise<{ version: string; sdkAvailable: boolean }> {
    return this.request("ping");
  }

  async dispose(): Promise<void> {
    this.unlistenMessage?.();
    this.unlistenError?.();
    this.unlistenMessage = null;
    this.unlistenError = null;
    this.pending.clear();
    this.connected = false;
    await invoke("pi_sdk_sidecar_stop");
  }

  private handleMessage(response: SdkSidecarResponse) {
    if (!response.id) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error ?? "pi sdk sidecar request failed"));
  }
}

export const sdkSidecarClient = new SdkSidecarClient();
