/**
 * 24-HOUR CLOUD ENGINE — Timing Engine
 * cloud-engine/encoder/timing-engine.js
 *
 * Tracks media playback/encoding timing and exposes telemetry
 * that the Stage 3 watchdog can consume.
 *
 * Tracks:
 *   - Wall-clock elapsed time since encoding started
 *   - Media position (from FFmpeg progress)
 *   - Media duration
 *   - Expected vs actual frame timing
 *   - Processing speed ratio
 *   - Timing status: NORMAL / BEHIND / STALLED
 *
 * Does NOT implement the watchdog itself — that is Stage 3.
 *
 * Stage 2 — Shadow Encoder
 */

import { assessTimingStatus } from './encoder-metrics.js';

export class TimingEngine {
  constructor() {
    this._startTime   = null;   // Date.now() when encoding started
    this._duration    = null;   // media duration in seconds
    this._position    = null;   // current encoding position in seconds
    this._fps         = null;   // current encoding fps
    this._targetFps   = null;   // profile target fps
    this._speed       = null;   // FFmpeg speed ratio (e.g. 1.05)
    this._encodedFrames = null;
  }

  /**
   * Signal that encoding has started.
   * @param {object} opts
   * @param {number} opts.duration   Media duration in seconds.
   * @param {number} opts.targetFps  Profile target frame rate.
   */
  start({ duration, targetFps }) {
    this._startTime     = Date.now();
    this._duration      = duration;
    this._targetFps     = targetFps;
    this._position      = 0;
    this._fps           = null;
    this._speed         = null;
    this._encodedFrames = 0;
  }

  /** Reset to idle state. */
  reset() {
    this._startTime     = null;
    this._duration      = null;
    this._position      = null;
    this._fps           = null;
    this._targetFps     = null;
    this._speed         = null;
    this._encodedFrames = null;
  }

  /**
   * Update timing from a metrics snapshot.
   * Called each time a complete FFmpeg progress block arrives.
   *
   * @param {object} metrics  Current EncoderMetrics snapshot.
   */
  update(metrics) {
    if (metrics.position      !== null) this._position      = metrics.position;
    if (metrics.fps           !== null) this._fps           = metrics.fps;
    if (metrics.speed         !== null) this._speed         = metrics.speed;
    if (metrics.encodedFrames !== null) this._encodedFrames = metrics.encodedFrames;
  }

  /* ── Computed telemetry ──────────────────────────────────────────── */

  /** Wall-clock elapsed time in seconds since encoding started. */
  get elapsedSec() {
    if (!this._startTime) return null;
    return (Date.now() - this._startTime) / 1000;
  }

  /** Current media position in seconds. */
  get position() { return this._position; }

  /** Total media duration in seconds. */
  get duration() { return this._duration; }

  /** Frames per second being encoded. */
  get fps() { return this._fps; }

  /** Target fps from profile. */
  get targetFps() { return this._targetFps; }

  /** Processing speed ratio. */
  get speed() { return this._speed; }

  /** Total frames encoded so far. */
  get encodedFrames() { return this._encodedFrames; }

  /**
   * Expected frame count at the current wall-clock elapsed time.
   * Useful for detecting if the encoder is behind schedule.
   * @returns {number|null}
   */
  get expectedFrames() {
    if (!this._startTime || !this._targetFps) return null;
    return Math.floor(this.elapsedSec * this._targetFps);
  }

  /**
   * The timing status for Stage 3 watchdog consumption.
   * @returns {'NORMAL'|'BEHIND'|'STALLED'|null}
   */
  get timingStatus() {
    return assessTimingStatus(this._speed);
  }

  /**
   * Full telemetry snapshot.
   * @returns {object}
   */
  snapshot() {
    return {
      startedAt:      this._startTime ? new Date(this._startTime).toISOString() : null,
      elapsedSec:     this.elapsedSec,
      position:       this._position,
      duration:       this._duration,
      fps:            this._fps,
      targetFps:      this._targetFps,
      speed:          this._speed,
      encodedFrames:  this._encodedFrames,
      expectedFrames: this.expectedFrames,
      timingStatus:   this.timingStatus,
    };
  }
}
