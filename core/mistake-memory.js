// ============================================================
// Mistake Memory
// Records incorrect answers, failed solutions, and corrections.
// Before answering, retrieves relevant past mistakes to prevent
// Shadow Reaper from repeating the same reasoning errors.
// ============================================================
import {
  saveMistake, getMistakes, updateMistake
} from "../firebase/firestore-service.js";
import { PRIVACY_LEVELS } from "./memory-engine.js";

// ── Confidence level labels ───────────────────────────────
export const MISTAKE_STATUS = {
  UNCONFIRMED: "unconfirmed",  // Recorded but not yet validated
  CONFIRMED:   "confirmed",    // Correction later confirmed correct
  SUPERSEDED:  "superseded"    // A later correction replaced this
};

export class MistakeMemory {
  constructor(retrievalEngine) {
    this._retrieval = retrievalEngine;
    this._uid       = null;
    this._cache     = null;         // Lazy-loaded cache
    this._cacheTime = 0;
    this._cacheTTL  = 5 * 60 * 1000; // 5-minute TTL
  }

  setUID(uid) {
    this._uid   = uid;
    this._cache = null;
  }

  // ── Record a new mistake ──────────────────────────────────
  async recordMistake({
    originalQuestion,
    originalResponse,
    correction,
    projectId     = null,
    topic         = null,
    subject       = null,
    confidenceBefore = 0.5,
    lesson        = null,
    conversationId = null
  }) {
    if (!this._uid) return null;

    const derivedLesson = lesson || this._deriveLesson(originalQuestion, correction);

    const record = {
      originalQuestion:   originalQuestion?.slice(0, 500) || "",
      originalConclusion: originalResponse?.slice(0, 500) || "",
      correction:         correction?.slice(0, 500) || "",
      lesson:             derivedLesson,
      projectId:          projectId  || null,
      topic:              topic      || this._detectTopic(originalQuestion, originalResponse),
      subject:            subject    || null,
      confidence:         confidenceBefore,
      status:             MISTAKE_STATUS.UNCONFIRMED,
      confirmed:          false,
      conversationId:     conversationId || null,
      createdAt:          new Date().toISOString(),
      lastRelevantAt:     new Date().toISOString(),
      privacy:            PRIVACY_LEVELS.PRIVATE
    };

    const id = await saveMistake(this._uid, record);
    const stored = { ...record, id };

    // Invalidate cache
    this._cache = null;

    return stored;
  }

  // ── Retrieve relevant past mistakes for a question ───────
  async getRelevantMistakes(query, options = {}) {
    if (!this._uid) return [];

    const {
      topN      = 3,
      project   = null,
      minScore  = 8
    } = options;

    const all = await this._loadCache();
    if (all.length === 0) return [];

    // Score each mistake for relevance to the current query
    const queryTokens = this._retrieval.tokenize(query);

    const scored = all.map(m => {
      // Build a searchable text block from this mistake
      const text = [
        m.originalQuestion,
        m.originalConclusion,
        m.correction,
        m.lesson,
        m.topic,
        m.subject,
        m.projectId
      ].filter(Boolean).join(" ");

      const tokens = this._retrieval.tokenize(text);
      const tokenSet = new Set(tokens);

      let score = 0;
      for (const qt of queryTokens) {
        if (tokenSet.has(qt)) score += 10;
      }

      // Project match bonus
      if (project && m.projectId === project) score += 20;

      // Confirmed mistakes are more reliable
      if (m.confirmed) score += 5;

      // Recency bonus
      if (m.lastRelevantAt) {
        const ageDays = (Date.now() - new Date(m.lastRelevantAt).getTime()) / 86400000;
        score += Math.max(0, 5 - ageDays * 0.1);
      }

      return { mistake: m, score };
    });

    return scored
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(s => {
        // Update lastRelevantAt (fire-and-forget)
        if (s.mistake.id) {
          this._touchMistake(s.mistake.id);
        }
        return s.mistake;
      });
  }

  // ── Confirm a previously recorded mistake was correct ────
  async confirmMistake(mistakeId) {
    if (!this._uid || !mistakeId) return;
    await updateMistake(this._uid, mistakeId, {
      confirmed:   true,
      status:      MISTAKE_STATUS.CONFIRMED,
      confirmedAt: new Date().toISOString()
    });
    this._cache = null;
  }

  // ── Mark a mistake as superseded by a newer correction ───
  async supersedeMistake(mistakeId, newMistakeId) {
    if (!this._uid || !mistakeId) return;
    await updateMistake(this._uid, mistakeId, {
      status:          MISTAKE_STATUS.SUPERSEDED,
      supersededById:  newMistakeId
    });
    this._cache = null;
  }

  // ── Get all mistakes (for dashboard) ─────────────────────
  async getAllMistakes() {
    if (!this._uid) return [];
    return this._loadCache();
  }

  // ── Format mistakes for context injection ─────────────────
  formatForContext(mistakes) {
    if (!mistakes || mistakes.length === 0) return "";

    let block = "\n\n--- PREVIOUS CORRECTIONS TO AVOID REPEATING ---\n";
    for (const m of mistakes) {
      block += `\n[PAST MISTAKE`;
      if (m.projectId) block += ` — ${m.projectId}`;
      if (m.topic)     block += ` / ${m.topic}`;
      block += `]\n`;
      block += `Original reasoning: ${m.originalConclusion?.slice(0, 150)}\n`;
      block += `Correction given:   ${m.correction?.slice(0, 150)}\n`;
      block += `Lesson:             ${m.lesson}\n`;
      if (m.confirmed) block += `(This correction was confirmed as accurate)\n`;
    }
    return block;
  }

  // ── Count mistakes by project (for UI) ──────────────────
  async countByProject() {
    const all = await this._loadCache();
    const counts = {};
    for (const m of all) {
      const k = m.projectId || "_general";
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }

  // ── Private: load and cache from Firestore ────────────────
  async _loadCache() {
    const now = Date.now();
    if (this._cache && (now - this._cacheTime) < this._cacheTTL) {
      return this._cache;
    }
    this._cache     = await getMistakes(this._uid);
    this._cacheTime = now;
    return this._cache;
  }

  async _touchMistake(mistakeId) {
    try {
      await updateMistake(this._uid, mistakeId, {
        lastRelevantAt: new Date().toISOString()
      });
    } catch (_) {}
  }

  // ── Private: derive a lesson string ──────────────────────
  _deriveLesson(question, correction) {
    if (!correction) return "Answer was incorrect; see correction.";
    // Extract the substance of the correction as the lesson
    const cleaned = correction
      .replace(/^(actually|no,?|you('re| are) wrong[,.]?|that('s| is) (not |in)?correct[,.]?)\s*/i, "")
      .trim();
    return cleaned.slice(0, 200) || "Answer was incorrect; see correction.";
  }

  // ── Private: detect topic from text ──────────────────────
  _detectTopic(question, response) {
    const combined = ((question || "") + " " + (response || "")).toLowerCase();

    if (/tv|stream|playback|video|channel/i.test(combined))    return "media-playback";
    if (/firebase|firestore|database|auth/i.test(combined))    return "firebase";
    if (/cloudflare|r2|worker|pages/i.test(combined))          return "cloudflare";
    if (/webgpu|model|llm|ai|inference/i.test(combined))       return "ai-model";
    if (/css|layout|style|design/i.test(combined))             return "ui-design";
    if (/api|fetch|request|endpoint/i.test(combined))          return "api";
    if (/error|bug|crash|exception/i.test(combined))           return "debugging";
    if (/access|permission|guest|user/i.test(combined))        return "access-control";

    return "general";
  }
}
