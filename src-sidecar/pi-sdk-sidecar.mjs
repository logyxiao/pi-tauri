#!/usr/bin/env node
import { createInterface } from "node:readline";

const sidecarVersion = "0.1.0";

/** @type {Promise<any> | null} */
let sdkPromise = null;

function loadSdk() {
  sdkPromise ??= import("@earendil-works/pi-coding-agent").catch((error) => {
    throw new Error(`Failed to load @earendil-works/pi-coding-agent: ${error?.message ?? error}`);
  });
  return sdkPromise;
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
}

function fail(id, error) {
  process.stdout.write(`${JSON.stringify({ id, ok: false, error: error?.message ?? String(error) })}\n`);
}

async function handle(request) {
  const { id, method, params = {} } = request;
  if (!id) throw new Error("request id required");
  if (!method) throw new Error("request method required");

  if (method === "ping") {
    respond(id, { version: sidecarVersion, sdkAvailable: await isSdkAvailable() });
    return;
  }

  if (method === "sdk_session_tree") {
    respond(id, await sdkSessionTree(params.sessionFile));
    return;
  }

  if (method === "sdk_set_label") {
    await sdkSetLabel(params.sessionFile, params.entryId, params.label);
    respond(id, { ok: true });
    return;
  }

  if (method === "sdk_get_settings") {
    respond(id, await sdkGetSettings(params.cwd));
    return;
  }

  if (method === "sdk_update_settings") {
    respond(id, await sdkUpdateSettings(params.cwd, params.update));
    return;
  }

  if (method === "sdk_auth_status") {
    respond(id, await sdkAuthStatus());
    return;
  }

  throw new Error(`unknown method: ${method}`);
}

async function isSdkAvailable() {
  try {
    await loadSdk();
    return true;
  } catch {
    return false;
  }
}

async function sdkSessionTree(sessionFile) {
  if (!sessionFile || typeof sessionFile !== "string") throw new Error("sessionFile required");
  const { SessionManager } = await loadSdk();
  const sm = await SessionManager.open(sessionFile);
  const entries = safeCall(() => sm.getEntries(), []);
  const leaf = safeCall(() => sm.getLeafEntry(), undefined);
  const path = safeCall(() => sm.getPath(), []);
  const tree = safeCall(() => sm.getTree(), undefined);
  const parentSession = entries.find((entry) => entry?.type === "session")?.parentSession;
  const nodes = entries.map((entry) => mapEntryToNode(sm, entry, tree));
  return {
    sessionFile,
    parentSession,
    activeLeafId: leaf?.id,
    activeLeafSource: "sdk",
    activeLeafNote: "Current cursor comes from SDK SessionManager.getLeafEntry().",
    activePathIds: path.map((entry) => entry.id),
    nodes,
  };
}

async function sdkSetLabel(sessionFile, entryId, label) {
  if (!sessionFile || typeof sessionFile !== "string") throw new Error("sessionFile required");
  if (!entryId || typeof entryId !== "string") throw new Error("entryId required");
  const { SessionManager } = await loadSdk();
  const sm = await SessionManager.open(sessionFile);
  sm.appendLabelChange(entryId, typeof label === "string" && label.trim() ? label.trim() : undefined);
}

async function sdkGetSettings(cwd) {
  if (!cwd || typeof cwd !== "string") throw new Error("cwd required");
  const manager = await createSettingsManager(cwd);
  const settings = await firstAvailableCall(manager, ["getSettings", "get", "load"], []);
  return settings ?? {};
}

async function sdkUpdateSettings(cwd, update) {
  if (!cwd || typeof cwd !== "string") throw new Error("cwd required");
  if (!update || typeof update !== "object") throw new Error("update required");
  const manager = await createSettingsManager(cwd);
  const normalized = normalizeSettingsUpdate(update);
  if (!Object.keys(normalized).length) return await sdkGetSettings(cwd);

  if (typeof manager.updateSettings === "function") {
    await manager.updateSettings(normalized);
  } else if (typeof manager.update === "function") {
    await manager.update(normalized);
  } else if (typeof manager.setSettings === "function") {
    const current = await sdkGetSettings(cwd);
    await manager.setSettings({ ...current, ...normalized });
  } else if (typeof manager.save === "function") {
    const current = await sdkGetSettings(cwd);
    await manager.save({ ...current, ...normalized });
  } else {
    throw new Error("SettingsManager write API unavailable");
  }

  return await sdkGetSettings(cwd);
}

async function createSettingsManager(cwd) {
  const sdk = await loadSdk();
  const SettingsManager = sdk.SettingsManager;
  if (!SettingsManager) throw new Error("SettingsManager not exported by SDK");
  if (typeof SettingsManager.create === "function") return await SettingsManager.create(cwd);
  if (typeof SettingsManager.open === "function") return await SettingsManager.open(cwd);
  if (typeof SettingsManager.fromCwd === "function") return await SettingsManager.fromCwd(cwd);
  try {
    return new SettingsManager(cwd);
  } catch (error) {
    throw new Error(`SettingsManager constructor unavailable: ${error?.message ?? error}`);
  }
}

async function firstAvailableCall(target, methods, args) {
  for (const method of methods) {
    if (typeof target?.[method] === "function") return await target[method](...args);
  }
  throw new Error(`No supported method found: ${methods.join(", ")}`);
}

