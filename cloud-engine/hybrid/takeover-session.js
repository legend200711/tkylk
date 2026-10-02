/**
 * 24-HOUR CLOUD ENGINE — Takeover Session
 * cloud-engine/hybrid/takeover-session.js
 *
 * Represents a single live broadcast takeover session in Hybrid Mode.
 * Tracks the lifecycle of one "creator goes live" event.
 *
 * Stage 11 — Hybrid Mode
 */

/* ═══════════════════════════════════
   TAKEOVER SESSION
═══════════════════════════════════ */
export const TAKEOVER_STATE = Object.freeze({
  PREPARING:  'PREPARING',
  ACTIVE:     'ACTIVE',
  ENDING:     'ENDING',
  ENDED:      'ENDED',
  FAILED:     'FAILED',
});

export class TakeoverSession {
  constructor({ sessionId, stationId, ownerId, ingestSessionId }) {
    if (!sessionId)  throw new Error('sessionId required');
    if (!stationId)  throw new Error('stationId required');
    if (!ownerId)    throw new Error('ownerId required');

    this.sessionId       = sessionId;
    this.stationId       = stationId;
    this.ownerId         = ownerId;
    this.ingestSessionId = ingestSessionId ?? null;

    this._state         = TAKEOVER_STATE.PREPARING;
    this._startedAt     = null;
    this._endedAt       = null;
    this._durationSec   = null;
    this._failureReason = null;
  }

  get state()      { return this._state; }
  get isActive()   { return this._state === TAKEOVER_STATE.ACTIVE; }
  get durationSec() { return this._durationSec; }

  activate() {
    this._state     = TAKEOVER_STATE.ACTIVE;
    this._startedAt = new Date().toISOString();
  }

  begin_end() {
    this._state = TAKEOVER_STATE.ENDING;
  }

  complete() {
    this._state    = TAKEOVER_STATE.ENDED;
    this._endedAt  = new Date().toISOString();
    if (this._startedAt) {
      this._durationSec = (Date.now() - new Date(this._startedAt).getTime()) / 1000;
    }
  }

  fail(reason) {
    this._state         = TAKEOVER_STATE.FAILED;
    this._failureReason = reason;
    this._endedAt       = new Date().toISOString();
  }

  snapshot() {
    return {
      sessionId:       this.sessionId,
      stationId:       this.stationId,
      ownerId:         this.ownerId,
      ingestSessionId: this.ingestSessionId,
      state:           this._state,
      startedAt:       this._startedAt,
      endedAt:         this._endedAt,
      durationSec:     this._durationSec,
      failureReason:   this._failureReason,
    };
  }
}
