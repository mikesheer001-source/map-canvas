const DB_NAME = "map-canvas-offline-v1";
const DB_VERSION = 1;
const PENDING = "pending";
const AREAS = "areas";
let dbPromise;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("This browser does not support offline storage."));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING, { keyPath: "pinId" });
      if (!db.objectStoreNames.contains(AREAS)) db.createObjectStore(AREAS, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error("Could not open offline storage."));
    request.onblocked = () => reject(new Error("Offline storage is busy in another tab. Close the other Map Canvas tab and retry."));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function transactionResult(storeName, mode, action) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let value;
    try { action(store, result => { value = result; }); }
    catch (error) { try { tx.abort(); } catch {} reject(error); return; }
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error("Offline storage transaction failed."));
    tx.onabort = () => reject(tx.error || new Error("Offline storage transaction was interrupted."));
  }));
}

export function coalesceQueuedChange(existing, next) {
  if (existing && existing.expectedVersion === null && next.action === "delete") {
    return { cancelled: true, pinId: next.pinId };
  }
  return {
    ...existing,
    ...next,
    expectedVersion: existing ? existing.expectedVersion : next.expectedVersion,
    createdAt: existing?.createdAt ?? next.createdAt ?? Date.now(),
    status: "pending",
    conflict: null,
  };
}

export async function enqueueOfflineChange(change) {
  if (!change || typeof change.pinId !== "string" || !change.pinId ||
      !["save", "delete"].includes(change.action)) throw new Error("Invalid offline edit.");
  return transactionResult(PENDING, "readwrite", (store, done) => {
    const request = store.get(change.pinId);
    request.onsuccess = () => {
      const result = coalesceQueuedChange(request.result, { ...change, createdAt: change.createdAt ?? Date.now() });
      if (result.cancelled) store.delete(change.pinId);
      else store.put(result);
      done(result);
    };
  });
}

export async function getQueuedChange(pinId) {
  return transactionResult(PENDING, "readonly", (store, done) => {
    const request = store.get(pinId);
    request.onsuccess = () => done(request.result || null);
  });
}

export async function listQueuedChanges() {
  return transactionResult(PENDING, "readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done((request.result || []).sort((a, b) => a.createdAt - b.createdAt));
  });
}

export async function removeQueuedChange(pinId) {
  return transactionResult(PENDING, "readwrite", (store, done) => {
    store.delete(pinId);
    done(true);
  });
}

export async function markQueuedConflict(pinId, message) {
  return transactionResult(PENDING, "readwrite", (store, done) => {
    const request = store.get(pinId);
    request.onsuccess = () => {
      if (!request.result) { done(false); return; }
      store.put({ ...request.result, status: "conflict", conflict: String(message || "The shared version changed.") });
      done(true);
    };
  });
}

export async function listOfflineAreas() {
  return transactionResult(AREAS, "readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done((request.result || []).sort((a, b) => b.downloadedAt - a.downloadedAt));
  });
}

export async function removeOfflineAreaRecord(id) {
  return transactionResult(AREAS, "readwrite", (store, done) => {
    store.delete(id);
    done(true);
  });
}

export function mergePendingChanges(serverEntries, pendingChanges) {
  const merged = new Map((serverEntries || []).map(entry => [entry.id, { ...entry }]));
  for (const change of [...(pendingChanges || [])].sort((a, b) => a.createdAt - b.createdAt)) {
    const id = change.pinId;
    if (change.status === "conflict") {
      if (change.action === "save" && change.entry) {
        merged.set(id, { ...change.entry, pendingSync: true, syncConflict: true });
      } else if (merged.has(id)) {
        merged.set(id, { ...merged.get(id), syncConflict: true });
      }
    } else if (change.action === "save" && change.entry) {
      merged.set(id, { ...change.entry, pendingSync: true, syncConflict: false });
    } else if (change.action === "delete") {
      merged.delete(id);
    }
  }
  return [...merged.values()];
}

export function stripOfflineFlags(entry) {
  const clean = { ...entry };
  delete clean.pendingSync;
  delete clean.syncConflict;
  return clean;
}

export function formatOfflineBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
