/**
 * 24-HOUR CLOUD ENGINE — Ingest Session
 * cloud-engine/ingest/ingest-session.js
 *
 * Manages the lifecycle of a single ingest session.
 * An ingest session represents one active source being ingested
 * and prepared for the encoder / fan-out pipeline.
 *
 * Session lifecycle:
 *   IDLE → PROBING → READY → ACTIVE → STOPPED
 *                         ↘ ERROR
 *
 * Stage 5 — Live Input / Ingest
 */

import EventEmitter from 'events';
import path from 'path';
import { SOURCE_TYPE, SOURCE_TYPE_STATUS,
         IngestError, INGEST_ERROR_CODE }              from './ingest-errors.js';
import { validateSourceConfig, validateMediaFile }      from './ingest-validator.js';
import { StreamSource, STREAM_SOURCE_STATE }            from './stream-source.js';
import { createIngestMetrics, snapshotIngestMetrics,
         computeIngestHealth }                          from './ingest-metrics.js';
import { CloudEngineLogger }                            from '../logs/logger.js';

const MODULE = 'ingest/ingest-session';

/* ═══════════════════════════════════
   INGEST SESSION STATES
═══════════════════════════════════ */
export const INGEST_SESSION_STATE = Object.freeze({
  IDLE:         'IDLE',
  PROBING:      'PROBING',
  READY:        'READY',
  ACTIVE:       'ACTIVE',
  STOPPING:     'STOPPING',
  STOPPED:      'STOPPED',
  ERROR:        'ERROR',
});

/* ═══════════════════════════════════
   INGEST SESSION EVENTS
═══════════════════════════════════ */
export const INGEST_SESSION_EVENT = Object.freeze({
  READY:        'ingest_session:ready',
  ACTIVE:       'ingest_session:active',
  STOPPED:      'ingest_session:stopped',
  ERROR:        'ingest_session:error',
  DISCONNECTED: 'ingest_session:disconnected',
  STALLED:      'ingest_session:stalled',
});

/* ═══════════════════════════════════
   INGEST SESSION CLASS
═══════════════════════════════════ */

