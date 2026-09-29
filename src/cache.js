// IndexedDB tile cache: persists generated heightmaps between sessions.
const DB_NAME = 'terrain-cache';
const STORE = 'tiles';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class TileCache {
  constructor() { this._db = null; this.enabled = typeof indexedDB !== 'undefined'; }

  async _store(mode) {
    if (!this._db) this._db = await openDB();
    return this._db.transaction(STORE, mode).objectStore(STORE);
  }

  async get(key) {
    if (!this.enabled) return null;
    try {
      const store = await this._store('readonly');
      return await new Promise((resolve) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  async put(key, buffer) {
    if (!this.enabled) return;
    try {
      const store = await this._store('readwrite');
      await new Promise((resolve) => {
        const req = store.put(buffer, key);
        req.onsuccess = resolve;
        req.onerror = resolve;
      });
    } catch { /* cache is best-effort */ }
  }

  async clear() {
    if (!this.enabled) return;
    try {
      const store = await this._store('readwrite');
      await new Promise((resolve) => {
        const req = store.clear();
        req.onsuccess = resolve;
        req.onerror = resolve;
      });
    } catch { /* ignore */ }
  }
}
