/**
 * 24-HOUR CLOUD ENGINE — Shadow Encoder (Full Implementation)
 * cloud-engine/encoder/shadow-encoder-impl.js
 *
 * Stage 2 — complete functional Shadow Encoder.
 *
 * Architecture:
 *   Media Input → Media Probe → Codec Adapter → Process Manager
 *                                              → Video Pipeline (FFmpeg vf)
 *                                              → Audio Pipeline (FFmpeg af)
 *                                              → Output Manager
 *                               ↕
 *                           Timing Engine
 *                           Encoder Metrics
 *
 * Public interface matches the Stage 1 contract (shadow-encoder.js).
 * All lifecycle methods return { success, status, message, data? }.
 *
 * Stage 2 — Shadow Encoder
 */

import path          from 'path';
import { randomUUID } from 'crypto';

import { CloudEngineLogger }                      from '../logs/logger.js';
import { CloudEngineEventBus }                    from '../core/event-bus.js';
import { CloudEngineStateManager, COMPONENT_STATUS } from '../core/state-manager.js';
import { CLOUD_ENGINE_EVENTS }                    from '../core/events.js';

import { EncoderError, ENCODER_ERROR_CODE }       from './encoder-errors.js';
import { getProfile, DEFAULT_PROFILE_ID }         from './encoder-profiles.js';
import { detectCodecEngine, buildEncodeArgs, verifyProfileCodecs } from './codec-adapter.js';
import { probeMedia }                             from './media-probe.js';
import { ProcessManager, PROCESS_STATE, PROCESS_EVENT } from './process-manager.js';
import { OutputManager }                          from './output-manager.js';
import { TimingEngine }                           from './timing-engine.js';
import {
  createMetrics,
  parseProgressLine,
  applyProgressField,
  assessTimingStatus,
} from './encoder-metrics.js';

const MODULE = 'encoder/shadow-encoder';

/* ═══════════════════════════════════
   ENCODER STATES
═══════════════════════════════════ */
export const ENCODER_STATE = Object.freeze({
  UNINITIALIZED:  'UNINITIALIZED',
  INITIALIZING:   'INITIALIZING',
  READY:          'READY',
  MEDIA_LOADED:   'MEDIA_LOADED',
  ENCODING:       'ENCODING',
  PAUSED:         'PAUSED',
  STOPPING:       'STOPPING',
  STOPPED:        'STOPPED',
  COMPLETED:      'COMPLETED',
  ERROR:          'ERROR',
});

/* ═══════════════════════════════════
   COMMAND RESULT BUILDERS
═══════════════════════════════════ */
function _ok(message, data)  { return { success: true,  status: 'OK',    message, data };  }
function _err(message, data) { return { success: false, status: 'ERROR', message, data };  }
function _notImpl(method)    {
  return {
    success: false,
    status:  'NOT_SUPPORTED',
    message: `ShadowEncoder.${method}() is not supported in the current architecture.`,
  };
}

/* ═══════════════════════════════════
   SHADOW ENCODER IMPLEMENTATION
═══════════════════════════════════ */

export class ShadowEncoderImpl {
  constructor() {
    this._state         = ENCODER_STATE.UNINITIALIZED;
    this._codecEngine   = null;   // { ffmpegPath, ffprobePath, ffmpegVersion }
    this._profile       = null;   // active EncoderProfile
    this._mediaInfo     = null;   // MediaInfo from last probe
    this._mediaPath     = null;   // absolute path to the loaded media
    this._outputPath    = null;   // absolute path to the current output file
    this._processManager= null;   // ProcessManager instance
    this._outputManager = null;   // OutputManager instance
    this._timingEngine  = new TimingEngine();
    this._metrics       = createMetrics();
    this._currentJobId  = null;

    // In-progress FFmpeg progress-block accumulator
    this._progressBlock = {};
  }

  /* ── State helpers ───────────────────────────────────────────────── */

  _setState(newState) {
    const prev = this._state;
    this._state = newState;
    CloudEngineLogger.debug(MODULE, 'STATE_CHANGE',
      `Encoder state: ${prev} → ${newState}`);

    // Sync to central state manager
    CloudEngineStateManager.set('encoder.state', newState);
    CloudEngineStateManager.set('encoder.status',
      newState === ENCODER_STATE.ERROR     ? COMPONENT_STATUS.ERROR     :
      newState === ENCODER_STATE.ENCODING  ? COMPONENT_STATUS.OK        :
      newState === ENCODER_STATE.READY ||
      newState === ENCODER_STATE.MEDIA_LOADED ||
      newState === ENCODER_STATE.STOPPED ||
      newState === ENCODER_STATE.COMPLETED  ? COMPONENT_STATUS.OK        :
      newState === ENCODER_STATE.UNINITIALIZED ? COMPONENT_STATUS.NOT_IMPLEMENTED :
      COMPONENT_STATUS.INITIALIZING
    );
  }