export class IngestSession extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}  opts.sessionId   Unique session identifier
   * @param {object}  opts.config      IngestSourceConfig
   */
  constructor({ sessionId, config }) {
    super();
    this._sessionId  = sessionId;
    this._config     = config;
    this._state      = INGEST_SESSION_STATE.IDLE;
    this._source     = null;
    this._metrics    = createIngestMetrics({ sessionId, sourceType: config.sourceType });
    this._startedAt  = null;
    this._stoppedAt  = null;
    this._lastError  = null;
  }

  get sessionId()  { return this._sessionId; }
  get state()      { return this._state; }
  get sourceType() { return this._config.sourceType; }

  /** The resolved StreamSource (available after prepare() completes). */
  get source() { return this._source; }

  /* ── Lifecycle ─────────────────────────────────────────── */

  /**
   * Validate the source config, probe the source, and transition to READY.
   * Does NOT start the active ingest — call activate() for that.
   *
   * @returns {Promise<{ success: boolean, message: string, source?: object }>}
   */
  async prepare() {
    if (this._state !== INGEST_SESSION_STATE.IDLE) {
      return { success: false, message: `Cannot prepare session in state "${this._state}".` };
    }

    this._setState(INGEST_SESSION_STATE.PROBING);

    try {
      // Validate config (throws IngestError if invalid)
      validateSourceConfig(this._config);

      // Additional file validation for MEDIA_FILE sources
      if (this._config.sourceType === SOURCE_TYPE.MEDIA_FILE) {
        await validateMediaFile(this._config.filePath);
      }

      // Create the stream source
      this._source = new StreamSource({
        sessionId:  this._sessionId,
        sourceType: this._config.sourceType,
        filePath:   this._config.filePath ?? null,
        rtmpUrl:    this._config.rtmpUrl  ?? null,
      });

      // For MEDIA_FILE: probe media using the encoder's media probe
      if (this._config.sourceType === SOURCE_TYPE.MEDIA_FILE) {
        await this._probeMediaFile();
      }

      this._source.markReady();
      this._metrics.sourceType  = this._config.sourceType;
      this._metrics.videoPresent = this._source.probeInfo?.hasVideo ?? null;
      this._metrics.audioPresent = this._source.probeInfo?.hasAudio ?? null;
      this._metrics.resolution   = this._source.probeInfo?.resolution ?? null;
      this._metrics.inputFps     = this._source.probeInfo?.fps ?? null;
      this._metrics.videoCodec   = this._source.probeInfo?.videoCodec ?? null;
      this._metrics.audioCodec   = this._source.probeInfo?.audioCodec ?? null;
      this._metrics.audioSampleRate = this._source.probeInfo?.audioSampleRate ?? null;

      this._setState(INGEST_SESSION_STATE.READY);
      this.emit(INGEST_SESSION_EVENT.READY, { sessionId: this._sessionId });

      CloudEngineLogger.info(MODULE, 'INGEST_PREPARED',
        `Ingest session "${this._sessionId}" ready (${this._config.sourceType}).`);

      return { success: true, message: 'Source prepared and ready.', source: this._source.getSummary() };

    } catch (err) {
      const ingestErr = err instanceof IngestError ? err : new IngestError(
        INGEST_ERROR_CODE.SOURCE_INVALID, err.message,
      );
      this._lastError = ingestErr;
      this._metrics.lastError = ingestErr.toJSON();
      this._setState(INGEST_SESSION_STATE.ERROR);
      this.emit(INGEST_SESSION_EVENT.ERROR, { sessionId: this._sessionId, error: ingestErr });

      CloudEngineLogger.warn(MODULE, 'INGEST_PREPARE_FAILED',
        `Ingest session "${this._sessionId}" prepare failed: ${ingestErr.message}`);

      return { success: false, message: ingestErr.message };
    }
  }

  /**
   * Activate the session — mark the source as actively being consumed.
   * Called when the encoder/fan-out has successfully started using this source.
   *
   * @returns {{ success: boolean, message: string }}
   */
  activate() {
    if (this._state !== INGEST_SESSION_STATE.READY) {
      return { success: false, message: `Cannot activate session in state "${this._state}".` };
    }

    this._startedAt              = Date.now();
    this._metrics.connected      = true;
    this._metrics.startedAt      = new Date(this._startedAt).toISOString();
    this._metrics.lastActivityAt = new Date(this._startedAt).toISOString();
    this._metrics.health         = 'OK';

    if (this._source) this._source.markActive();
    this._setState(INGEST_SESSION_STATE.ACTIVE);
    this.emit(INGEST_SESSION_EVENT.ACTIVE, { sessionId: this._sessionId });

    CloudEngineLogger.info(MODULE, 'INGEST_ACTIVE',
      `Ingest session "${this._sessionId}" activated.`);

    return { success: true, message: 'Ingest session activated.' };
  }

  /**
   * Stop this ingest session.
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async stop() {
    if (this._state === INGEST_SESSION_STATE.STOPPED) {
      return { success: true, message: 'Session already stopped.' };
    }

    this._setState(INGEST_SESSION_STATE.STOPPING);
    this._stoppedAt         = Date.now();
    this._metrics.connected = false;
    this._metrics.health    = null;

    if (this._source) this._source.markDisconnected();
    this._setState(INGEST_SESSION_STATE.STOPPED);
    this.emit(INGEST_SESSION_EVENT.STOPPED, { sessionId: this._sessionId });

    CloudEngineLogger.info(MODULE, 'INGEST_STOPPED',
      `Ingest session "${this._sessionId}" stopped.`);

    return { success: true, message: 'Ingest session stopped.' };
  }

  /* ── Status & Metrics ──────────────────────────────────── */

  /**
   * Get current session status (safe — no secrets).
   * @returns {object}
   */
  getStatus() {
    return {
      sessionId:         this._sessionId,
      sourceType:        this._config.sourceType,
      operabilityStatus: SOURCE_TYPE_STATUS[this._config.sourceType] ?? 'UNKNOWN',
      state:             this._state,
      source:            this._source?.getSummary() ?? null,
      lastError:         this._lastError?.toJSON() ?? null,
    };
  }

  /**
   * Get real-time ingest metrics snapshot.
   * @returns {object}
   */
  getMetrics() {
    const snap = snapshotIngestMetrics(this._metrics);
    snap.health = computeIngestHealth(snap);
    return snap;
  }

  /* ── Private ───────────────────────────────────────────── */

  _setState(newState) {
    this._state = newState;
  }

  /**
   * Probe a media file and populate probeInfo on the source.
   * Uses MediaProbe if available, falls back to basic stat info.
   */
  async _probeMediaFile() {
    try {
      // Dynamically import MediaProbe from the encoder module
      const { MediaProbe } = await import('../encoder/media-probe.js');
      const probe = await MediaProbe.probe(this._config.filePath);
      if (probe.success) {
        this._source.probeInfo = probe.info;
      }
    } catch {
      // MediaProbe may not be available in all environments
      // Populate what we can from the file path
      this._source.probeInfo = {
        hasVideo:      null,
        hasAudio:      null,
        resolution:    null,
        fps:           null,
        duration:      null,
        videoCodec:    null,
        audioCodec:    null,
        audioSampleRate: null,
      };
    }
  }
}
