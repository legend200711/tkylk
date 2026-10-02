// ============================================================
// Knowledge Graph
// Creates and traverses relationships between concepts.
// ============================================================
import {
  saveRelationship, getRelationships, deleteRelationship
} from "../firebase/firestore-service.js";

export class KnowledgeGraph {
  constructor() {
    this._uid   = null;
    this._cache = null;
  }

  setUID(uid) {
    this._uid  = uid;
    this._cache = null;
  }

  // ── Add relationship ─────────────────────────────────────
  async addRelationship(fromConcept, type, toConcept, metadata = {}) {
    if (!this._uid) return;

    const rel = {
      fromConcept,
      type,         // "contains", "uses", "relates-to", "solves", "experienced-issue", "built-with", etc.
      toConcept,
      strength:     metadata.strength ?? 0.8,
      project:      metadata.project  ?? null,
      sourceConvId: metadata.sourceConvId ?? null,
      createdAt:    new Date().toISOString()
    };

    const id = await saveRelationship(this._uid, rel);
    this._cache = null;
    return { ...rel, id };
  }

  // ── Get all relationships ─────────────────────────────────
  async getAllRelationships() {
    if (!this._uid) return [];
    if (this._cache) return this._cache;
    const rels = await getRelationships(this._uid);
    this._cache = rels;
    return rels;
  }

  // ── Get relationships for a concept ──────────────────────
  async getConceptRelationships(concept) {
    if (!this._uid) return [];
    const all  = await this.getAllRelationships();
    const lower = concept.toLowerCase();
    return all.filter(r =>
      r.fromConcept?.toLowerCase() === lower ||
      r.toConcept?.toLowerCase()   === lower
    );
  }

  // ── Traverse graph outward from concept ──────────────────
  async traverse(startConcept, depth = 2) {
    const visited = new Set();
    const result  = [];

    const explore = async (concept, currentDepth) => {
      if (currentDepth <= 0 || visited.has(concept.toLowerCase())) return;
      visited.add(concept.toLowerCase());

      const rels = await this.getConceptRelationships(concept);
      for (const rel of rels) {
        result.push(rel);
        const next = rel.fromConcept?.toLowerCase() === concept.toLowerCase()
          ? rel.toConcept
          : rel.fromConcept;
        await explore(next, currentDepth - 1);
      }
    };

    await explore(startConcept, depth);
    return result;
  }

  // ── Build context string from relationships ───────────────
  async getRelationshipContext(concept) {
    const rels = await this.traverse(concept, 2);
    if (rels.length === 0) return "";

    const lines = rels.map(r => `${r.fromConcept} →[${r.type}]→ ${r.toConcept}`);
    return `Knowledge relationships:\n${lines.join("\n")}`;
  }

  // ── Delete relationship ───────────────────────────────────
  async deleteRelationship(id) {
    if (!this._uid) return;
    await deleteRelationship(this._uid, id);
    this._cache = null;
  }

  // ── Auto-create relationships from learning results ───────
  // Prevents duplicates: checks existing cache before writing.
  async processLearningRelationships(relationships, project = null, convId = null) {
    const existing = await this.getAllRelationships();
    for (const rel of relationships) {
      const fromLower = (rel.from || "").toLowerCase();
      const toLower   = (rel.to   || "").toLowerCase();
      const typeLower = (rel.type || "related-to").toLowerCase();
      const isDuplicate = existing.some(r =>
        r.fromConcept?.toLowerCase() === fromLower &&
        r.toConcept?.toLowerCase()   === toLower   &&
        r.type?.toLowerCase()        === typeLower
      );
      if (!isDuplicate) {
        await this.addRelationship(rel.from, rel.type || "related-to", rel.to, {
          project,
          sourceConvId: convId
        });
      }
    }
  }
}
