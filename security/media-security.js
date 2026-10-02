/**
 * 24-HOUR CLOUD ENGINE — Media Security
 * cloud-engine/security/media-security.js
 *
 * Ensures users cannot use media identifiers or path manipulation
 * to access another user's files.
 *
 * Storage/media operations validate:
 *   OWNER_ID + MEDIA_ID + STORAGE_REFERENCE
 *
 * Client-provided filesystem paths are NEVER trusted.
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { SECURITY_ERROR_CODE, SecurityError } from './security-errors.js';
import { validateId, validateMediaPath }       from './input-validation.js';

/* ═══════════════════════════════════
   MEDIA ACCESS VALIDATION
═══════════════════════════════════ */

/**
 * Validate that a user is authorized to access a specific media item.
 * Checks: ownerId match + mediaId validity + optional storageRef validity.
 *
 * @param {object} opts
 * @param {string}  opts.requesterId    Authenticated user ID
 * @param {string}  opts.mediaOwnerId   Owner ID stored with the media item
 * @param {string}  opts.mediaId        Media item ID
 * @param {string}  [opts.storageRef]   Storage reference (if provided, must be safe)
 * @returns {{ authorized: boolean, reason?: string, code?: string }}
 */
export function validateMediaAccess({ requesterId, mediaOwnerId, mediaId, storageRef }) {
  // 1. Validate media ID format
  const idResult = validateId(mediaId, 'mediaId');
  if (!idResult.valid) {
    return { authorized: false, reason: idResult.reason,
             code: SECURITY_ERROR_CODE.MALFORMED_ID };
  }

  // 2. Ownership check
  if (!requesterId || !mediaOwnerId) {
    return { authorized: false, reason: 'requesterId and mediaOwnerId required.',
             code: SECURITY_ERROR_CODE.NOT_AUTHENTICATED };
  }

  if (requesterId !== mediaOwnerId) {
    return {
      authorized: false,
      reason:     'Media ownership mismatch — cross-user media access denied.',
      code:       SECURITY_ERROR_CODE.OWNERSHIP_VIOLATION,
    };
  }

  // 3. Storage reference safety check (if provided)
  if (storageRef !== undefined && storageRef !== null) {
    // Ensure the storage reference belongs to the owner
    // Storage refs should follow: userId/mediaId/filename pattern
    // Client-supplied paths with traversal attempts are rejected
    const pathResult = validateMediaPath(storageRef);
    if (!pathResult.valid) {
      return { authorized: false, reason: pathResult.reason, code: pathResult.code };
    }

    // Ensure the storage reference starts with the owner's user ID segment
    // This prevents users from constructing refs to other users' storage
    const ownerPrefix = requesterId + '/';
    if (!storageRef.startsWith(ownerPrefix)) {
      return {
        authorized: false,
        reason:     'Storage reference does not belong to authenticated user.',
        code:       SECURITY_ERROR_CODE.OWNERSHIP_VIOLATION,
      };
    }
  }

  return { authorized: true };
}

/**
 * Assert media access — throws SecurityError if denied.
 * @param {object} opts  Same as validateMediaAccess
 * @throws {SecurityError}
 */
export function assertMediaAccess(opts) {
  const result = validateMediaAccess(opts);
  if (!result.authorized) {
    throw new SecurityError(
      result.code ?? SECURITY_ERROR_CODE.OWNERSHIP_VIOLATION,
      result.reason,
      {
        requesterId: opts.requesterId,
        mediaId:     opts.mediaId,
        // storageRef intentionally omitted from error meta
      }
    );
  }
}

/**
 * Build a safe storage reference for a media item.
 * Ensures the reference is scoped to the owner.
 *
 * @param {string} ownerId
 * @param {string} mediaId
 * @param {string} filename
 * @returns {string}  Safe storage reference
 */
export function buildSafeStorageRef(ownerId, mediaId, filename) {
  // Sanitize each component
  const safeOwner   = ownerId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const safeMediaId = mediaId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const safeFile    = filename.replace(/[^a-zA-Z0-9_\-. ]/g, '_');

  return `${safeOwner}/${safeMediaId}/${safeFile}`;
}
