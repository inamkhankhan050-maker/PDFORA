// Local session recovery in IndexedDB. Nothing leaves the browser.
const DB_NAME = "pdfora";
const STORE = "sessions";
const KEY = "current";

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveSession(session) {
  try {
    await run("readwrite", (store) => store.put({ ...session, savedAt: Date.now() }, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadSession() {
  try { return (await run("readonly", (store) => store.get(KEY))) || null; } catch { return null; }
}

export async function clearSession() {
  try { await run("readwrite", (store) => store.delete(KEY)); } catch { /* nothing stored */ }
}
