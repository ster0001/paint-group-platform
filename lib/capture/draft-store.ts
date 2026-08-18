"use client";

/**
 * Crash-safe local persistence for capture mode (room-loop brief section 7).
 *
 * Every state change is written to IndexedDB immediately, keyed by estimate -
 * bad reception is the NORMAL case on site, so offline is the default path,
 * not the error path. Server sync is the caller's job (debounced + flushed on
 * room commit); this module only guarantees that killing the tab mid-room
 * loses nothing.
 *
 * No dependencies - the API surface we need is ~40 lines of raw IndexedDB.
 */
import type { RoomDraft } from "./commit";

const DB_NAME = "pg-capture";
const STORE = "estimate-drafts";

export type CaptureState = {
  estimateId: string;
  storeyHeights: Record<string, number>;
  currentStorey: string;
  rooms: RoomDraft[];
  /** Room localIds captured but not yet acknowledged by the server. */
  pendingSync: string[];
  updatedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadCaptureState(estimateId: string): Promise<CaptureState | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(estimateId);
      req.onsuccess = () => resolve((req.result as CaptureState) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null; // private-mode browsers without IndexedDB: capture still works, just not crash-safe
  }
}

export async function saveCaptureState(state: CaptureState): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ ...state, updatedAt: Date.now() }, state.estimateId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* same fallback as load */
  }
}

export async function clearCaptureState(estimateId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(estimateId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* nothing to clear */
  }
}
