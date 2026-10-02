// ============================================================
// Reflection Engine
// Consolidates related memories into stronger concepts.
// Runs periodically or when triggered by the learning adapter.
//
// Checkpoint B additions:
//   - Pattern synthesis: detects recurring root causes
//   - Evidence retention: sources, confidence, project scope, timestamps
//   - Minimum evidence threshold (no fabricated patterns)
//   - Cross-memory pattern detection (e.g. 3+ issues → same root cause)
//   - Derived knowledge marked clearly as "reflection-derived"
// ============================================================
import { saveReflection } from "../firebase/firestore-service.js";
import { PRIVACY_LEVELS } from "./memory-engine.js";

// Minimum memories before pattern detection fires
const MIN_PATTERN_EVIDENCE = 3;

// Common root-cause keyword clusters for pattern detection
const ROOT_CAUSE_PATTERNS = [
  { label: "Firebase permissions",   keywords: ["firebase", "permission", "access", "denied", "auth", "firestore", "rules"] },
  { label: "Configuration errors",   keywords: ["config", "configuration", "env", "environment", "setting", "variable", "key"] },
  { label: "CORS / network errors",  keywords: ["cors", "network", "fetch", "request", "origin", "header", "blocked"] },
  { label: "WebGPU availability",    keywords: ["webgpu", "gpu", "model", "inference", "load", "memory"] },
  { label: "Authentication issues",  keywords: ["auth", "login", "token", "session", "expire", "unauthorized"] },
  { label: "Deployment issues",      keywords: ["deploy", "build", "cloudflare", "github", "pages", "publish"] },
  { label: "Type / undefined errors",keywords: ["undefined", "null", "typeerror", "cannot", "read", "property"] }
];

export class ReflectionEngine {
  constructor(memoryEngine, knowledgeEngine, knowledgeGraph) {
    this._memory    = memoryEngine;
    this._knowledge = knowledgeEngine;
    this._graph     = knowledgeGraph;
    this._uid       = null;
  }

  setUID(uid) { this._uid = uid; }

  // ── Trigger reflection for a project ─────────────────────
  async reflectOnProject(project) {
    if (!this._uid) return null;

    const memories = await this._memory.getMemoriesByProject(project);
    if (memories.length < 3) return null;

    const reflection = this._consolidate(project, memories);

    // Checkpoint B: pattern synthesis on failure/error memories
    const patterns = this._detectPatterns(project, memories);
    if (patterns.length > 0) {
      reflection.patterns = patterns;
      reflection.summary += ` Patterns detected: ${patterns.map(p => p.label).join(", ")}.`;
    }

    // Save reflection record
    const saved = await saveReflection(this._uid, {
      project,
      type:            "project-consolidation",
      summary:         reflection.summary,
      conceptsFound:   reflection.concepts,
      patterns:        reflection.patterns || [],
      sourceMemoryIds: memories.map(m => m.id),
      memoryCount:     memories.length,
      createdAt:       new Date().toISOString()
    });

    // Promote consolidated knowledge
    for (const concept of reflection.concepts) {
      const existing = await this._knowledge.getAllKnowledge(project);
      const duplicate = existing.find(k =>
        k.concept?.toLowerCase() === concept.label.toLowerCase() &&
        k.project === project
      );

      if (!duplicate && concept.confidence >= 0.7) {
        await this._knowledge.storeKnowledge({
          concept:           concept.label,
          category:          concept.category,
          fact:              concept.summary,
          project,
          importance:        concept.importance,
          confidence:        concept.confidence,
          confirmationCount: concept.count,
          sourceType:        "reflection",
          privacy:           PRIVACY_LEVELS.PRIVATE,
          relationships:     [project],
          tags:              ["reflected", project.toLowerCase().replace(/\s/g, "-")]
        });
      }
    }

    // Checkpoint B: promote detected patterns as knowledge
    for (const pattern of (reflection.patterns || [])) {
      if (pattern.occurrences < MIN_PATTERN_EVIDENCE) continue;

      const existing = await this._knowledge.getAllKnowledge(project);
      const dup = existing.find(k =>
        k.concept?.toLowerCase().includes(pattern.label.toLowerCase()) &&
        k.project === project &&
        k.sourceType === "reflection-pattern"
      );

      if (!dup) {
        await this._knowledge.storeKnowledge({
          concept:           `Recurring pattern: ${pattern.label}`,
          category:          "pattern",
          fact:              this._buildPatternFact(pattern, project),
          project,
          importance:        Math.min(0.85, 0.55 + pattern.occurrences * 0.08),
          confidence:        Math.min(0.82, 0.45 + pattern.occurrences * 0.1),
          confirmationCount: pattern.occurrences,
          sourceType:        "reflection-pattern",
          privacy:           PRIVACY_LEVELS.PRIVATE,
          relationships:     [project],
          tags:              ["pattern", "reflection-derived", project.toLowerCase().replace(/\s/g, "-")],
          // Evidence chain for transparency
          evidenceCount:     pattern.occurrences,
          evidenceExamples:  pattern.examples.slice(0, 3)
        }).catch(() => {});
      }
    }

    return { id: saved, reflection };
  }