function normalizeSettingsUpdate(update) {
  const normalized = {};
  if (typeof update.model === "string") normalized.defaultModel = update.model;
  if (typeof update.provider === "string") normalized.defaultProvider = update.provider;
  if (typeof update.thinkingLevel === "string") normalized.defaultThinkingLevel = update.thinkingLevel;
  if (typeof update.autoCompaction === "boolean") normalized.autoCompaction = update.autoCompaction;
  if (typeof update.autoRetry === "boolean") normalized.autoRetry = update.autoRetry;
  if (typeof update.steeringMode === "string") normalized.steeringMode = update.steeringMode;
  if (typeof update.followUpMode === "string") normalized.followUpMode = update.followUpMode;
  return normalized;
}

async function sdkAuthStatus() {
  const sdk = await loadSdk();
  const providers = ["anthropic", "openai", "google", "openrouter", "groq", "xai", "mistral"];
  const envStatus = providers.map((provider) => authStatusFromEnv(provider));
  const sdkStatus = await authStatusFromSdkStorage(sdk, providers).catch((error) => [
    { provider: "sdk", status: "unknown", detail: `AuthStorage probe failed: ${error?.message ?? error}` },
  ]);
  return mergeAuthStatus(envStatus, sdkStatus);
}

async function authStatusFromSdkStorage(sdk, providers) {
  const AuthStorage = sdk.AuthStorage;
  if (!AuthStorage) return [{ provider: "sdk", status: "unknown", detail: "AuthStorage not exported by SDK" }];
  const storage = await createAuthStorage(AuthStorage);
  return await Promise.all(
    providers.map(async (provider) => {
      const value = await readProviderAuth(storage, provider);
      if (value === undefined) return { provider, status: "unknown", detail: "AuthStorage provider probe unavailable" };
      if (value === null || value === false || value === "") return { provider, status: "missing", detail: "No SDK auth entry found" };
      return { provider, status: "configured", detail: "SDK auth entry found" };
    }),
  );
}

async function createAuthStorage(AuthStorage) {
  if (typeof AuthStorage.create === "function") return await AuthStorage.create();
  if (typeof AuthStorage.open === "function") return await AuthStorage.open();
  if (typeof AuthStorage.load === "function") return await AuthStorage.load();
  return new AuthStorage();
}

async function readProviderAuth(storage, provider) {
  for (const method of ["get", "getAuth", "getProvider", "getCredentials", "getApiKey"]) {
    if (typeof storage?.[method] !== "function") continue;
    try {
      return await storage[method](provider);
    } catch {
      // Try next possible SDK API.
    }
  }
  return undefined;
}

function authStatusFromEnv(provider) {
  const keys = envKeysForProvider(provider);
  const configuredKey = keys.find((key) => Boolean(process.env[key]));
  return configuredKey
    ? { provider, status: "configured", detail: `Environment variable ${configuredKey} is set` }
    : { provider, status: "missing", detail: `No environment variable found (${keys.join(", ")})` };
}

function envKeysForProvider(provider) {
  const map = {
    anthropic: ["ANTHROPIC_API_KEY"],
    openai: ["OPENAI_API_KEY"],
    google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    openrouter: ["OPENROUTER_API_KEY"],
    groq: ["GROQ_API_KEY"],
    xai: ["XAI_API_KEY"],
    mistral: ["MISTRAL_API_KEY"],
  };
  return map[provider] ?? [];
}

function mergeAuthStatus(envStatus, sdkStatus) {
  const merged = new Map();
  for (const item of envStatus) merged.set(item.provider, item);
  for (const item of sdkStatus) {
    const current = merged.get(item.provider);
    if (!current || item.status === "configured" || current.status === "missing") merged.set(item.provider, item);
  }
  return Array.from(merged.values());
}

function mapEntryToNode(sm, entry, tree) {
  const id = String(entry.id ?? crypto.randomUUID());
  const children = safeCall(() => sm.getChildren(id), []);
  const label = safeCall(() => sm.getLabel(id), undefined);
  return {
    id,
    parentId: entry.parentId,
    type: normalizeEntryType(entry.type),
    role: entry.message?.role,
    title: entryTitle(entry),
    timestamp: entry.timestamp,
    label,
    summary: entry.summary,
    depth: inferDepth(entry, tree),
    childrenCount: children.length,
    isLeaf: children.length === 0,
  };
}

function inferDepth(entry, tree) {
  if (!tree) return 0;
  const node = findTreeNode(tree, entry.id);
  return Number.isFinite(node?.depth) ? node.depth : 0;
}

function findTreeNode(node, id) {
  if (!node) return undefined;
  if (node.id === id || node.entry?.id === id) return node;
  for (const child of node.children ?? []) {
    const match = findTreeNode(child, id);
    if (match) return match;
  }
  return undefined;
}

function normalizeEntryType(type) {
  return ["session", "message", "model_change", "thinking_level_change", "compaction", "branch_summary", "custom"].includes(type)
    ? type
    : "unknown";
}

function entryTitle(entry) {
  if (entry.type === "session") return "Session start";
  if (entry.type === "branch_summary") return "Branch summary";
  if (entry.type === "compaction") return "Compaction";
  if (entry.message?.content) return contentText(entry.message.content).slice(0, 96) || entry.message.role || "message";
  if (entry.summary) return String(entry.summary).slice(0, 96);
  return entry.type ?? "entry";
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item?.text).filter(Boolean).join("\n");
  return "";
}

function safeCall(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
    await handle(request);
  } catch (error) {
    fail(request?.id ?? null, error);
  }
});

process.on("uncaughtException", (error) => fail(null, error));
process.on("unhandledRejection", (error) => fail(null, error));
