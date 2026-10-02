/**
 * 24-HOUR CLOUD ENGINE — Station Playback
 * cloud-engine/tv-station/station-playback.js
 *
 * Manages the actual playback of programs for a TV station.
 *
 * The station playback layer:
 *   1. Takes the current program from the queue/schedule
 *   2. Resolves it to a MediaPlaybackSource
 *   3. Passes it to the Shadow Encoder
 *   4. Advances to the next item when complete
 *
 * When no programming is available:
 *   - If fallback media is configured: use it
 *   - Otherwise: enter NO_PROGRAMMING state (no dead air invented)
 *
 * Stage 10 — Optional TV Station Mode
 */

import EventEmitter                          from 'events';
import { CloudEngineLogger }                 from '../logs/logger.js';
import { CloudEngineEventBus }               from '../core/event-bus.js';
import { STATION_STATE, STATION_PLAYBACK_STATE,
         STATION_ERROR_CODE }                from './station-errors.js';

const MODULE = 'tv-station/station-playback';

/* ═══════════════════════════════════
   PLAYBACK EVENTS
═══════════════════════════════════ */
export const STATION_PLAYBACK_EVENT = Object.freeze({
  PROGRAM_STARTED:    'program:started',
  PROGRAM_ENDED:      'program:ended',
  PROGRAM_ADVANCED:   'program:advanced',
  NO_PROGRAMMING:     'program:none',
  FALLBACK_ACTIVATED: 'program:fallback',
  PLAYBACK_ERROR:     'playback:error',
});

/* ═══════════════════════════════════
   STATION PLAYBACK
═══════════════════════════════════ */
export class StationPlayback extends EventEmitter {
  /**
   * @param {object} opts
   * @param {Station} opts.station
   * @param {CloudMediaLibrary} opts.mediaLibrary
   * @param {ScheduleManager} opts.scheduleManager
   */
  constructor({ station, mediaLibrary, scheduleManager }) {
    super();
    this._station        = station;
    this._mediaLibrary   = mediaLibrary;
    this._scheduleManager = scheduleManager;
    this._currentSource  = null;
    this._advanceTimer   = null;
    this._playbackState  = STATION_PLAYBACK_STATE.IDLE;
    this._running        = false;
  }

  get playbackState() { return this._playbackState; }

  /* ── START / STOP ───────────────────────────────────────── */

  /**
   * Start station playback.
   * Determines what should currently be airing from schedule/queue.
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async start() {
    if (this._running) {
      return { success: false, message: 'Playback already running.' };
    }
    this._running = true;
    this._station.state.setStationState(STATION_STATE.ON_AIR);

    CloudEngineLogger.info(MODULE, 'STATION_PLAYBACK_START',
      `[${this._station.stationId}] Station playback starting.`);

    await this._advanceToCurrentProgram();
    return { success: true, message: 'Station playback started.' };
  }

  /**
   * Stop station playback.
   */
  async stop() {
    this._running = false;
    this._clearAdvanceTimer();

    if (this._currentSource) {
      await this._currentSource.release().catch(() => {});
      this._currentSource = null;
    }

    this._playbackState = STATION_PLAYBACK_STATE.STOPPED;
    this._station.state.setCurrentProgram(null);
    this._station.state.setStationState(STATION_STATE.OFFLINE);

    CloudEngineLogger.info(MODULE, 'STATION_PLAYBACK_STOP',
      `[${this._station.stationId}] Station playback stopped.`);

    return { success: true, message: 'Station playback stopped.' };
  }

  /* ── PROGRAM ADVANCEMENT ────────────────────────────────── */

