// ============================================================
// Emotion Engine
// Simulated emotional state that influences response style.
// These are computational state dimensions — NOT claims of
// human consciousness or biological experience.
// ============================================================
import { saveEmotionalState, loadEmotionalState } from "../firebase/firestore-service.js";

const DEFAULT_STATE = {
  curiosity:   0.75,
  confidence:  0.70,
  concern:     0.20,
  excitement:  0.55,
  frustration: 0.10,
  calm:        0.80,
  familiarity: 0.60
};

// How much each dimension drifts back toward baseline per interaction
const BASELINE_PULL = 0.05;

// Dimension bounds
const MIN = 0.0;
const MAX = 1.0;

function clamp(v) { return Math.max(MIN, Math.min(MAX, v)); }

export class EmotionEngine {
  constructor() {
    this._state    = { ...DEFAULT_STATE };
    this._uid      = null;
    this._dirty    = false;
  }

  async initialize(uid) {
    this._uid = uid;
    const saved = await loadEmotionalState(uid);
    if (saved) {
      // Merge saved values, ignore Firebase metadata
      for (const key of Object.keys(DEFAULT_STATE)) {
        if (typeof saved[key] === "number") {
          this._state[key] = clamp(saved[key]);
        }
      }
    }
    return this._state;
  }

  getState() { return { ...this._state }; }

  // ── Update based on interaction signals ──────────────────────
  processInteraction(signals) {
    /**
     * signals: {
     *   newInfo: bool,         — new information learned
     *   correction: bool,      — user corrected Shadow Reaper
     *   taskSuccess: bool,     — confirmed something worked
     *   taskFailure: bool,     — confirmed something failed
     *   repeated: bool,        — user repeating themselves
     *   familiar: bool,        — familiar project/topic
     *   complex: bool,         — complex/difficult topic
     *   positive: bool,        — positive acknowledgment
     *   negative: bool,        — negative feedback
     *   longConv: bool,        — extended conversation
     *   question: bool         — user asked a question
     * }
     */

    const s = this._state;

    if (signals.newInfo)     { s.curiosity   = clamp(s.curiosity   + 0.08); s.excitement = clamp(s.excitement + 0.05); }
    if (signals.question)    { s.curiosity   = clamp(s.curiosity   + 0.04); }
    if (signals.correction)  { s.confidence  = clamp(s.confidence  - 0.10); s.concern    = clamp(s.concern    + 0.08); }
    if (signals.taskSuccess) { s.confidence  = clamp(s.confidence  + 0.08); s.excitement = clamp(s.excitement + 0.06); s.frustration = clamp(s.frustration - 0.10); }
    if (signals.taskFailure) { s.frustration = clamp(s.frustration + 0.12); s.concern    = clamp(s.concern    + 0.10); s.confidence  = clamp(s.confidence  - 0.06); }
    if (signals.repeated)    { s.frustration = clamp(s.frustration + 0.08); s.concern    = clamp(s.concern    + 0.05); }
    if (signals.familiar)    { s.familiarity = clamp(s.familiarity + 0.06); s.confidence = clamp(s.confidence + 0.04); s.calm        = clamp(s.calm        + 0.04); }
    if (signals.complex)     { s.curiosity   = clamp(s.curiosity   + 0.05); s.calm       = clamp(s.calm       - 0.05); s.concern     = clamp(s.concern     + 0.04); }
    if (signals.positive)    { s.confidence  = clamp(s.confidence  + 0.06); s.calm       = clamp(s.calm       + 0.04); s.frustration = clamp(s.frustration - 0.06); }
    if (signals.negative)    { s.concern     = clamp(s.concern     + 0.08); s.frustration = clamp(s.frustration + 0.06); }
    if (signals.longConv)    { s.familiarity = clamp(s.familiarity + 0.04); }

    // Baseline drift — emotions gradually return toward default
    for (const key of Object.keys(DEFAULT_STATE)) {
      const baseline = DEFAULT_STATE[key];
      const current  = s[key];
      if (current > baseline) s[key] = clamp(current - BASELINE_PULL * 0.3);
      else if (current < baseline) s[key] = clamp(current + BASELINE_PULL * 0.3);
    }

    this._dirty = true;
  }

  // Direct adjustment (for admin override)
  adjust(dimension, delta) {
    if (!(dimension in this._state)) return;
    this._state[dimension] = clamp(this._state[dimension] + delta);
    this._dirty = true;
  }

  forceSet(dimension, value) {
    if (!(dimension in this._state)) return;
    this._state[dimension] = clamp(value);
    this._dirty = true;
  }

  async persist() {
    if (!this._dirty || !this._uid) return;
    await saveEmotionalState(this._uid, this._state);
    this._dirty = false;
  }

  getEmotionColor(dimension) {
    const value = this._state[dimension] ?? 0;
    if (dimension === "frustration" || dimension === "concern") {
      // Higher = more red/orange
      const r = Math.round(value * 255);
      const g = Math.round((1 - value) * 100);
      return `rgb(${r}, ${g}, 60)`;
    }
    // Higher = more green/blue
    const g = Math.round(value * 200 + 55);
    const b = Math.round(value * 100 + 100);
    return `rgb(20, ${g}, ${b})`;
  }

  getSummaryString() {
    return Object.entries(this._state)
      .map(([k, v]) => `${k}: ${v.toFixed(2)}`)
      .join(", ");
  }
}
