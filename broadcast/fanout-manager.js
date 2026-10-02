/**
 * 24-HOUR CLOUD ENGINE — Fan-Out Manager
 * cloud-engine/broadcast/fanout-manager.js
 *
 * Manages simultaneous broadcasting to multiple RTMP/RTMPS destinations.
 *
 * Architecture:
 *   Input (FLV path / pipe)
 *     ↓
 *   Fan-Out Manager
 *     ├── DestinationSession A  (YouTube)
 *     ├── DestinationSession B  (Twitch)
 *     ├── DestinationSession C  (Facebook)
 *     └── DestinationSession N  (Custom RTMP/RTMPS)
 *
 * Each destination encodes from the same source input using FFmpeg stream copy,
 * so the source is encoded once upstream and delivered via copy transport to N
 * destinations simultaneously.
 *
 * One destination failure NEVER terminates healthy destinations.
 *
 * Stage 4 — Multi-Platform Fan-Out
 */

import EventEmitter from 'events';
import { DestinationSession, SESSION_STATE, SESSION_EVENT } from './destination-session.js';
import { validateDestination, safeDestinationInfo }        from './destination-manager.js';
import { BroadcastError, BROADCAST_ERROR_CODE }            from './broadcast-errors.js';
import { CloudEngineLogger }                               from '../logs/logger.js';
import { CloudEngineEventBus }                             from '../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS }                             from '../core/events.js';
import { computeMultiBroadcastMetrics }                    from './multi-broadcast-metrics.js';

const MODULE = 'broadcast/fanout-manager';

/* ═══════════════════════════════════
   FANOUT STATES
═══════════════════════════════════ */
export const FANOUT_STATE = Object.freeze({
  IDLE:          'IDLE',
  BROADCASTING:  'BROADCASTING',
  PARTIAL:       'PARTIAL',      // some destinations failed, others running
  STOPPING:      'STOPPING',
  STOPPED:       'STOPPED',
});

/* ═══════════════════════════════════
   FAN-OUT MANAGER CLASS
═══════════════════════════════════ */

export class FanOutManager extends EventEmitter {
  constructor() {
    super();
    this._sessions     = new Map();   // destinationId → DestinationSession
    this._ffmpegPath   = null;
    this._inputPath    = null;
    this._state        = FANOUT_STATE.IDLE;
    this._startedAt    = null;
  }

  /* ── Initialization ───────────────────────────────────── */

  /**
   * Set the FFmpeg binary path.
   * Must be called before startMultiBroadcast().
   * @param {string} ffmpegPath
   */
  setFfmpegPath(ffmpegPath) {
    this._ffmpegPath = ffmpegPath;
  }

  /* ── Destination Management ────────────────────────────── */

  /**
   * Add a destination to the fan-out. Can be called before or during a broadcast.
   * If a broadcast is already running, the new destination starts immediately.
   *
   * @param {object} destination  BroadcastDestination config
   * @param {object} [reconnectPolicy] Optional override
   * @returns {{ success: boolean, message: string }}
   */
  addDestination(destination, reconnectPolicy = {}) {
    try {
      validateDestination(destination);
    } catch (err) {
      return { success: false, message: err.message };
    }

    const { destinationId } = destination;
    if (this._sessions.has(destinationId)) {
      return { success: false, message: `Destination "${destinationId}" already registered.` };
    }

    const session = new DestinationSession({
      destination,
      ffmpegPath:      this._ffmpegPath ?? '',
      inputPath:       this._inputPath  ?? '',
      reconnectPolicy,
    });

    this._wireSession(session);
    this._sessions.set(destinationId, session);

    CloudEngineLogger.info(MODULE, 'DESTINATION_ADDED',
      `Destination added: "${destinationId}"`, safeDestinationInfo(destination));

    return { success: true, message: `Destination "${destinationId}" added.` };
  }

  /**
   * Remove a destination from the fan-out.
   * If broadcasting, stops the destination session first.
   *
   * @param {string} destinationId
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async removeDestination(destinationId) {
    const session = this._sessions.get(destinationId);
    if (!session) {
      return { success: false, message: `Destination "${destinationId}" not found.` };
    }

    await session.stop();
    this._sessions.delete(destinationId);

    CloudEngineLogger.info(MODULE, 'DESTINATION_REMOVED',
      `Destination removed: "${destinationId}"`);

    return { success: true, message: `Destination "${destinationId}" removed.` };
  }

  /* ── Multi-Broadcast Lifecycle ─────────────────────────── */

