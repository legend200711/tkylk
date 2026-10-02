/**
 * 24-HOUR CLOUD ENGINE — Event Catalogue
 * cloud-engine/core/events.js
 *
 * Defines all internal event names for the 24-Hour Cloud Engine.
 * Modules communicate via CloudEngineEventBus using these constants.
 * No module should use raw string event names — always reference this file.
 *
 * Stage 1 — core events defined.
 * Stage 2 — encoder events active.
 * Stage 3 — broadcast events fully active (additions below marked Stage 3).
 * Stage 4 — fan-out destination events added.
 */

export const CLOUD_ENGINE_EVENTS = Object.freeze({
  // ── Engine lifecycle ──────────────────────────────────────────
  ENGINE_READY:              'ENGINE_READY',
  ENGINE_ERROR:              'ENGINE_ERROR',

  // ── Media events ─────────────────────────────────────────────
  MEDIA_LOADING:             'MEDIA_LOADING',
  MEDIA_STARTED:             'MEDIA_STARTED',
  MEDIA_ENDED:               'MEDIA_ENDED',
  MEDIA_ERROR:               'MEDIA_ERROR',

  // ── Encoder events ───────────────────────────────────────────
  ENCODER_STARTED:           'ENCODER_STARTED',
  ENCODER_STOPPED:           'ENCODER_STOPPED',
  ENCODER_ERROR:             'ENCODER_ERROR',

  // ── Broadcast events ─────────────────────────────────────────
  // Original Stage 1/2 events (preserved for compatibility):
  BROADCAST_CONNECTED:       'BROADCAST_CONNECTED',
  BROADCAST_DISCONNECTED:    'BROADCAST_DISCONNECTED',
  BROADCAST_ERROR:           'BROADCAST_ERROR',

  // Stage 3 — additional broadcast lifecycle events:
  BROADCAST_STARTED:         'BROADCAST_STARTED',       // FFmpeg transport spawned, data flowing
  BROADCAST_STOPPED:         'BROADCAST_STOPPED',       // Broadcast halted (requested or completed)
  BROADCAST_RECONNECTING:    'BROADCAST_RECONNECTING',  // Auto-reconnect initiated
  BROADCAST_RECONNECTED:     'BROADCAST_RECONNECTED',   // Auto-reconnect succeeded

  // ── Stage 4 — Fan-Out destination events ────────────────────
  DESTINATION_ADDED:         'DESTINATION_ADDED',
  DESTINATION_REMOVED:       'DESTINATION_REMOVED',
  DESTINATION_STARTED:       'DESTINATION_STARTED',
  DESTINATION_CONNECTED:     'DESTINATION_CONNECTED',
  DESTINATION_DISCONNECTED:  'DESTINATION_DISCONNECTED',
  DESTINATION_RECONNECTING:  'DESTINATION_RECONNECTING',
  DESTINATION_RECONNECTED:   'DESTINATION_RECONNECTED',
  DESTINATION_FAILED:        'DESTINATION_FAILED',
  DESTINATION_EXHAUSTED:     'DESTINATION_EXHAUSTED',

  // ── Stage 5 — Ingest events ───────────────────────────────────
  INGEST_STARTED:            'INGEST_STARTED',
  INGEST_STOPPED:            'INGEST_STOPPED',
  INGEST_SOURCE_CONNECTED:   'INGEST_SOURCE_CONNECTED',
  INGEST_SOURCE_DISCONNECTED:'INGEST_SOURCE_DISCONNECTED',
  INGEST_SOURCE_STALLED:     'INGEST_SOURCE_STALLED',
  INGEST_ERROR:              'INGEST_ERROR',

  // ── Queue / Playlist / Schedule ──────────────────────────────
  QUEUE_CHANGED:             'QUEUE_CHANGED',
  SCHEDULE_CHANGED:          'SCHEDULE_CHANGED',

  // ── Watchdog / Recovery ──────────────────────────────────────
  WATCHDOG_WARNING:                'WATCHDOG_WARNING',
  WATCHDOG_FAILURE:                'WATCHDOG_FAILURE',
  RECOVERY_STARTED:                'RECOVERY_STARTED',
  RECOVERY_ATTEMPT:                'RECOVERY_ATTEMPT',
  RECOVERY_COMPLETED:              'RECOVERY_COMPLETED',
  RECOVERY_FAILED:                 'RECOVERY_FAILED',
  COMPONENT_RESTARTED:             'COMPONENT_RESTARTED',
  DESTINATION_RECOVERY_STARTED:    'DESTINATION_RECOVERY_STARTED',
  DESTINATION_RECOVERED:           'DESTINATION_RECOVERED',
  SOURCE_RECOVERY_STARTED:         'SOURCE_RECOVERY_STARTED',
  SOURCE_RECOVERED:                'SOURCE_RECOVERED',
  STATION_RECOVERED:               'STATION_RECOVERED',
  FALLBACK_ACTIVATED:              'FALLBACK_ACTIVATED',

  // ── Security / Audit ─────────────────────────────────────────
  SECURITY_REJECTION:              'SECURITY_REJECTION',
  OWNERSHIP_VIOLATION:             'OWNERSHIP_VIOLATION',
  RATE_LIMIT_TRIGGERED:            'RATE_LIMIT_TRIGGERED',
  AUDIT_EVENT:                     'AUDIT_EVENT',
});
