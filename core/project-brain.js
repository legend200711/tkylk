// ============================================================
// Project Brain
// Individual evolving knowledge base for every project.
// Tracks architecture, bugs, fixes, decisions, history, etc.
// Auto-identifies which project a conversation concerns.
// ============================================================
import {
  saveProjectBrain, getProjectBrain, getAllProjectBrains,
  updateProjectBrain, saveProjectBrainEntry, getProjectBrainEntries,
  upsertProjectRegistry, loadProjectRegistry
} from "../firebase/firestore-service.js";
import { KNOWLEDGE_STATE, TEMPORAL_STATE } from "./understanding-engine.js";

// ── Entry types in the project brain ─────────────────────
export const BRAIN_ENTRY_TYPES = {
  ARCHITECTURE:   "architecture",
  TECHNOLOGY:     "technology",
  FEATURE:        "feature",
  BUG:            "bug",
  FIX_ATTEMPTED:  "fix-attempted",
  FIX_SUCCEEDED:  "fix-succeeded",
  FIX_FAILED:     "fix-failed",
  DECISION:       "decision",
  REQUIREMENT:    "requirement",
  HISTORY:        "history",
  RELATIONSHIP:   "relationship",
  UNRESOLVED:     "unresolved",
  CONVERSATION:   "conversation",
  FIREBASE_CONFIG:"firebase-config",
  CLOUDFLARE_CONFIG:"cloudflare-config",
  // New types to support knowledge states
  IDEA:           "idea",
  ABANDONED:      "abandoned",
  SUPERSEDED:     "superseded",
  PAUSED:         "paused"
};

// ── Known-project registry (extended by learning) ────────
const DEFAULT_PROJECT_SIGNATURES = [
  {
    id:       "shadow-nexus-social",
    name:     "Shadow Nexus Social",
    aliases:  ["shadow nexus", "nexus social", "shadow nexus social", "sns"],
    keywords: ["shadow nexus", "nexus", "social", "sns"]
  },
  {
    id:       "shadow-of-salem",
    name:     "Shadow of Salem",
    aliases:  ["shadow of salem", "salem"],
    keywords: ["shadow of salem", "salem"]
  },
  {
    id:       "shadow-reaper",
    name:     "Shadow Reaper",
    aliases:  ["shadow reaper", "reaper"],
    keywords: ["shadow reaper", "reaper", "webgpu", "webllm"]
  },
  {
    id:       "aurenix",
    name:     "Aurenix",
    aliases:  ["aurenix"],
    keywords: ["aurenix"]
  },
  {
    id:       "legend",
    name:     "Legend",
    aliases:  ["legend"],
    keywords: ["legend"]
  }
];

export class ProjectBrain {
  constructor(retrievalEngine) {
    this._retrieval   = retrievalEngine;
    this._uid         = null;
    this._cache       = new Map();   // projectId → brain doc
    this._entryCaches = new Map();   // projectId → entry[]
    this._knownProjects = [...DEFAULT_PROJECT_SIGNATURES];
    this._cacheTime   = new Map();
    this._cacheTTL    = 5 * 60 * 1000;
    this._registryLoaded = false;
  }

  setUID(uid) {
    this._uid = uid;
    this._cache.clear();
    this._entryCaches.clear();
    this._registryLoaded = false;
  }

