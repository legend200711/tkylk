/**
 * 24-HOUR CLOUD ENGINE — Recovery Errors
 * cloud-engine/recovery/recovery-errors.js
 *
 * Error types and codes for the recovery subsystem.
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

/* ═══════════════════════════════════
   RECOVERY ERROR CODES
═══════════════════════════════════ */
export const RECOVERY_ERROR_CODE = Object.freeze({
  // Policy errors
  MAX_ATTEMPTS_EXCEEDED:       'MAX_ATTEMPTS_EXCEEDED',
  COOLDOWN_ACTIVE:             'COOLDOWN_ACTIVE',
  POLICY_NOT_FOUND:            'POLICY_NOT_FOUND',
  INVALID_POLICY:              'INVALID_POLICY',

  // Component errors
  COMPONENT_NOT_FOUND:         'COMPONENT_NOT_FOUND',
  COMPONENT_UNRECOVERABLE:     'COMPONENT_UNRECOVERABLE',
  RECOVERY_IN_PROGRESS:        'RECOVERY_IN_PROGRESS',

  // State errors
  STATE_CORRUPT:               'STATE_CORRUPT',
  STATE_OWNERSHIP_MISMATCH:    'STATE_OWNERSHIP_MISMATCH',
  STATE_STALE:                 'STATE_STALE',
  STATE_UNSAFE_RESTORE:        'STATE_UNSAFE_RESTORE',

  // Encoder errors
  ENCODER_CRASH:               'ENCODER_CRASH',
  ENCODER_STALLED:             'ENCODER_STALLED',
  ENCODER_BEHIND:              'ENCODER_BEHIND',
  ORPHAN_PROCESS:              'ORPHAN_PROCESS',

  // Ingest errors
  INGEST_DISCONNECTED:         'INGEST_DISCONNECTED',
  INGEST_STALLED:              'INGEST_STALLED',

  // Destination errors
  DESTINATION_DISCONNECTED:    'DESTINATION_DISCONNECTED',
  TRANSPORT_CRASH:             'TRANSPORT_CRASH',
  RECONNECT_EXHAUSTED:         'RECONNECT_EXHAUSTED',

  // Control-plane errors
  CONTROL_PLANE_FAILURE:       'CONTROL_PLANE_FAILURE',

  // General
  UNKNOWN_FAILURE:             'UNKNOWN_FAILURE',
  FATAL:                       'FATAL',
});

/* ═══════════════════════════════════
   RECOVERY ACTIONS
═══════════════════════════════════ */
export const RECOVERY_ACTION = Object.freeze({
  RETRY:               'RETRY',
  RECONNECT:           'RECONNECT',
  RESTART_COMPONENT:   'RESTART_COMPONENT',
  RESTART_SOURCE:      'RESTART_SOURCE',
  RETURN_TO_STATION:   'RETURN_TO_STATION',
  USE_FALLBACK:        'USE_FALLBACK',
  ESCALATE:            'ESCALATE',
  FATAL:               'FATAL',
  NONE:                'NONE',
});

/* ═══════════════════════════════════
   RECOVERY ERROR CLASS
═══════════════════════════════════ */
export class RecoveryError extends Error {
  /**
   * @param {string} code    RECOVERY_ERROR_CODE.*
   * @param {string} message Human-readable message
   * @param {object} [meta]  Safe additional metadata (no secrets)
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name       = 'RecoveryError';
    this.code       = code;
    this.meta       = meta;
    this.timestamp  = new Date().toISOString();
  }

  toJSON() {
    return {
      name:      this.name,
      code:      this.code,
      message:   this.message,
      timestamp: this.timestamp,
      meta:      this.meta,
    };
  }
}
