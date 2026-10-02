/**
 * 24-HOUR CLOUD ENGINE — Authorization
 * cloud-engine/security/authorization.js
 *
 * Server-side authorization enforcement.
 *
 * ARCHITECTURE:
 *   This module enforces authorization on the server side.
 *   It is NOT a frontend hint — it is the actual enforcement layer.
 *
 *   Roles come from Firebase custom claims (verified server-side),
 *   not from the browser.
 *
 *   There is NO backdoor, master password, or universal access token.
 *   ADMIN does not automatically access every customer's private credentials.
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { ROLE, PERMISSION, hasPermission }    from './permissions.js';
import { verifyOwnership, assertOwnership }   from './ownership.js';
import { SECURITY_ERROR_CODE, SecurityError } from './security-errors.js';
import { AuditLog }                           from './audit-log.js';

/* ═══════════════════════════════════
   AUTHORIZATION RESULT
═══════════════════════════════════ */

/**
 * @typedef {object} AuthResult
 * @property {boolean} authorized
 * @property {string}  reason
 * @property {string}  [code]
 */

/* ═══════════════════════════════════
   AUTHORIZATION FUNCTIONS
═══════════════════════════════════ */

/**
 * Verify that an authenticated user has a required permission.
 *
 * @param {object} context
 * @param {string}  context.userId      Authenticated user ID
 * @param {string}  context.userRole    Verified server-side role
 * @param {string}  context.permission  PERMISSION.*
 * @returns {AuthResult}
 */
export function checkPermission({ userId, userRole, permission }) {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return {
      authorized: false,
      reason:     'Authentication required.',
      code:       SECURITY_ERROR_CODE.NOT_AUTHENTICATED,
    };
  }

  if (!userRole || !ROLE[userRole]) {
    return {
      authorized: false,
      reason:     `Invalid or missing role: "${userRole}".`,
      code:       SECURITY_ERROR_CODE.INSUFFICIENT_ROLE,
    };
  }

  if (!permission || !PERMISSION[permission]) {
    return {
      authorized: false,
      reason:     `Unknown permission: "${permission}".`,
      code:       SECURITY_ERROR_CODE.PERMISSION_DENIED,
    };
  }

  if (!hasPermission(userRole, permission)) {
    return {
      authorized: false,
      reason:     `Role "${userRole}" does not have permission: ${permission}`,
      code:       SECURITY_ERROR_CODE.INSUFFICIENT_ROLE,
    };
  }

  return { authorized: true, reason: 'Permission granted.' };
}

/**
 * Full authorization check: authentication + role permission + ownership.
 *
 * @param {object} context
 * @param {string}   context.userId         Authenticated user ID
 * @param {string}   context.userRole       Verified server-side role
 * @param {string}   context.permission     PERMISSION.*
 * @param {string}   context.resourceOwner  Owner ID of the resource
 * @param {string}   context.resourceType   RESOURCE_TYPE.*
 * @param {string}   [context.resourceId]   Safe resource identifier
 * @param {string}   [context.action]       What is being attempted (for audit)
 * @returns {AuthResult}
 */
export function authorize(context) {
  const {
    userId, userRole, permission,
    resourceOwner, resourceType, resourceId = 'unknown',
    action = permission,
  } = context;

  // Step 1: Permission check
  const permResult = checkPermission({ userId, userRole, permission });
  if (!permResult.authorized) {
    AuditLog.record({
      actor:        userId ?? 'unauthenticated',
      action,
      resourceType,
      resourceId,
      result:       'DENIED',
      reason:       permResult.reason,
    });
    return permResult;
  }

  // Step 2: Ownership check (if resource has an owner)
  if (resourceOwner !== undefined && resourceOwner !== null) {
    const ownerResult = verifyOwnership({
      requesterId:   userId,
      requesterRole: userRole,
      resourceOwner,
      resourceType,
      resourceId,
    });

    if (!ownerResult.authorized) {
      AuditLog.record({
        actor:        userId,
        action,
        resourceType,
        resourceId,
        result:       'DENIED',
        reason:       ownerResult.reason,
      });
      return {
        authorized: false,
        reason:     ownerResult.reason,
        code:       ownerResult.code ?? SECURITY_ERROR_CODE.OWNERSHIP_VIOLATION,
      };
    }
  }

  return { authorized: true, reason: 'Authorized.' };
}

/**
 * Assert authorization — throws SecurityError if denied.
 *
 * @param {object} context  Same as authorize()
 * @throws {SecurityError}
 */
export function assertAuthorization(context) {
  const result = authorize(context);
  if (!result.authorized) {
    throw new SecurityError(
      result.code ?? SECURITY_ERROR_CODE.UNAUTHORIZED,
      result.reason,
      {
        userId:       context.userId ?? 'unknown',
        permission:   context.permission,
        resourceType: context.resourceType,
        resourceId:   context.resourceId ?? 'unknown',
      }
    );
  }
}

/**
 * Check if a user is authenticated (userId is present and non-empty).
 * @param {string|null|undefined} userId
 * @returns {boolean}
 */
export function isAuthenticated(userId) {
  return !!(userId && typeof userId === 'string' && userId.trim());
}

/**
 * Check if a role string is a valid, known role.
 * @param {string} role
 * @returns {boolean}
 */
export function isValidRole(role) {
  return !!(role && ROLE[role]);
}
