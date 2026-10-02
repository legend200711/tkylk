/**
 * 24-HOUR CLOUD ENGINE — Station State
 * cloud-engine/tv-station/station-state.js
 *
 * Manages the persistent state of a TV station.
 * State is kept in memory and can be serialized for restart recovery.
 *
 * Stage 10 — Optional TV Station Mode
 */

import { STATION_STATE, STATION_PLAYBACK_STATE } from './station-errors.js';

/* ═══════════════════════════════════
   STATION STATE MANAGER
═══════════════════════════════════ */
export class StationState {
  constructor(stationId) {
    this.stationId = stationId;

    // Station lifecycle
    this._stationState    = STATION_STATE.OFFLINE;
    this._createdAt       = new Date().toISOString();
    this._startedAt       = null;
    this._lastError       = null;

    // Playback
    this._playbackState   = STATION_PLAYBACK_STATE.IDLE;
    this._currentProgram  = null;    // { mediaId, title, startedAt, expectedEndAt }
    this._nextProgram     = null;    // { mediaId, title, scheduledAt }
    this._queuePosition   = 0;
    this._programCount    = 0;       // Total programs played since start

    // Metrics
    this._totalAirtime    = 0;       // seconds on air
    this._airStartedAt    = null;
  }

  /* ── Getters ────────────────────────────────────────────── */

  get stationState()   { return this._stationState; }
  get playbackState()  { return this._playbackState; }
  get currentProgram() { return this._currentProgram ? { ...this._currentProgram } : null; }
  get nextProgram()    { return this._nextProgram ? { ...this._nextProgram } : null; }
  get queuePosition()  { return this._queuePosition; }
  get programCount()   { return this._programCount; }

  /* ── State transitions ─────────────────────────────────── */

  setStationState(state) {
    this._stationState = state;
    if (state === STATION_STATE.ON_AIR) {
      this._startedAt  = this._startedAt ?? new Date().toISOString();
      this._airStartedAt = Date.now();
    }
  }

  setCurrentProgram(program) {
    if (this._currentProgram) {
      // Accumulate airtime from previous program
      if (this._airStartedAt) {
        this._totalAirtime += (Date.now() - this._airStartedAt) / 1000;
      }
    }
    this._currentProgram = program
      ? { ...program, _setAt: new Date().toISOString() }
      : null;
    this._airStartedAt = program ? Date.now() : null;

    if (program) {
      this._programCount++;
      this._playbackState = STATION_PLAYBACK_STATE.PLAYING;
    } else {
      this._playbackState = STATION_PLAYBACK_STATE.IDLE;
    }
  }

  setNextProgram(program) {
    this._nextProgram = program ? { ...program } : null;
  }

  advanceQueuePosition() {
    this._queuePosition++;
  }

  setError(code, message) {
    this._lastError    = { code, message, at: new Date().toISOString() };
    this._stationState = STATION_STATE.ERROR;
  }

  clearError() {
    this._lastError = null;
  }

  /* ── Serialization ─────────────────────────────────────── */

  /**
   * Get a complete serializable snapshot of station state.
   * Safe for logging and recovery — no secrets.
   */
  snapshot() {
    const now = Date.now();
    const uptime = this._startedAt
      ? Math.floor((now - new Date(this._startedAt).getTime()) / 1000)
      : 0;
    const currentAirtime = this._airStartedAt
      ? this._totalAirtime + (now - this._airStartedAt) / 1000
      : this._totalAirtime;

    return {
      stationId:      this.stationId,
      stationState:   this._stationState,
      playbackState:  this._playbackState,
      currentProgram: this.currentProgram,
      nextProgram:    this.nextProgram,
      queuePosition:  this._queuePosition,
      programCount:   this._programCount,
      createdAt:      this._createdAt,
      startedAt:      this._startedAt,
      uptimeSeconds:  uptime,
      totalAirtimeSec: Math.floor(currentAirtime),
      lastError:      this._lastError,
    };
  }
}
