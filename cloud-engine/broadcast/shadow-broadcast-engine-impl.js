/**
 * 24-HOUR CLOUD ENGINE — Shadow Broadcast Engine (Implementation)
 * cloud-engine/broadcast/shadow-broadcast-engine-impl.js
 *
 * Stage 3 — complete functional Shadow Broadcast Engine.
 *
 * Architecture:
 *   Shadow Encoder (encodes to H.264/AAC)
 *           ↓
 *   Shadow Broadcast Engine (transmits via RTMP/RTMPS)
 *           ↓
 *   RTMP Transport (FFmpeg, spawned as a child process)
 *           ↓
 *   RTMP/RTMPS Destination (YouTube, custom, etc.)
 *
 * Clean separation from the encoder:
 *   - Shadow Encoder is responsible for ENCODING only.
 *   - Shadow Broadcast Engine is responsible for TRANSPORT only.
 *   - They are independently controllable and testable.
 *
 * For live broadcast mode, the encoder writes to a named pipe (fifo)
 * or the broadcast engine reads the encoder's output file in realtime.
 * For test mode, the broadcast engine reads a completed local FLV file.
 *
 * Stage 3 — Shadow Broadcast Engine
 */

import path          from 'path';
import { randomUUID } from 'crypto';

import { CloudEngineLogger }                         from '../logs/logger.js';
import { CloudEngineEventBus }                       from '../core/event-bus.js';
import { CloudEngineStateManager, COMPONENT_STATUS } from '../core/state-manager.js';
import { CLOUD_ENGINE_EVENTS }                       from '../core/events.js';

import { BroadcastError, BROADCAST_ERROR_CODE }      from './broadcast-errors.js';
import {
  DestinationManager,
  resolveStreamKey,
  buildPublishUrl,
  safeDestinationInfo,
} from './destination-manager.js';
import {
  RtmpTransport,
  TRANSPORT_STATE,
  TRANSPORT_EVENT,
  redactRtmpUrl,
} from './rtmp-transport.js';
import {
  createBroadcastMetrics,
  snapshotMetrics,
} from './broadcast-metrics.js';
import { ReconnectManager } from './reconnect-manager.js';
import { detectCodecEngine } from '../encoder/codec-adapter.js';

const MODULE = 'broadcast/shadow-broadcast-engine';

/* ═══════════════════════════════════
   BROADCAST STATES
═══════════════════════════════════ */
export const BROADCAST_STATE = Object.freeze({
  UNINITIALIZED:  'UNINITIALIZED',
  INITIALIZING:   'INITIALIZING',
  READY:          'READY',
  CONNECTING:     'CONNECTING',
  CONNECTED:      'CONNECTED',
  BROADCASTING:   'BROADCASTING',
  RECONNECTING:   'RECONNECTING',
  STOPPING:       'STOPPING',
  STOPPED:        'STOPPED',
  ERROR:          'ERROR',
});

/* ═══════════════════════════════════
   COMMAND RESULT BUILDERS
═══════════════════════════════════ */
function _ok(message, data)   { return { success: true,  status: 'OK',    message, data };  }
function _err(message, data)  { return { success: false, status: 'ERROR', message, data };  }

/* ═══════════════════════════════════
   SHADOW BROADCAST ENGINE IMPLEMENTATION
═══════════════════════════════════ */

export class ShadowBroadcastEngineImpl {
  constructor() {
    this._state             = BROADCAST_STATE.UNINITIALIZED;
    this._codecEngine       = null;    // { ffmpegPath, … }
    this._destManager       = new DestinationManager();
    this._transport         = null;    // RtmpTransport instance
    this._reconnectManager  = null;    // ReconnectManager instance
    this._metrics           = createBroadcastMetrics({ state: BROADCAST_STATE.UNINITIALIZED });
    this._currentJobId      = null;
    this._inputPath         = null;    // Path being broadcast
    this._intentionalStop   = false;   // Distinguish intentional stop from crash
  }

  /* ── State helpers ───────────────────────────────────────────────── */

