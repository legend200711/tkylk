/**
 * 24-HOUR CLOUD ENGINE — Broadcast Error Codes
 * cloud-engine/broadcast/broadcast-errors.js
 *
 * Defines all error codes used throughout the Shadow Broadcast Engine.
 * Provides a structured BroadcastError class so errors are distinguishable
 * from generic JS errors and can be serialised for state/logging.
 *
 * Stage 3 — Shadow Broadcast Engine
 */

/* ═══════════════════════════════════
   ERROR CODES
═══════════════════════════════════ */
export const BROADCAST_ERROR_CODE = Object.freeze({
  BROADCAST_NOT_INITIALIZED:   'BROADCAST_NOT_INITIALIZED',
  DESTINATION_NOT_CONFIGURED:  'DESTINATION_NOT_CONFIGURED',
  DESTINATION_INVALID:         'DESTINATION_INVALID',
  STREAM_KEY_MISSING:          'STREAM_KEY_MISSING',
  PROTOCOL_UNSUPPORTED:        'PROTOCOL_UNSUPPORTED',
  CONNECTION_FAILED:           'CONNECTION_FAILED',
  CONNECTION_LOST:             'CONNECTION_LOST',
  BROADCAST_START_FAILED:      'BROADCAST_START_FAILED',
  BROADCAST_PROCESS_CRASHED:   'BROADCAST_PROCESS_CRASHED',
  RECONNECT_FAILED:            'RECONNECT_FAILED',
  BROADCAST_STOP_FAILED:       'BROADCAST_STOP_FAILED',
  ENCODER_NOT_READY:           'ENCODER_NOT_READY',
  ENCODER_TOO_SLOW:            'ENCODER_TOO_SLOW',
  INVALID_STATE:               'INVALID_STATE',
  ALREADY_BROADCASTING:        'ALREADY_BROADCASTING',
  PATH_TRAVERSAL_DENIED:       'PATH_TRAVERSAL_DENIED',
});

/* ═══════════════════════════════════
   BROADCAST ERROR CLASS
═══════════════════════════════════ */

/**
 * Structured error thrown by Shadow Broadcast Engine components.
 *
 * @property {string} code     One of BROADCAST_ERROR_CODE.*
 * @property {string} message  Human-readable description.
 * @property {object} meta     Additional context (NEVER includes stream keys or secrets).
 */
export class BroadcastError extends Error {
  /**
   * @param {string} code    BROADCAST_ERROR_CODE constant
   * @param {string} message Human-readable message
   * @param {object} [meta]  Optional context (NO SECRETS — stream keys are never passed here)
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name      = 'BroadcastError';
    this.code      = code;
    this.meta      = meta;
    this.timestamp = new Date().toISOString();

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BroadcastError);
    }
  }

  /**
   * Serialise to a plain object suitable for logging/state.
   * NEVER includes the stream key or any secret.
   * @returns {{ code:string, message:string, timestamp:string, meta:object }}
   */
  toJSON() {
    return {
      code:      this.code,
      message:   this.message,
      timestamp: this.timestamp,
      meta:      this.meta,
    };
  }
}
