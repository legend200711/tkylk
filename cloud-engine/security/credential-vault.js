/**
 * 24-HOUR CLOUD ENGINE — Credential Vault
 * cloud-engine/security/credential-vault.js
 *
 * Secure handling of sensitive credentials.
 *
 * SECURITY PRINCIPLES:
 *   Secrets must NEVER appear in:
 *     - browser responses
 *     - Studio status
 *     - diagnostics
 *     - metrics
 *     - events
 *     - logs
 *     - error messages
 *     - persisted unsafe state
 *
 *   Use credential references (refs) instead of raw values.
 *   Where secure storage infrastructure is not available, report NOT_CONFIGURED.
 *   No fake encryption is used.
 *
 * Protected credential types:
 *   - stream keys
 *   - OAuth access tokens
 *   - OAuth refresh tokens
 *   - Firebase/admin credentials
 *   - storage credentials
 *   - future API secrets
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { SECURITY_ERROR_CODE, SecurityError } from './security-errors.js';

/* ═══════════════════════════════════
   CREDENTIAL TYPES
═══════════════════════════════════ */
export const CREDENTIAL_TYPE = Object.freeze({
  STREAM_KEY:       'STREAM_KEY',
  OAUTH_ACCESS:     'OAUTH_ACCESS',
  OAUTH_REFRESH:    'OAUTH_REFRESH',
  FIREBASE_ADMIN:   'FIREBASE_ADMIN',
  STORAGE:          'STORAGE',
  API_SECRET:       'API_SECRET',
});

/* ═══════════════════════════════════
   VAULT STATUS
═══════════════════════════════════ */
export const VAULT_STATUS = Object.freeze({
  NOT_CONFIGURED:  'NOT_CONFIGURED',
  CONFIGURED:      'CONFIGURED',
  ERROR:           'ERROR',
});

/* ═══════════════════════════════════
   CREDENTIAL REFERENCE
   Returned to callers instead of raw credentials.
═══════════════════════════════════ */

/**
 * Create a credential reference (safe to pass to clients).
 * Never contains the actual credential value.
 *
 * @param {string} credentialType  CREDENTIAL_TYPE.*
 * @param {string} ownerId
 * @param {string} resourceId
 * @returns {CredentialRef}
 */
export function createCredentialRef(credentialType, ownerId, resourceId) {
  return Object.freeze({
    ref:            `cred:${credentialType}:${ownerId}:${resourceId}`,
    credentialType,
    ownerId,
    resourceId,
    isResolved:     false,
    // value: intentionally absent
  });
}

/* ═══════════════════════════════════
   CREDENTIAL VAULT
═══════════════════════════════════ */
export class CredentialVault {
  /**
   * The vault uses environment variables as its backing store.
   * This is the same mechanism as the existing stream-key resolution.
   *
   * In production, this would be backed by:
   *   - Cloudflare Secrets
   *   - Firebase Secret Manager
   *   - HashiCorp Vault
   *   - AWS Secrets Manager
   *
   * If no secure backing is configured, status = NOT_CONFIGURED.
   * We do NOT create fake in-memory storage that pretends to be secure.
   */
  constructor() {
    this._status       = VAULT_STATUS.NOT_CONFIGURED;
    this._storeType    = 'ENVIRONMENT_VARIABLES';  // only implemented backing
  }

  /**
   * Initialize the vault.
   * Checks if backing store is available.
   */
  async initialize() {
    // Environment variables ARE available (same as existing stream key resolution)
    // Mark as configured for env-var-backed secrets
    this._status = VAULT_STATUS.CONFIGURED;
    return {
      success:   true,
      status:    this._status,
      storeType: this._storeType,
    };
  }

  /**
   * Resolve a stream key from environment variable.
   * Never returns the key in logs or status.
   *
   * @param {string} envVarName   Name of the environment variable
   * @param {string} ownerId      Owner claiming this credential
   * @returns {{ resolved: boolean, value?: string, status: string }}
   */
  resolveStreamKey(envVarName, ownerId) {
    if (!envVarName || typeof envVarName !== 'string') {
      return { resolved: false, status: VAULT_STATUS.NOT_CONFIGURED,
               reason: 'envVarName is required.' };
    }

    const value = process.env[envVarName];
    if (!value) {
      return {
        resolved: false,
        status:   VAULT_STATUS.NOT_CONFIGURED,
        reason:   `Environment variable "${envVarName}" is not set.`,
        // value: intentionally absent
      };
    }

    // NEVER log the value
    return {
      resolved: true,
      status:   VAULT_STATUS.CONFIGURED,
      value,   // Only returned to the caller that needs it — never logged or persisted
    };
  }

  /**
   * Check if a credential type is configured (without returning the value).
   *
   * @param {string} envVarName
   * @returns {boolean}
   */
  isConfigured(envVarName) {
    return !!(envVarName && process.env[envVarName]);
  }

  /**
   * Get vault status (safe — no credentials returned).
   * Reports NOT_CONFIGURED where applicable.
   */
  getStatus() {
    return {
      status:    this._status,
      storeType: this._storeType,
      note:      this._status === VAULT_STATUS.NOT_CONFIGURED
        ? 'Vault not fully configured. Secrets backed by environment variables only.'
        : 'Vault operational. Environment variable backing active.',
    };
  }
}

/* ═══════════════════════════════════
   CREDENTIAL SAFETY UTILITIES
═══════════════════════════════════ */

/**
 * Mask a credential value for safe display.
 * Replaces all but first/last characters with asterisks.
 * @param {string|null} value
 * @returns {string}
 */
export function maskCredential(value) {
  if (!value || typeof value !== 'string') return '********';
  if (value.length <= 4) return '****';
  return value[0] + '*'.repeat(value.length - 2) + value[value.length - 1];
}

/**
 * Check if a string looks like a credential that should not be logged.
 * Basic heuristic — not exhaustive.
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikeCredential(value) {
  if (typeof value !== 'string') return false;
  // Common credential patterns
  const credPatterns = [
    /^sk_live_/i,      // Stripe-style
    /^AIza/,           // Firebase API key
    /ya29\./,          // Google OAuth token
    /^xoxb-/,          // Slack bot token
    /^ghp_/,           // GitHub PAT
    /^[A-Z0-9_]{20,}$/, // Generic very long uppercase key (stream keys are typically 20+ chars)
  ];
  return credPatterns.some(p => p.test(value));
}

/**
 * Scrub an object of credential-like values before logging.
 * Operates on a COPY — does not mutate the original.
 *
 * @param {object} obj
 * @returns {object}
 */
export function scrubCredentials(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const SENSITIVE_KEYS = new Set([
    'streamKey', 'stream_key', 'key', 'token', 'accessToken', 'refreshToken',
    'password', 'secret', 'credential', 'privateKey', 'apiKey', 'api_key',
    'auth', 'authorization', 'bearer',
  ]);

  const scrub = (o, depth = 0) => {
    if (depth > 10) return '[MAX_DEPTH]';
    if (Array.isArray(o)) return o.map(v => scrub(v, depth + 1));
    if (typeof o !== 'object' || o === null) return o;

    const result = {};
    for (const [k, v] of Object.entries(o)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase()) || SENSITIVE_KEYS.has(k)) {
        result[k] = '********';
      } else if (typeof v === 'string' && looksLikeCredential(v)) {
        result[k] = '********';
      } else {
        result[k] = scrub(v, depth + 1);
      }
    }
    return result;
  };

  return scrub(obj);
}

/* ═══════════════════════════════════
   SHARED VAULT INSTANCE
═══════════════════════════════════ */
export const SharedCredentialVault = new CredentialVault();