  _setState(newState) {
    const prev = this._state;
    this._state = newState;
    CloudEngineLogger.debug(MODULE, 'STATE_CHANGE',
      `Broadcast state: ${prev} → ${newState}`);

    this._metrics.state = newState;
    this._metrics.connectionStatus = _mapStateToConnectionStatus(newState);

    // Sync to central state manager
    CloudEngineStateManager.set('broadcast.status',
      newState === BROADCAST_STATE.ERROR        ? COMPONENT_STATUS.ERROR        :
      newState === BROADCAST_STATE.BROADCASTING ? COMPONENT_STATUS.OK           :
      newState === BROADCAST_STATE.CONNECTED    ? COMPONENT_STATUS.OK           :
      newState === BROADCAST_STATE.UNINITIALIZED ? COMPONENT_STATUS.NOT_IMPLEMENTED :
      COMPONENT_STATUS.INITIALIZING
    );
    CloudEngineStateManager.set('broadcast.connected',
      newState === BROADCAST_STATE.BROADCASTING ||
      newState === BROADCAST_STATE.CONNECTED);
  }

  _assertState(allowed, operation) {
    if (!allowed.includes(this._state)) {
      throw new BroadcastError(
        BROADCAST_ERROR_CODE.INVALID_STATE,
        `${operation}: invalid state "${this._state}". ` +
        `Allowed: [${allowed.join(', ')}]`,
      );
    }
  }

  _setError(err) {
    this._setState(BROADCAST_STATE.ERROR);
    const errData = err instanceof BroadcastError ? err.toJSON() : { message: err.message };
    this._metrics.lastError = errData;
    CloudEngineStateManager.set('broadcast.lastError', errData);
    CloudEngineStateManager.pushError(MODULE, err.message, errData);
  }

  /* ── initialize() ────────────────────────────────────────────────── */

