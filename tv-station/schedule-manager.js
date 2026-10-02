/**
 * 24-HOUR CLOUD ENGINE — Schedule Manager
 * cloud-engine/tv-station/schedule-manager.js
 *
 * Manages the TV station schedule.
 * Scheduling uses deterministic UTC timestamps — NOT browser timers.
 *
 * A schedule entry links a time slot to a media item or playlist.
 * The cloud engine determines what should be airing by comparing
 * the current UTC time against schedule entries.
 *
 * Timezone handling:
 *   Input times can be in any timezone (using UTC offset or name).
 *   All internal storage is UTC timestamps (ISO 8601).
 *   Timezone conversion uses a minimal built-in approach via
 *   Intl.DateTimeFormat — no external packages required.
 *
 * Stage 10 — Optional TV Station Mode
 */

import { CloudEngineLogger }                from '../logs/logger.js';
import { STATION_ERROR_CODE }               from './station-errors.js';

const MODULE = 'tv-station/schedule-manager';

/* ═══════════════════════════════════
   SCHEDULE ENTRY
═══════════════════════════════════ */

/**
 * Create a schedule entry.
 *
 * @param {object} params
 * @param {string} params.entryId      Unique ID
 * @param {string} params.stationId    Station this belongs to
 * @param {string} params.ownerId
 * @param {string} params.mediaId      Media item to air
 * @param {string} params.title        Display title
 * @param {string} params.startAt      ISO 8601 UTC timestamp
 * @param {number} params.duration     Duration in seconds (from media metadata)
 * @param {string} [params.playlistId] Optional: playlist to play
 * @returns {ScheduleEntry}
 */
export function createScheduleEntry(params) {
  const { entryId, stationId, ownerId, mediaId, title, startAt, duration, playlistId } = params;
  if (!entryId)    throw new Error('entryId required');
  if (!stationId)  throw new Error('stationId required');
  if (!ownerId)    throw new Error('ownerId required');
  if (!startAt)    throw new Error('startAt required');
  if (!duration || duration <= 0) throw new Error('duration must be > 0');

  const startMs = new Date(startAt).getTime();
  if (isNaN(startMs)) throw new Error(`Invalid startAt: "${startAt}"`);

  return Object.freeze({
    entryId,
    stationId,
    ownerId,
    mediaId:    mediaId    ?? null,
    playlistId: playlistId ?? null,
    title:      title      ?? 'Untitled',
    startAt:    new Date(startMs).toISOString(),  // Normalize to UTC ISO
    endAt:      new Date(startMs + duration * 1000).toISOString(),
    durationSec: duration,
    createdAt:   new Date().toISOString(),
  });
}

/* ═══════════════════════════════════
   SCHEDULE MANAGER
═══════════════════════════════════ */
export class ScheduleManager {
  constructor() {
    this._entries = new Map();   // entryId → ScheduleEntry
  }

  /**
   * Add a schedule entry.
   * Validates for time conflicts with existing entries of the same station.
   *
   * @param {object} params
   * @param {boolean} [allowConflict=false]  Allow overlapping entries
   * @returns {{ success: boolean, entry: ScheduleEntry|null, conflicts: ScheduleEntry[] }}
   */
  add(params, allowConflict = false) {
    try {
      const entry = createScheduleEntry(params);

      if (this._entries.has(entry.entryId)) {
        return { success: false, entry: null, conflicts: [],
                 message: `Entry "${entry.entryId}" already exists.`,
                 code: STATION_ERROR_CODE.SCHEDULE_NOT_FOUND };
      }

      // Check for conflicts on the same station
      const conflicts = this._findConflicts(entry);
      if (conflicts.length > 0 && !allowConflict) {
        return {
          success: false, entry: null, conflicts,
          message: `Schedule conflict: ${conflicts.length} overlapping entries.`,
          code: STATION_ERROR_CODE.SCHEDULE_CONFLICT,
        };
      }

      this._entries.set(entry.entryId, entry);
      CloudEngineLogger.info(MODULE, 'SCHEDULE_ENTRY_ADDED',
        `Schedule entry added: "${entry.entryId}" station=${entry.stationId} ` +
        `at ${entry.startAt} (${entry.durationSec}s)`);

      return { success: true, entry, conflicts };
    } catch (err) {
      return { success: false, entry: null, conflicts: [], message: err.message,
               code: STATION_ERROR_CODE.SCHEDULE_INVALID_TIME };
    }
  }