  // ── Load project registry from Firestore ─────────────────
  // Merges persisted projects into _knownProjects without duplicating
  async loadRegistry() {
    if (!this._uid || this._registryLoaded) return;
    try {
      const persisted = await loadProjectRegistry(this._uid);
      for (const proj of persisted) {
        const existing = this._knownProjects.find(p => p.id === proj.id);
        if (!existing) {
          this._knownProjects.push({
            id:          proj.id,
            name:        proj.name || proj.id,
            aliases:     proj.aliases || [],
            keywords:    proj.keywords || [],
            description: proj.description || "",
            status:      proj.status || "active",
            createdAt:   proj.createdAt,
            lastActive:  proj.lastActive,
            relationships: proj.relationships || [],
            technologies:  proj.technologies || [],
            parent:        proj.parent || null
          });
        } else {
          // Merge — update aliases/keywords from persisted without losing defaults
          existing.aliases  = [...new Set([...(existing.aliases || []), ...(proj.aliases || [])])];
          existing.keywords = [...new Set([...(existing.keywords || []), ...(proj.keywords || [])])];
          if (proj.description)    existing.description    = proj.description;
          if (proj.status)         existing.status         = proj.status;
          if (proj.relationships)  existing.relationships  = proj.relationships;
          if (proj.technologies)   existing.technologies   = proj.technologies;
          if (proj.parent)         existing.parent         = proj.parent;
        }
      }
      this._registryLoaded = true;
    } catch (_) {
      this._registryLoaded = true; // don't retry on error
    }
  }

  // ── Identify which project a message concerns ─────────────
  identifyProject(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    // Score each project by keyword match
    const scores = this._knownProjects.map(proj => {
      let score = 0;

      for (const alias of (proj.aliases || [])) {
        if (lower.includes(alias)) score += 30;
      }
      for (const kw of (proj.keywords || [])) {
        if (lower.includes(kw)) score += 10;
      }

      return { proj, score };
    });

    scores.sort((a, b) => b.score - a.score);

    if (scores[0]?.score >= 10) {
      return {
        id:    scores[0].proj.id,
        name:  scores[0].proj.name,
        score: scores[0].score
      };
    }

    return null;
  }

  // ── Get or create a project brain ─────────────────────────
  async getBrain(projectId) {
    if (!this._uid) return null;

    // Check cache
    const cached = this._cache.get(projectId);
    if (cached && (Date.now() - (this._cacheTime.get(projectId) || 0)) < this._cacheTTL) {
      return cached;
    }

    let brain = await getProjectBrain(this._uid, projectId);

    if (!brain) {
      // Find the project signature
      const sig = this._knownProjects.find(p => p.id === projectId);
      brain = await this._createBrain(projectId, sig?.name || projectId);
    }

    this._cache.set(projectId, brain);
    this._cacheTime.set(projectId, Date.now());
    return brain;
  }

  // ── Get all project brains (for UI) ───────────────────────
  async getAllBrains() {
    if (!this._uid) return [];
    return getAllProjectBrains(this._uid);
  }

  // ── Get entries for a project brain ───────────────────────
  async getEntries(projectId, type = null) {
    if (!this._uid) return [];

    const cacheKey = `${projectId}:${type || "all"}`;
    const cached   = this._entryCaches.get(cacheKey);
    if (cached && (Date.now() - (this._cacheTime.get(cacheKey) || 0)) < this._cacheTTL) {
      return cached;
    }

    const entries = await getProjectBrainEntries(this._uid, projectId, type);
    this._entryCaches.set(cacheKey, entries);
    this._cacheTime.set(cacheKey, Date.now());
    return entries;
  }

  // ── Add a new entry to a project brain ───────────────────
  async addEntry(projectId, {
    type,
    title,
    content,
    confidence  = 0.7,
    importance  = 0.6,
    tags        = [],
    sourceConvId = null,
    metadata    = {}
  }) {
    if (!this._uid) return null;

    // Ensure the brain exists
    await this.getBrain(projectId);

    const entry = {
      projectId,
      type:         type || BRAIN_ENTRY_TYPES.HISTORY,
      title:        title || "",
      content:      content || "",
      confidence,
      importance,
      tags,
      sourceConvId,
      metadata,
      createdAt:    new Date().toISOString(),
      updatedAt:    new Date().toISOString()
    };

    const id = await saveProjectBrainEntry(this._uid, projectId, entry);

    // Invalidate entry caches for this project
    for (const key of this._entryCaches.keys()) {
      if (key.startsWith(projectId + ":")) this._entryCaches.delete(key);
    }

    // Update stats on brain doc
    await this._incrementBrainStat(projectId, type);

    return { ...entry, id };
  }

