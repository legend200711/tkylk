// ============================================================
// Memory Engine
// Manages all memory types: working, episodic, semantic,
// procedural, preference, relationship
// ============================================================
import {
  saveMemory, getMemories,
  updateMemory as fsUpdateMemory,
  deleteMemory as fsDeleteMemory
} from "../firebase/firestore-service.js";
import {
  saveWorkingMemoryItem, getWorkingMemory, clearWorkingMemory
} from "../storage/indexeddb.js";

export const MEMORY_TYPES = {
  WORKING:      "working",
  EPISODIC:     "episodic",
  SEMANTIC:     "semantic",
  PROCEDURAL:   "procedural",
  PREFERENCE:   "preference",
  RELATIONSHIP: "relationship"
};

export const PRIVACY_LEVELS = {
  PRIVATE:   "private-user",    // Only for this user
  PROJECT:   "project",         // Project-scoped
  GENERAL:   "general"          // Safe to generalize (no personal info)
};

export class MemoryEngine {
  constructor() {
    this._uid  = null;
    this._workingCache = new Map(); // convId → items[]
  }

  setUID(uid) { this._uid = uid; }

  // ── Working Memory (IndexedDB — ephemeral) ────────────────
  async addWorkingMemory(convId, key, value, metadata = {}) {
    const item = { key, value, metadata, timestamp: Date.now() };
    await saveWorkingMemoryItem(convId, item);

    if (!this._workingCache.has(convId)) this._workingCache.set(convId, []);
    this._workingCache.get(convId).push(item);
    return item;
  }

  async getWorkingMemory(convId) {
    if (this._workingCache.has(convId)) return this._workingCache.get(convId);
    const items = await getWorkingMemory(convId);
    this._workingCache.set(convId, items);
    return items;
  }

  async clearWorkingMemory(convId) {
    this._workingCache.delete(convId);
    await clearWorkingMemory(convId);
  }

  // ── Episodic Memory ───────────────────────────────────────
  async storeEpisodic(data) {
    return this._storeMemory({ ...data, memoryType: MEMORY_TYPES.EPISODIC });
  }

  // ── Semantic Memory ───────────────────────────────────────
  async storeSemantic(data) {
    return this._storeMemory({ ...data, memoryType: MEMORY_TYPES.SEMANTIC });
  }

  // ── Procedural Memory ─────────────────────────────────────
  async storeProcedural(data) {
    return this._storeMemory({ ...data, memoryType: MEMORY_TYPES.PROCEDURAL });
  }

  // ── Preference Memory ─────────────────────────────────────
  async storePreference(data) {
    return this._storeMemory({ ...data, memoryType: MEMORY_TYPES.PREFERENCE });
  }

  // ── Generic Store ─────────────────────────────────────────
  async _storeMemory(data) {
    if (!this._uid) throw new Error("MemoryEngine: no UID set");

    const memory = {
      memoryType:         data.memoryType || MEMORY_TYPES.SEMANTIC,
      concept:            data.concept || "",
      category:           data.category || "general",
      fact:               data.fact || data.content || "",
      detail:             data.detail || "",
      project:            data.project || null,
      importance:         Math.max(0, Math.min(1, data.importance ?? 0.5)),
      confidence:         Math.max(0, Math.min(1, data.confidence ?? 0.7)),
      confirmationCount:  data.confirmationCount ?? 1,
      contradictionCount: data.contradictionCount ?? 0,
      sourceType:         data.sourceType || "conversation",
      sourceConvId:       data.sourceConvId || null,
      privacy:            data.privacy || PRIVACY_LEVELS.PRIVATE,
      relationships:      data.relationships || [],
      tags:               data.tags || [],
      lastObserved:       new Date().toISOString(),
      accessCount:        0
    };

    if (data.id) memory.id = data.id;

    const id = await saveMemory(this._uid, memory);
    return { ...memory, id };
  }

  // ── Update / Correct Memory ───────────────────────────────
  async updateMemory(memId, updates) {
    if (!this._uid) return;
    await fsUpdateMemory(this._uid, memId, {
      ...updates,
      lastObserved: new Date().toISOString()
    });
  }

  async confirmMemory(memId) {
    const memories = await this.getMemoriesById([memId]);
    if (!memories.length) return;
    const m = memories[0];
    await fsUpdateMemory(this._uid, memId, {
      confirmationCount: (m.confirmationCount || 1) + 1,
      confidence: Math.min(1, (m.confidence || 0.7) + 0.05),
      lastObserved: new Date().toISOString()
    });
  }

  async contradictMemory(memId, newFact) {
    const memories = await this.getMemoriesById([memId]);
    if (!memories.length) return;
    const m = memories[0];
    await fsUpdateMemory(this._uid, memId, {
      contradictionCount: (m.contradictionCount || 0) + 1,
      confidence: Math.max(0, (m.confidence || 0.7) - 0.15),
      supersededBy: newFact,
      lastObserved: new Date().toISOString()
    });
  }

  async deleteMemory(memId) {
    if (!this._uid) return;
    await fsDeleteMemory(this._uid, memId);
  }

  // ── Retrieval ─────────────────────────────────────────────
  async getAllMemories(category = null) {
    if (!this._uid) return [];
    return getMemories(this._uid, category);
  }

  async getMemoriesById(ids) {
    const all = await this.getAllMemories();
    return all.filter(m => ids.includes(m.id));
  }

  async getMemoriesByProject(project) {
    if (!this._uid) return [];
    const all = await getMemories(this._uid, null, 500);
    return all.filter(m => m.project === project);
  }

  async getMemoriesByType(type) {
    const all = await this.getAllMemories();
    return all.filter(m => m.memoryType === type);
  }

  // ── Record Access ─────────────────────────────────────────
  async recordAccess(memId, memory) {
    try {
      await fsUpdateMemory(this._uid, memId, {
        accessCount: (memory.accessCount || 0) + 1,
        lastAccessed: new Date().toISOString()
      });
    } catch (_) {}
  }
}