  /**
   * Advance to the program that SHOULD be playing right now,
   * based on schedule or queue.
   *
   * This is the key method for schedule-aware playback.
   * It does NOT simply play the "next item" — it determines what
   * should be airing at the current time.
   */
  async _advanceToCurrentProgram() {
    if (!this._running) return;

    this._clearAdvanceTimer();

    const now = Date.now();

    // 1. Check schedule for what should be airing
    const { current, next } = this._scheduleManager.getCurrentAndNext(
      this._station.stationId, now,
    );

    if (current) {
      // Emit metric
      this._station._metrics.scheduleHits++;

      const elapsed = this._scheduleManager.getElapsedInEntry(current, now);
      const remaining = Math.max(0, current.durationSec - elapsed);

      this._station.state.setCurrentProgram({
        mediaId:    current.mediaId,
        title:      current.title,
        startedAt:  current.startAt,
        expectedEndAt: current.endAt,
        scheduledEntry: true,
        elapsedSec: elapsed,
      });
      this._station.state.setNextProgram(next
        ? { mediaId: next.mediaId, title: next.title, scheduledAt: next.startAt }
        : null,
      );

      this.emit(STATION_PLAYBACK_EVENT.PROGRAM_STARTED, {
        stationId: this._station.stationId,
        mediaId:   current.mediaId,
        title:     current.title,
        elapsed,
        remaining,
      });

      CloudEngineLogger.info(MODULE, 'PROGRAM_ON_AIR',
        `[${this._station.stationId}] ON AIR: "${current.title}" ` +
        `(${elapsed.toFixed(1)}s elapsed, ${remaining.toFixed(1)}s remaining)`);

      // Schedule advancement to end of entry or next entry
      if (remaining > 0) {
        this._advanceTimer = setTimeout(
          () => this._advanceToCurrentProgram(),
          remaining * 1000,
        );
        // unref so open timer does not prevent Node from exiting in tests
        if (this._advanceTimer?.unref) this._advanceTimer.unref();
      }
      return;
    }

    // 2. Check queue (playlist-driven)
    const queue = this._station.queue;
    if (queue.hasNext || queue.depth > 0 && queue.position < 0) {
      const item = queue.advance();
      if (item) {
        this._station._metrics.scheduleHits++;
        this._station.state.setCurrentProgram({
          mediaId: item.mediaId, title: item.title,
          startedAt: new Date().toISOString(),
          expectedEndAt: item.duration
            ? new Date(now + item.duration * 1000).toISOString() : null,
          scheduledEntry: false,
        });
        this._station.state.setNextProgram(queue.next
          ? { mediaId: queue.next.mediaId, title: queue.next.title } : null);

        this.emit(STATION_PLAYBACK_EVENT.PROGRAM_STARTED, {
          stationId: this._station.stationId,
          mediaId:   item.mediaId,
          title:     item.title,
        });

        // Auto-advance at end of item
        if (item.duration) {
          this._advanceTimer = setTimeout(
            () => this._advanceToCurrentProgram(),
            item.duration * 1000,
          );
          if (this._advanceTimer?.unref) this._advanceTimer.unref();
        }
        return;
      }
    }

    // 3. Fallback
    this._station._metrics.scheduleMisses++;

    if (this._station.fallbackMediaId) {
      this._station._metrics.fallbackActivations++;
      this._station.state.setCurrentProgram({
        mediaId:   this._station.fallbackMediaId,
        title:     'Fallback',
        startedAt: new Date().toISOString(),
        isFallback: true,
      });
      this.emit(STATION_PLAYBACK_EVENT.FALLBACK_ACTIVATED, {
        stationId: this._station.stationId,
        mediaId:   this._station.fallbackMediaId,
      });
      CloudEngineLogger.info(MODULE, 'FALLBACK_ACTIVATED',
        `[${this._station.stationId}] No scheduled content — using fallback.`);
      return;
    }

    // 4. No programming
    this._station.state.setCurrentProgram(null);
    this._station.state.setStationState(STATION_STATE.NO_PROGRAMMING);
    this.emit(STATION_PLAYBACK_EVENT.NO_PROGRAMMING, {
      stationId: this._station.stationId,
    });
    CloudEngineLogger.warn(MODULE, 'NO_PROGRAMMING',
      `[${this._station.stationId}] No scheduled content and no fallback configured.`);
  }

  /**
   * Manually advance to next item (skip current).
   */
  async next() {
    this._clearAdvanceTimer();
    await this._advanceToCurrentProgram();
    this.emit(STATION_PLAYBACK_EVENT.PROGRAM_ADVANCED,
      { stationId: this._station.stationId });
    return { success: true, message: 'Advanced to next program.' };
  }

  /**
   * Restart the current program.
   */
  async restart() {
    const current = this._station.state.currentProgram;
    if (!current) {
      return { success: false, message: 'No current program.' };
    }
    this._clearAdvanceTimer();
    await this._advanceToCurrentProgram();
    return { success: true, message: 'Program restarted.' };
  }

  /* ── Private ────────────────────────────────────────────── */
  _clearAdvanceTimer() {
    if (this._advanceTimer) {
      clearTimeout(this._advanceTimer);
      this._advanceTimer = null;
    }
  }
}