  // ── Update knowledge from a correction ───────────────────
  async recordCorrection(projectId, { topic, originalConclusion, correction, mistakeId }) {
    return this.addEntry(projectId, {
      type:       BRAIN_ENTRY_TYPES.HISTORY,
      title:      `Correction: ${topic || "unknown topic"}`,
      content:    `Previous conclusion: ${originalConclusion?.slice(0, 200)}\nCorrection: ${correction?.slice(0, 200)}`,
      confidence: 0.9,
      importance: 0.8,
      tags:       ["correction", "mistake", topic].filter(Boolean),
      metadata:   { mistakeId, isCorrectionRecord: true }
    });
  }

  // ── Record a resolved issue ───────────────────────────────
  async recordSolvedIssue(projectId, { title, description, solution }) {
    return this.addEntry(projectId, {
      type:       BRAIN_ENTRY_TYPES.FIX_SUCCEEDED,
      title:      title || "Issue resolved",
      content:    `Problem: ${description?.slice(0, 200)}\nSolution: ${solution?.slice(0, 300)}`,
      confidence: 0.9,
      importance: 0.85,
      tags:       ["solved", "fix"]
    });
  }

  // ── Retrieve relevant brain entries for a query ───────────
  async getRelevantEntries(projectId, query, { topN = 6 } = {}) {
    if (!this._uid || !projectId) return [];

    const entries = await this.getEntries(projectId);
    if (!entries.length) return [];

    // Adapt entries to the format retrieval engine expects
    const adapted = entries.map(e => ({
      ...e,
      fact:    e.content,
      concept: e.title
    }));

    return this._retrieval.retrieveRelevant(adapted, query, {
      topN,
      minScore: 3
    });
  }

  // ── Format brain context for prompt ───────────────────────
  formatForContext(projectId, projectName, entries) {
    if (!entries || entries.length === 0) return "";

    let block = `\n\n--- PROJECT BRAIN: ${projectName || projectId} ---\n`;

    // Group by type for readability
    const byType = {};
    for (const e of entries) {
      if (!byType[e.type]) byType[e.type] = [];
      byType[e.type].push(e);
    }

    const typeLabels = {
      [BRAIN_ENTRY_TYPES.ARCHITECTURE]:    "Architecture",
      [BRAIN_ENTRY_TYPES.TECHNOLOGY]:      "Technology",
      [BRAIN_ENTRY_TYPES.FEATURE]:         "Features",
      [BRAIN_ENTRY_TYPES.BUG]:             "Known Issues",
      [BRAIN_ENTRY_TYPES.FIX_SUCCEEDED]:   "Proven Solutions",
      [BRAIN_ENTRY_TYPES.FIX_FAILED]:      "Failed Approaches",
      [BRAIN_ENTRY_TYPES.FIX_ATTEMPTED]:   "Attempted Fixes",
      [BRAIN_ENTRY_TYPES.DECISION]:        "Decisions",
      [BRAIN_ENTRY_TYPES.REQUIREMENT]:     "Requirements",
      [BRAIN_ENTRY_TYPES.HISTORY]:         "History",
      [BRAIN_ENTRY_TYPES.UNRESOLVED]:      "Unresolved Problems",
      [BRAIN_ENTRY_TYPES.FIREBASE_CONFIG]: "Firebase Config",
      [BRAIN_ENTRY_TYPES.CLOUDFLARE_CONFIG]: "Cloudflare Config",
      [BRAIN_ENTRY_TYPES.IDEA]:            "Ideas (Unconfirmed)",
      [BRAIN_ENTRY_TYPES.ABANDONED]:       "Abandoned",
      [BRAIN_ENTRY_TYPES.SUPERSEDED]:      "Superseded",
      [BRAIN_ENTRY_TYPES.PAUSED]:          "On Hold"
    };

    for (const [type, items] of Object.entries(byType)) {
      const label = typeLabels[type] || type;
      block += `\n[${label.toUpperCase()}]\n`;
      for (const item of items.slice(0, 3)) {
        const conf  = Math.round((item.confidence || 0.7) * 100);
        const state = item.knowledgeState ? ` [${item.knowledgeState}]` : "";
        const temporal = item.temporalState && item.temporalState !== "CURRENT"
          ? ` (${item.temporalState})`
          : "";
        block += `  • ${item.title} (${conf}%${state}${temporal}): ${item.content?.slice(0, 150)}\n`;
      }
    }

    return block;
  }

