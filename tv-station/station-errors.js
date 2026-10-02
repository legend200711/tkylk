/**
 * 24-HOUR CLOUD ENGINE — TV Station Errors
 * cloud-engine/tv-station/station-errors.js
 *
 * Error codes and StationError class for TV Station Mode.
 *
 * Stage 10 — Optional TV Station Mode
 */

/* ═══════════════════════════════════
   STATION STATES
═══════════════════════════════════ */
export const STATION_STATE = Object.freeze({
  OFFLINE:          'OFFLINE',
  INITIALIZING:     'INITIALIZING',
  READY:            'READY',
  ON_AIR:           'ON_AIR',
  PAUSED:           'PAUSED',          // Temporary gap; fallback may fill
  NO_PROGRAMMING:   'NO_PROGRAMMING',  // No scheduled content
  ERROR:            'ERROR',
  STOPPING:         'STOPPING',
});

/* ═══════════════════════════════════
   PLAYBACK STATES
═══════════════════════════════════ */
export const STATION_PLAYBACK_STATE = Object.freeze({
  IDLE:       'IDLE',
  PLAYING:    'PLAYING',
  ADVANCING:  'ADVANCING',  // Moving to next item
  STOPPED:    'STOPPED',
});

/* ═══════════════════════════════════
   ERROR CODES
═══════════════════════════════════ */
export const STATION_ERROR_CODE = Object.freeze({
  // Station
  STATION_NOT_FOUND:           'STATION_NOT_FOUND',
  STATION_ALREADY_EXISTS:      'STATION_ALREADY_EXISTS',
  INVALID_STATION_CONFIG:      'INVALID_STATION_CONFIG',
  ACCESS_DENIED:               'ACCESS_DENIED',

  // Playlist
  PLAYLIST_NOT_FOUND:          'PLAYLIST_NOT_FOUND',
  PLAYLIST_ALREADY_EXISTS:     'PLAYLIST_ALREADY_EXISTS',
  PLAYLIST_EMPTY:              'PLAYLIST_EMPTY',
  INVALID_PLAYLIST_ITEM:       'INVALID_PLAYLIST_ITEM',

  // Schedule
  SCHEDULE_CONFLICT:           'SCHEDULE_CONFLICT',
  SCHEDULE_INVALID_TIME:       'SCHEDULE_INVALID_TIME',
  SCHEDULE_NOT_FOUND:          'SCHEDULE_NOT_FOUND',
  INVALID_TIMEZONE:            'INVALID_TIMEZONE',

  // Playback / Queue
  QUEUE_EMPTY:                 'QUEUE_EMPTY',
  NO_CURRENT_PROGRAM:          'NO_CURRENT_PROGRAM',
  MEDIA_NOT_READY:             'MEDIA_NOT_READY',
  PLAYBACK_FAILED:             'PLAYBACK_FAILED',
});

/* ═══════════════════════════════════
   STATION ERROR CLASS
═══════════════════════════════════ */
export class StationError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name      = 'StationError';
    this.code      = code;
    this.meta      = meta;
    this.timestamp = new Date().toISOString();

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StationError);
    }
  }

  toJSON() {
    return { code: this.code, message: this.message, timestamp: this.timestamp, meta: this.meta };
  }
}
