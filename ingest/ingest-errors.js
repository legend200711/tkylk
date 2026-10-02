/**
 * 24-HOUR CLOUD ENGINE — Ingest Source Types & Errors
 * cloud-engine/ingest/ingest-errors.js
 *
 * Defines all source type constants and error codes for the ingest subsystem.
 *
 * Source types indicate the INPUT side of the pipeline:
 *   LIVE SOURCE → INGEST → SHADOW ENCODER → FAN-OUT → DESTINATIONS
 *
 * Only mark a source type as OPERATIONAL if it is genuinely implemented.
 * Do NOT fabricate WebRTC or camera support that cannot work in this environment.
 *
 * Stage 5 — Live Input / Ingest
 */

/* ═══════════════════════════════════
   SOURCE TYPES
═══════════════════════════════════ */
export const SOURCE_TYPE = Object.freeze({
  MEDIA_FILE:         'MEDIA_FILE',          // Prerecorded local media file (OPERATIONAL)
  RTMP_INPUT:         'RTMP_INPUT',          // Incoming RTMP push from external encoder (ARCHITECTURE_READY)
  CAMERA:             'CAMERA',              // Physical camera device (NOT_IMPLEMENTED — env limitation)
  MICROPHONE:         'MICROPHONE',          // Microphone only (NOT_IMPLEMENTED — env limitation)
  CAMERA_MIC:         'CAMERA_MIC',          // Camera + microphone (NOT_IMPLEMENTED — env limitation)
  FUTURE_WEBRTC:      'FUTURE_WEBRTC',       // WebRTC browser/mobile source (NOT_IMPLEMENTED)
  EXTERNAL_ENCODER:   'EXTERNAL_ENCODER',    // RTMP push from OBS/Wirecast/etc. (ARCHITECTURE_READY)
});

/**
 * Which source types are genuinely operational in this environment.
 * Others are architecturally defined but not yet runnable.
 */
export const SOURCE_TYPE_STATUS = Object.freeze({
  [SOURCE_TYPE.MEDIA_FILE]:       'OPERATIONAL',       // Can read local FLV/MP4/etc.
  [SOURCE_TYPE.RTMP_INPUT]:       'ARCHITECTURE_READY',// Interface defined; RTMP server not yet running
  [SOURCE_TYPE.CAMERA]:           'NOT_IMPLEMENTED',   // No physical camera access in this environment
  [SOURCE_TYPE.MICROPHONE]:       'NOT_IMPLEMENTED',   // No microphone access in this environment
  [SOURCE_TYPE.CAMERA_MIC]:       'NOT_IMPLEMENTED',   // No AV capture in this environment
  [SOURCE_TYPE.FUTURE_WEBRTC]:    'NOT_IMPLEMENTED',   // WebRTC not implemented
  [SOURCE_TYPE.EXTERNAL_ENCODER]: 'ARCHITECTURE_READY',// Interface defined; RTMP listener not yet running
});

/* ═══════════════════════════════════
   INGEST ERROR CODES
═══════════════════════════════════ */
export const INGEST_ERROR_CODE = Object.freeze({
  SOURCE_INVALID:            'SOURCE_INVALID',
  SOURCE_UNSUPPORTED:        'SOURCE_UNSUPPORTED',
  SOURCE_NOT_FOUND:          'SOURCE_NOT_FOUND',
  SOURCE_NOT_OPERATIONAL:    'SOURCE_NOT_OPERATIONAL',
  SOURCE_DISCONNECTED:       'SOURCE_DISCONNECTED',
  NO_VIDEO:                  'NO_VIDEO',
  NO_AUDIO:                  'NO_AUDIO',
  STALLED_INPUT:             'STALLED_INPUT',
  PROCESS_CRASHED:           'PROCESS_CRASHED',
  ALREADY_ACTIVE:            'ALREADY_ACTIVE',
  NOT_ACTIVE:                'NOT_ACTIVE',
  INVALID_STATE:             'INVALID_STATE',
  PROBE_FAILED:              'PROBE_FAILED',
  INVALID_SESSION_ID:        'INVALID_SESSION_ID',
});

/* ═══════════════════════════════════
   INGEST ERROR CLASS
═══════════════════════════════════ */
export class IngestError extends Error {
  /**
   * @param {string} code     INGEST_ERROR_CODE constant
   * @param {string} message  Human-readable message
   * @param {object} [meta]   Additional context (NO SECRETS)
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name      = 'IngestError';
    this.code      = code;
    this.meta      = meta;
    this.timestamp = new Date().toISOString();

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IngestError);
    }
  }

  toJSON() {
    return {
      code:      this.code,
      message:   this.message,
      timestamp: this.timestamp,
      meta:      this.meta,
    };
  }
}
