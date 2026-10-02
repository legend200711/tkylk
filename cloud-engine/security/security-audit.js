/**
 * 24-HOUR CLOUD ENGINE — Security Audit Utilities
 * cloud-engine/security/security-audit.js
 *
 * Utilities for security auditing, secret detection, and safe reporting.
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { scrubCredentials, looksLikeCredential } from './credential-vault.js';

/* ═══════════════════════════════════
   SECRET DETECTION
═══════════════════════════════════ */

/**
 * Check if any value in an object looks like a secret/credential.
 * Returns a list of suspicious field paths.
 *
 * @param {object} obj
 * @param {string} [prefix]
 * @returns {string[]}  Paths to suspicious fields
 */
export function findSuspiciousFields(obj, prefix = '') {
  if (!obj || typeof obj !== 'object') return [];

  const suspicious = [];

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string' && looksLikeCredential(value)) {
      suspicious.push(path);
    } else if (typeof value === 'object' && value !== null) {
      suspicious.push(...findSuspiciousFields(value, path));
    }
  }

  return suspicious;
}

/**
 * Assert that an object does not contain any secret-looking values.
 * Throws if secrets are detected.
 *
 * Used to validate that API responses, events, and log entries
 * are safe to emit.
 *
 * @param {object} obj
 * @param {string} [context]  For error messages
 * @throws {Error} If secrets detected
 */
export function assertNoSecrets(obj, context = 'object') {
  const suspicious = findSuspiciousFields(obj);
  if (suspicious.length > 0) {
    throw new Error(
      `SECURITY: Potential secret detected in ${context} at: ${suspicious.join(', ')}. ` +
      `NEVER expose credentials in responses, logs, or events.`
    );
  }
}

/**
 * Create a safe copy of an object for use in API responses or logs.
 * Scrubs all credential-like values.
 *
 * @param {object} obj
 * @returns {object}
 */
export function safeCopy(obj) {
  return scrubCredentials(obj);
}

/**
 * Validate that a status/response object is safe for external consumption.
 * Returns the scrubbed version.
 *
 * @param {object} response
 * @param {string} [context]
 * @returns {object}  Scrubbed response
 */
export function makeSafeResponse(response, context = 'response') {
  return scrubCredentials(response);
}

/* ═══════════════════════════════════
   SECURITY DIAGNOSTICS
═══════════════════════════════════ */

/**
 * Generate a security audit summary.
 * Safe for display — no credentials.
 *
 * @returns {object}
 */
export function getSecurityDiagnostics() {
  return {
    status: 'ACTIVE',
    capabilities: {
      ownershipEnforcement:    'ACTIVE',
      roleBasedAccess:         'ACTIVE',
      credentialVault:         'NOT_CONFIGURED',  // env-var only
      commandIdempotency:      'ACTIVE',
      replayProtection:        'ACTIVE',
      inputValidation:         'ACTIVE',
      pathTraversalProtection: 'ACTIVE',
      shellInjectionProtection:'ACTIVE',
      ssrfProtection:          'ACTIVE',
      rateLimiting:            'ACTIVE',
      auditLogging:            'ACTIVE',
      mediaIsolation:          'ACTIVE',
      recoveryAccountIsolation:'ACTIVE',
    },
    limitations: [
      'Credential vault uses environment variables only — NOT a hardware HSM or cloud secret manager',
      'In-memory rate limiter — resets on process restart',
      'Audit log in-memory only — not persisted in Stage 13',
      'Firebase role enforcement requires external Firebase deployment',
      'Camera/Mic/WebRTC: NOT_IMPLEMENTED',
    ],
    note: 'There is no backdoor, master password, or universal access token.',
  };
}