  // ── Consolidate memories into concept clusters ────────────
  _consolidate(project, memories) {
    const clusters = {};

    for (const mem of memories) {
      const key = (mem.category || "general").toLowerCase();
      if (!clusters[key]) clusters[key] = [];
      clusters[key].push(mem);
    }

    const concepts = [];

    for (const [category, items] of Object.entries(clusters)) {
      if (items.length === 0) continue;

      const avgConfidence = items.reduce((s, m) => s + (m.confidence || 0.5), 0) / items.length;
      const avgImportance = items.reduce((s, m) => s + (m.importance || 0.5), 0) / items.length;
      const facts         = items.map(m => m.fact).filter(Boolean);

      concepts.push({
        label:      `${project} — ${category}`,
        category,
        summary:    facts.slice(0, 5).join("; "),
        count:      items.length,
        confidence: avgConfidence,
        importance: avgImportance
      });
    }

    const summary = `${project}: ${concepts.map(c => `${c.count} ${c.category} records`).join(", ")} consolidated from ${memories.length} memories.`;

    return { summary, concepts };
  }

  // ── Checkpoint B: Detect recurring root-cause patterns ────
  // Requires at minimum MIN_PATTERN_EVIDENCE memories matching a pattern.
  // Does not fabricate patterns — only derives from actual stored evidence.
  _detectPatterns(project, memories) {
    const patterns = [];
    const textCorpus = memories
      .map(m => `${m.fact || ""} ${m.concept || ""} ${(m.tags || []).join(" ")}`.toLowerCase())
      .filter(Boolean);

    for (const patternDef of ROOT_CAUSE_PATTERNS) {
      const matchingMems = memories.filter((mem, i) => {
        const text = textCorpus[i] || "";
        const matchCount = patternDef.keywords.filter(kw => text.includes(kw)).length;
        return matchCount >= 2; // Require at least 2 keyword matches
      });

      if (matchingMems.length >= MIN_PATTERN_EVIDENCE) {
        patterns.push({
          label:       patternDef.label,
          occurrences: matchingMems.length,
          examples:    matchingMems.slice(0, 3).map(m => ({
            concept:   m.concept,
            fact:      (m.fact || "").slice(0, 120),
            createdAt: m.createdAt || m.lastObserved || null
          })),
          firstSeen:   matchingMems
            .map(m => m.createdAt || m.lastObserved)
            .filter(Boolean)
            .sort()[0] || null
        });
      }
    }

    return patterns;
  }

  // ── Build a human-readable pattern fact ──────────────────
  _buildPatternFact(pattern, project) {
    const examplesText = pattern.examples
      .map(e => e.concept || "")
      .filter(Boolean)
      .join(", ");

    return `In ${project}, "${pattern.label}" has caused issues ${pattern.occurrences} times.` +
      (examplesText ? ` Related: ${examplesText}.` : "") +
      ` This is a reflection-derived pattern — not a single observation.` +
      ` Evidence basis: ${pattern.occurrences} memories matching this pattern.`;
  }

  // ── Reflect on recent interactions (global) ───────────────
  async reflectRecent(limitDays = 7) {
    if (!this._uid) return [];

    const allMemories = await this._memory.getAllMemories();
    const cutoff      = Date.now() - limitDays * 24 * 60 * 60 * 1000;

    const recent = allMemories.filter(m => {
      const t = new Date(m.lastObserved || m.createdAt || 0).getTime();
      return t >= cutoff;
    });

    // Group by project
    const byProject = {};
    for (const m of recent) {
      const proj = m.project || "_general";
      if (!byProject[proj]) byProject[proj] = [];
      byProject[proj].push(m);
    }

    const results = [];
    for (const [proj, mems] of Object.entries(byProject)) {
      if (mems.length >= 3 && proj !== "_general") {
        const r = await this.reflectOnProject(proj);
        if (r) results.push(r);
      }
    }

    return results;
  }

  // ── Get synthesized patterns for a project ────────────────
  async getPatternsForProject(project) {
    if (!this._uid) return [];
    const memories = await this._memory.getMemoriesByProject(project);
    if (memories.length < MIN_PATTERN_EVIDENCE) return [];
    return this._detectPatterns(project, memories);
  }
}
