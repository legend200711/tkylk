/**
 * 24-HOUR CLOUD ENGINE — TV Station Manager
 * cloud-engine/tv-station/tv-station-manager.js
 * (also re-exports createQueueItem for internal use)
 *
 * Central manager for all TV stations.
 *
 * A user can create a station, configure playlists, schedule content,
 * and start/stop station broadcasting.
 *
 * THIS IS AN OPTIONAL MODE.
 * The primary engine is the live broadcast engine.
 * TV Station Mode is an add-on capability, not the default.
 *
 * Multi-station architecture:
 *   Each station is independently owned and controlled.
 *   Station A cannot control Station B.
 *   Full security hardening is Stage 13.
 *
 * Restart recovery:
 *   StationState serializes all necessary data.
 *   On restart, getCurrentAndNext() from ScheduleManager
 *   determines the correct program — no manual resume needed.
 *
 * Stage 10 — Optional TV Station Mode
 */

import { CloudEngineLogger }         from '../logs/logger.js';
import { CloudEngineEventBus }       from '../core/event-bus.js';
import { Station }                   from './station.js';
import { StationPlayback,
         STATION_PLAYBACK_EVENT }    from './station-playback.js';
import { STATION_STATE,
         STATION_ERROR_CODE }        from './station-errors.js';
import { createQueueItem }           from './program-queue.js';

const MODULE = 'tv-station/tv-station-manager';

/* ═══════════════════════════════════
   TV STATION MANAGER
═══════════════════════════════════ */
export class TVStationManager {
  constructor({ mediaLibrary } = {}) {
    this._stations   = new Map();   // stationId → { station, playback }
    this._mediaLibrary = mediaLibrary ?? null;
  }

  /* ── Station Lifecycle ─────────────────────────────────── */

  /**
   * Create a new TV station.
   * @param {object} config  Station configuration
   * @returns {{ success: boolean, station: Station|null, message: string }}
   */
  createStation(config) {
    if (!config?.stationId) {
      return { success: false, station: null, message: 'stationId required.',
               code: STATION_ERROR_CODE.INVALID_STATION_CONFIG };
    }

    if (this._stations.has(config.stationId)) {
      return { success: false, station: null,
               message: `Station "${config.stationId}" already exists.`,
               code: STATION_ERROR_CODE.STATION_ALREADY_EXISTS };
    }

    try {
      const station  = new Station(config);
      const playback = new StationPlayback({
        station,
        mediaLibrary:    this._mediaLibrary,
        scheduleManager: station.schedule,
      });

      // Wire playback events to engine event bus
      this._wirePlaybackEvents(station, playback);

      this._stations.set(config.stationId, { station, playback });

      CloudEngineLogger.info(MODULE, 'STATION_CREATED',
        `TV Station created: "${config.stationId}" (${config.name}) owner=${config.ownerId}`);

      return { success: true, station, message: 'TV Station created.' };
    } catch (err) {
      return { success: false, station: null, message: err.message,
               code: STATION_ERROR_CODE.INVALID_STATION_CONFIG };
    }
  }

  /**
   * Delete a TV station. Stops playback first.
   */
  async deleteStation(stationId, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;

    await entry.playback.stop().catch(() => {});
    this._stations.delete(stationId);
    CloudEngineLogger.info(MODULE, 'STATION_DELETED', `Station deleted: "${stationId}"`);
    return { success: true, message: `Station "${stationId}" deleted.` };
  }

  /* ── Playback Control ──────────────────────────────────── */

  /**
   * Start station broadcast.
   */
  async startStation(stationId, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;

    const result = await entry.playback.start();
    return result;
  }

  /**
   * Stop station broadcast.
   */
  async stopStation(stationId, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;

    const result = await entry.playback.stop();
    return result;
  }

  /**
   * Advance to next program.
   */
  async nextProgram(stationId, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    return entry.playback.next();
  }

  /**
   * Restart current program.
   */
  async restartProgram(stationId, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    return entry.playback.restart();
  }

  /* ── Schedule Management ───────────────────────────────── */

  /**
   * Schedule a program entry.
   */
  scheduleProgram(stationId, params, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    return entry.station.schedule.add({ ...params, stationId, ownerId: requesterId });
  }