  /**
   * Start broadcasting to ALL registered and enabled destinations simultaneously.
   * Each destination starts independently — one failure does not prevent others.
   *
   * @param {object} opts
   * @param {string} opts.inputPath   Path to the encoded FLV (or 'pipe:0').
   * @param {string} opts.ffmpegPath  Path to the FFmpeg binary.
   * @param {string[]} [opts.destinationIds]  Optional: subset of destination IDs to start.
   *                                          Defaults to all registered destinations.
   * @returns {Promise<object>}  Per-destination start results.
   */
  async startMultiBroadcast({ inputPath, ffmpegPath, destinationIds } = {}) {
    if (this._state === FANOUT_STATE.BROADCASTING ||
        this._state === FANOUT_STATE.PARTIAL) {
      return { success: false, message: 'Fan-out already broadcasting.' };
    }

    if (!inputPath) return { success: false, message: 'inputPath is required.' };
    if (!ffmpegPath) return { success: false, message: 'ffmpegPath is required.' };

    this._inputPath  = inputPath;
    this._ffmpegPath = ffmpegPath;
    this._startedAt  = Date.now();
    this._state      = FANOUT_STATE.BROADCASTING;

    // Update session paths
    for (const session of this._sessions.values()) {
      session._inputPath  = inputPath;
      session._ffmpegPath = ffmpegPath;
    }

    const targets = destinationIds
      ? [...this._sessions.values()].filter(s => destinationIds.includes(s.destinationId))
      : [...this._sessions.values()];

    if (targets.length === 0) {
      this._state = FANOUT_STATE.IDLE;
      return { success: false, message: 'No destinations to broadcast to.' };
    }

    CloudEngineLogger.info(MODULE, 'FANOUT_STARTING',
      `Starting fan-out broadcast to ${targets.length} destination(s).`);

    // Start all destinations in parallel, independently
    const results = await Promise.allSettled(
      targets.map(session => session.start().then(r => ({
        destinationId: session.destinationId,
        ...r,
      }))),
    );

    const summary = {};
    for (const r of results) {
      if (r.status === 'fulfilled') {
        summary[r.value.destinationId] = {
          success: r.value.success,
          message: r.value.message,
        };
      } else {
        summary[r.reason?.destinationId ?? 'unknown'] = {
          success: false,
          message: r.reason?.message ?? 'Unknown error',
        };
      }
    }

    const anySuccess = Object.values(summary).some(r => r.success);
    if (!anySuccess) {
      this._state = FANOUT_STATE.STOPPED;
      return { success: false, message: 'All destinations failed to start.', destinations: summary };
    }

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_STARTED, {
      destinationCount: targets.length,
      startedAt: new Date(this._startedAt).toISOString(),
    });

