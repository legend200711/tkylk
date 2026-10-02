/**
 * 24-HOUR CLOUD ENGINE — Broadcast Studio Events
 * cloud-engine/studio/studio-events.js
 *
 * Safe event feed for the Broadcast Studio.
 * Events are sanitized before exposure — no secrets, no stream keys.
 *
 * Stage 7 — Broadcast Studio
 */

/* ═══════════════════════════════════
   STUDIO EVENT TYPES
═══════════════════════════════════ */
export const STUDIO_EVENT_TYPE = Object.freeze({
  // Broadcast lifecycle
  BROADCAST_STARTED:            'broadcast_started',
  BROADCAST_STOPPED:            'broadcast_stopped',

  // Destination events
  DESTINATION_CONNECTED:        'destination_connected',
  DESTINATION_DISCONNECTED:     'destination_disconnected',
  DESTINATION_RECONNECTING:     'destination_reconnecting',
  DESTINATION_RECONNECTED:      'destination_reconnected',
  DESTINATION_FAILED:           'destination_failed',
  DESTINATION_ADDED:            'destination_added',
  DESTINATION_REMOVED:          'destination_removed',

  // Ingest events
  INGEST_STARTED:               'ingest_started',
  INGEST_STOPPED:               'ingest_stopped',
  INGEST_SOURCE_CONNECTED:      'ingest_source_connected',
  INGEST_SOURCE_DISCONNECTED:   'ingest_source_disconnected',

  // Encoder events
  ENCODER_STARTED:              'encoder_started',
  ENCODER_STOPPED:              'encoder_stopped',
  ENCODER_BEHIND:               'encoder_behind',
  ENCODER_STALLED:              'encoder_stalled',
  ENCODER_ERROR:                'encoder_error',

  // Errors
  ERROR:                        'error',
});

/* ═══════════════════════════════════
   STUDIO EVENT FEED
   Ring buffer of recent events.
═══════════════════════════════════ */
const MAX_EVENTS = 100;

export class StudioEventFeed {
  constructor() {
    this._events    = [];
    this._listeners = new Set();
  }

  /**
   * Add a safe event to the feed.
   * @param {string} type   STUDIO_EVENT_TYPE.*
   * @param {object} [data] Safe event data (no stream keys, no secrets)
   */
  push(type, data = {}) {
    // Safety: strip any accidental secret fields
    const safe = _stripEventSecrets(data);
    const event = {
      id:        `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      timestamp: new Date().toISOString(),
      data:      safe,
    };

    this._events.push(event);
    if (this._events.length > MAX_EVENTS) {
      this._events.shift();
    }

    // Notify listeners
    for (const listener of this._listeners) {
      try { listener(event); } catch { /* listener errors never crash the feed */ }
    }
  }

  /**
   * Get all recent events.
   * @param {number} [limit]  Max events to return (newest last).
   * @returns {object[]}
   */
  getRecent(limit = 50) {
    return limit ? this._events.slice(-limit) : [...this._events];
  }

  /**
   * Subscribe to new events.
   * @param {Function} listener
   * @returns {Function} unsubscribe
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** Clear all events. */
  clear() {
    this._events.length = 0;
  }
}

/* ═══════════════════════════════════
   SECRET STRIPPING
═══════════════════════════════════ */
const _SECRET_KEYS = new Set(['streamKey', 'stream_key', 'publishUrl', 'password', 'token',
  'accessToken', 'refreshToken', 'apiKey', 'secret']);

function _stripEventSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(_stripEventSecrets);
  const safe = {};
  for (const [k, v] of Object.entries(obj)) {
    safe[k] = _SECRET_KEYS.has(k) ? '[REDACTED]' : (typeof v === 'object' ? _stripEventSecrets(v) : v);
  }
  return safe;
}