  // ── Record an idea (NOT a fact — clearly marked as unconfirmed) ──
  async recordIdea(projectId, { title, content, confidence = 0.55, sourceConvId = null }) {
    return this.addEntry(projectId, {
      type:         BRAIN_ENTRY_TYPES.IDEA,
      title:        `IDEA: ${title || "unnamed"}`,
      content:      content || "",
      confidence,
      importance:   0.5,
      tags:         ["idea", "unconfirmed"],
      sourceConvId,
      metadata:     { knowledgeState: KNOWLEDGE_STATE.IDEA, temporalState: TEMPORAL_STATE.PLANNED }
    });
  }

  // ── Mark a previous entry as abandoned / removed ─────────
  async recordAbandoned(projectId, { title, content, reason = null, sourceConvId = null }) {
    return this.addEntry(projectId, {
      type:         BRAIN_ENTRY_TYPES.ABANDONED,
      title:        `REMOVED: ${title || "unnamed"}`,
      content:      `${content || ""}${reason ? `\nReason: ${reason}` : ""}`,
      confidence:   0.85,
      importance:   0.6,
      tags:         ["abandoned", "removed"],
      sourceConvId,
      metadata:     { knowledgeState: KNOWLEDGE_STATE.ABANDONED, temporalState: TEMPORAL_STATE.REMOVED }
    });
  }

  // ── Mark an entry superseded by newer info ────────────────
  async recordSuperseded(projectId, { oldTitle, newTitle, newContent, sourceConvId = null }) {
    return this.addEntry(projectId, {
      type:         BRAIN_ENTRY_TYPES.SUPERSEDED,
      title:        `SUPERSEDED: ${oldTitle || "previous info"}`,
      content:      `Now replaced by: ${newTitle || newContent || "updated information"}`,
      confidence:   0.85,
      importance:   0.7,
      tags:         ["superseded", "correction"],
      sourceConvId,
      metadata:     { knowledgeState: KNOWLEDGE_STATE.SUPERSEDED, temporalState: TEMPORAL_STATE.SUPERSEDED }
    });
  }

  // ── Register a new project dynamically (persists to Firestore) ──
  async registerProject(id, name, aliases = [], keywords = [], extra = {}) {
    const existing = this._knownProjects.find(p => p.id === id);

    // Check for alias overlap before registering to avoid duplication
    // e.g. "Shadow Nexus" and "Shadow Nexus Social" share aliases
    if (!existing) {
      const projectDef = {
        id,
        name,
        aliases:       aliases.map(a => a.toLowerCase()),
        keywords:      keywords.map(k => k.toLowerCase()),
        description:   extra.description   || "",
        status:        extra.status        || "active",
        relationships: extra.relationships || [],
        technologies:  extra.technologies  || [],
        parent:        extra.parent        || null,
        createdAt:     new Date().toISOString()
      };
      this._knownProjects.push(projectDef);

      // Persist to Firestore so it survives reload
      if (this._uid) {
        upsertProjectRegistry(this._uid, projectDef).catch(() => {});
      }
    } else {
      // Update existing with new aliases
      const newAliases = aliases.map(a => a.toLowerCase());
      const newKeywords = keywords.map(k => k.toLowerCase());
      existing.aliases  = [...new Set([...(existing.aliases  || []), ...newAliases])];
      existing.keywords = [...new Set([...(existing.keywords || []), ...newKeywords])];
      if (extra.description)   existing.description   = extra.description;
      if (extra.status)        existing.status        = extra.status;
      if (extra.relationships) existing.relationships = extra.relationships;
      if (extra.technologies)  existing.technologies  = extra.technologies;
      if (extra.parent)        existing.parent        = extra.parent;

      // Persist updates
      if (this._uid) {
        upsertProjectRegistry(this._uid, existing).catch(() => {});
      }
    }
  }