  /**
   * Remove a schedule entry.
   */
  remove(entryId, requesterId = null) {
    const entry = this._entries.get(entryId);
    if (!entry) {
      return { success: false, message: `Entry "${entryId}" not found.`,
               code: STATION_ERROR_CODE.SCHEDULE_NOT_FOUND };
    }
    if (requesterId !== null && entry.ownerId !== requesterId) {
      return { success: false, message: 'Access denied.',
               code: STATION_ERROR_CODE.ACCESS_DENIED };
    }
    this._entries.delete(entryId);
    return { success: true, message: `Entry "${entryId}" removed.` };
  }

  /**
   * Get entry by ID.
   */
  get(entryId) {
    return this._entries.get(entryId) ?? null;
  }

  /**
   * Get all entries for a station, sorted by startAt.
   */
  getByStation(stationId) {
    return [...this._entries.values()]
      .filter(e => e.stationId === stationId)
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  }

  /**
   * Get entries for a station within a time window.
   * @param {string} stationId
   * @param {Date|string} from
   * @param {Date|string} to
   */
  getByStationWindow(stationId, from, to) {
    const fromMs = new Date(from).getTime();
    const toMs   = new Date(to).getTime();
    return this.getByStation(stationId).filter(e => {
      const startMs = new Date(e.startAt).getTime();
      const endMs   = new Date(e.endAt).getTime();
      // Overlap: entry starts before window ends AND ends after window starts
      return startMs < toMs && endMs > fromMs;
    });
  }

  /**
   * Determine what should be airing at a given timestamp.
   * This is deterministic: given the same schedule + timestamp, always
   * returns the same result. Used for restart recovery.
   *
   * @param {string} stationId
   * @param {Date|string|number} [atTime=Date.now()]
   * @returns {{ current: ScheduleEntry|null, next: ScheduleEntry|null }}
   */
  getCurrentAndNext(stationId, atTime = Date.now()) {
    const atMs    = new Date(atTime).getTime();
    const entries = this.getByStation(stationId);

    let current = null;
    let next    = null;

    for (const entry of entries) {
      const startMs = new Date(entry.startAt).getTime();
      const endMs   = new Date(entry.endAt).getTime();

      if (startMs <= atMs && endMs > atMs) {
        current = entry;
      } else if (startMs > atMs) {
        if (!next || startMs < new Date(next.startAt).getTime()) {
          next = entry;
        }
      }
    }

    return { current, next };
  }

  /**
   * Get time elapsed within the current entry (for mid-entry recovery).
   * @param {ScheduleEntry} entry
   * @param {number} [atMs=Date.now()]
   * @returns {number} Elapsed seconds into the entry
   */
  getElapsedInEntry(entry, atMs = Date.now()) {
    const startMs = new Date(entry.startAt).getTime();
    return Math.max(0, (atMs - startMs) / 1000);
  }

  /* ── Private ────────────────────────────────────────────── */

  _findConflicts(candidate) {
    const cStartMs = new Date(candidate.startAt).getTime();
    const cEndMs   = new Date(candidate.endAt).getTime();

    return [...this._entries.values()].filter(e => {
      if (e.stationId !== candidate.stationId) return false;
      const eStartMs = new Date(e.startAt).getTime();
      const eEndMs   = new Date(e.endAt).getTime();
      // Overlaps if one starts before the other ends
      return cStartMs < eEndMs && cEndMs > eStartMs;
    });
  }
}
