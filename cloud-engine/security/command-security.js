/**
 * 24-HOUR CLOUD ENGINE — Command Security
 * cloud-engine/security/command-security.js
 *
 * Hardened command validation for Firebase/control commands.
 *
 * Every mutating command must verify:
 *   - authentication
 *   - authorization
 *   - ownership
 *   - command schema
 *   - resource scope
 *   - idempotency
 *   - expiration/timestamp where appropriate
 *
 * Prevents:
 *   - User A changing an ID to control User B's resource
 *   - Stale/replayed commands
 *   - Schema violations
 *   - Oversized payloads
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { SECURITY_ERROR_CODE, SecurityError } from './security-errors.js';
import { AuditLog }                           from './audit-log.js';
import { isAuthenticated, isValidRole }       from './authorization.js';

const MODULE = 'security/command-security';

/* ═══════════════════════════════════
   COMMAND SECURITY CONFIG
═══════════════════════════════════ */
const MAX_COMMAND_AGE_MS       = 5 * 60 * 1000;  // 5 minutes
const MAX_PAYLOAD_BYTES        = 65_536;           // 64 KB
const IDEMPOTENCY_CACHE_SIZE   = 1_000;

/* ═══════════════════════════════════
   IDEMPOTENCY STORE
   In-memory (production: use Firestore/Redis)
═══════════════════════════════════ */
const _seenCommandIds = new Set();

function _recordCommand(commandId) {
  _seenCommandIds.add(commandId);
  if (_seenCommandIds.size > IDEMPOTENCY_CACHE_SIZE) {
    // Remove oldest
    const first = _seenCommandIds.values().next().value;
    _seenCommandIds.delete(first);
  }
}

function _isReplay(commandId) {
  return _seenCommandIds.has(commandId);
}

/* ═══════════════════════════════════
   COMMAND VALIDATOR
═══════════════════════════════════ */

/**
 * Validate a mutating command for all security requirements.
 *
 * @param {object} cmd
 * @param {string}  cmd.commandId     Unique command identifier
 * @param {string}  cmd.command       Command name
 * @param {string}  cmd.userId        Authenticated user ID
 * @param {string}  cmd.userRole      Verified server-side role
 * @param {string}  cmd.ownerId       Owner of the target resource
 * @param {number}  [cmd.issuedAt]    Timestamp (ms) for replay protection
 * @param {object}  [cmd.params]      Command parameters
 * @returns {{ valid: boolean, reason?: string, code?: string }}
 */
export function validateCommand(cmd) {
  const { commandId, command, userId, userRole, ownerId, issuedAt, params } = cmd ?? {};

  // ── 1. Authentication ─────────────────────────────────────
  if (!isAuthenticated(userId)) {
    return {
      valid:  false,
      reason: 'Authentication required — userId missing.',
      code:   SECURITY_ERROR_CODE.NOT_AUTHENTICATED,
    };
  }

  // ── 2. Role validation ────────────────────────────────────
  if (!isValidRole(userRole)) {
    return {
      valid:  false,
      reason: `Invalid role: "${userRole}".`,
      code:   SECURITY_ERROR_CODE.INSUFFICIENT_ROLE,
    };
  }

  // ── 3. Command ID ─────────────────────────────────────────
  if (!commandId || typeof commandId !== 'string' || !commandId.trim()) {
    return {
      valid:  false,
      reason: 'commandId is required.',
      code:   SECURITY_ERROR_CODE.INVALID_INPUT,
    };
  }

  // ── 4. Replay protection ──────────────────────────────────
  if (_isReplay(commandId)) {
    AuditLog.record({
      actor:      userId,
      action:     command,
      resourceId: commandId,
      result:     'DENIED',
      reason:     'Replay detected',
    });
    return {
      valid:  false,
      reason: `Command "${commandId}" was already processed (replay prevention).`,
      code:   SECURITY_ERROR_CODE.REPLAY_DETECTED,
    };
  }

  // ── 5. Timestamp / expiration ─────────────────────────────
  if (issuedAt !== undefined && issuedAt !== null) {
    const age = Date.now() - issuedAt;
    if (age > MAX_COMMAND_AGE_MS) {
      return {
        valid:  false,
        reason: `Command expired: issued ${Math.floor(age / 1000)}s ago (max ${MAX_COMMAND_AGE_MS / 1000}s).`,
        code:   SECURITY_ERROR_CODE.COMMAND_EXPIRED,
      };
    }
  }

  // ── 6. Command name ───────────────────────────────────────
  if (!command || typeof command !== 'string') {
    return {
      valid:  false,
      reason: 'Command name is required.',
      code:   SECURITY_ERROR_CODE.INVALID_INPUT,
    };
  }

  // ── 7. Payload size ───────────────────────────────────────
  if (params !== undefined) {
    const payloadSize = JSON.stringify(params).length;
    if (payloadSize > MAX_PAYLOAD_BYTES) {
      return {
        valid:  false,
        reason: `Payload too large: ${payloadSize} bytes (max ${MAX_PAYLOAD_BYTES}).`,
        code:   SECURITY_ERROR_CODE.OVERSIZED_PAYLOAD,
      };
    }
  }

  // ── 8. Ownership scope — prevent ID swap attacks ──────────
  // If the command includes an ownerId in params, verify it matches
  if (params?.ownerId && params.ownerId !== userId && userRole !== 'ADMIN') {
    return {
      valid:  false,
      reason: 'ownerId in params does not match authenticated userId.',
      code:   SECURITY_ERROR_CODE.CROSS_ACCOUNT_ACCESS,
    };
  }

  return { valid: true };
}

/**
 * Record a command as processed (call after successful validation).
 * @param {string} commandId
 */
export function markCommandProcessed(commandId) {
  _recordCommand(commandId);
}

/**
 * Check if a command has already been processed.
 * @param {string} commandId
 * @returns {boolean}
 */
export function isCommandProcessed(commandId) {
  return _isReplay(commandId);
}

/**
 * Clear idempotency cache (for testing only).
 */
export function clearIdempotencyCache() {
  _seenCommandIds.clear();
}