  // ── Detect a new project mentioned for the first time ────
  // Returns { id, name, aliases } if a new project is detected, null otherwise
  detectNewProjectMention(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    // Patterns: "my project [Name]", "project called [Name]", "working on [Name]"
    const newProjectPatterns = [
      /(?:my|our)\s+(?:new\s+)?(?:project|app|website|site|game)\s+(?:called|named)?\s+["']?([A-Z][a-zA-Z0-9 ]{2,30})["']?/i,
      /(?:working\s+on|building|creating|developing)\s+["']?([A-Z][a-zA-Z0-9 ]{2,30})["']?/i,
      /(?:project|app)\s+(?:is\s+)?(?:called|named)\s+["']?([A-Z][a-zA-Z0-9 ]{2,30})["']?/i,
      /["']([A-Z][a-zA-Z0-9 ]{2,30})["']\s+(?:project|app|game|website)/i
    ];

    for (const pattern of newProjectPatterns) {
      const match = text.match(pattern);
      if (match) {
        const name = match[1].trim();
        // Don't register if it matches an existing project
        const existing = this.identifyProject(name);
        if (!existing || existing.score < 20) {
          const id = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
          return {
            id,
            name,
            aliases:  [name.toLowerCase()],
            keywords: name.toLowerCase().split(/\s+/).filter(w => w.length > 2)
          };
        }
      }
    }
    return null;
  }

  // ── Get known project list ────────────────────────────────
  getKnownProjects() {
    return this._knownProjects;
  }

  // ── Private: create a new brain doc ───────────────────────
  async _createBrain(projectId, name) {
    const brain = {
      projectId,
      name,
      description:    "",
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
      stats: {
        knowledgeCount:    0,
        experienceCount:   0,
        knownIssues:       0,
        solvedIssues:      0,
        unresolvedCount:   0,
        mistakeCount:      0,
        lastLearnedAt:     null
      }
    };

    await saveProjectBrain(this._uid, projectId, brain);
    return brain;
  }

  // ── Private: increment a stat ────────────────────────────
  async _incrementBrainStat(projectId, entryType) {
    try {
      const brain   = await getProjectBrain(this._uid, projectId);
      if (!brain) return;

      const stats = brain.stats || {};
      stats.lastLearnedAt = new Date().toISOString();

      if ([BRAIN_ENTRY_TYPES.ARCHITECTURE, BRAIN_ENTRY_TYPES.TECHNOLOGY,
           BRAIN_ENTRY_TYPES.FEATURE, BRAIN_ENTRY_TYPES.DECISION,
           BRAIN_ENTRY_TYPES.REQUIREMENT].includes(entryType)) {
        stats.knowledgeCount = (stats.knowledgeCount || 0) + 1;
      }
      if ([BRAIN_ENTRY_TYPES.HISTORY, BRAIN_ENTRY_TYPES.CONVERSATION,
           BRAIN_ENTRY_TYPES.FIX_ATTEMPTED].includes(entryType)) {
        stats.experienceCount = (stats.experienceCount || 0) + 1;
      }
      if (entryType === BRAIN_ENTRY_TYPES.BUG) {
        stats.knownIssues = (stats.knownIssues || 0) + 1;
      }
      if (entryType === BRAIN_ENTRY_TYPES.FIX_SUCCEEDED) {
        stats.solvedIssues = (stats.solvedIssues || 0) + 1;
      }
      if (entryType === BRAIN_ENTRY_TYPES.UNRESOLVED) {
        stats.unresolvedCount = (stats.unresolvedCount || 0) + 1;
      }

      await updateProjectBrain(this._uid, projectId, { stats });
      this._cache.delete(projectId);
    } catch (_) {}
  }
}
