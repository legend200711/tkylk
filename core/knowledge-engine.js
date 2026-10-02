// ============================================================
// Knowledge Engine
// Stores and retrieves structured learned knowledge.
// Higher-level than raw memories — curated concepts.
// ============================================================
import {
  saveKnowledge, getKnowledge,
  updateKnowledge as fsUpdateKnowledge,
  deleteKnowledge as fsDeleteKnowledge
} from "../firebase/firestore-service.js";
import { PRIVACY_LEVELS } from "./memory-engine.js";

export class KnowledgeEngine {
  constructor() {
    this._uid = null;
    this._cache = null;
    this._cacheTime = 0;
    this._CACHE_TTL = 60 * 1000; // 1 minute
  }

  setUID(uid) {
    this._uid   = uid;
    this._cache = null;
  }

  async storeKnowledge(data) {
    if (!this._uid) throw new Error("KnowledgeEngine: no UID set");

    const record = {
      concept:            data.concept || "",
      category:           data.category || "general",
      fact:               data.fact || data.content || "",
      detail:             data.detail || "",
      project:            data.project || null,
      importance:         Math.max(0, Math.min(1, data.importance ?? 0.7)),
      confidence:         Math.max(0, Math.min(1, data.confidence ?? 0.75)),
      confirmationCount:  data.confirmationCount ?? 1,
      contradictionCount: data.contradictionCount ?? 0,
      sourceType:         data.sourceType || "conversation",
      sourceConvId:       data.sourceConvId || null,
      privacy:            data.privacy || PRIVACY_LEVELS.PRIVATE,
      relationships:      data.relationships || [],
      tags:               data.tags || [],
      lastObserved:       new Date().toISOString()
    };

    if (data.id) record.id = data.id;
    const id = await saveKnowledge(this._uid, record);
    this._cache = null; // invalidate cache
    return { ...record, id };
  }

  async getAllKnowledge(project = null) {
    if (!this._uid) return [];

    // Use cache if fresh
    if (!project && this._cache && (Date.now() - this._cacheTime) < this._CACHE_TTL) {
      return this._cache;
    }

    const result = await getKnowledge(this._uid, project);

    if (!project) {
      this._cache = result;
      this._cacheTime = Date.now();
    }

    return result;
  }

  async updateKnowledge(id, updates) {
    if (!this._uid) return;
    await fsUpdateKnowledge(this._uid, id, updates);
    this._cache = null;
  }

  async deleteKnowledge(id) {
    if (!this._uid) return;
    await fsDeleteKnowledge(this._uid, id);
    this._cache = null;
  }

  async confirmKnowledge(id) {
    const all = await this.getAllKnowledge();
    const item = all.find(k => k.id === id);
    if (!item) return;
    await this.updateKnowledge(id, {
      confirmationCount: (item.confirmationCount || 1) + 1,
      confidence:        Math.min(1, (item.confidence || 0.75) + 0.05),
      lastObserved:      new Date().toISOString()
    });
  }

  async decreaseConfidence(id) {
    const all = await this.getAllKnowledge();
    const item = all.find(k => k.id === id);
    if (!item) return;
    await this.updateKnowledge(id, {
      confidence: Math.max(0, (item.confidence || 0.75) - 0.15)
    });
  }

  async mergeKnowledge(sourceId, targetId) {
    const all    = await this.getAllKnowledge();
    const source = all.find(k => k.id === sourceId);
    const target = all.find(k => k.id === targetId);
    if (!source || !target) return;

    await this.updateKnowledge(targetId, {
      confirmationCount: (target.confirmationCount || 1) + (source.confirmationCount || 1),
      confidence:        Math.max(target.confidence || 0, source.confidence || 0),
      relationships:     [...new Set([...(target.relationships || []), ...(source.relationships || [])])],
      tags:              [...new Set([...(target.tags || []), ...(source.tags || [])])]
    });
    await this.deleteKnowledge(sourceId);
  }

  // ── Import project knowledge ──────────────────────────────
  async importProjectKnowledge(uid, projectData) {
    /**
     * projectData shape (see spec):
     * {
     *   project: string,
     *   description: string,
     *   features: string[],
     *   technologies: string[],
     *   decisions: string[],
     *   knownIssues: string[],
     *   solutions: string[],
     *   relationships: string[]
     * }
     */
    this._uid = uid;
    const results = [];
    const proj = projectData.project;

    // Description
    if (projectData.description) {
      results.push(await this.storeKnowledge({
        concept: proj,
        category: "project-description",
        fact: projectData.description,
        project: proj,
        importance: 0.9,
        confidence: 1.0,
        privacy: PRIVACY_LEVELS.PRIVATE
      }));
    }

    // Features
    for (const feature of (projectData.features || [])) {
      results.push(await this.storeKnowledge({
        concept: `${proj} feature`,
        category: "project-fact",
        fact: feature,
        project: proj,
        importance: 0.75,
        confidence: 1.0,
        relationships: [proj],
        privacy: PRIVACY_LEVELS.PRIVATE
      }));
    }

    // Technologies
    for (const tech of (projectData.technologies || [])) {
      results.push(await this.storeKnowledge({
        concept: tech,
        category: "technology",
        fact: `${proj} uses ${tech}`,
        project: proj,
        importance: 0.7,
        confidence: 1.0,
        relationships: [proj, tech],
        privacy: PRIVACY_LEVELS.PRIVATE
      }));
    }

    // Decisions
    for (const decision of (projectData.decisions || [])) {
      results.push(await this.storeKnowledge({
        concept: `${proj} decision`,
        category: "decision",
        fact: decision,
        project: proj,
        importance: 0.8,
        confidence: 1.0,
        relationships: [proj],
        privacy: PRIVACY_LEVELS.PRIVATE
      }));
    }

    // Known issues
    for (const issue of (projectData.knownIssues || [])) {
      results.push(await this.storeKnowledge({
        concept: `${proj} issue`,
        category: "problem",
        fact: issue,
        project: proj,
        importance: 0.8,
        confidence: 1.0,
        relationships: [proj],
        privacy: PRIVACY_LEVELS.PRIVATE
      }));
    }

    // Solutions
    for (const solution of (projectData.solutions || [])) {
      results.push(await this.storeKnowledge({
        concept: `${proj} solution`,
        category: "solution",
        fact: solution,
        project: proj,
        importance: 0.85,
        confidence: 1.0,
        relationships: [proj],
        privacy: PRIVACY_LEVELS.PRIVATE
      }));
    }

    return results;
  }
}
