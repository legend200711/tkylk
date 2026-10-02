// ============================================================
// Confidence Engine
// Tracks, scores, and adjusts confidence levels for learned
// knowledge and memories. Prevents Shadow Reaper from treating
// uncertain information as established fact.
// ============================================================
import {
  saveConfidenceRecord, getConfidenceRecords
} from "../firebase/firestore-service.js";

// ── Confidence tiers ──────────────────────────────────────
export const CONFIDENCE_TIER = {
  KNOWN:      "KNOWN",       // ≥ 0.85
  LIKELY:     "LIKELY",      // ≥ 0.65
  UNCERTAIN:  "UNCERTAIN",   // ≥ 0.40
  CONFLICTED: "CONFLICTED",  // contradictionCount > confirmationCount
  OUTDATED:   "OUTDATED"     // Last confirmed > 90 days ago, or superseded
};

// ── Confidence score thresholds ───────────────────────────
const TIER_THRESHOLDS = {
  KNOWN:     0.85,
  LIKELY:    0.65,
  UNCERTAIN: 0.40
};

// ── Score adjustments ─────────────────────────────────────
const DELTA = {
  NEW_INFORMATION:    0.00,  // Starting point
  FIRST_CONFIRMATION: 0.08,
  REPEAT_CONFIRMATION: 0.05,
  EXPLICIT_VERIFY:    0.12,
  CONTRADICTION:      -0.18,
  CORRECTION:         -0.25,
  TIME_DECAY_PER_DAY: 0.001  // Very slow decay
};

export class ConfidenceEngine {
  constructor() {
    this._uid   = null;
    this._cache = new Map();   // conceptKey → record
    this._dirty = new Set();   // Keys needing persistence
    this._saveTimer = null;
  }

  setUID(uid) {
    this._uid  = uid;
    this._cache.clear();
    this._dirty.clear();
  }

  // ── Get or initialize a confidence record for a concept ──
  async getRecord(conceptKey, initialData = {}) {
    if (!this._uid) return null;

    if (this._cache.has(conceptKey)) {
      return this._applyDecay(this._cache.get(conceptKey));
    }

    // Load all records lazily once
    await this._loadCache();

    if (this._cache.has(conceptKey)) {
      return this._applyDecay(this._cache.get(conceptKey));
    }

    // Create new record
    const record = this._newRecord(conceptKey, initialData);
    this._cache.set(conceptKey, record);
    this._dirty.add(conceptKey);
    this._scheduleSave();
    return record;
  }

  // ── Classify a confidence score as a tier label ──────────
  classify(score, record = null) {
    // Check for conflicted state first
    if (record) {
      const contraCount = record.contradictionCount || 0;
      const confirmCount = record.confirmationCount || 1;
      if (contraCount > 0 && contraCount >= confirmCount) {
        return CONFIDENCE_TIER.CONFLICTED;
      }
      // Check for outdated
      if (this._isOutdated(record)) {
        return CONFIDENCE_TIER.OUTDATED;
      }
    }

    if (score >= TIER_THRESHOLDS.KNOWN)     return CONFIDENCE_TIER.KNOWN;
    if (score >= TIER_THRESHOLDS.LIKELY)    return CONFIDENCE_TIER.LIKELY;
    if (score >= TIER_THRESHOLDS.UNCERTAIN) return CONFIDENCE_TIER.UNCERTAIN;
    return CONFIDENCE_TIER.UNCERTAIN;
  }

  // ── Register new information (initial creation) ───────────
  async registerNew(conceptKey, { confidence = 0.50, sourceType = "conversation" } = {}) {
    const record = await this.getRecord(conceptKey);
    if (!record) return null;

    // Only update if this is actually brand new
    if (record.confirmationCount <= 1 && record.contradictionCount === 0) {
      record.confidence = Math.max(record.confidence, confidence);
      record.sourceCount = (record.sourceCount || 1);
      record.updatedAt = new Date().toISOString();
      this._dirty.add(conceptKey);
      this._scheduleSave();
    }
    return record;
  }

  // ── Apply a confirmation event ────────────────────────────
  async confirm(conceptKey, { explicit = false } = {}) {
    const record = await this.getRecord(conceptKey);
    if (!record) return null;

    const delta = explicit ? DELTA.EXPLICIT_VERIFY
                : record.confirmationCount === 0 ? DELTA.FIRST_CONFIRMATION
                : DELTA.REPEAT_CONFIRMATION;

    record.confirmationCount = (record.confirmationCount || 0) + 1;
    record.confidence        = Math.min(0.98, record.confidence + delta);
    record.lastConfirmedAt   = new Date().toISOString();
    record.updatedAt         = new Date().toISOString();

    this._cache.set(conceptKey, record);
    this._dirty.add(conceptKey);
    this._scheduleSave();
    return record;
  }

  // ── Apply a contradiction event ───────────────────────────
  async contradict(conceptKey) {
    const record = await this.getRecord(conceptKey);
    if (!record) return null;

    record.contradictionCount  = (record.contradictionCount || 0) + 1;
    record.confidence          = Math.max(0.05, record.confidence + DELTA.CONTRADICTION);
    record.lastContradictedAt  = new Date().toISOString();
    record.updatedAt           = new Date().toISOString();

    this._cache.set(conceptKey, record);
    this._dirty.add(conceptKey);
    this._scheduleSave();
    return record;
  }

