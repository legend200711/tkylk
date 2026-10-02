/**
 * 24-HOUR CLOUD ENGINE — Security Errors
 * cloud-engine/security/security-errors.js
 *
 * Error types for the security subsystem.
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

/* ═══════════════════════════════════
   SECURITY ERROR CODES
═══════════════════════════════════ */
export const SECURITY_ERROR_CODE = Object.freeze({
  // Authentication
  NOT_AUTHENTICATED:          'NOT_AUTHENTICATED',
  INVALID_TOKEN:              'INVALID_TOKEN',
  TOKEN_EXPIRED:              'TOKEN_EXPIRED',

  // Authorization
  UNAUTHORIZED:               'UNAUTHORIZED',
  INSUFFICIENT_ROLE:          'INSUFFICIENT_ROLE',
  PERMISSION_DENIED:          'PERMISSION_DENIED',

  // Ownership
  OWNERSHIP_VIOLATION:        'OWNERSHIP_VIOLATION',
  CROSS_ACCOUNT_ACCESS:       'CROSS_ACCOUNT_ACCESS',

  // Input validation
  INVALID_INPUT:              'INVALID_INPUT',
  SCHEMA_VIOLATION:           'SCHEMA_VIOLATION',
  OVERSIZED_PAYLOAD:          'OVERSIZED_PAYLOAD',
  MALFORMED_ID:               'MALFORMED_ID',

  // Path / injection
  PATH_TRAVERSAL:             'PATH_TRAVERSAL',
  COMMAND_INJECTION:          'COMMAND_INJECTION',
  SHELL_INJECTION:            'SHELL_INJECTION',
  UNSAFE_PROTOCOL:            'UNSAFE_PROTOCOL',

  // Network destination
  SSRF_BLOCKED:               'SSRF_BLOCKED',
  LOCALHOST_BLOCKED:          'LOCALHOST_BLOCKED',
  PRIVATE_NETWORK_BLOCKED:    'PRIVATE_NETWORK_BLOCKED',
  METADATA_ENDPOINT_BLOCKED:  'METADATA_ENDPOINT_BLOCKED',
  MALFORMED_URL:              'MALFORMED_URL',

  // Replay / idempotency
  REPLAY_DETECTED:            'REPLAY_DETECTED',
  COMMAND_EXPIRED:            'COMMAND_EXPIRED',
  DUPLICATE_COMMAND:          'DUPLICATE_COMMAND',

  // Rate limiting
  RATE_LIMITED:               'RATE_LIMITED',
  ABUSE_DETECTED:             'ABUSE_DETECTED',

  // Credential security
  CREDENTIAL_EXPOSURE_BLOCKED:'CREDENTIAL_EXPOSURE_BLOCKED',
  UNSAFE_STORAGE:             'UNSAFE_STORAGE',
  VAULT_NOT_CONFIGURED:       'VAULT_NOT_CONFIGURED',

  // General
  SECURITY_POLICY_VIOLATION:  'SECURITY_POLICY_VIOLATION',
});

/* ═══════════════════════════════════
   SECURITY ERROR CLASS
═══════════════════════════════════ */
export class SecurityError extends Error {
  /**
   * @param {string} code    SECURITY_ERROR_CODE.*
   * @param {string} message Human-readable message (must not contain secrets)
   * @param {object} [safe]  Safe metadata for audit (no credentials)
   */
  constructor(code, message, safe = {}) {
    super(message);
    this.name      = 'SecurityError';
    this.code      = code;
    this.safe      = safe;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name:      this.name,
      code:      this.code,
      message:   this.message,
      timestamp: this.timestamp,
      // 'safe' is intentionally omitted from JSON to prevent
      // partial information disclosure in API responses
    };
  }

  /** For audit log only — includes safe metadata but not credentials. */
  toAuditEntry() {
    return {
      name:      this.name,
      code:      this.code,
      message:   this.message,
      timestamp: this.timestamp,
      safe:      this.safe,
    };
  }
}
