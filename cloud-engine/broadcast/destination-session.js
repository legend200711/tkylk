/**
 * 24-HOUR CLOUD ENGINE — Destination Session
 * cloud-engine/broadcast/destination-session.js
 *
 * Manages a single, independent broadcast session to one RTMP/RTMPS destination.
 * Each destination in the fan-out gets its own DestinationSession instance with:
 *   - Independent state machine
 *   - Independent RtmpTransport process
 *   - Independent ReconnectManager
 *   - Independent metrics
 *   - Independent error tracking
 *
 * One session failure MUST NOT affect any other session.
 *
 * Stage 4 — Multi-Platform Fan-Out
 */

import EventEmitter from 'events';
import { RtmpTransport, TRANSPORT_EVENT, TRANSPORT_STATE } from './rtmp-transport.js';
import { ReconnectManager, DEFAULT_RECONNECT_POLICY }      from './reconnect-manager.js';
import { BroadcastError, BROADCAST_ERROR_CODE }            from './broadcast-errors.js';
import { resolveStreamKey, buildPublishUrl,
         validateDestination, safeDestinationInfo }        from './destination-manager.js';
import { CloudEngineLogger }                               from '../logs/logger.js';

const MODULE = 'broadcast/destination-session';

/* ═══════════════════════════════════
   SESSION STATES
═══════════════════════════════════ */
export const SESSION_STATE = Object.freeze({
  IDLE:          'IDLE',
  CONNECTING:    'CONNECTING',
  CONNECTED:     'CONNECTED',
  BROADCASTING:  'BROADCASTING',
  RECONNECTING:  'RECONNECTING',
  STOPPING:      'STOPPING',
  STOPPED:       'STOPPED',
  ERROR:         'ERROR',
  EXHAUSTED:     'EXHAUSTED',   // reconnect attempts exhausted
});

/* ═══════════════════════════════════
   SESSION EVENTS
═══════════════════════════════════ */
export const SESSION_EVENT = Object.freeze({
  STATE_CHANGED:    'session:state_changed',
  CONNECTED:        'session:connected',
  BROADCASTING:     'session:broadcasting',
  DISCONNECTED:     'session:disconnected',
  RECONNECTING:     'session:reconnecting',
  RECONNECTED:      'session:reconnected',
  ERROR:            'session:error',
  STOPPED:          'session:stopped',
  EXHAUSTED:        'session:exhausted',
  BYTES_SENT:       'session:bytes_sent',
});

/* ═══════════════════════════════════
   DESTINATION SESSION CLASS
═══════════════════════════════════ */

