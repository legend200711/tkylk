/**
 * 24-HOUR CLOUD ENGINE — Shadow Encoder Public Interface
 * cloud-engine/encoder/shadow-encoder.js
 *
 * Stage 2: Replaces the Stage 1 placeholder with the real Shadow Encoder.
 *
 * This module exposes a single shared encoder instance (ShadowEncoder)
 * and re-exports encoder state types for consumers.
 *
 * Stage 1 compatibility:
 *   The ShadowEncoder object still has the same shape used by health.js,
 *   diagnostics.js, and engine.js. Stage 1 callers continue to work.
 *
 * Stage 2 modification:
 *   All methods now delegate to ShadowEncoderImpl instead of returning
 *   NOT_IMPLEMENTED stubs.
 *
 * Modified from Stage 1 by: Stage 2 Shadow Encoder implementation.
 */

import { ShadowEncoderImpl, ENCODER_STATE } from './shadow-encoder-impl.js';

/* ══════════════════════════════════════════════════════
   SHARED ENCODER INSTANCE
   One instance is shared across the Cloud Engine.
   Stage 3+ may introduce a multi-encoder pool; that
   change will be isolated to this file.
══════════════════════════════════════════════════════ */
const _encoderInstance = new ShadowEncoderImpl();

/**
 * Shadow Encoder — Stage 2 functional implementation.
 *
 * Lifecycle:
 *   1. initialize()    — detect FFmpeg, activate profile, prepare output dir
 *   2. loadMedia(path) — probe and validate a local media file
 *   3. start()         — begin encoding (spawns FFmpeg child process)
 *   4. getMetrics()    — poll real-time metrics
 *   5. stop()          — stop cleanly (SIGTERM → SIGKILL)
 *   6. shutdown()      — release all resources
 *
 * Pause/resume return NOT_SUPPORTED (FFmpeg file-to-file doesn't support this).
 */
export const ShadowEncoder = Object.freeze({

  /**
   * Initialize the encoder: detect FFmpeg, activate profile, prepare output dir.
   * @param {object}  [opts]
   * @param {string}  [opts.profileId]   Profile to use (default: 'youtube_1080p30').
   * @param {string}  [opts.outputRoot]  Override output directory.
   * @returns {Promise<CommandResult>}
   */
  async initialize(opts) {
    return _encoderInstance.initialize(opts);
  },

  /**
   * Probe and load a local media file.
   * @param {string} filePath  Absolute path to the media file.
   * @returns {Promise<CommandResult>}
   */
  async loadMedia(filePath) {
    return _encoderInstance.loadMedia(filePath);
  },

  /**
   * Start encoding the loaded media to local output.
   * @returns {Promise<CommandResult>}
   */
  async start() {
    return _encoderInstance.start();
  },

  /**
   * Pause — NOT_SUPPORTED for FFmpeg file-to-file encoding.
   * @returns {Promise<CommandResult>}
   */
  async pause() {
    return _encoderInstance.pause();
  },

  /**
   * Resume — NOT_SUPPORTED (see pause).
   * @returns {Promise<CommandResult>}
   */
  async resume() {
    return _encoderInstance.resume();
  },

  /**
   * Stop encoding cleanly.
   * @returns {Promise<CommandResult>}
   */
  async stop() {
    return _encoderInstance.stop();
  },

  /**
   * Returns the current encoder status snapshot.
   * @returns {object}
   */
  getStatus() {
    return _encoderInstance.getStatus();
  },

  /**
   * Returns real-time encoder metrics.
   * @returns {EncoderMetrics}
   */
  getMetrics() {
    return _encoderInstance.getMetrics();
  },

  /**
   * Shut down the encoder completely and release all resources.
   * @returns {Promise<CommandResult>}
   */
  async shutdown() {
    return _encoderInstance.shutdown();
  },
});

// Re-export state constants for consumers
export { ENCODER_STATE };

// Re-export the encoder error types
export { EncoderError, ENCODER_ERROR_CODE } from './encoder-errors.js';
export { getProfile, listProfiles, DEFAULT_PROFILE_ID, LIVE_PROFILE_ID } from './encoder-profiles.js';