  /**
   * Initialize the Broadcast Engine.
   * Detects FFmpeg codec engine. Does NOT require a destination to be configured yet.
   *
   * @param {object} [opts]
   * @param {object} [opts.reconnectPolicy]  Override default reconnect policy.
   * @returns {Promise<CommandResult>}
   */
  async initialize({ reconnectPolicy } = {}) {
    if (this._state !== BROADCAST_STATE.UNINITIALIZED &&
        this._state !== BROADCAST_STATE.ERROR         &&
        this._state !== BROADCAST_STATE.STOPPED) {
      return _err(`Cannot initialize in state "${this._state}"`);
    }

    this._setState(BROADCAST_STATE.INITIALIZING);
    CloudEngineLogger.info(MODULE, 'BROADCAST_INIT', 'Shadow Broadcast Engine initializing…');

    try {
      // ── 1. Detect FFmpeg codec engine ────────────────────────
      const codecInfo = await detectCodecEngine();
      if (!codecInfo.found) {
        throw new BroadcastError(
          BROADCAST_ERROR_CODE.BROADCAST_NOT_INITIALIZED,
          codecInfo.error ?? 'FFmpeg not found. Install FFmpeg to use Broadcast Engine.',
        );
      }
      this._codecEngine = codecInfo;
      CloudEngineLogger.info(MODULE, 'CODEC_ENGINE_DETECTED',
        `FFmpeg ${codecInfo.ffmpegVersion} found at ${codecInfo.ffmpegPath}`);

      // ── 2. Set up reconnect manager ──────────────────────────
      this._reconnectManager = new ReconnectManager(reconnectPolicy ?? {});

      // ── 3. Ready ─────────────────────────────────────────────
      this._setState(BROADCAST_STATE.READY);
      this._metrics = createBroadcastMetrics({ state: BROADCAST_STATE.READY });

      CloudEngineLogger.info(MODULE, 'BROADCAST_READY',
        'Shadow Broadcast Engine initialized.', {
          ffmpegVersion: codecInfo.ffmpegVersion,
        });

      return _ok('Shadow Broadcast Engine initialized.', {
        ffmpegVersion: codecInfo.ffmpegVersion,
      });

    } catch (err) {
      const bcErr = err instanceof BroadcastError ? err :
        new BroadcastError(BROADCAST_ERROR_CODE.BROADCAST_NOT_INITIALIZED, err.message);
      this._setError(bcErr);
      CloudEngineLogger.error(MODULE, 'BROADCAST_INIT_FAILED',
        `Broadcast Engine init failed: ${err.message}`);
      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_ERROR, {
        code:    bcErr.code,
        message: bcErr.message,
      });
      return _err(`Initialization failed: ${err.message}`);
    }
  }

  /* ── registerDestination() ────────────────────────────────────────── */

  /**
   * Register a broadcast destination.
   * The stream key is NOT passed here — it is read from the environment at
   * connect() time via the streamKeyEnvVar.
   *
   * @param {BroadcastDestination} dest
   * @returns {{ success: boolean, message: string }}
   */
  registerDestination(dest) {
    try {
      this._destManager.register(dest);
      return _ok(`Destination "${dest.destinationId}" registered.`,
        { destination: safeDestinationInfo(dest) });
    } catch (err) {
      CloudEngineLogger.error(MODULE, 'DESTINATION_REGISTER_FAILED',
        `Failed to register destination: ${err.message}`);
      return _err(err.message, { code: err.code ?? null });
    }
  }

  /* ── connect() ───────────────────────────────────────────────────── */

  /**
   * Validate destination configuration and prepare for broadcasting.
   * Does NOT start the FFmpeg process or begin sending data.
   *
   * @param {object} opts
   * @param {string} opts.destinationId  ID of the registered destination to use.
   * @returns {Promise<CommandResult>}
   */
  async connect({ destinationId } = {}) {
    try {
      this._assertState([BROADCAST_STATE.READY, BROADCAST_STATE.STOPPED], 'connect');
    } catch (err) {
      return _err(err.message, { code: err.code ?? null });
    }

    CloudEngineLogger.info(MODULE, 'BROADCAST_CONNECTING',
      `Connecting to destination: "${destinationId}"…`);
    this._setState(BROADCAST_STATE.CONNECTING);

    try {
      // ── 1. Get destination config ────────────────────────────
      const dest = this._destManager.get(destinationId);  // throws if not found

      // ── 2. Set as active ─────────────────────────────────────
      this._destManager.setActive(destinationId);

      // ── 3. Validate stream key exists ────────────────────────
      // resolveStreamKey() throws STREAM_KEY_MISSING if env var not set.
      // We validate here WITHOUT storing the key — it is discarded immediately.
      resolveStreamKey(dest);

      // ── 4. Update state ──────────────────────────────────────
      this._setState(BROADCAST_STATE.CONNECTED);

      this._metrics.destinationId   = dest.destinationId;
      this._metrics.destinationName = dest.name;
      this._metrics.serverUrl       = dest.serverUrl;
      this._metrics.protocol        = dest.protocol;

      CloudEngineStateManager.set('broadcast.destination', safeDestinationInfo(dest));

      CloudEngineLogger.info(MODULE, 'BROADCAST_CONNECTED',
        `Connected to destination: "${dest.name}" (${dest.protocol})`,
        safeDestinationInfo(dest));

      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_CONNECTED, {
        destinationId: dest.destinationId,
        name:          dest.name,
        protocol:      dest.protocol,
        serverUrl:     dest.serverUrl,
      });

      return _ok(`Connected to destination "${dest.name}".`, {
        destination: safeDestinationInfo(dest),
      });

    } catch (err) {
      const bcErr = err instanceof BroadcastError ? err :
        new BroadcastError(BROADCAST_ERROR_CODE.CONNECTION_FAILED, err.message);

      CloudEngineLogger.error(MODULE, 'BROADCAST_CONNECT_FAILED',
        `Connect failed: ${err.message}`, { code: bcErr.code });

      this._setState(BROADCAST_STATE.READY);
      this._metrics.lastError = bcErr.toJSON();

      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_ERROR, {
        code:    bcErr.code,
        message: bcErr.message,
      });

      return _err(bcErr.message, { code: bcErr.code });
    }
  }

  /* ── disconnect() ────────────────────────────────────────────────── */

  /**
   * Disconnect from the current destination without stopping the engine.
   * @returns {Promise<CommandResult>}
   */
  async disconnect() {
    if (this._state === BROADCAST_STATE.BROADCASTING) {
      await this.stopBroadcast();
    }

    if (this._state !== BROADCAST_STATE.CONNECTED  &&
        this._state !== BROADCAST_STATE.STOPPED     &&
        this._state !== BROADCAST_STATE.RECONNECTING) {
      // Not connected — treat as no-op
      return _ok('Already disconnected.');
    }

    this._reconnectManager?.cancel();
    this._setState(BROADCAST_STATE.READY);

    CloudEngineStateManager.set('broadcast.destination', null);
    CloudEngineStateManager.set('broadcast.connected', false);

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_DISCONNECTED, {
      reason: 'REQUESTED',
    });

    CloudEngineLogger.info(MODULE, 'BROADCAST_DISCONNECTED',
      'Broadcast Engine disconnected.');
    return _ok('Disconnected.');
  }

  /* ── startBroadcast() ────────────────────────────────────────────── */

  /**
   * Start broadcasting an encoded FLV file to the configured RTMP destination.
   * Must call connect() first.
   *
   * @param {object} opts
   * @param {string} opts.inputPath  Absolute path to the FLV file to broadcast.
   * @returns {Promise<CommandResult>}
   */
  async startBroadcast({ inputPath } = {}) {
    try {
      this._assertState([BROADCAST_STATE.CONNECTED], 'startBroadcast');
    } catch (err) {
      return _err(err.message, { code: err.code ?? null });
    }

    if (!inputPath || typeof inputPath !== 'string') {
      return _err('inputPath is required to start broadcasting.', {
        code: BROADCAST_ERROR_CODE.BROADCAST_START_FAILED,
      });
    }

    const dest = this._destManager.getActive();
    if (!dest) {
      return _err('No active destination.', {
        code: BROADCAST_ERROR_CODE.DESTINATION_NOT_CONFIGURED,
      });
    }

    CloudEngineLogger.info(MODULE, 'BROADCAST_STARTING',
      `Starting broadcast to "${dest.name}" (${dest.protocol})`, {
        input: path.basename(inputPath),
        destination: safeDestinationInfo(dest),
      });

    try {
      // ── 1. Resolve stream key (SECRET) ───────────────────────
      // The stream key is resolved just-in-time, never stored longer than needed.
      const streamKey  = resolveStreamKey(dest);
      const publishUrl = buildPublishUrl(dest, streamKey);
      // streamKey and publishUrl are local secrets — they must not be logged

      this._inputPath    = inputPath;
      this._currentJobId = randomUUID().slice(0, 8);

      // ── 2. Create transport ──────────────────────────────────
      this._transport = new RtmpTransport({
        ffmpegPath: this._codecEngine.ffmpegPath,
        inputPath,
        publishUrl,   // SECRET — passed to transport, never logged
        protocol:     dest.protocol,
        jobId:        this._currentJobId,
      });

      // ── 3. Wire transport events ─────────────────────────────
      this._wireTransportEvents();

      // ── 4. Spawn FFmpeg broadcast process ───────────────────
      this._intentionalStop = false;
      await this._transport.start();

      // ── 5. Update state ─────────────────────────────────────
      this._setState(BROADCAST_STATE.BROADCASTING);

      const now = new Date().toISOString();
      this._metrics.broadcastStartedAt = now;
      this._metrics.pid                = this._transport.pid;
      this._reconnectManager?.reset();

      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_STARTED, {
        jobId:       this._currentJobId,
        destination: safeDestinationInfo(dest),
        input:       path.basename(inputPath),
      });

      CloudEngineLogger.info(MODULE, 'BROADCASTING',
        `Broadcasting started (job ${this._currentJobId})`, {
          input:       path.basename(inputPath),
          destination: safeDestinationInfo(dest),
          pid:         this._transport.pid,
        });

      return _ok('Broadcast started.', {
        jobId:       this._currentJobId,
        pid:         this._transport.pid,
        destination: safeDestinationInfo(dest),
      });

    } catch (err) {
      const bcErr = err instanceof BroadcastError ? err :
        new BroadcastError(BROADCAST_ERROR_CODE.BROADCAST_START_FAILED, err.message);

      this._setError(bcErr);
      CloudEngineLogger.error(MODULE, 'BROADCAST_START_FAILED',
        `Broadcast start failed: ${err.message}`);
      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_ERROR, bcErr.toJSON());
      return _err(bcErr.message, { code: bcErr.code });
    }
  }

  /* ── stopBroadcast() ─────────────────────────────────────────────── */

  /**
   * Stop the broadcast cleanly.
   * @returns {Promise<CommandResult>}
   */
  async stopBroadcast() {
    if (this._state !== BROADCAST_STATE.BROADCASTING &&
        this._state !== BROADCAST_STATE.RECONNECTING) {
      return _err(`Cannot stop broadcast in state "${this._state}"`);
    }

    CloudEngineLogger.info(MODULE, 'BROADCAST_STOPPING', 'Stopping broadcast…');
    this._setState(BROADCAST_STATE.STOPPING);
    this._intentionalStop = true;
    this._reconnectManager?.cancel();

    try {
      if (this._transport) {
        await this._transport.stop();
        this._transport = null;
      }
    } catch (err) {
      CloudEngineLogger.warn(MODULE, 'BROADCAST_STOP_WARN',
        `Non-fatal error during stop: ${err.message}`);
    }

    this._setState(BROADCAST_STATE.STOPPED);

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_STOPPED, {
      jobId:  this._currentJobId,
      reason: 'REQUESTED',
    });

    CloudEngineLogger.info(MODULE, 'BROADCAST_STOPPED', 'Broadcast stopped.');
    return _ok('Broadcast stopped.');
  }

  /* ── reconnect() ─────────────────────────────────────────────────── */

  /**
   * Manual reconnect.
   * Tears down the current connection and establishes a fresh one.
   * Only valid when CONNECTED, BROADCASTING, or in an ERROR state with a destination.
   *
   * @returns {Promise<CommandResult>}
   */
  async reconnect() {
    if (this._state !== BROADCAST_STATE.BROADCASTING &&
        this._state !== BROADCAST_STATE.CONNECTED    &&
        this._state !== BROADCAST_STATE.ERROR) {
      return _err(`Cannot reconnect in state "${this._state}"`);
    }

    CloudEngineLogger.info(MODULE, 'BROADCAST_RECONNECTING_MANUAL',
      'Manual reconnect requested.');

    const inputPath   = this._inputPath;
    const activeDest  = this._destManager.getActive();

    if (!activeDest) {
      return _err('No active destination to reconnect to.', {
        code: BROADCAST_ERROR_CODE.DESTINATION_NOT_CONFIGURED,
      });
    }

    // Stop existing transport
    if (this._transport && this._transport.state === TRANSPORT_STATE.RUNNING) {
      this._intentionalStop = true;
      await this._transport.stop();
      this._transport = null;
    }

    this._reconnectManager?.reset();
    this._setState(BROADCAST_STATE.CONNECTED);

    if (inputPath) {
      return this.startBroadcast({ inputPath });
    }

    return _ok('Reconnected — call startBroadcast() with inputPath to resume.');
  }

  /* ── getConnectionStatus() ───────────────────────────────────────── */

  /**
   * Returns the current connection and broadcast status.
   * @returns {object}
   */
  getConnectionStatus() {
    const dest = this._destManager.getActive();
    return {
      connectionStatus:   _mapStateToConnectionStatus(this._state),
      state:              this._state,
      destination:        dest ? safeDestinationInfo(dest) : null,
      connectedAt:        this._metrics.connectedAt,
      broadcastStartedAt: this._metrics.broadcastStartedAt,
      lastError:          this._metrics.lastError,
    };
  }

  /* ── getStatus() ─────────────────────────────────────────────────── */

  /**
   * Full status snapshot.
   * @returns {object}
   */
  getStatus() {
    return {
      state:          this._state,
      destination:    this._destManager.getActive()
                        ? safeDestinationInfo(this._destManager.getActive())
                        : null,
      jobId:          this._currentJobId,
      pid:            this._transport?.pid ?? null,
      reconnect:      this._reconnectManager?.getStatus() ?? null,
    };
  }

  /* ── getMetrics() ────────────────────────────────────────────────── */

  /**
   * Real broadcast metrics snapshot.
   * Never fabricates values — null means "not available".
   * @returns {BroadcastMetrics}
   */
  getMetrics() {
    // Merge live transport data
    if (this._transport) {
      this._metrics.bytesSent  = this._transport.bytesSent > 0
        ? this._transport.bytesSent
        : null;
      this._metrics.pid        = this._transport.pid;
      if (this._transport.connectedAt) {
        this._metrics.connectedAt = new Date(this._transport.connectedAt).toISOString();
      }
    }

    // Merge reconnect data
    const reconnectStatus = this._reconnectManager?.getStatus();
    if (reconnectStatus) {
      this._metrics.reconnectCount = reconnectStatus.attempts;
      this._metrics.lastReconnectAt = reconnectStatus.lastAttemptAt;
    }

    return snapshotMetrics(this._metrics);
  }

  /* ── shutdown() ──────────────────────────────────────────────────── */

  /**
   * Full shutdown — stop broadcasting if active, release all resources.
   * @returns {Promise<CommandResult>}
   */
  async shutdown() {
    CloudEngineLogger.info(MODULE, 'BROADCAST_SHUTDOWN', 'Shadow Broadcast Engine shutting down…');

    this._reconnectManager?.cancel();

    if (this._state === BROADCAST_STATE.BROADCASTING ||
        this._state === BROADCAST_STATE.RECONNECTING) {
      await this.stopBroadcast();
    }

    if (this._transport) {
      try { await this._transport.stop(); } catch { /* best effort */ }
      this._transport = null;
    }

    this._setState(BROADCAST_STATE.STOPPED);
    CloudEngineLogger.info(MODULE, 'BROADCAST_SHUTDOWN_COMPLETE', 'Broadcast Engine shut down.');
    return _ok('Shadow Broadcast Engine shut down.');
  }

  /* ── Transport event wiring ──────────────────────────────────────── */

  _wireTransportEvents() {
    const t = this._transport;
    if (!t) return;

    t.on(TRANSPORT_EVENT.CONNECTED, ({ connectedAt }) => {
      if (this._state === BROADCAST_STATE.BROADCASTING) {
        this._metrics.connectedAt = connectedAt;
        CloudEngineLogger.info(MODULE, 'TRANSPORT_CONNECTED',
          `RTMP handshake confirmed at ${connectedAt}`);
      }
    });

    t.on(TRANSPORT_EVENT.BYTES_SENT, ({ bytesSent }) => {
      this._metrics.bytesSent = bytesSent;
    });

    t.on(TRANSPORT_EVENT.STDERR_LINE, (line) => {
      // Only log actual errors/warnings — not progress noise
      if (line && (line.includes('Error') || line.includes('error') ||
                   line.includes('failed') || line.includes('Failed'))) {
        CloudEngineLogger.warn(MODULE, 'TRANSPORT_STDERR', line);
      }
    });

    t.on(TRANSPORT_EVENT.COMPLETED, () => {
      this._onTransportCompleted();
    });

    t.on(TRANSPORT_EVENT.CRASHED, ({ exitCode, signal, stderr }) => {
      this._onTransportCrashed(exitCode, signal, stderr);
    });

    t.on(TRANSPORT_EVENT.STOPPED, () => {
      // Intentional stop — state already handled by stopBroadcast()
    });

    t.on(TRANSPORT_EVENT.ERROR, (err) => {
      CloudEngineLogger.error(MODULE, 'TRANSPORT_ERROR', err.message);
      if (this._state === BROADCAST_STATE.BROADCASTING) {
        this._onTransportCrashed(null, null, err.message);
      }
    });
  }

  _onTransportCompleted() {
    if (this._state !== BROADCAST_STATE.BROADCASTING) return;

    CloudEngineLogger.info(MODULE, 'TRANSPORT_COMPLETED',
      'Broadcast transport completed normally (input exhausted).');

    this._transport = null;
    this._setState(BROADCAST_STATE.STOPPED);

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_STOPPED, {
      jobId:  this._currentJobId,
      reason: 'COMPLETED',
    });
  }

  _onTransportCrashed(exitCode, signal, stderr) {
    if (this._intentionalStop ||
        this._state === BROADCAST_STATE.STOPPING ||
        this._state === BROADCAST_STATE.STOPPED  ||
        this._state === BROADCAST_STATE.RECONNECTING) {
      return;
    }

    CloudEngineLogger.error(MODULE, 'TRANSPORT_CRASHED',
      `Broadcast transport crashed (exit: ${exitCode}, signal: ${signal ?? 'none'})`,
      { exitCode, signal, stderr: stderr?.slice(0, 200) });

    this._transport = null;

    const err = new BroadcastError(
      BROADCAST_ERROR_CODE.BROADCAST_PROCESS_CRASHED,
      `Broadcast process crashed (exit code: ${exitCode}, signal: ${signal ?? 'none'})`,
      { exitCode, signal },
    );
    this._metrics.lastError = err.toJSON();

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_ERROR, err.toJSON());

    // Attempt auto-reconnect if destination supports it
    const dest = this._destManager.getActive();
    if (dest?.autoReconnect && !this._reconnectManager?.isExhausted) {
      this._initiateAutoReconnect();
    } else {
      this._setError(err);
    }
  }

  _initiateAutoReconnect() {
    this._setState(BROADCAST_STATE.RECONNECTING);

    CloudEngineLogger.info(MODULE, 'BROADCAST_RECONNECTING',
      `Auto-reconnect initiated (attempt ${(this._reconnectManager?.attempts ?? 0) + 1})`);

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_RECONNECTING, {
      attempt:     (this._reconnectManager?.attempts ?? 0) + 1,
      destination: safeDestinationInfo(this._destManager.getActive()),
    });

    const inputPath = this._inputPath;

    this._reconnectManager?.scheduleNext(
      // onAttempt
      async () => {
        try {
          CloudEngineLogger.info(MODULE, 'RECONNECT_ATTEMPT',
            `Reconnect attempt ${this._reconnectManager.attempts}…`);

          this._metrics.reconnectCount = this._reconnectManager.attempts;
          this._metrics.lastReconnectAt = new Date().toISOString();

          this._setState(BROADCAST_STATE.CONNECTED);

          if (inputPath) {
            const result = await this.startBroadcast({ inputPath });
            if (result.success) {
              CloudEngineLogger.info(MODULE, 'BROADCAST_RECONNECTED',
                `Reconnect succeeded (attempt ${this._reconnectManager.attempts}).`);
              CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_RECONNECTED, {
                attempt:     this._reconnectManager.attempts,
                destination: safeDestinationInfo(this._destManager.getActive()),
              });
            } else {
              this._onTransportCrashed(null, null, result.message);
            }
          }
        } catch (err) {
          CloudEngineLogger.error(MODULE, 'RECONNECT_FAILED',
            `Reconnect attempt ${this._reconnectManager.attempts} failed: ${err.message}`);
          this._onTransportCrashed(null, null, err.message);
        }
      },
      // onExhausted
      () => {
        const exhaustedErr = new BroadcastError(
          BROADCAST_ERROR_CODE.RECONNECT_FAILED,
          `Reconnect failed after ${this._reconnectManager.maxAttempts} attempt(s).`,
          { attempts: this._reconnectManager.attempts },
        );
        CloudEngineLogger.error(MODULE, 'RECONNECT_EXHAUSTED',
          exhaustedErr.message);
        CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_ERROR, exhaustedErr.toJSON());
        this._setError(exhaustedErr);
      },
    );
  }
}

/* ═══════════════════════════════════
   HELPERS
═══════════════════════════════════ */

/**
 * Map a BROADCAST_STATE to a human-readable connection status.
 * @param {string} state
 * @returns {string}
 */
function _mapStateToConnectionStatus(state) {
  switch (state) {
    case BROADCAST_STATE.CONNECTED:
    case BROADCAST_STATE.BROADCASTING:
      return 'CONNECTED';
    case BROADCAST_STATE.CONNECTING:
      return 'CONNECTING';
    case BROADCAST_STATE.RECONNECTING:
      return 'RECONNECTING';
    case BROADCAST_STATE.ERROR:
      return 'ERROR';
    case BROADCAST_STATE.UNINITIALIZED:
    case BROADCAST_STATE.READY:
    case BROADCAST_STATE.STOPPED:
    case BROADCAST_STATE.STOPPING:
    case BROADCAST_STATE.COMPLETED:
      return 'DISCONNECTED';
    default:
      return 'DISCONNECTED';
  }
}
