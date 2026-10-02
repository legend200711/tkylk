/**
 * 24-HOUR CLOUD ENGINE — Hybrid State
 * cloud-engine/hybrid/hybrid-state.js
 *
 * Tracks the state of Hybrid Mode for a given session.
 * This state is serializable for logging and recovery.
 *
 * Stage 11 — Hybrid Mode
 */

import { HYBRID_STATE, RESUME_STRATEGY } from './hybrid-errors.js';

/* ═══════════════════════════════════
   HYBRID STATE
═══════════════════════════════════ */
export class HybridModeState {
  constructor({ stationId, ownerId, resumeStrategy = RESUME_STRATEGY.CURRENT_SCHEDULE }) {
    this.stationId      = stationId;
    this.ownerId        = ownerId;
    this.resumeStrategy = resumeStrategy;

    this._hybridState        = HYBRID_STATE.OFFLINE;
    this._liveSession        = null;  // Active takeover session
    this._interruptedAt      = null;  // When live took over
    this._interruptedProgram = null;  // What was playing when live started
    this._resumedAt          = null;
    this._liveStartedAt      = null;
    this._lastError          = null;
    this._transitionCount    = 0;     // Number of live→station transitions
  }

  /* ── Getters ────────────────────────────────────────────── */
  get hybridState()        { return this._hybridState; }
  get isLive()             { return this._hybridState === HYBRID_STATE.LIVE; }
  get isStation()          { return this._hybridState === HYBRID_STATE.STATION; }
  get interruptedProgram() { return this._interruptedProgram ? { ...this._interruptedProgram } : null; }

  /* ── Transitions ────────────────────────────────────────── */

  setStationMode() {
    this._hybridState = HYBRID_STATE.STATION;
    this._liveSession = null;
  }

  startLivePrep(session) {
    this._hybridState   = HYBRID_STATE.PREPARING_LIVE;
    this._liveSession   = session;
    this._liveStartedAt = new Date().toISOString();
  }

  setLiveActive(interruptedProgram) {
    this._hybridState        = HYBRID_STATE.LIVE;
    this._interruptedAt      = new Date().toISOString();
    this._interruptedProgram = interruptedProgram ?? null;
  }

  startReturning() {
    this._hybridState = HYBRID_STATE.RETURNING_TO_STATION;
  }

  completeReturn() {
    this._hybridState  = HYBRID_STATE.STATION;
    this._resumedAt    = new Date().toISOString();
    this._liveSession  = null;
    this._transitionCount++;
  }

  setError(code, message) {
    this._lastError   = { code, message, at: new Date().toISOString() };
    this._hybridState = HYBRID_STATE.ERROR;
  }

  clearError() {
    this._lastError = null;
  }

  /* ── Serialization ─────────────────────────────────────── */

  snapshot() {
    return {
      stationId:           this.stationId,
      ownerId:             this.ownerId,
      hybridState:         this._hybridState,
      resumeStrategy:      this.resumeStrategy,
      isLive:              this.isLive,
      liveStartedAt:       this._liveStartedAt,
      interruptedAt:       this._interruptedAt,
      interruptedProgram:  this.interruptedProgram,
      resumedAt:           this._resumedAt,
      transitionCount:     this._transitionCount,
      lastError:           this._lastError,
      asOf:                new Date().toISOString(),
    };
  }
}
