/**
 * 24-HOUR CLOUD ENGINE — Platform Errors
 * cloud-engine/platforms/platform-errors.js
 *
 * Defines all error codes and the PlatformError class for the
 * platform connection layer.
 *
 * Stage 8 — Platform Connections
 */

/* ═══════════════════════════════════
   ERROR CODES
═══════════════════════════════════ */
export const PLATFORM_ERROR_CODE = Object.freeze({
  // Configuration
  NOT_CONFIGURED:              'NOT_CONFIGURED',
  INVALID_CONFIG:              'INVALID_CONFIG',
  MISSING_CREDENTIALS:         'MISSING_CREDENTIALS',

  // Authentication / OAuth
  AUTH_REQUIRED:               'AUTH_REQUIRED',
  TOKEN_EXPIRED:               'TOKEN_EXPIRED',
  TOKEN_REFRESH_FAILED:        'TOKEN_REFRESH_FAILED',
  OAUTH_FLOW_FAILED:           'OAUTH_FLOW_FAILED',
  REVOKE_FAILED:               'REVOKE_FAILED',

  // Connection
  CONNECTION_FAILED:           'CONNECTION_FAILED',
  CONNECTION_TIMEOUT:          'CONNECTION_TIMEOUT',
  ALREADY_CONNECTED:           'ALREADY_CONNECTED',
  NOT_CONNECTED:               'NOT_CONNECTED',

  // Platform-specific
  PLATFORM_REJECTED:           'PLATFORM_REJECTED',
  PLATFORM_UNAVAILABLE:        'PLATFORM_UNAVAILABLE',
  STREAM_KEY_MISSING:          'STREAM_KEY_MISSING',
  DESTINATION_BUILD_FAILED:    'DESTINATION_BUILD_FAILED',

  // Validation
  VALIDATION_FAILED:           'VALIDATION_FAILED',

  // Operation not supported
  OPERATION_NOT_SUPPORTED:     'OPERATION_NOT_SUPPORTED',

  // Test connection
  TEST_FAILED:                 'TEST_FAILED',
});

/* ═══════════════════════════════════
   PLATFORM ERROR CLASS
═══════════════════════════════════ */
export class PlatformError extends Error {
  /**
   * @param {string} code     PLATFORM_ERROR_CODE constant
   * @param {string} message  Human-readable message
   * @param {object} [meta]   Additional context (NO SECRETS)
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name      = 'PlatformError';
    this.code      = code;
    this.meta      = meta;
    this.timestamp = new Date().toISOString();

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PlatformError);
    }
  }

  toJSON() {
    return {
      code:      this.code,
      message:   this.message,
      timestamp: this.timestamp,
      meta:      this.meta,
    };
  }
}
