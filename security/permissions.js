/**
 * 24-HOUR CLOUD ENGINE — Security & Permissions Foundation
 * cloud-engine/security/permissions.js
 *
 * Role/permission architecture for the 24-Hour Cloud Engine.
 *
 * IMPORTANT SECURITY PRINCIPLES:
 *   1. Roles are NEVER trusted from the browser directly.
 *      All permission decisions for sensitive operations must be
 *      enforced server-side (Cloudflare Worker, Firebase Functions,
 *      or Firebase Security Rules).
 *   2. The isAdmin() check in tv/firestore.rules (email match) is the
 *      existing server-side enforcement mechanism. This file extends that model.
 *   3. There is NO backdoor, master password, or universal access token.
 *   4. There is NO special "Founder" role hardcoded here.
 *      The OWNER role is assigned through Firebase custom claims,
 *      verified server-side.
 *
 * Stage 1: Role definitions and permission matrix only.
 * Stage 2+: Integrate with Firebase Auth custom claims for enforcement.
 */

/* ═══════════════════════════════════
   ROLES
═══════════════════════════════════ */
export const ROLE = Object.freeze({
  OWNER:   'OWNER',    // Full control — verified via server-side Firebase claims
  ADMIN:   'ADMIN',    // Administrative access — also server-side only
  CREATOR: 'CREATOR',  // Upload / playlist management
  VIEWER:  'VIEWER',   // Read-only: watch channels, see public status
});

/* ═══════════════════════════════════
   PERMISSION NAMES
═══════════════════════════════════ */
export const PERMISSION = Object.freeze({
  // Engine control
  START_ENGINE:          'START_ENGINE',
  STOP_ENGINE:           'STOP_ENGINE',
  RESTART_ENGINE:        'RESTART_ENGINE',

  // Broadcast control
  START_BROADCAST:       'START_BROADCAST',
  STOP_BROADCAST:        'STOP_BROADCAST',

  // Media management
  UPLOAD_MEDIA:          'UPLOAD_MEDIA',
  DELETE_MEDIA:          'DELETE_MEDIA',
  APPROVE_MEDIA:         'APPROVE_MEDIA',

  // Playlist management
  CREATE_PLAYLIST:       'CREATE_PLAYLIST',
  EDIT_PLAYLIST:         'EDIT_PLAYLIST',
  DELETE_PLAYLIST:       'DELETE_PLAYLIST',

  // Schedule management
  CREATE_SCHEDULE:       'CREATE_SCHEDULE',
  EDIT_SCHEDULE:         'EDIT_SCHEDULE',

  // Queue management
  ADD_TO_QUEUE:          'ADD_TO_QUEUE',
  REMOVE_FROM_QUEUE:     'REMOVE_FROM_QUEUE',
  REORDER_QUEUE:         'REORDER_QUEUE',

  // Viewing
  VIEW_CHANNEL:          'VIEW_CHANNEL',
  VIEW_STATUS:           'VIEW_STATUS',
  VIEW_LOGS:             'VIEW_LOGS',

  // Destinations (stream keys never exposed to browser)
  MANAGE_DESTINATIONS:   'MANAGE_DESTINATIONS',
  VIEW_DESTINATION_INFO: 'VIEW_DESTINATION_INFO',
});

/* ═══════════════════════════════════
   ROLE → PERMISSION MATRIX
   Defines what each role is ALLOWED to do.
   Enforcement happens server-side — this matrix is for documentation
   and client-side UI hints (e.g., hide buttons for un-permitted actions).
═══════════════════════════════════ */
const _permissionMatrix = {
  [ROLE.OWNER]: new Set(Object.values(PERMISSION)),  // All permissions

  [ROLE.ADMIN]: new Set([
    PERMISSION.START_ENGINE,    PERMISSION.STOP_ENGINE,    PERMISSION.RESTART_ENGINE,
    PERMISSION.START_BROADCAST, PERMISSION.STOP_BROADCAST,
    PERMISSION.UPLOAD_MEDIA,    PERMISSION.DELETE_MEDIA,   PERMISSION.APPROVE_MEDIA,
    PERMISSION.CREATE_PLAYLIST, PERMISSION.EDIT_PLAYLIST,  PERMISSION.DELETE_PLAYLIST,
    PERMISSION.CREATE_SCHEDULE, PERMISSION.EDIT_SCHEDULE,
    PERMISSION.ADD_TO_QUEUE,    PERMISSION.REMOVE_FROM_QUEUE, PERMISSION.REORDER_QUEUE,
    PERMISSION.VIEW_CHANNEL,    PERMISSION.VIEW_STATUS,    PERMISSION.VIEW_LOGS,
    PERMISSION.MANAGE_DESTINATIONS, PERMISSION.VIEW_DESTINATION_INFO,
  ]),

  [ROLE.CREATOR]: new Set([
    PERMISSION.UPLOAD_MEDIA,
    PERMISSION.CREATE_PLAYLIST, PERMISSION.EDIT_PLAYLIST,
    PERMISSION.ADD_TO_QUEUE,
    PERMISSION.VIEW_CHANNEL,    PERMISSION.VIEW_STATUS,
    PERMISSION.VIEW_DESTINATION_INFO,
  ]),

  [ROLE.VIEWER]: new Set([
    PERMISSION.VIEW_CHANNEL,
    PERMISSION.VIEW_STATUS,
  ]),
};

/* ═══════════════════════════════════
   PUBLIC API
═══════════════════════════════════ */

/**
 * Check whether a role has a specific permission.
 * This is a CLIENT-SIDE hint only — it does NOT replace server-side enforcement.
 *
 * @param {string} role        One of ROLE.*
 * @param {string} permission  One of PERMISSION.*
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
  if (!_permissionMatrix[role]) return false;
  return _permissionMatrix[role].has(permission);
}

/**
 * Returns all permissions for a role.
 * @param {string} role
 * @returns {string[]}
 */
export function getPermissions(role) {
  if (!_permissionMatrix[role]) return [];
  return Array.from(_permissionMatrix[role]);
}

/**
 * Returns all roles that have a specific permission.
 * @param {string} permission
 * @returns {string[]}
 */
export function getRolesWithPermission(permission) {
  return Object.entries(_permissionMatrix)
    .filter(([, perms]) => perms.has(permission))
    .map(([role]) => role);
}
