/**
 * 24-HOUR CLOUD ENGINE — Station
 * cloud-engine/tv-station/station.js
 *
 * Represents a single TV station owned by a creator.
 * Multiple stations can coexist — each is independently owned and controlled.
 *
 * A Station does NOT directly manage broadcasting — it delegates to
 * TVStationManager → StationPlayback → Shadow Encoder → Fan-Out.
 *
 * Stage 10 — Optional TV Station Mode
 */

import { STATION_STATE, STATION_ERROR_CODE } from './station-errors.js';
import { StationState }                       from './station-state.js';
import { PlaylistManager }                    from './playlist-manager.js';
import { ScheduleManager }                    from './schedule-manager.js';
import { ProgramQueue }                       from './program-queue.js';
import { createStationMetrics }               from './station-metrics.js';

/* ═══════════════════════════════════
   STATION CLASS
═══════════════════════════════════ */
export class Station {
  /**
   * @param {object} config
   * @param {string} config.stationId
   * @param {string} config.ownerId
   * @param {string} config.name
   * @param {string} [config.description]
   * @param {string[]} [config.enabledDestinations]  Destination IDs from FanOutManager
   * @param {string} [config.fallbackMediaId]        Media to use when no programming exists
   * @param {string} [config.timezone]               IANA timezone, default 'UTC'
   * @param {object} [config.defaultSettings]
   */
  constructor(config) {
    const {
      stationId, ownerId, name, description = '',
      enabledDestinations = [], fallbackMediaId = null,
      timezone = 'UTC', defaultSettings = {},
    } = config ?? {};

    if (!stationId) throw new Error('stationId required');
    if (!ownerId)   throw new Error('ownerId required');
    if (!name)      throw new Error('name required');

    this.stationId           = stationId;
    this.ownerId             = ownerId;
    this.name                = name;
    this.description         = description;
    this.enabledDestinations = [...enabledDestinations];
    this.fallbackMediaId     = fallbackMediaId;
    this.timezone            = timezone;
    this.defaultSettings     = { ...defaultSettings };
    this.createdAt           = new Date().toISOString();

    // Sub-components
    this._state    = new StationState(stationId);
    this._playlists = new PlaylistManager();
    this._schedule  = new ScheduleManager();
    this._queue     = new ProgramQueue();
    this._metrics   = createStationMetrics(stationId);
  }

  /* ── Accessors ──────────────────────────────────────────── */
  get state()     { return this._state; }
  get playlists() { return this._playlists; }
  get schedule()  { return this._schedule; }
  get queue()     { return this._queue; }
  get metrics()   { return this._metrics; }

  /* ── Dashboard ─────────────────────────────────────────── */

  /**
   * Get a safe, complete station dashboard.
   * No credentials, no private state.
   */
  getDashboard() {
    const stateSnap = this._state.snapshot();
    return {
      stationId:           this.stationId,
      ownerId:             this.ownerId,
      name:                this.name,
      description:         this.description,
      timezone:            this.timezone,
      enabledDestinations: [...this.enabledDestinations],
      fallbackMediaId:     this.fallbackMediaId,

      // Station status
      stationState:   stateSnap.stationState,
      playbackState:  stateSnap.playbackState,
      currentProgram: stateSnap.currentProgram,
      nextProgram:    stateSnap.nextProgram,
      uptimeSeconds:  stateSnap.uptimeSeconds,
      programCount:   stateSnap.programCount,

      // Queue
      queue: this._queue.getStatus(),

      // Metrics
      metrics: { ...this._metrics },

      // Timestamps
      createdAt: this.createdAt,
      asOf:      new Date().toISOString(),
    };
  }

  /**
   * Verify that the requester owns this station.
   * @param {string} requesterId
   * @returns {boolean}
   */
  isOwner(requesterId) {
    return this.ownerId === requesterId;
  }

  toJSON() {
    return {
      stationId:   this.stationId,
      ownerId:     this.ownerId,
      name:        this.name,
      description: this.description,
      timezone:    this.timezone,
      createdAt:   this.createdAt,
    };
  }
}
