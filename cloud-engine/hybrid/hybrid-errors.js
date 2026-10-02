/**
 * 24-HOUR CLOUD ENGINE — Hybrid Mode Errors & States
 * cloud-engine/hybrid/hybrid-errors.js
 *
 * Defines all state constants, events, and error codes for Hybrid Mode.
 *
 * Hybrid Mode combines 24-Hour TV Station + Creator Live Broadcast.
 * The TV station runs continuously; a live broadcast can take over
 * temporarily, then the station resumes at the schedule-correct position.
 *
 * Stage 11 — Hybrid Mode
 */

/* ═══════════════════════════════════
   HYBRID STATES
═══════════════════════════════════ */
export const HYBRID_STATE = Object.freeze({
  STATION:            'STATION',           // Normal TV station playback
  PREPARING_LIVE:     'PREPARING_LIVE',    // Live takeover being set up
  LIVE:               'LIVE',              // Creator is live; station paused
  RETURNING_TO_STATION: 'RETURNING_TO_STATION', // Transitioning back
  ERROR:              'ERROR',
  OFFLINE:            'OFFLINE',
});

/* ═══════════════════════════════════
   RESUME STRATEGIES
   When live ends, how does the station resume?
═══════════════════════════════════ */
export const RESUME_STRATEGY = Object.freeze({
  CURRENT_SCHEDULE:   'CURRENT_SCHEDULE',  // (DEFAULT) Determine what SHOULD be airing NOW
  RESUME_INTERRUPTED: 'RESUME_INTERRUPTED', // Resume the item that was interrupted
  NEXT_ITEM:          'NEXT_ITEM',         // Skip interrupted item, go to next scheduled
});

/* ═══════════════════════════════════
   HYBRID EVENTS
═══════════════════════════════════ */
export const HYBRID_EVENT = Object.freeze({
  HYBRID_LIVE_PREPARING:  'HYBRID_LIVE_PREPARING',
  HYBRID_LIVE_STARTED:    'HYBRID_LIVE_STARTED',
  HYBRID_LIVE_FAILED:     'HYBRID_LIVE_FAILED',
  HYBRID_RETURNING:       'HYBRID_RETURNING',
  HYBRID_STATION_RESUMED: 'HYBRID_STATION_RESUMED',
});

/* ═══════════════════════════════════
   ERROR CODES
═══════════════════════════════════ */
export const HYBRID_ERROR_CODE = Object.freeze({
  NOT_CONFIGURED:           'NOT_CONFIGURED',
  NO_STATION:               'NO_STATION',
  ALREADY_LIVE:             'ALREADY_LIVE',
  NOT_LIVE:                 'NOT_LIVE',
  LIVE_TAKEOVER_FAILED:     'LIVE_TAKEOVER_FAILED',
  STATION_RESUME_FAILED:    'STATION_RESUME_FAILED',
  INVALID_STATE:            'INVALID_STATE',
  ACCESS_DENIED:            'ACCESS_DENIED',
});

/* ═══════════════════════════════════
   HYBRID ERROR CLASS
═══════════════════════════════════ */
export class HybridError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name      = 'HybridError';
    this.code      = code;
    this.meta      = meta;
    this.timestamp = new Date().toISOString();

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HybridError);
    }
  }

  toJSON() {
    return { code: this.code, message: this.message, timestamp: this.timestamp, meta: this.meta };
  }
}