  /**
   * Remove a scheduled entry.
   */
  removeScheduledEntry(stationId, entryId, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    return entry.station.schedule.remove(entryId, requesterId);
  }

  /**
   * Get the full schedule for a station.
   */
  getSchedule(stationId, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    return {
      success: true,
      entries: entry.station.schedule.getByStation(stationId),
    };
  }

  /**
   * Determine what should be airing right now on a station.
   * Used for recovery and Studio dashboard.
   */
  getCurrentSchedulePosition(stationId, requesterId, atTime) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    const pos = entry.station.schedule.getCurrentAndNext(stationId, atTime);
    return { success: true, ...pos };
  }

  /* ── Playlist Management ───────────────────────────────── */

  createPlaylist(stationId, config, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    return entry.station.playlists.create({ ...config, ownerId: requesterId });
  }

  addToPlaylist(stationId, playlistId, item, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    return entry.station.playlists.addItem(playlistId, item, requesterId);
  }

  removeFromPlaylist(stationId, playlistId, mediaId, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    return entry.station.playlists.removeItem(playlistId, mediaId, requesterId);
  }

  reorderPlaylist(stationId, playlistId, orderedMediaIds, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    return entry.station.playlists.reorder(playlistId, orderedMediaIds, requesterId);
  }

  /**
   * Load a playlist into the station queue.
   */
  loadPlaylistToQueue(stationId, playlistId, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;

    const plResult = entry.station.playlists.get(playlistId, requesterId);
    if (!plResult.success) return plResult;

    if (plResult.playlist.isEmpty) {
      return { success: false, message: 'Playlist is empty.',
               code: STATION_ERROR_CODE.PLAYLIST_EMPTY };
    }

    entry.station.queue.clear();
    for (const item of plResult.playlist.getItems()) {
      const qi = createQueueItem({
        mediaId:  item.mediaId,
        title:    item.title,
        duration: item.duration,
        source:   'playlist',
      });
      entry.station.queue.enqueue(qi);
    }

    CloudEngineLogger.info(MODULE, 'PLAYLIST_LOADED',
      `[${stationId}] Playlist "${playlistId}" loaded to queue ` +
      `(${plResult.playlist.length} items).`);

    return {
      success: true,
      message: `Playlist loaded to queue.`,
      itemCount: plResult.playlist.length,
    };
  }

  /* ── Station Status ────────────────────────────────────── */

  /**
   * Get a station's dashboard.
   */
  getDashboard(stationId, requesterId) {
    const entry = this._getEntry(stationId, requesterId);
    if (!entry.success) return entry;
    return { success: true, dashboard: entry.station.getDashboard() };
  }

  /**
   * Get statuses of all stations owned by a user.
   */
  getStationsByOwner(ownerId) {
    return [...this._stations.values()]
      .filter(e => e.station.ownerId === ownerId)
      .map(e => e.station.getDashboard());
  }

  /**
   * List all station IDs (admin use).
   */
  listAll() { return [...this._stations.keys()]; }

  /* ── Private ────────────────────────────────────────────── */

  _getEntry(stationId, requesterId) {
    const entry = this._stations.get(stationId);
    if (!entry) {
      return { success: false, message: `Station "${stationId}" not found.`,
               code: STATION_ERROR_CODE.STATION_NOT_FOUND };
    }
    if (requesterId !== undefined && requesterId !== null &&
        entry.station.ownerId !== requesterId) {
      return { success: false, message: 'Access denied.',
               code: STATION_ERROR_CODE.ACCESS_DENIED };
    }
    return { success: true, ...entry };
  }

  _wirePlaybackEvents(station, playback) {
    playback.on(STATION_PLAYBACK_EVENT.PROGRAM_STARTED, (data) => {
      CloudEngineEventBus.emit('STATION_PROGRAM_STARTED', data);
    });
    playback.on(STATION_PLAYBACK_EVENT.NO_PROGRAMMING, (data) => {
      CloudEngineEventBus.emit('STATION_NO_PROGRAMMING', data);
    });
    playback.on(STATION_PLAYBACK_EVENT.FALLBACK_ACTIVATED, (data) => {
      CloudEngineEventBus.emit('STATION_FALLBACK_ACTIVATED', data);
    });
  }
}
