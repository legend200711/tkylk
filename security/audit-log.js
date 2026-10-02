/**
 * 24-HOUR CLOUD ENGINE — Audit Log
 * cloud-engine/security/audit-log.js
 *
 * Security audit logging for important actions.
 *
 * SECURITY RULES:
 *   - Audit records must NOT contain secrets or credentials
 *   - Records include: eventId, actor/userId, action, resourceType,
 *                      safe resourceId, timestamp, result, safe reason
 *   - Records are immutable once written
 *   - Maximum in-memory retention: 1000 records
 *     (production: persisted to Firebase/logging service)
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { randomUUID }          from 'crypto';
import { CloudEngineLogger }   from '../logs/logger.js';
import { CloudEngineEventBus } from '../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS } from '../core/events.js';

const MODULE = 'security/audit-log';
const MAX_AUDIT_RECORDS = 1000;

/* ═══════════════════════════════════
   AUDIT EVENT TYPES
═══════════════════════════════════ */
export const AUDIT_EVENT_TYPE = Object.freeze({
  // Authentication
  AUTH_SUCCESS:               'AUTH_SUCCESS',
  AUTH_FAILURE:               'AUTH_FAILURE',

  // Broadcast
  BROADCAST_START_REQUEST:    'BROADCAST_START_REQUEST',
  BROADCAST_STOP_REQUEST:     'BROADCAST_STOP_REQUEST',
  BROADCAST_STARTED:          'BROADCAST_STARTED',
  BROADCAST_STOPPED:          'BROADCAST_STOPPED',

  // Destinations
  DESTINATION_CREATED:        'DESTINATION_CREATED',
  DESTINATION_REMOVED:        'DESTINATION_REMOVED',
  DESTINATION_RECONNECT:      'DESTINATION_RECONNECT',

  // Platforms
  PLATFORM_CONNECTED:         'PLATFORM_CONNECTED',
  PLATFORM_REVOKED:           'PLATFORM_REVOKED',

  // Stations
  STATION_CREATED:            'STATION_CREATED',
  STATION_DELETED:            'STATION_DELETED',
  STATION_STARTED:            'STATION_STARTED',
  STATION_STOPPED:            'STATION_STOPPED',

  // Media
  MEDIA_UPLOADED:             'MEDIA_UPLOADED',
  MEDIA_DELETED:              'MEDIA_DELETED',

  // Security events
  SECURITY_REJECTION:         'SECURITY_REJECTION',
  OWNERSHIP_VIOLATION:        'OWNERSHIP_VIOLATION',
  RATE_LIMIT_TRIGGERED:       'RATE_LIMIT_TRIGGERED',
  PERMISSION_DENIED:          'PERMISSION_DENIED',
  INVALID_ROLE_REJECTED:      'INVALID_ROLE_REJECTED',
  MISSING_AUTH_REJECTED:      'MISSING_AUTH_REJECTED',
  PATH_TRAVERSAL_BLOCKED:     'PATH_TRAVERSAL_BLOCKED',
  SSRF_BLOCKED:               'SSRF_BLOCKED',
  REPLAY_DETECTED:            'REPLAY_DETECTED',
  TAMPERED_OWNER_ID:          'TAMPERED_OWNER_ID',
  SHELL_INJECTION_BLOCKED:    'SHELL_INJECTION_BLOCKED',

  // Recovery
  RECOVERY_OVERRIDE:          'RECOVERY_OVERRIDE',
  RECOVERY_CROSS_ACCOUNT_BLOCKED: 'RECOVERY_CROSS_ACCOUNT_BLOCKED',

  // Admin
  ADMIN_ACCESS:               'ADMIN_ACCESS',
  CONFIG_CHANGED:             'CONFIG_CHANGED',
});

/* ═══════════════════════════════════
   AUDIT RECORD SHAPE
═══════════════════════════════════ */