  _assertState(allowed, operation) {
    if (!allowed.includes(this._state)) {
      throw new EncoderError(
        ENCODER_ERROR_CODE.INVALID_STATE,
        `${operation}: invalid state "${this._state}". ` +
        `Allowed: [${allowed.join(', ')}]`,
      );
    }
  }

  _setError(err) {
    this._setState(ENCODER_STATE.ERROR);
    const errData = err instanceof EncoderError ? err.toJSON() : { message: err.message };
    this._metrics.lastError = errData;
    CloudEngineStateManager.set('encoder.lastError', errData);
    CloudEngineStateManager.pushError(MODULE, err.message, errData);
  }

  /* ── initialize() ────────────────────────────────────────────────── */

  /**
   * Detect the codec engine and prepare the encoder for use.
   * Must be called before any other operation.
   *
   * @param {object}  [opts]
   * @param {string}  [opts.profileId]    Profile to activate (default: youtube_1080p30).
   * @param {string}  [opts.outputRoot]   Override output directory.
   * @returns {Promise<CommandResult>}
   */
  async initialize({ profileId = DEFAULT_PROFILE_ID, outputRoot } = {}) {
    if (this._state !== ENCODER_STATE.UNINITIALIZED &&
        this._state !== ENCODER_STATE.ERROR &&
        this._state !== ENCODER_STATE.STOPPED) {
      return _err(`Cannot initialize in state "${this._state}"`);
    }

    this._setState(ENCODER_STATE.INITIALIZING);
    CloudEngineLogger.info(MODULE, 'ENCODER_INIT', 'Shadow Encoder initializing…');

    try {
      // ── 1. Load profile ──────────────────────────────────────
      this._profile = getProfile(profileId);
      CloudEngineLogger.info(MODULE, 'PROFILE_LOADED',
        `Encoder profile: "${this._profile.id}" — ${this._profile.description}`);

      // ── 2. Detect codec engine ───────────────────────────────
      const codecInfo = await detectCodecEngine();
      if (!codecInfo.found) {
        throw new EncoderError(
          ENCODER_ERROR_CODE.CODEC_ENGINE_NOT_FOUND,
          codecInfo.error ?? 'FFmpeg not found.',
        );
      }
      this._codecEngine = codecInfo;
      CloudEngineLogger.info(MODULE, 'CODEC_ENGINE_DETECTED',
        `FFmpeg ${codecInfo.ffmpegVersion} found at ${codecInfo.ffmpegPath}`);

      // ── 3. Verify required codecs ────────────────────────────
      const { ok, missing } = await verifyProfileCodecs(
        this._codecEngine.ffmpegPath,
        this._profile,
      );
      if (!ok) {
        throw new EncoderError(
          ENCODER_ERROR_CODE.CODEC_ENGINE_NOT_FOUND,
          `Required codecs not available: ${missing.join(', ')}`,
          { missing },
        );
      }

      // ── 4. Prepare output manager ────────────────────────────
      this._outputManager = new OutputManager({ outputRoot });
      await this._outputManager.init();

      // ── 5. Ready ─────────────────────────────────────────────
      this._setState(ENCODER_STATE.READY);
      this._metrics = createMetrics({
        state:     ENCODER_STATE.READY,
        targetFps: this._profile.video.frameRate,
      });

      CloudEngineLogger.info(MODULE, 'ENCODER_READY',
        'Shadow Encoder initialized successfully.', {
          profile:       this._profile.id,
          ffmpegVersion: this._codecEngine.ffmpegVersion,
          outputRoot:    this._outputManager.outputRoot,
        });

      return _ok('Shadow Encoder initialized.', {
        profile:       this._profile.id,
        ffmpegVersion: this._codecEngine.ffmpegVersion,
        outputRoot:    this._outputManager.outputRoot,
      });

    } catch (err) {
      this._setError(err instanceof EncoderError ? err :
        new EncoderError(ENCODER_ERROR_CODE.ENCODER_NOT_INITIALIZED, err.message));
      CloudEngineLogger.error(MODULE, 'ENCODER_INIT_FAILED',
        `Shadow Encoder initialization failed: ${err.message}`);
      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.ENCODER_ERROR, {
        code:    err.code ?? ENCODER_ERROR_CODE.ENCODER_NOT_INITIALIZED,
        message: err.message,
      });
      return _err(`Initialization failed: ${err.message}`);
    }
  }

  /* ── loadMedia() ─────────────────────────────────────────────────── */

  /**
   * Probe and load a local media file for encoding.
   *
   * @param {string} filePath  Absolute path to the media file.
   * @returns {Promise<CommandResult>}
   */
  async loadMedia(filePath) {
    try {
      this._assertState(
        [ENCODER_STATE.READY, ENCODER_STATE.MEDIA_LOADED, ENCODER_STATE.COMPLETED, ENCODER_STATE.STOPPED],
        'loadMedia',
      );
    } catch (err) {
      return _err(err.message);
    }

    // Validate path is a string (security baseline)
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return _err('filePath must be a non-empty string.');
    }

    const absPath = path.resolve(filePath);
    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.MEDIA_LOADING, { path: absPath });
    CloudEngineLogger.info(MODULE, 'MEDIA_LOADING',
      `Loading media: ${path.basename(absPath)}`);

    try {
      const mediaInfo = await probeMedia(absPath, this._codecEngine.ffprobePath);

      this._mediaPath = absPath;
      this._mediaInfo = mediaInfo;
      this._setState(ENCODER_STATE.MEDIA_LOADED);

      // Update central state
      CloudEngineStateManager.set('encoder.currentMedia', path.basename(absPath));
      CloudEngineStateManager.set('encoder.duration', mediaInfo.duration);

      this._metrics = createMetrics({
        state:        ENCODER_STATE.MEDIA_LOADED,
        currentMedia: path.basename(absPath),
        duration:     mediaInfo.duration,
        targetFps:    this._profile.video.frameRate,
      });

      CloudEngineLogger.info(MODULE, 'MEDIA_LOADED',
        `Media loaded: ${path.basename(absPath)}`, {
          duration:   mediaInfo.duration,
          resolution: mediaInfo.hasVideo ? `${mediaInfo.width}×${mediaInfo.height}` : null,
          videoCodec: mediaInfo.videoCodec,
          audioCodec: mediaInfo.audioCodec,
          fps:        mediaInfo.frameRate,
        });

      return _ok(`Media loaded: ${path.basename(absPath)}`, {
        mediaInfo: _safeMediaInfo(mediaInfo),
      });

    } catch (err) {
      const encErr = err instanceof EncoderError ? err :
        new EncoderError(ENCODER_ERROR_CODE.MEDIA_PROBE_FAILED, err.message);

      CloudEngineLogger.error(MODULE, 'MEDIA_ERROR',
        `Failed to load media: ${err.message}`, { path: path.basename(absPath) });
      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.MEDIA_ERROR, {
        path:    absPath,
        code:    encErr.code,
        message: encErr.message,
      });

      // Do NOT crash the encoder — return to READY state
      if (this._state !== ENCODER_STATE.UNINITIALIZED) {
        this._setState(ENCODER_STATE.READY);
      }

      return _err(encErr.message, { code: encErr.code });
    }
  }

  /* ── start() ─────────────────────────────────────────────────────── */

  /**
   * Begin encoding the loaded media.
   * @returns {Promise<CommandResult>}
   */
  async start() {
    try {
      this._assertState([ENCODER_STATE.MEDIA_LOADED], 'start');
    } catch (err) {
      return _err(err.message);
    }

    if (!this._mediaPath || !this._mediaInfo) {
      return _err('No media loaded. Call loadMedia() first.');
    }

    CloudEngineLogger.info(MODULE, 'ENCODER_STARTING',
      `Encoding started: ${path.basename(this._mediaPath)}`);

    try {
      // ── 1. Build output path ────────────────────────────────
      this._currentJobId = randomUUID().slice(0, 8);
      this._outputPath   = this._outputManager.buildOutputPath({
        jobId:         `job-${this._currentJobId}`,
        fileExtension: this._profile.fileExtension,
      });

      // ── 2. Build FFmpeg arguments ───────────────────────────
      const ffmpegArgs = buildEncodeArgs({
        inputPath:  this._mediaPath,
        outputPath: this._outputPath,
        profile:    this._profile,
        overwrite:  true,
      });

      // ── 3. Create process manager ───────────────────────────
      this._processManager = new ProcessManager({
        ffmpegPath: this._codecEngine.ffmpegPath,
        args:       ffmpegArgs,
        jobId:      this._currentJobId,
      });

      // ── 4. Wire process events ──────────────────────────────
      this._wireProcessEvents();

      // ── 5. Start timing engine ──────────────────────────────
      this._timingEngine.start({
        duration:  this._mediaInfo.duration ?? 0,
        targetFps: this._profile.video.frameRate,
      });

      // ── 6. Spawn FFmpeg ─────────────────────────────────────
      await this._processManager.start();

      // ── 7. Update state ─────────────────────────────────────
      this._setState(ENCODER_STATE.ENCODING);

      this._metrics = createMetrics({
        state:        ENCODER_STATE.ENCODING,
        currentMedia: path.basename(this._mediaPath),
        duration:     this._mediaInfo.duration,
        targetFps:    this._profile.video.frameRate,
        startedAt:    new Date().toISOString(),
      });

      CloudEngineStateManager.set('encoder.startedAt', this._metrics.startedAt);

      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.ENCODER_STARTED, {
        jobId:       this._currentJobId,
        media:       path.basename(this._mediaPath),
        outputPath:  this._outputPath,
        profile:     this._profile.id,
      });

      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.MEDIA_STARTED, {
        media: path.basename(this._mediaPath),
      });

      CloudEngineLogger.info(MODULE, 'ENCODING_STARTED',
        `Encoding started (job ${this._currentJobId})`, {
          input:   path.basename(this._mediaPath),
          output:  path.basename(this._outputPath),
          profile: this._profile.id,
          pid:     this._processManager.pid,
        });

      return _ok('Encoding started.', {
        jobId:      this._currentJobId,
        outputPath: this._outputPath,
        profile:    this._profile.id,
        pid:        this._processManager.pid,
      });

    } catch (err) {
      const encErr = err instanceof EncoderError ? err :
        new EncoderError(ENCODER_ERROR_CODE.ENCODER_START_FAILED, err.message);
      this._setError(encErr);
      CloudEngineLogger.error(MODULE, 'ENCODER_START_FAILED',
        `Encoding failed to start: ${err.message}`);
      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.ENCODER_ERROR, encErr.toJSON());
      return _err(encErr.message, { code: encErr.code });
    }
  }

  /* ── pause() / resume() ──────────────────────────────────────────── */

  /**
   * Pause is not reliably supported for FFmpeg file-to-file encoding.
   * Returns NOT_SUPPORTED rather than faking it.
   */
  async pause() {
    return _notImpl('pause');
  }

  /** @see pause */
  async resume() {
    return _notImpl('resume');
  }

  /* ── stop() ──────────────────────────────────────────────────────── */

  /**
   * Stop encoding cleanly.
   * @returns {Promise<CommandResult>}
   */
  async stop() {
    if (this._state !== ENCODER_STATE.ENCODING) {
      return _err(`Cannot stop in state "${this._state}"`);
    }

    CloudEngineLogger.info(MODULE, 'ENCODER_STOPPING', 'Stopping encoder…');
    this._setState(ENCODER_STATE.STOPPING);

    try {
      if (this._processManager) {
        await this._processManager.stop();
      }
    } catch (err) {
      CloudEngineLogger.warn(MODULE, 'ENCODER_STOP_WARN',
        `Non-fatal error during stop: ${err.message}`);
    }

    this._timingEngine.reset();
    this._setState(ENCODER_STATE.STOPPED);

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.ENCODER_STOPPED, {
      jobId: this._currentJobId,
      reason: 'REQUESTED',
    });

    CloudEngineLogger.info(MODULE, 'ENCODING_STOPPED', 'Encoder stopped.');
    return _ok('Encoder stopped.');
  }

  /* ── shutdown() ──────────────────────────────────────────────────── */

  /**
   * Full shutdown — stop encoding if running, release resources.
   * @returns {Promise<CommandResult>}
   */
  async shutdown() {
    CloudEngineLogger.info(MODULE, 'ENCODER_SHUTDOWN', 'Shadow Encoder shutting down…');

    if (this._state === ENCODER_STATE.ENCODING) {
      await this.stop();
    }

    if (this._processManager) {
      try { await this._processManager.stop(); } catch { /* best effort */ }
      this._processManager = null;
    }

    this._timingEngine.reset();
    this._setState(ENCODER_STATE.UNINITIALIZED);
    CloudEngineLogger.info(MODULE, 'ENCODER_SHUTDOWN_COMPLETE', 'Shadow Encoder shut down.');
    return _ok('Shadow Encoder shut down.');
  }

  /* ── getStatus() ─────────────────────────────────────────────────── */

  /**
   * Return current encoder status.
   * @returns {object}
   */
  getStatus() {
    return {
      state:         this._state,
      profile:       this._profile?.id ?? null,
      currentMedia:  this._mediaPath ? path.basename(this._mediaPath) : null,
      outputPath:    this._outputPath ?? null,
      jobId:         this._currentJobId ?? null,
      codecEngine:   this._codecEngine ? {
        ffmpegVersion: this._codecEngine.ffmpegVersion,
        ffmpegPath:    this._codecEngine.ffmpegPath,
      } : null,
    };
  }

  /* ── getMetrics() ────────────────────────────────────────────────── */

  /**
   * Return real-time encoder metrics.
   * @returns {EncoderMetrics}
   */
  getMetrics() {
    const timing = this._timingEngine.snapshot();

    return {
      ...this._metrics,
      state:          this._state,
      elapsedMs:      timing.elapsedSec != null ? Math.round(timing.elapsedSec * 1000) : null,
      processUptime:  this._processManager?.uptimeSec ?? null,
      timingStatus:   timing.timingStatus,
      speed:          timing.speed ?? this._metrics.speed,
      fps:            timing.fps   ?? this._metrics.fps,
      position:       timing.position ?? this._metrics.position,
    };
  }

  /* ── Process event wiring ────────────────────────────────────────── */

  _wireProcessEvents() {
    const pm = this._processManager;
    if (!pm) return;

    // Parse FFmpeg progress lines
    pm.on(PROCESS_EVENT.STDERR_LINE, (line) => {
      this._handleProgressLine(line);
    });

    // Normal completion
    pm.on(PROCESS_EVENT.COMPLETED, ({ exitCode }) => {
      this._onProcessCompleted();
    });

    // Crash
    pm.on(PROCESS_EVENT.CRASHED, ({ exitCode, signal, stderr }) => {
      this._onProcessCrashed(exitCode, signal);
    });

    // Requested stop (already handled by stop())
    pm.on(PROCESS_EVENT.STOPPED, () => {
      // State already set by stop()
    });
  }

  _handleProgressLine(line) {
    const kv = parseProgressLine(line);
    if (!kv) return;

    const done = applyProgressField(this._progressBlock, kv.key, kv.value);

    if (done) {
      // A complete progress block arrived — update metrics and timing
      const block = this._progressBlock;
      this._progressBlock = {};

      // Merge block into live metrics
      for (const [k, v] of Object.entries(block)) {
        if (v !== null && v !== undefined) {
          this._metrics[k] = v;
        }
      }
      this._metrics.state        = this._state;
      this._metrics.timingStatus = assessTimingStatus(this._metrics.speed);

      // Update timing engine
      this._timingEngine.update(this._metrics);

      // Sync key metrics to state manager
      CloudEngineStateManager.set('encoder.position',     this._metrics.position);
      CloudEngineStateManager.set('encoder.fps',          this._metrics.fps);
      CloudEngineStateManager.set('encoder.videoBitrate', this._metrics.videoBitrate);
    }
  }

  _onProcessCompleted() {
    if (this._state !== ENCODER_STATE.ENCODING) return;

    this._timingEngine.reset();
    this._setState(ENCODER_STATE.COMPLETED);
    this._metrics.progress = 1.0;

    CloudEngineLogger.info(MODULE, 'ENCODING_COMPLETED',
      `Encoding completed: ${path.basename(this._mediaPath ?? '')}`, {
        output: this._outputPath ? path.basename(this._outputPath) : null,
      });

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.MEDIA_ENDED, {
      media:      path.basename(this._mediaPath ?? ''),
      outputPath: this._outputPath,
      jobId:      this._currentJobId,
    });

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.ENCODER_STOPPED, {
      jobId:  this._currentJobId,
      reason: 'COMPLETED',
    });
  }

  _onProcessCrashed(exitCode, signal) {
    if (this._state === ENCODER_STATE.STOPPING ||
        this._state === ENCODER_STATE.STOPPED  ||
        this._state === ENCODER_STATE.COMPLETED) return;

    const err = new EncoderError(
      ENCODER_ERROR_CODE.ENCODER_PROCESS_CRASHED,
      `FFmpeg process crashed (exit code: ${exitCode}, signal: ${signal ?? 'none'})`,
      { exitCode, signal },
    );

    CloudEngineLogger.error(MODULE, 'ENCODER_PROCESS_CRASHED', err.message);
    this._setError(err);

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.ENCODER_ERROR, err.toJSON());

    // Engine remains operational — caller can loadMedia() and start() a new job
  }
}

/* ═══════════════════════════════════
   HELPERS
═══════════════════════════════════ */

/**
 * Strip the _raw ffprobe output before exposing MediaInfo externally.
 * @param {object} mediaInfo
 * @returns {object}
 */
function _safeMediaInfo(mediaInfo) {
  if (!mediaInfo) return null;
  const { _raw, ...safe } = mediaInfo;
  return safe;
}
