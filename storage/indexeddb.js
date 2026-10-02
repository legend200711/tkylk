// ============================================================
// IndexedDB Storage Layer
// Fast local cache for model state, working memory, sync queue,
// model configuration, and retrieval indexes.
// ============================================================

const DB_NAME    = "shadow-reaper-local";
const DB_VERSION = 3;  // bumped: added model-config and retrieval-index stores

const STORES = {
  modelCache:      "model-cache",      // model metadata / download state
  modelConfig:     "model-config",     // device-selected model config / manifest
  workingMemory:   "working-memory",   // current session working memory
  pendingSync:     "pending-sync",     // items queued for Firebase sync
  localKnowledge:  "local-knowledge",  // quick-access knowledge index
  retrievalIndex:  "retrieval-index",  // pre-computed TF token index for fast retrieval
  preferences:     "preferences",      // local UI preferences
  aiConfig:        "ai-config"         // device-specific AI configuration
};

let _db = null;

export async function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      for (const store of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(store)) {
          const s = db.createObjectStore(store, { keyPath: "id" });
          if (store === "pending-sync") {
            s.createIndex("type",      "type",      { unique: false });
            s.createIndex("timestamp", "timestamp", { unique: false });
          }
          if (store === "working-memory") {
            s.createIndex("conversationId", "conversationId", { unique: false });
          }
          if (store === "retrieval-index") {
            s.createIndex("concept",  "concept",  { unique: false });
            s.createIndex("category", "category", { unique: false });
          }
        }
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror  = (e) => reject(new Error(`IndexedDB open failed: ${e.target.error}`));
  });
}

function getStore(storeName, mode = "readonly") {
  if (!_db) throw new Error("IndexedDB not initialized");
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Generic CRUD ──────────────────────────────────────────────
export async function idbSet(storeName, record) {
  if (!record.id) record.id = crypto.randomUUID();
  return promisify(getStore(storeName, "readwrite").put(record));
}

export async function idbGet(storeName, id) {
  return promisify(getStore(storeName).get(id));
}

export async function idbDelete(storeName, id) {
  return promisify(getStore(storeName, "readwrite").delete(id));
}

export async function idbGetAll(storeName) {
  return promisify(getStore(storeName).getAll());
}

export async function idbClear(storeName) {
  return promisify(getStore(storeName, "readwrite").clear());
}

// ── Model Cache ───────────────────────────────────────────────
export async function saveModelCacheState(state) {
  return idbSet(STORES.modelCache, { id: "current-model", ...state });
}

export async function loadModelCacheState() {
  return idbGet(STORES.modelCache, "current-model");
}

// ── Model Configuration (device-specific, from manifest) ─────
export async function saveModelConfig(config) {
  return idbSet(STORES.modelConfig, { id: "active-config", ...config, savedAt: Date.now() });
}

export async function loadModelConfig() {
  return idbGet(STORES.modelConfig, "active-config");
}

// ── AI / Device Configuration ─────────────────────────────────
export async function saveAIConfig(config) {
  return idbSet(STORES.aiConfig, { id: "device-ai-config", ...config, savedAt: Date.now() });
}

export async function loadAIConfig() {
  return idbGet(STORES.aiConfig, "device-ai-config");
}

// ── Retrieval Index ────────────────────────────────────────────
export async function saveRetrievalIndex(items) {
  await idbClear(STORES.retrievalIndex);
  for (const item of items) {
    await idbSet(STORES.retrievalIndex, item);
  }
}

export async function getRetrievalIndex() {
  return idbGetAll(STORES.retrievalIndex);
}

// ── Working Memory ────────────────────────────────────────────
export async function saveWorkingMemoryItem(convId, item) {
  return idbSet(STORES.workingMemory, {
    id: `${convId}-${item.key || crypto.randomUUID()}`,
    conversationId: convId,
    timestamp: Date.now(),
    ...item
  });
}

export async function getWorkingMemory(convId) {
  if (!_db) return [];
  const store = getStore(STORES.workingMemory);
  const index = store.index("conversationId");
  return promisify(index.getAll(convId));
}

export async function clearWorkingMemory(convId) {
  const items = await getWorkingMemory(convId);
  const tx = _db.transaction(STORES.workingMemory, "readwrite");
  const store = tx.objectStore(STORES.workingMemory);
  items.forEach(item => store.delete(item.id));
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

// ── Pending Sync Queue ────────────────────────────────────────
export async function enqueueSyncItem(type, payload) {
  return idbSet(STORES.pendingSync, {
    id: crypto.randomUUID(),
    type,
    payload,
    timestamp: Date.now(),
    retries: 0
  });
}

export async function getPendingSyncItems() {
  return idbGetAll(STORES.pendingSync);
}

export async function removeSyncItem(id) {
  return idbDelete(STORES.pendingSync, id);
}

// ── Local Knowledge Index ──────────────────────────────────────
export async function updateLocalKnowledgeIndex(items) {
  // Replace the entire index
  await idbClear(STORES.localKnowledge);
  for (const item of items) {
    await idbSet(STORES.localKnowledge, item);
  }
}

export async function getLocalKnowledgeIndex() {
  return idbGetAll(STORES.localKnowledge);
}

// ── Local Preferences ─────────────────────────────────────────
export async function saveLocalPreference(key, value) {
  return idbSet(STORES.preferences, { id: key, value, updatedAt: Date.now() });
}

export async function loadLocalPreference(key, defaultValue = null) {
  const item = await idbGet(STORES.preferences, key);
  return item ? item.value : defaultValue;
}