  // ── Apply a correction (stronger than contradiction) ──────
  async applyCorrection(conceptKey, newFact = null) {
    const record = await this.getRecord(conceptKey);
    if (!record) return null;

    record.contradictionCount  = (record.contradictionCount || 0) + 1;
    record.confidence          = Math.max(0.05, record.confidence + DELTA.CORRECTION);
    record.lastContradictedAt  = new Date().toISOString();
    record.updatedAt           = new Date().toISOString();
    if (newFact) record.supersededBy = newFact;

    this._cache.set(conceptKey, record);
    this._dirty.add(conceptKey);
    this._scheduleSave();
    return record;
  }

  // ── Format confidence for context injection ───────────────
  formatForContext(records) {
    if (!records || records.length === 0) return "";

    const lowConf = records.filter(r => {
      const tier = this.classify(r.confidence, r);
      return tier !== CONFIDENCE_TIER.KNOWN;
    });

    if (lowConf.length === 0) return "";

    let block = "\n\n--- CONFIDENCE NOTES ---\n";
    for (const r of lowConf) {
      const tier = this.classify(r.confidence, r);
      const pct  = Math.round(r.confidence * 100);
      block += `[${tier}] ${r.conceptKey}: ${pct}% confidence`;
      if (tier === CONFIDENCE_TIER.CONFLICTED) block += " (conflicting information exists)";
      if (tier === CONFIDENCE_TIER.OUTDATED)   block += " (may be outdated)";
      block += "\n";
    }
    block += "When referencing these concepts, communicate appropriate uncertainty.\n";
    return block;
  }

  // ── Generate uncertainty phrasing hint for the model ─────
  getUncertaintyHint(tier) {
    switch (tier) {
      case CONFIDENCE_TIER.KNOWN:
        return null; // No qualifier needed
      case CONFIDENCE_TIER.LIKELY:
        return "Based on what I know, though I'm not fully certain:";
      case CONFIDENCE_TIER.UNCERTAIN:
        return "I'm not highly confident about this, but:";
      case CONFIDENCE_TIER.CONFLICTED:
        return "I have conflicting information on this — please verify:";
      case CONFIDENCE_TIER.OUTDATED:
        return "This information may be outdated:";
      default:
        return null;
    }
  }

  // ── Get overall confidence stats ─────────────────────────
  async getStats() {
    const all = await this._loadCache();
    const records = [...this._cache.values()];
    const tiers = { KNOWN: 0, LIKELY: 0, UNCERTAIN: 0, CONFLICTED: 0, OUTDATED: 0 };

    for (const r of records) {
      const tier = this.classify(r.confidence, r);
      tiers[tier] = (tiers[tier] || 0) + 1;
    }

    return {
      total:       records.length,
      tiers,
      avgConf:     records.length
        ? records.reduce((s, r) => s + r.confidence, 0) / records.length
        : 0
    };
  }

  // ── Apply time-based confidence decay ─────────────────────
  _applyDecay(record) {
    if (!record.lastConfirmedAt) return record;

    const ageDays = (Date.now() - new Date(record.lastConfirmedAt).getTime()) / 86400000;
    if (ageDays < 1) return record;

    const decayed = Math.max(0.1, record.confidence - ageDays * DELTA.TIME_DECAY_PER_DAY);

    // Only apply decay if it crosses a tier boundary to avoid thrashing
    const oldTier = this.classify(record.confidence, record);
    const newTier = this.classify(decayed, record);
    if (oldTier !== newTier) {
      record.confidence = decayed;
      record.updatedAt  = new Date().toISOString();
      this._dirty.add(record.conceptKey);
      this._scheduleSave();
    }

    return record;
  }

  _isOutdated(record) {
    if (!record.lastConfirmedAt) return false;
    const ageDays = (Date.now() - new Date(record.lastConfirmedAt).getTime()) / 86400000;
    return ageDays > 90;
  }

  // ── Create a new confidence record ───────────────────────
  _newRecord(conceptKey, initialData = {}) {
    return {
      conceptKey,
      confidence:          initialData.confidence ?? 0.50,
      confirmationCount:   initialData.confirmationCount ?? 0,
      contradictionCount:  initialData.contradictionCount ?? 0,
      sourceCount:         initialData.sourceCount ?? 1,
      lastConfirmedAt:     null,
      lastContradictedAt:  null,
      createdAt:           new Date().toISOString(),
      updatedAt:           new Date().toISOString()
    };
  }

  // ── Load all records from Firestore into cache ─────────────
  async _loadCache() {
    if (!this._uid || this._cache.size > 0) return this._cache;
    try {
      const records = await getConfidenceRecords(this._uid);
      for (const r of records) {
        this._cache.set(r.conceptKey, r);
      }
    } catch (_) {}
    return this._cache;
  }

  // ── Debounced save ────────────────────────────────────────
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._flushDirty(), 3000);
  }

  async _flushDirty() {
    if (!this._uid || this._dirty.size === 0) return;
    const keys = [...this._dirty];
    this._dirty.clear();
    for (const key of keys) {
      const record = this._cache.get(key);
      if (!record) continue;
      try {
        await saveConfidenceRecord(this._uid, record);
      } catch (_) {}
    }
  }
}
