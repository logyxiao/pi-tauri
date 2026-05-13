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
  const sdk = await loadSdk();
  const SettingsManager = sdk.SettingsManager;
  if (!SettingsManager) throw new Error("SettingsManager not exported by SDK");
  const manager = await SettingsManager.create?.(cwd);
  if (!manager) throw new Error("SettingsManager.create unavailable");
  const settings = await manager.getSettings?.();
  return settings ?? {};
}

async function sdkAuthStatus() {
  const sdk = await loadSdk();
  const AuthStorage = sdk.AuthStorage;
  if (!AuthStorage) return [{ provider: "unknown", status: "unknown", detail: "AuthStorage not exported by SDK" }];
  return [{ provider: "unknown", status: "unknown", detail: "Auth status probing pending concrete SDK AuthStorage API wiring" }];
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
