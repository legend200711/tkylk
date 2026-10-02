/**
 * 24-HOUR CLOUD ENGINE — Encoder Error Codes
 * cloud-engine/encoder/encoder-errors.js
 *
 * Defines all error codes used throughout the Shadow Encoder.
 * Provides a structured EncoderError class so errors are distinguishable
 * from generic JS errors and can be serialised for state/logging.
 *
 * Stage 2 — Shadow Encoder
 */

/* ═══════════════════════════════════
   ERROR CODES
═══════════════════════════════════ */
export const ENCODER_ERROR_CODE = Object.freeze({
  ENCODER_NOT_INITIALIZED:   'ENCODER_NOT_INITIALIZED',
  MEDIA_NOT_FOUND:           'MEDIA_NOT_FOUND',
  MEDIA_UNSUPPORTED:         'MEDIA_UNSUPPORTED',
  MEDIA_PROBE_FAILED:        'MEDIA_PROBE_FAILED',
  NO_MEDIA_LOADED:           'NO_MEDIA_LOADED',
  INVALID_STATE:             'INVALID_STATE',
  ENCODER_START_FAILED:      'ENCODER_START_FAILED',
  ENCODER_PROCESS_CRASHED:   'ENCODER_PROCESS_CRASHED',
  OUTPUT_FAILED:             'OUTPUT_FAILED',
  ENCODER_STOP_FAILED:       'ENCODER_STOP_FAILED',
  CODEC_ENGINE_NOT_FOUND:    'CODEC_ENGINE_NOT_FOUND',
  PROFILE_NOT_FOUND:         'PROFILE_NOT_FOUND',
  PAUSE_NOT_SUPPORTED:       'PAUSE_NOT_SUPPORTED',
  PATH_TRAVERSAL_DENIED:     'PATH_TRAVERSAL_DENIED',
  OUTPUT_OUTSIDE_ALLOWED:    'OUTPUT_OUTSIDE_ALLOWED',
});

/* ═══════════════════════════════════
   ENCODER ERROR CLASS
═══════════════════════════════════ */

/**
 * Structured error thrown by Shadow Encoder components.
 *
 * @property {string} code     One of ENCODER_ERROR_CODE.*
 * @property {string} message  Human-readable description.
 * @property {object} meta     Additional context (never includes secrets).
 */
export class EncoderError extends Error {
  /**
   * @param {string} code    ENCODER_ERROR_CODE constant
   * @param {string} message Human-readable message
   * @param {object} [meta]  Optional context (no secrets)
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name       = 'EncoderError';
    this.code       = code;
    this.meta       = meta;
    this.timestamp  = new Date().toISOString();

    // Ensure stack trace points at the caller, not this constructor
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EncoderError);
    }
  }

  /**
   * Serialise to a plain object suitable for logging/state.
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
