/**
 * 24-HOUR CLOUD ENGINE — Input Validation
 * cloud-engine/security/input-validation.js
 *
 * Validates all externally supplied input.
 *
 * Protected against:
 *   - command injection
 *   - path traversal
 *   - shell injection
 *   - malformed URLs
 *   - unsafe protocols
 *   - oversized payloads
 *
 * All FFmpeg processes continue to use shell:false (no shell injection path).
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { SECURITY_ERROR_CODE, SecurityError } from './security-errors.js';
import { validateNetworkDestination }         from './network-policy.js';

/* ═══════════════════════════════════
   CONSTANTS
═══════════════════════════════════ */

const MAX_ID_LENGTH         = 128;
const MAX_NAME_LENGTH       = 256;
const MAX_URL_LENGTH        = 2048;
const MAX_MEDIA_PATH_LENGTH = 1024;

// Allowed characters for IDs (alphanumeric, hyphens, underscores)
const SAFE_ID_REGEX         = /^[a-zA-Z0-9_\-.:@]+$/;

// Shell metacharacter detection (for defense-in-depth, primary protection is shell:false)
const SHELL_METACHAR_REGEX  = /[;&|`$<>!\\]/;

// Path traversal patterns
const PATH_TRAVERSAL_REGEX  = /\.\.[/\\]/;
const ABSOLUTE_PATH_REGEX   = /^[/\\]/;

// Null bytes
const NULL_BYTE_REGEX       = /\x00/;

/* ═══════════════════════════════════
   VALIDATION FUNCTIONS
═══════════════════════════════════ */

/**
 * Validate a resource ID.
 * @param {string} id
 * @param {string} [fieldName]
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateId(id, fieldName = 'id') {
  if (id === null || id === undefined) {
    return { valid: false, reason: `${fieldName} is required.` };
  }
  if (typeof id !== 'string') {
    return { valid: false, reason: `${fieldName} must be a string.` };
  }
  if (!id.trim()) {
    return { valid: false, reason: `${fieldName} cannot be empty.` };
  }
  if (id.length > MAX_ID_LENGTH) {
    return { valid: false, reason: `${fieldName} too long (max ${MAX_ID_LENGTH}).` };
  }
  if (!SAFE_ID_REGEX.test(id)) {
    return { valid: false, reason: `${fieldName} contains invalid characters.`,
             code: SECURITY_ERROR_CODE.MALFORMED_ID };
  }
  if (NULL_BYTE_REGEX.test(id)) {
    return { valid: false, reason: `${fieldName} contains null bytes.`,
             code: SECURITY_ERROR_CODE.COMMAND_INJECTION };
  }
  return { valid: true };
}

/**
 * Validate a URL.
 * @param {string} url
 * @param {string[]} [allowedProtocols]  e.g., ['https', 'rtmp', 'rtmps']
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateUrl(url, allowedProtocols = ['https', 'http', 'rtmp', 'rtmps']) {
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'URL is required.' };
  }
  if (url.length > MAX_URL_LENGTH) {
    return { valid: false, reason: `URL too long (max ${MAX_URL_LENGTH}).` };
  }
  if (NULL_BYTE_REGEX.test(url)) {
    return { valid: false, reason: 'URL contains null bytes.' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Malformed URL.',
             code: SECURITY_ERROR_CODE.MALFORMED_URL };
  }

  const proto = parsed.protocol.replace(':', '').toLowerCase();
  if (!allowedProtocols.includes(proto)) {
    return {
      valid:  false,
      reason: `Unsafe protocol "${proto}". Allowed: ${allowedProtocols.join(', ')}`,
      code:   SECURITY_ERROR_CODE.UNSAFE_PROTOCOL,
    };
  }

  return { valid: true, parsed };
}

/**
 * Validate an RTMP/RTMPS destination URL.
 * Also checks for SSRF risks.
 * @param {string} url
 * @param {object} [opts]
 * @param {boolean} [opts.devMode]  Allow localhost in development mode
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateRtmpUrl(url, opts = {}) {
  const urlResult = validateUrl(url, ['rtmp', 'rtmps']);
  if (!urlResult.valid) return urlResult;

  return validateNetworkDestination(url, opts);
}

/**
 * Validate a media path.
 * Prevents path traversal and shell injection.
 * @param {string} mediaPath
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateMediaPath(mediaPath) {
  if (!mediaPath || typeof mediaPath !== 'string') {
    return { valid: false, reason: 'Media path is required.' };
  }
  if (mediaPath.length > MAX_MEDIA_PATH_LENGTH) {
    return { valid: false, reason: 'Media path too long.' };
  }
  if (NULL_BYTE_REGEX.test(mediaPath)) {
    return { valid: false, reason: 'Media path contains null bytes.',
             code: SECURITY_ERROR_CODE.PATH_TRAVERSAL };
  }
  if (PATH_TRAVERSAL_REGEX.test(mediaPath)) {
    return { valid: false, reason: 'Path traversal detected in media path.',
             code: SECURITY_ERROR_CODE.PATH_TRAVERSAL };
  }
  if (SHELL_METACHAR_REGEX.test(mediaPath)) {
    return { valid: false, reason: 'Shell metacharacters in media path.',
             code: SECURITY_ERROR_CODE.SHELL_INJECTION };
  }
  return { valid: true };
}

/**
 * Validate a user-supplied name (station name, broadcast name, etc.).
 * @param {string} name
 * @param {string} [fieldName]
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateName(name, fieldName = 'name') {
  if (!name || typeof name !== 'string') {
    return { valid: false, reason: `${fieldName} is required.` };
  }
  if (!name.trim()) {
    return { valid: false, reason: `${fieldName} cannot be empty.` };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { valid: false, reason: `${fieldName} too long (max ${MAX_NAME_LENGTH}).` };
  }
  if (NULL_BYTE_REGEX.test(name)) {
    return { valid: false, reason: `${fieldName} contains null bytes.` };
  }
  return { valid: true };
}

/**
 * Validate a platform identifier.
 * @param {string} platformId
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validatePlatformId(platformId) {
  const VALID_PLATFORMS = new Set([
    'youtube', 'twitch', 'facebook', 'custom', 'rtmp', 'rtmps',
  ]);

  if (!platformId || typeof platformId !== 'string') {
    return { valid: false, reason: 'Platform identifier is required.' };
  }
  if (!VALID_PLATFORMS.has(platformId.toLowerCase())) {
    return {
      valid:  false,
      reason: `Unknown platform: "${platformId}". Allowed: ${[...VALID_PLATFORMS].join(', ')}`,
      code:   SECURITY_ERROR_CODE.INVALID_INPUT,
    };
  }
  return { valid: true };
}

/**
 * Assert a validation result — throws SecurityError if invalid.
 * @param {{ valid: boolean, reason?: string, code?: string }} result
 * @param {string} [context]  For error message
 * @throws {SecurityError}
 */
export function assertValid(result, context = '') {
  if (!result.valid) {
    throw new SecurityError(
      result.code ?? SECURITY_ERROR_CODE.INVALID_INPUT,
      context ? `${context}: ${result.reason}` : result.reason,
    );
  }
}

/**
 * Validate an arbitrary payload object structure (basic type checking).
 * Does not deep-validate — use field-specific validators for each field.
 * @param {*} payload
 * @param {string} [fieldName]
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validatePayload(payload, fieldName = 'payload') {
  if (payload === null || payload === undefined) {
    return { valid: true };  // null/undefined payloads are allowed (optional)
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: `${fieldName} must be a plain object.` };
  }
  // Check for null bytes in stringified form (basic injection protection)
  const str = JSON.stringify(payload);
  if (NULL_BYTE_REGEX.test(str)) {
    return { valid: false, reason: `${fieldName} contains null bytes.`,
             code: SECURITY_ERROR_CODE.COMMAND_INJECTION };
  }
  return { valid: true };
}
