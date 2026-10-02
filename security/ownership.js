/**
 * 24-HOUR CLOUD ENGINE — Ownership Enforcement
 * cloud-engine/security/ownership.js
 *
 * Strict server-side ownership enforcement.
 *
 * PRINCIPLE:
 *   User A must NEVER be able to read, modify, stop, delete, reconnect,
 *   or control User B's private resources without explicit authorized permission.
 *
 *   Ownership is enforced by matching ownerId on every resource.
 *   This check is NOT bypassed by any role except where explicitly documented.
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { SECURITY_ERROR_CODE, SecurityError } from './security-errors.js';
import { ROLE }                               from './permissions.js';

/* ═══════════════════════════════════
   RESOURCE TYPES
═══════════════════════════════════ */
export const RESOURCE_TYPE = Object.freeze({
  BROADCAST:        'BROADCAST',
  DESTINATION:      'DESTINATION',
  PLATFORM:         'PLATFORM',
  CREDENTIAL:       'CREDENTIAL',
  MEDIA:            'MEDIA',
  PLAYLIST:         'PLAYLIST',
  SCHEDULE:         'SCHEDULE',
  STATION:          'STATION',
  QUEUE:            'QUEUE',
  HYBRID_SESSION:   'HYBRID_SESSION',
  INGEST_SESSION:   'INGEST_SESSION',
  RECOVERY_STATE:   'RECOVERY_STATE',
  STUDIO_OPERATION: 'STUDIO_OPERATION',
});

/* ═══════════════════════════════════
   OWNERSHIP VERIFIER
═══════════════════════════════════ */

/**
 * Verify that the requesting user owns (or is authorized to access) a resource.
 *
 * Authorization matrix:
 *   - OWNER: may access their own resources
 *   - ADMIN: may access resources they are explicitly authorized for
 *            (NOT automatically every customer's resources)
 *   - CREATOR/VIEWER: may only access their own resources
 *
 * @param {object} opts
 * @param {string}  opts.requesterId   Authenticated user ID
 * @param {string}  opts.requesterRole Verified server-side role (ROLE.*)
 * @param {string}  opts.resourceOwner Owner ID of the resource
 * @param {string}  opts.resourceType  RESOURCE_TYPE.*
 * @param {string}  [opts.resourceId]  For audit logging
 * @returns {{ authorized: boolean, reason: string }}
 */
export function verifyOwnership({
  requesterId,
  requesterRole,
  resourceOwner,
  resourceType,
  resourceId = 'unknown',
}) {
  if (!requesterId || typeof requesterId !== 'string') {
    return {
      authorized: false,
      reason:     'requesterId is required.',
      code:       SECURITY_ERROR_CODE.NOT_AUTHENTICATED,
    };
  }

  if (!resourceOwner || typeof resourceOwner !== 'string') {
    return {
      authorized: false,
      reason:     'resourceOwner is required for ownership check.',
      code:       SECURITY_ERROR_CODE.OWNERSHIP_VIOLATION,
    };
  }

  // Direct ownership — always authorized
  if (requesterId === resourceOwner) {
    return { authorized: true, reason: 'Direct ownership verified.' };
  }

  // ADMIN can access cross-account resources ONLY for administrative purposes
  // (e.g., read-only monitoring, NOT credential access or broadcast control)
  // This is explicitly limited and auditable.
  if (requesterRole === ROLE.ADMIN) {
    const adminAllowed = ADMIN_CROSS_ACCOUNT_RESOURCES.has(resourceType);
    if (adminAllowed) {
      return {
        authorized: true,
        reason:     'Admin cross-account access (limited resource type).',
        crossAccount: true,
      };
    }
    return {
      authorized: false,
      reason:     `Admin role is not authorized for cross-account access to: ${resourceType}`,
      code:       SECURITY_ERROR_CODE.CROSS_ACCOUNT_ACCESS,
    };
  }

  // All other roles: ownership mismatch = denied
  return {
    authorized: false,
    reason:     `Ownership mismatch: requester "${requesterId}" is not owner of ${resourceType}/${resourceId}`,
    code:       SECURITY_ERROR_CODE.OWNERSHIP_VIOLATION,
  };
}

/**
 * Resource types that ADMIN can access across accounts (read-only, no credentials).
 * This is the exhaustive, explicit list — not open-ended.
 */
const ADMIN_CROSS_ACCOUNT_RESOURCES = new Set([
  // ADMIN may view status but NOT credentials, destinations, or media
]);

/**
 * Assert ownership — throws SecurityError if ownership check fails.
 *
 * @param {object} opts  Same as verifyOwnership
 * @throws {SecurityError}
 */
export function assertOwnership(opts) {
  const result = verifyOwnership(opts);
  if (!result.authorized) {
    throw new SecurityError(
      result.code ?? SECURITY_ERROR_CODE.OWNERSHIP_VIOLATION,
      result.reason,
      {
        requesterId:  opts.requesterId,
        resourceType: opts.resourceType,
        resourceId:   opts.resourceId ?? 'unknown',
        // NOTE: resourceOwner intentionally omitted to prevent enumeration
      }
    );
  }
}

/**
 * Verify a resource's ownerId matches what the requester claims.
 * Used to prevent ID-swapping attacks (changing a resourceId to target another user).
 *
 * @param {string} claimedOwnerId
 * @param {string} actualOwnerId
 * @param {string} resourceType
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyOwnerIdClaim(claimedOwnerId, actualOwnerId, resourceType) {
  if (!claimedOwnerId || !actualOwnerId) {
    return { valid: false, reason: 'Both claimedOwnerId and actualOwnerId required.' };
  }
  if (claimedOwnerId !== actualOwnerId) {
    return {
      valid:  false,
      reason: `ownerId claim mismatch for ${resourceType} — possible ID tampering.`,
    };
  }
  return { valid: true };
}