export class DestinationSession extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object}  opts.destination      BroadcastDestination config object
   * @param {string}  opts.ffmpegPath       Path to ffmpeg binary
   * @param {string}  opts.inputPath        Path to FLV input (or 'pipe:0')
   * @param {object}  [opts.reconnectPolicy] Override reconnect policy
   */
  constructor({ destination, ffmpegPath, inputPath, reconnectPolicy = {} }) {
    super();

    validateDestination(destination);

    this._destination     = { ...destination };
    this._ffmpegPath      = ffmpegPath;
    this._inputPath       = inputPath;
    this._reconnectPolicy = { ...DEFAULT_RECONNECT_POLICY, ...reconnectPolicy };

    this._state           = SESSION_STATE.IDLE;
    this._transport       = null;
    this._reconnectMgr    = new ReconnectManager(this._reconnectPolicy);

    // Metrics
    this._startedAt       = null;
    this._connectedAt     = null;
    this._bytesSent       = 0;
    this._reconnectCount  = 0;
    this._lastError       = null;
    this._pid             = null;
  }

  /* ── Accessors ─────────────────────────────────────────── */

  get destinationId()   { return this._destination.destinationId; }
  get state()           { return this._state; }
  get bytesSent()       { return this._bytesSent; }
  get reconnectCount()  { return this._reconnectCount; }
  get lastError()       { return this._lastError; }

  get uptimeSec() {
    if (!this._connectedAt) return null;
    return Math.floor((Date.now() - this._connectedAt) / 1000);
  }

  /* ── Start ─────────────────────────────────────────────── */

  /**
   * Start broadcasting to this destination.
   * Resolves the stream key, builds the publish URL, and starts the transport.
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async start() {
    if (this._state !== SESSION_STATE.IDLE &&
        this._state !== SESSION_STATE.STOPPED &&
        this._state !== SESSION_STATE.ERROR) {
      return { success: false, message: `Cannot start session in state "${this._state}".` };
    }

    this._setState(SESSION_STATE.CONNECTING);
    this._startedAt = Date.now();

    try {
      const streamKey  = resolveStreamKey(this._destination);
      const publishUrl = buildPublishUrl(this._destination, streamKey);

      this._transport = new RtmpTransport({
        ffmpegPath:  this._ffmpegPath,
        inputPath:   this._inputPath,
        publishUrl,
        protocol:    this._destination.protocol,
        jobId:       this._destination.destinationId,
        reEncode:    false,
      });

      this._wireTransport();
      await this._transport.start();
      this._pid = this._transport.pid;
      this._setState(SESSION_STATE.CONNECTED);
      this._reconnectMgr.reset();

      CloudEngineLogger.info(MODULE, 'SESSION_STARTED',
        `Destination "${this._destination.destinationId}" transport started.`);

      return { success: true, message: 'Session started.' };
    } catch (err) {
      this._setError(err);
      this._setState(SESSION_STATE.ERROR);
      return { success: false, message: err.message };
    }
  }

  /* ── Stop ──────────────────────────────────────────────── */

  /**
   * Stop this destination session cleanly.
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async stop() {
    if (this._state === SESSION_STATE.STOPPED ||
        this._state === SESSION_STATE.IDLE) {
      return { success: true, message: 'Session already stopped.' };
    }

    this._reconnectMgr.cancel();
    this._setState(SESSION_STATE.STOPPING);

    if (this._transport) {
      try {
        await this._transport.stop();
      } catch { /* transport may already be gone */ }
    }

    this._setState(SESSION_STATE.STOPPED);
    this.emit(SESSION_EVENT.STOPPED, { destinationId: this.destinationId });
    return { success: true, message: 'Session stopped.' };
  }

  /* ── Restart ───────────────────────────────────────────── */

  /**
   * Restart this session (stop then start).
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async restart() {
    await this.stop();
    this._state = SESSION_STATE.IDLE;
    this._reconnectMgr.reset();
    return this.start();
  }

  /* ── Status / Metrics ──────────────────────────────────── */

  /**
   * Get a safe status snapshot (no stream key).
   * @returns {object}
   */
  getStatus() {
    return {
      destinationId:   this.destinationId,
      name:            this._destination.name,
      protocol:        this._destination.protocol,
      serverUrl:       this._destination.serverUrl,
      streamKeyEnvVar: this._destination.streamKeyEnvVar,
      streamKey:       '********',            // ALWAYS masked
      state:           this._state,
      startedAt:       this._startedAt ? new Date(this._startedAt).toISOString() : null,
      connectedAt:     this._connectedAt ? new Date(this._connectedAt).toISOString() : null,
      uptimeSec:       this.uptimeSec,
      bytesSent:       this._bytesSent,
      reconnectCount:  this._reconnectCount,
      pid:             this._pid,
      lastError:       this._lastError ? this._lastError.toJSON?.() ?? { message: this._lastError.message } : null,
      reconnect:       this._reconnectMgr.getStatus(),
    };
  }

  /* ── Private ───────────────────────────────────────────── */

  _setState(newState) {
    const prev = this._state;
    this._state = newState;
    if (prev !== newState) {
      this.emit(SESSION_EVENT.STATE_CHANGED, {
        destinationId: this.destinationId,
        from: prev,
        to:   newState,
      });
    }
  }

  _setError(err) {
    this._lastError = err;
    CloudEngineLogger.warn(MODULE, 'SESSION_ERROR',
      `Destination "${this.destinationId}" error: ${err.message}`);
  }

  _wireTransport() {
    const t = this._transport;

    t.on(TRANSPORT_EVENT.CONNECTED, () => {
      this._connectedAt = Date.now();
      this._setState(SESSION_STATE.BROADCASTING);
      this.emit(SESSION_EVENT.CONNECTED,    { destinationId: this.destinationId });
      this.emit(SESSION_EVENT.BROADCASTING, { destinationId: this.destinationId });
    });

    t.on(TRANSPORT_EVENT.BYTES_SENT, ({ bytesSent }) => {
      this._bytesSent = bytesSent;
      this.emit(SESSION_EVENT.BYTES_SENT, { destinationId: this.destinationId, bytesSent });
    });

    t.on(TRANSPORT_EVENT.COMPLETED, () => {
      this._setState(SESSION_STATE.STOPPED);
      this.emit(SESSION_EVENT.STOPPED, { destinationId: this.destinationId });
    });

    t.on(TRANSPORT_EVENT.STOPPED, () => {
      if (this._state === SESSION_STATE.STOPPING) {
        this._setState(SESSION_STATE.STOPPED);
      }
    });

    t.on(TRANSPORT_EVENT.CRASHED, ({ exitCode, signal, stderr }) => {
      const err = new BroadcastError(
        BROADCAST_ERROR_CODE.BROADCAST_PROCESS_CRASHED,
        `Transport crashed: exit ${exitCode} signal ${signal}. ${stderr ?? ''}`,
      );
      this._setError(err);
      this.emit(SESSION_EVENT.ERROR, { destinationId: this.destinationId, error: err });

      if (this._destination.autoReconnect && this._state !== SESSION_STATE.STOPPING) {
        this._initiateReconnect();
      } else {
        this._setState(SESSION_STATE.ERROR);
      }
    });

    t.on(TRANSPORT_EVENT.ERROR, (err) => {
      this._setError(err);
      this.emit(SESSION_EVENT.ERROR, { destinationId: this.destinationId, error: err });
      if (this._destination.autoReconnect && this._state !== SESSION_STATE.STOPPING) {
        this._initiateReconnect();
      } else {
        this._setState(SESSION_STATE.ERROR);
      }
    });
  }

  _initiateReconnect() {
    this._setState(SESSION_STATE.RECONNECTING);
    this._reconnectCount++;
    this.emit(SESSION_EVENT.RECONNECTING, {
      destinationId: this.destinationId,
      attempt: this._reconnectMgr.attempts + 1,
    });

    this._reconnectMgr.scheduleNext(
      async () => {
        CloudEngineLogger.info(MODULE, 'SESSION_RECONNECT_ATTEMPT',
          `Reconnecting destination "${this.destinationId}" (attempt ${this._reconnectMgr.attempts}).`);
        this._state = SESSION_STATE.IDLE;
        const result = await this.start();
        if (result.success) {
          this.emit(SESSION_EVENT.RECONNECTED, { destinationId: this.destinationId });
        }
      },
      () => {
        this._setState(SESSION_STATE.EXHAUSTED);
        this.emit(SESSION_EVENT.EXHAUSTED, { destinationId: this.destinationId });
        CloudEngineLogger.warn(MODULE, 'SESSION_EXHAUSTED',
          `Destination "${this.destinationId}" reconnect attempts exhausted.`);
      },
    );
  }
}