    return { success: true, message: 'Fan-out broadcast started.', destinations: summary };
  }

  /**
   * Stop all destination sessions cleanly.
   * @returns {Promise<object>}
   */
  async stopMultiBroadcast() {
    if (this._state === FANOUT_STATE.STOPPED ||
        this._state === FANOUT_STATE.IDLE) {
      return { success: true, message: 'Fan-out already stopped.' };
    }

    this._state = FANOUT_STATE.STOPPING;
    CloudEngineLogger.info(MODULE, 'FANOUT_STOPPING', 'Stopping all destination sessions.');

    const results = await Promise.allSettled(
      [...this._sessions.values()].map(s => s.stop()),
    );

    this._state = FANOUT_STATE.STOPPED;

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_STOPPED, {
      stoppedAt: new Date().toISOString(),
    });

    CloudEngineLogger.info(MODULE, 'FANOUT_STOPPED', 'All destination sessions stopped.');

    return {
      success: true,
      message: 'Fan-out broadcast stopped.',
      stopped: results.length,
    };
  }

  /**
   * Add a destination and start it immediately if a broadcast is running.
   * @param {object} destination
   * @param {object} [reconnectPolicy]
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async addDestinationToBroadcast(destination, reconnectPolicy = {}) {
    const addResult = this.addDestination(destination, reconnectPolicy);
    if (!addResult.success) return addResult;

    if (this._state === FANOUT_STATE.BROADCASTING ||
        this._state === FANOUT_STATE.PARTIAL) {
      const session = this._sessions.get(destination.destinationId);
      if (session) {
        session._inputPath  = this._inputPath;
        session._ffmpegPath = this._ffmpegPath;
        return session.start();
      }
    }

    return { success: true, message: `Destination "${destination.destinationId}" added (not yet broadcasting).` };
  }

  /**
   * Remove a destination from an active broadcast.
   * Stops the session cleanly without affecting others.
   * @param {string} destinationId
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async removeDestinationFromBroadcast(destinationId) {
    return this.removeDestination(destinationId);
  }

  /**
   * Restart a single destination session without affecting others.
   * @param {string} destinationId
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async restartDestination(destinationId) {
    const session = this._sessions.get(destinationId);
    if (!session) {
      return { success: false, message: `Destination "${destinationId}" not found.` };
    }
    CloudEngineLogger.info(MODULE, 'DESTINATION_RESTART',
      `Restarting destination "${destinationId}".`);
    return session.restart();
  }

  /* ── Status / Metrics ──────────────────────────────────── */

  /**
   * Get status of a single destination (no stream key).
   * @param {string} destinationId
   * @returns {object|null}
   */
  getDestinationStatus(destinationId) {
    const session = this._sessions.get(destinationId);
    return session ? session.getStatus() : null;
  }

  /**
   * Get status of all destinations.
   * @returns {object[]}
   */
  getAllDestinationStatuses() {
    return [...this._sessions.values()].map(s => s.getStatus());
  }

  /**
   * Get aggregate fan-out metrics.
   * @returns {object}
   */
  getMultiBroadcastMetrics() {
    const statuses = [...this._sessions.values()].map(s => s.getStatus());
    return computeMultiBroadcastMetrics(statuses, {
      fanoutState: this._state,
      startedAt:   this._startedAt ? new Date(this._startedAt).toISOString() : null,
    });
  }

  /* ── Private ───────────────────────────────────────────── */

  _wireSession(session) {
    session.on(SESSION_EVENT.STATE_CHANGED, ({ destinationId, from, to }) => {
      CloudEngineLogger.debug(MODULE, 'DESTINATION_STATE',
        `Destination "${destinationId}": ${from} → ${to}`);
      this._updateFanoutState();
    });

    session.on(SESSION_EVENT.ERROR, ({ destinationId, error }) => {
      // Log but do NOT propagate to kill other sessions
      CloudEngineLogger.warn(MODULE, 'DESTINATION_SESSION_ERROR',
        `Destination "${destinationId}" error: ${error.message}`);
      // Emit at fan-out level so consumers can react
      this.emit('destination:error', { destinationId, error });
      this._updateFanoutState();
    });

    session.on(SESSION_EVENT.EXHAUSTED, ({ destinationId }) => {
      CloudEngineLogger.warn(MODULE, 'DESTINATION_EXHAUSTED',
        `Destination "${destinationId}" reconnect attempts exhausted. Other destinations continue.`);
      this.emit('destination:exhausted', { destinationId });
      this._updateFanoutState();
    });

    session.on(SESSION_EVENT.RECONNECTING, (payload) => {
      this.emit('destination:reconnecting', payload);
    });

    session.on(SESSION_EVENT.RECONNECTED, (payload) => {
      this.emit('destination:reconnected', payload);
    });
  }

  _updateFanoutState() {
    if (this._state === FANOUT_STATE.STOPPING ||
        this._state === FANOUT_STATE.STOPPED  ||
        this._state === FANOUT_STATE.IDLE) return;

    const sessions = [...this._sessions.values()];
    if (sessions.length === 0) return;

    const allStopped = sessions.every(s =>
      s.state === SESSION_STATE.STOPPED ||
      s.state === SESSION_STATE.IDLE    ||
      s.state === SESSION_STATE.ERROR   ||
      s.state === SESSION_STATE.EXHAUSTED);

    const anyStopped = sessions.some(s =>
      s.state === SESSION_STATE.STOPPED ||
      s.state === SESSION_STATE.ERROR   ||
      s.state === SESSION_STATE.EXHAUSTED);

    const anyBroadcasting = sessions.some(s =>
      s.state === SESSION_STATE.BROADCASTING ||
      s.state === SESSION_STATE.RECONNECTING ||
      s.state === SESSION_STATE.CONNECTED);

    if (allStopped) {
      this._state = FANOUT_STATE.STOPPED;
    } else if (anyBroadcasting && anyStopped) {
      this._state = FANOUT_STATE.PARTIAL;
    }
  }
}
