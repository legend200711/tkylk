/**
 * 24-HOUR CLOUD ENGINE — Media Errors
 * cloud-engine/media/media-errors.js
 *
 * Error codes and MediaError class for the cloud media subsystem.
 *
 * Stage 9 — Cloud Media + Prerecorded Broadcasting
 */

/* ═══════════════════════════════════
   MEDIA TYPES
═══════════════════════════════════ */
export const MEDIA_TYPE = Object.freeze({
  VIDEO:        'VIDEO',
  AUDIO:        'AUDIO',
  IMAGE:        'IMAGE',
  PROGRAM:      'PROGRAM',     // Prerecorded program (multi-segment or single file)
  CLIP:         'CLIP',        // Short clip
  BUMPER:       'BUMPER',      // Short transition bumper
  STATION_ID:   'STATION_ID',  // Station identification
  AD:           'AD',          // Future: advertisement
  OVERLAY:      'OVERLAY',     // Future: overlay graphic
});

/* ═══════════════════════════════════
   VALIDATION STATES
═══════════════════════════════════ */
export const MEDIA_VALIDATION_STATE = Object.freeze({
  UNVALIDATED:  'UNVALIDATED',
  VALIDATING:   'VALIDATING',
  VALID:        'VALID',
  INVALID:      'INVALID',
  ERROR:        'ERROR',
});

/* ═══════════════════════════════════
   ERROR CODES
═══════════════════════════════════ */
export const MEDIA_ERROR_CODE = Object.freeze({
  // Registration
  MEDIA_NOT_FOUND:           'MEDIA_NOT_FOUND',
  MEDIA_ALREADY_EXISTS:      'MEDIA_ALREADY_EXISTS',
  INVALID_MEDIA_ITEM:        'INVALID_MEDIA_ITEM',

  // Storage
  STORAGE_UNAVAILABLE:       'STORAGE_UNAVAILABLE',
  STORAGE_READ_FAILED:       'STORAGE_READ_FAILED',
  FILE_NOT_FOUND:            'FILE_NOT_FOUND',
  FILE_TOO_LARGE:            'FILE_TOO_LARGE',

  // Validation
  VALIDATION_FAILED:         'VALIDATION_FAILED',
  FORMAT_UNSUPPORTED:        'FORMAT_UNSUPPORTED',
  PROBE_FAILED:              'PROBE_FAILED',
  NO_VIDEO_STREAM:           'NO_VIDEO_STREAM',
  NO_AUDIO_STREAM:           'NO_AUDIO_STREAM',
  CORRUPTED_MEDIA:           'CORRUPTED_MEDIA',
  ZERO_DURATION:             'ZERO_DURATION',

  // Playback
  NOT_PLAYABLE:              'NOT_PLAYABLE',
  PLAYBACK_SOURCE_ERROR:     'PLAYBACK_SOURCE_ERROR',

  // Ownership
  ACCESS_DENIED:             'ACCESS_DENIED',
});

/* ═══════════════════════════════════
   MEDIA ERROR CLASS
═══════════════════════════════════ */
export class MediaError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name      = 'MediaError';
    this.code      = code;
    this.meta      = meta;
    this.timestamp = new Date().toISOString();

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MediaError);
    }
  }

  toJSON() {
    return { code: this.code, message: this.message, timestamp: this.timestamp, meta: this.meta };
  }
}
