/**
 * 24-HOUR CLOUD ENGINE — Stream Source
 * cloud-engine/ingest/stream-source.js
 *
 * Represents a single resolved ingest stream source ready for use by the encoder
 * or fan-out engine. A StreamSource is the OUTPUT of the ingest layer — it
 * provides the path or reference that the encoder/transport will consume.
 *
 * The source is replaceable without redesigning the broadcast engine.
 *
 * Stage 5 — Live Input / Ingest
 */

import { SOURCE_TYPE, SOURCE_TYPE_STATUS } from './ingest-errors.js';

/* ═══════════════════════════════════
   STREAM SOURCE STATES
═══════════════════════════════════ */
export const STREAM_SOURCE_STATE = Object.freeze({
  IDLE:         'IDLE',
  PROBING:      'PROBING',
  READY:        'READY',
  ACTIVE:       'ACTIVE',
  STALLED:      'STALLED',
  DISCONNECTED: 'DISCONNECTED',
  ERROR:        'ERROR',
});

/* ═══════════════════════════════════
   STREAM SOURCE CLASS
═══════════════════════════════════ */

export class StreamSource {
  /**
   * @param {object} opts
   * @param {string}  opts.sessionId    Unique session identifier
   * @param {string}  opts.sourceType   SOURCE_TYPE.*
   * @param {string}  [opts.filePath]   For MEDIA_FILE sources
   * @param {string}  [opts.rtmpUrl]    For RTMP_INPUT / EXTERNAL_ENCODER sources
   * @param {object}  [opts.probeInfo]  Media probe result (from MediaProbe)
   */
  constructor({ sessionId, sourceType, filePath = null, rtmpUrl = null, probeInfo = null }) {
    this.sessionId    = sessionId;
    this.sourceType   = sourceType;
    this.filePath     = filePath;
    this.rtmpUrl      = rtmpUrl;
    this.probeInfo    = probeInfo;   // MediaProbe result
    this._state       = STREAM_SOURCE_STATE.IDLE;
    this._createdAt   = Date.now();
    this._activatedAt = null;
    this._lastActivityAt = null;
    this._error       = null;
  }

  get state()            { return this._state; }
  get isReady()          { return this._state === STREAM_SOURCE_STATE.READY; }
  get isActive()         { return this._state === STREAM_SOURCE_STATE.ACTIVE; }
  get operabilityStatus() { return SOURCE_TYPE_STATUS[this.sourceType] ?? 'UNKNOWN'; }

  /**
   * Get the input path that FFmpeg (or the transport) should consume.
   * - MEDIA_FILE: local file path
   * - RTMP_INPUT / EXTERNAL_ENCODER: rtmpUrl (future)
   * - Others: null (not implemented)
   *
   * @returns {string|null}
   */
  get inputPath() {
    switch (this.sourceType) {
      case SOURCE_TYPE.MEDIA_FILE:
        return this.filePath;
      case SOURCE_TYPE.RTMP_INPUT:
      case SOURCE_TYPE.EXTERNAL_ENCODER:
        return this.rtmpUrl ?? null;
      default:
        return null;
    }
  }

  /**
   * Get a safe summary (no sensitive data).
   * @returns {object}
   */
  getSummary() {
    return {
      sessionId:         this.sessionId,
      sourceType:        this.sourceType,
      operabilityStatus: this.operabilityStatus,
      state:             this._state,
      inputPath:         this._safeInputPath(),
      hasVideo:          this.probeInfo?.hasVideo  ?? null,
      hasAudio:          this.probeInfo?.hasAudio  ?? null,
      resolution:        this.probeInfo?.resolution ?? null,
      duration:          this.probeInfo?.duration   ?? null,
      fps:               this.probeInfo?.fps         ?? null,
      videoCodec:        this.probeInfo?.videoCodec  ?? null,
      audioCodec:        this.probeInfo?.audioCodec  ?? null,
      createdAt:         new Date(this._createdAt).toISOString(),
      activatedAt:       this._activatedAt ? new Date(this._activatedAt).toISOString() : null,
      lastActivityAt:    this._lastActivityAt ? new Date(this._lastActivityAt).toISOString() : null,
      error:             this._error ? { code: this._error.code, message: this._error.message } : null,
    };
  }

  /** Transition to READY state. */
  markReady() {
    this._state = STREAM_SOURCE_STATE.READY;
  }

  /** Transition to ACTIVE state. */
  markActive() {
    this._state = STREAM_SOURCE_STATE.ACTIVE;
    this._activatedAt = Date.now();
  }

  /** Transition to STALLED state. */
  markStalled() {
    this._state = STREAM_SOURCE_STATE.STALLED;
  }

  /** Transition to DISCONNECTED state. */
  markDisconnected() {
    this._state = STREAM_SOURCE_STATE.DISCONNECTED;
  }

  /** Transition to ERROR state. */
  markError(err) {
    this._state = STREAM_SOURCE_STATE.ERROR;
    this._error = err;
  }

  /** Update last activity timestamp. */
  touchActivity() {
    this._lastActivityAt = Date.now();
  }

  /** Safe path representation — only basename for logs. */
  _safeInputPath() {
    if (!this.inputPath) return null;
    // For file paths: only show the basename (no directory traversal in logs)
    if (this.sourceType === SOURCE_TYPE.MEDIA_FILE) {
      const { basename } = { basename: (p) => p.split('/').pop() };
      return basename(this.inputPath);
    }
    // For RTMP: mask any auth info
    return this.inputPath.replace(/:[^@\/]+@/, ':***@');
  }
}
