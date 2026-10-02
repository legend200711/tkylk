// ============================================================
// Retrieval Engine
// Scores and ranks memories/knowledge by relevance to query.
// Semantic relevance uses keyword/concept overlap + scoring.
//
// Checkpoint B enhancements:
//   - knowledge state penalty (failed solutions deprioritized)
//   - successful solution boost
//   - explicit correction override (newer correction beats old high-confidence)
//   - temporal state awareness (REMOVED/SUPERSEDED penalized)
//   - relationship context boost
//   - fresh explicit corrections always beat stale high-confidence
// ============================================================

const STOP_WORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being",
  "have","has","had","do","does","did","will","would","should",
  "could","may","might","shall","can","need","dare","ought",
  "it","its","i","you","he","she","we","they","them","their",
  "this","that","these","those","what","which","who","how","when",
  "where","why","to","of","in","on","at","by","for","with",
  "about","into","through","during","and","or","but","if","then"
]);

// Knowledge states that should be deprioritized in retrieval
const DEPRIORITIZED_STATES = new Set([
  "FAILED_APPROACH", "ABANDONED", "SUPERSEDED", "REMOVED"
]);

// Knowledge states that should be boosted
const BOOSTED_STATES = new Set([
  "SUCCESSFUL_APPROACH", "DECISION", "FACT"
]);

export class RetrievalEngine {
  constructor() {}

  // ── Tokenize for matching ─────────────────────────────────
  tokenize(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }

  // ── Score a single record against a query ────────────────
  scoreRecord(record, queryTokens, context = {}) {
    let score = 0;

    const fields = [
      record.concept || "",
      record.fact || record.content || "",
      record.category || "",
      record.project || "",
      record.detail || "",
      (record.tags || []).join(" "),
      (record.relationships || []).join(" ")
    ].join(" ");

    const recordTokens = this.tokenize(fields);
    const recordSet    = new Set(recordTokens);

    // Token overlap score
    let matchCount = 0;
    for (const qt of queryTokens) {
      if (recordSet.has(qt)) matchCount++;
    }

    if (queryTokens.length > 0) {
      score += (matchCount / queryTokens.length) * 60;
    }

    // Exact phrase matching bonus
    const lowerFields = fields.toLowerCase();
    for (const qt of queryTokens) {
      if (lowerFields.includes(qt)) score += 2;
    }

    // Project relevance boost
    if (context.project && record.project === context.project) {
      score += 25;
    }

    // Importance boost
    score += (record.importance || 0.5) * 15;

    // Confidence boost (reduced — correction recency matters more)
    score += (record.confidence || 0.5) * 8;

    // Confirmation boost
    score += Math.min(5, (record.confirmationCount || 1) * 1);

    // Contradiction penalty
    score -= (record.contradictionCount || 0) * 5;

    // ── Checkpoint B: Knowledge state scoring ────────────────
    const ks = record.knowledgeState || "";
    const ts = record.temporalState  || "";

    // Successful solution: strongly boost
    if (ks === "SUCCESSFUL_APPROACH" || (record.tags || []).includes("fix-succeeded")) {
      score += 20;
    }

    // Known fact or confirmed decision: boost
    if (BOOSTED_STATES.has(ks)) {
      score += 10;
    }

    // Failed/abandoned/superseded: penalize
    if (DEPRIORITIZED_STATES.has(ks) || DEPRIORITIZED_STATES.has(ts)) {
      score -= 15;
    }

    // Temporal state: REMOVED items should rarely surface
    if (ts === "REMOVED" || ts === "ABANDONED") {
      score -= 20;
    }

    // ── Checkpoint B: Recency vs. explicit correction override ─
    // If this record is an explicit correction (sourceType = "correction" or
    // category = "correction"), give it a strong recency bonus to ensure it
    // outranks older high-confidence records on the same topic.
    const isCorrection = record.sourceType === "correction" ||
                         record.category   === "correction"  ||
                         (record.tags || []).includes("correction");

    const lastObserved = record.lastObserved || record.updatedAt || record.createdAt;
    if (lastObserved) {
      const ageMs  = Date.now() - new Date(lastObserved).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (isCorrection) {
        // Corrections decay very slowly — they stay relevant for a long time
        score += Math.max(0, 20 - ageDays * 0.1);
      } else {
        // Normal freshness decay
        score += Math.max(0, 10 - ageDays * 0.2);
      }
    }

    // Memory type weighting
    if (record.memoryType === "procedural") score += 5;
    if (record.memoryType === "episodic")   score += 3;

    return score;
  }

  // ── Retrieve top-N relevant records ──────────────────────
  retrieveRelevant(records, query, options = {}) {
    const {
      topN     = 10,
      minScore = 5,
      context  = {}
    } = options;

    if (!records || records.length === 0) return [];

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) {
      // No query tokens — return most important recent items
      return [...records]
        .sort((a, b) => (b.importance || 0) - (a.importance || 0))
        .slice(0, topN);
    }

    const scored = records.map(r => ({
      record: r,
      score:  this.scoreRecord(r, queryTokens, context)
    }));

    // Sort — corrections always outrank same-topic older records
    // when the query is directly relevant
    return scored
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(s => ({ ...s.record, _relevanceScore: s.score }));
  }

  // ── Retrieve explicitly including failed solutions ────────
  // Used by project brain context to show full history
  retrieveWithHistory(records, query, options = {}) {
    const { topN = 6, context = {} } = options;
    if (!records || records.length === 0) return [];

    const queryTokens = this.tokenize(query);
    const scored = records.map(r => ({
      record: r,
      score:  this._scoreForHistory(r, queryTokens, context)
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(s => ({ ...s.record, _relevanceScore: s.score }));
  }

  // History scoring does not penalize failed/abandoned entries —
  // they are useful for understanding what has been tried
  _scoreForHistory(record, queryTokens, context) {
    const fields = [
      record.concept || "",
      record.fact || record.content || "",
      record.category || "",
      record.project || "",
      (record.tags || []).join(" ")
    ].join(" ");

    const recordSet = new Set(this.tokenize(fields));
    let matchCount = 0;
    for (const qt of queryTokens) if (recordSet.has(qt)) matchCount++;
    let score = queryTokens.length > 0 ? (matchCount / queryTokens.length) * 60 : 0;

    if (context.project && record.project === context.project) score += 25;
    score += (record.importance || 0.5) * 10;

    const lastObserved = record.lastObserved || record.updatedAt;
    if (lastObserved) {
      const ageDays = (Date.now() - new Date(lastObserved).getTime()) / 86400000;
      score += Math.max(0, 8 - ageDays * 0.1);
    }

    return score;
  }

  // ── Extract project context from query ───────────────────
  detectProject(query, knownProjects) {
    if (!query || !knownProjects?.length) return null;
    const lower = query.toLowerCase();
    for (const p of knownProjects) {
      if (lower.includes(p.name?.toLowerCase() || "")) return p.name;
    }
    return null;
  }

  // ── Extract keywords for learning ────────────────────────
  extractKeywords(text, topN = 10) {
    const tokens = this.tokenize(text);
    const freq = {};
    for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([word]) => word);
  }
}
