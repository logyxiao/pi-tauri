import { normalizePath } from "@/shared/hooks/session-cache";
import type { PiMessage, PiSessionSummary } from "@/shared/pi/types";

const DB_NAME = "pi-tauri-cache";
const DB_VERSION = 1;
const SESSION_MESSAGES_STORE = "sessionMessages";
const SESSIONS_STORE = "sessions";
const MESSAGE_LIMIT = 500;
const SESSION_LIMIT = 1000;
const SESSION_MESSAGE_RECORD_LIMIT = 120;
const SESSION_MESSAGE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

interface SessionMessagesRecord {
  key: string;
  sessionPath: string;
  savedAt: number;
  messages: PiMessage[];
}

interface SessionsRecord {
  key: string;
  savedAt: number;
  sessions: PiSessionSummary[];
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

export async function loadSessionMessagesFromDb(sessionPath: string): Promise<PiMessage[]> {
  const db = await openCacheDb();
  if (!db) return [];
  const record = await getRecord<SessionMessagesRecord>(db, SESSION_MESSAGES_STORE, cacheKey(sessionPath));
  if (record && Date.now() - record.savedAt > SESSION_MESSAGE_MAX_AGE_MS) {
    await deleteRecord(db, SESSION_MESSAGES_STORE, record.key);
    return [];
  }
  return record?.messages ?? [];
}

export async function persistSessionMessagesToDb(sessionPath: string, messages: PiMessage[]): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;
  const record: SessionMessagesRecord = {
    key: cacheKey(sessionPath),
    sessionPath,
    savedAt: Date.now(),
    messages: messages.slice(-MESSAGE_LIMIT),
  };
  await putRecord(db, SESSION_MESSAGES_STORE, record);
  void pruneSessionMessageRecords(db);
}

export async function removeSessionMessagesFromDb(sessionPath: string): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;
  await deleteRecord(db, SESSION_MESSAGES_STORE, cacheKey(sessionPath));
}

export async function loadSessionsFromDb(): Promise<PiSessionSummary[]> {
  const db = await openCacheDb();
  if (!db) return [];
  const record = await getRecord<SessionsRecord>(db, SESSIONS_STORE, "all");
  return record?.sessions ?? [];
}

export async function persistSessionsToDb(sessions: PiSessionSummary[]): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;
  const record: SessionsRecord = {
    key: "all",
    savedAt: Date.now(),
    sessions: sessions.slice(0, SESSION_LIMIT),
  };
  await putRecord(db, SESSIONS_STORE, record);
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_MESSAGES_STORE)) db.createObjectStore(SESSION_MESSAGES_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) db.createObjectStore(SESSIONS_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function getRecord<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | null> {
  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

function putRecord(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.objectStore(storeName).put(value);
  });
}

function deleteRecord(db: IDBDatabase, storeName: string, key: string): Promise<void> {
  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.objectStore(storeName).delete(key);
  });
}

async function pruneSessionMessageRecords(db: IDBDatabase): Promise<void> {
  const records = await getAllRecords<SessionMessagesRecord>(db, SESSION_MESSAGES_STORE);
  const now = Date.now();
  const expiredKeys = records
    .filter((record) => now - record.savedAt > SESSION_MESSAGE_MAX_AGE_MS)
    .map((record) => record.key);
  const overflowKeys = records
    .filter((record) => !expiredKeys.includes(record.key))
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(SESSION_MESSAGE_RECORD_LIMIT)
    .map((record) => record.key);
  const keys = [...new Set([...expiredKeys, ...overflowKeys])];
  if (!keys.length) return;
  await deleteRecords(db, SESSION_MESSAGES_STORE, keys);
}

function getAllRecords<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result as T[] | undefined) ?? []);
    request.onerror = () => resolve([]);
  });
}

function deleteRecords(db: IDBDatabase, storeName: string, keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    const store = transaction.objectStore(storeName);
    for (const key of keys) store.delete(key);
  });
}

function cacheKey(sessionPath: string): string {
  return normalizePath(sessionPath);
}
