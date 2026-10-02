/**
 * 24-HOUR CLOUD ENGINE — Resource Policy
 * cloud-engine/security/resource-policy.js
 *
 * Defines what operations are permitted on which resource types,
 * and provides resource-scope checking.
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { ROLE, PERMISSION } from './permissions.js';
import { RESOURCE_TYPE }    from './ownership.js';

/* ═══════════════════════════════════
   RESOURCE OPERATION → PERMISSION MAP
═══════════════════════════════════ */

/**
 * Maps (resourceType, operation) → required permission.
 * Any operation not listed here requires OWNER role.
 */
export const RESOURCE_PERMISSION_MAP = Object.freeze({
  [RESOURCE_TYPE.BROADCAST]: {
    start:    PERMISSION.START_BROADCAST,
    stop:     PERMISSION.STOP_BROADCAST,
    read:     PERMISSION.VIEW_STATUS,
  },
  [RESOURCE_TYPE.DESTINATION]: {
    create:   PERMISSION.MANAGE_DESTINATIONS,
    update:   PERMISSION.MANAGE_DESTINATIONS,
    delete:   PERMISSION.MANAGE_DESTINATIONS,
    read:     PERMISSION.VIEW_DESTINATION_INFO,
    reconnect:PERMISSION.MANAGE_DESTINATIONS,
  },
  [RESOURCE_TYPE.PLATFORM]: {
    connect:  PERMISSION.MANAGE_DESTINATIONS,
    revoke:   PERMISSION.MANAGE_DESTINATIONS,
    read:     PERMISSION.VIEW_DESTINATION_INFO,
  },
  [RESOURCE_TYPE.CREDENTIAL]: {
    // Credentials: ONLY owner can access. No cross-role access.
    read:     null,  // null = OWNER only
    write:    null,
    delete:   null,
  },
  [RESOURCE_TYPE.MEDIA]: {
    upload:   PERMISSION.UPLOAD_MEDIA,
    delete:   PERMISSION.DELETE_MEDIA,
    read:     PERMISSION.VIEW_STATUS,
    approve:  PERMISSION.APPROVE_MEDIA,
  },
  [RESOURCE_TYPE.PLAYLIST]: {
    create:   PERMISSION.CREATE_PLAYLIST,
    update:   PERMISSION.EDIT_PLAYLIST,
    delete:   PERMISSION.DELETE_PLAYLIST,
    read:     PERMISSION.VIEW_STATUS,
  },
  [RESOURCE_TYPE.SCHEDULE]: {
    create:   PERMISSION.CREATE_SCHEDULE,
    update:   PERMISSION.EDIT_SCHEDULE,
    read:     PERMISSION.VIEW_STATUS,
  },
  [RESOURCE_TYPE.STATION]: {
    create:   PERMISSION.START_BROADCAST,
    start:    PERMISSION.START_BROADCAST,
    stop:     PERMISSION.STOP_BROADCAST,
    delete:   PERMISSION.STOP_BROADCAST,
    read:     PERMISSION.VIEW_STATUS,
  },
  [RESOURCE_TYPE.QUEUE]: {
    add:      PERMISSION.ADD_TO_QUEUE,
    remove:   PERMISSION.REMOVE_FROM_QUEUE,
    reorder:  PERMISSION.REORDER_QUEUE,
    read:     PERMISSION.VIEW_STATUS,
  },
  [RESOURCE_TYPE.HYBRID_SESSION]: {
    start:    PERMISSION.START_BROADCAST,
    end:      PERMISSION.STOP_BROADCAST,
    read:     PERMISSION.VIEW_STATUS,
  },
  [RESOURCE_TYPE.INGEST_SESSION]: {
    start:    PERMISSION.START_BROADCAST,
    stop:     PERMISSION.STOP_BROADCAST,
    read:     PERMISSION.VIEW_STATUS,
  },
  [RESOURCE_TYPE.RECOVERY_STATE]: {
    // Recovery state: OWNER only — never cross-account
    read:     null,
    restore:  null,
    clear:    null,
  },
  [RESOURCE_TYPE.STUDIO_OPERATION]: {
    execute:  PERMISSION.START_BROADCAST,
    read:     PERMISSION.VIEW_STATUS,
  },
});

/**
 * Get the required permission for a resource operation.
 * Returns null if OWNER-only (no role delegation allowed).
 * Returns undefined if the operation is not defined.
 *
 * @param {string} resourceType  RESOURCE_TYPE.*
 * @param {string} operation     e.g., 'start', 'read', 'delete'
 * @returns {string|null|undefined}
 */
export function getRequiredPermission(resourceType, operation) {
  return RESOURCE_PERMISSION_MAP[resourceType]?.[operation];
}

/**
 * Check if an operation on a resource type is owner-only (not delegatable).
 * @param {string} resourceType
 * @param {string} operation
 * @returns {boolean}
 */
export function isOwnerOnlyOperation(resourceType, operation) {
  const perm = getRequiredPermission(resourceType, operation);
  return perm === null;  // null means owner-only, undefined means not defined
}
