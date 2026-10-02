// ============================================================
// Sync Manager — bridges IndexedDB queue to Firebase
// Handles offline resilience
// ============================================================
import { getPendingSyncItems, removeSyncItem } from "./indexeddb.js";

export class SyncManager {
  constructor(firestoreService, uid) {
    this._fs = firestoreService;
    this._uid = uid;
    this._running = false;
    this._online = navigator.onLine;

    window.addEventListener("online",  () => { this._online = true;  this.flush(); });
    window.addEventListener("offline", () => { this._online = false; });
  }

  async flush() {
    if (this._running || !this._online) return;
    this._running = true;

    try {
      const items = await getPendingSyncItems();
      for (const item of items) {
        try {
          await this._processItem(item);
          await removeSyncItem(item.id);
        } catch (err) {
          console.warn("[SyncManager] Failed to sync item:", item.type, err);
        }
      }
    } finally {
      this._running = false;
    }
  }

  async _processItem(item) {
    switch (item.type) {
      case "save-memory":
        await this._fs.saveMemory(this._uid, item.payload);
        break;
      case "save-knowledge":
        await this._fs.saveKnowledge(this._uid, item.payload);
        break;
      case "save-relationship":
        await this._fs.saveRelationship(this._uid, item.payload);
        break;
      default:
        console.warn("[SyncManager] Unknown sync type:", item.type);
    }
  }
}