/**
 * Create an audit record.
 * Records NEVER contain secrets.
 *
 * @param {object} entry
 * @param {string}  entry.eventType   AUDIT_EVENT_TYPE.*
 * @param {string}  entry.actor       User ID performing the action
 * @param {string}  [entry.action]    What was attempted
 * @param {string}  [entry.resourceType]
 * @param {string}  [entry.resourceId]  Safe resource identifier (not a file path)
 * @param {string}  entry.result      'ALLOWED' | 'DENIED' | 'ERROR'
 * @param {string}  [entry.reason]    Safe human-readable reason
 * @param {object}  [entry.meta]      Safe additional data (no credentials)
 * @returns {AuditRecord}
 */
function createAuditRecord({
  eventType,
  actor,
  action,
  resourceType,
  resourceId,
  result,
  reason,
  meta = {},
}) {
  return Object.freeze({
    eventId:      randomUUID(),
    eventType:    eventType ?? action ?? 'UNKNOWN',
    actor:        actor ?? 'system',
    action:       action ?? eventType ?? 'UNKNOWN',
    resourceType: resourceType ?? null,
    resourceId:   resourceId ?? null,
    result:       result ?? 'UNKNOWN',
    reason:       reason ?? null,
    timestamp:    new Date().toISOString(),
    // meta: scrubbed to remove any accidental credential inclusion
    meta:         _scrubMeta(meta),
  });
}

/* ═══════════════════════════════════
   AUDIT LOG STORE
═══════════════════════════════════ */
const _records = [];

/* ═══════════════════════════════════
   AUDIT LOG API
═══════════════════════════════════ */
export const AuditLog = Object.freeze({
  /**
   * Record an audit event.
   * @param {object} entry  (same as createAuditRecord params)
   * @returns {AuditRecord}
   */
  record(entry) {
    const record = createAuditRecord(entry);

    _records.push(record);
    if (_records.length > MAX_AUDIT_RECORDS) {
      _records.shift();
    }

    // Emit globally
    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.AUDIT_EVENT, record);

    // Also log denied/security events at warn level
    if (record.result === 'DENIED' || record.eventType === AUDIT_EVENT_TYPE.SECURITY_REJECTION) {
      CloudEngineLogger.warn(MODULE, 'AUDIT_DENIAL',
        `[AUDIT] ${record.eventType} | actor=${record.actor} | ` +
        `resource=${record.resourceType ?? 'N/A'}/${record.resourceId ?? 'N/A'} | ` +
        `result=${record.result} | reason=${record.reason ?? ''}`);
    } else {
      CloudEngineLogger.debug(MODULE, 'AUDIT_RECORD',
        `[AUDIT] ${record.eventType} | actor=${record.actor} | result=${record.result}`);
    }

    return record;
  },

  /**
   * Get recent audit records.
   * @param {object} [filter]
   * @param {string}  [filter.actor]      Filter by actor
   * @param {string}  [filter.eventType]  Filter by event type
   * @param {string}  [filter.result]     Filter by result
   * @param {number}  [filter.limit]      Max records to return (default: 100)
   * @returns {AuditRecord[]}
   */
  query({ actor, eventType, result, limit = 100 } = {}) {
    let records = [..._records];
    if (actor)     records = records.filter(r => r.actor === actor);
    if (eventType) records = records.filter(r => r.eventType === eventType);
    if (result)    records = records.filter(r => r.result === result);
    return records.slice(-limit);
  },

  /**
   * Get count of records by result type.
   */
  getStats() {
    const stats = { total: _records.length, ALLOWED: 0, DENIED: 0, ERROR: 0, UNKNOWN: 0 };
    for (const r of _records) {
      stats[r.result] = (stats[r.result] ?? 0) + 1;
    }
    return stats;
  },

  /**
   * Clear all records (test use only).
   */
  clear() {
    _records.length = 0;
  },
});

/* ── Helpers ──────────────────────────────────────────────── */

const CREDENTIAL_KEYS = new Set([
  'streamkey', 'token', 'password', 'secret', 'key', 'credential',
  'authorization', 'bearer', 'accesstoken', 'refreshtoken', 'apikey',
]);

function _scrubMeta(obj, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => _scrubMeta(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (CREDENTIAL_KEYS.has(k.toLowerCase())) {
      out[k] = '********';
    } else {
      out[k] = typeof v === 'object' ? _scrubMeta(v, depth + 1) : v;
    }
  }
  return out;
}
