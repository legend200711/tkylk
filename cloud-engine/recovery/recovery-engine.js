/**
 * 24-HOUR CLOUD ENGINE — Recovery Engine
 * cloud-engine/recovery/recovery-engine.js
 *
 * Central recovery orchestrator. Coordinates all recovery subsystems.
 *
 * Architecture:
 *   Watchdog detects failures → emits events
 *   RecoveryEngine receives events → dispatches to correct recovery handler
 *   Each handler applies its bounded policy
 *   Results are tracked in RecoveryMetrics
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

import { FAILURE_TYPE }                    from './recovery-policy.js';
import { RECOVERY_ACTION, RECOVERY_ERROR_CODE, RecoveryError }
  from './recovery-errors.js';
import { SourceRecovery }                  from './source-recovery.js';
import { DestinationRecovery }             from './destination-recovery.js';
import { StationRecovery }                 from './station-recovery.js';
import { StateRecovery }                   from './state-recovery.js';
import { ProcessSupervisor }               from './process-supervisor.js';
import {
  createRecoveryMetrics,
  recordRecoveryAttempt,
  recordRecoverySuccess,
  recordRecoveryFailure,
  recordComponentRestart,
  recordDestinationReconnect,
  snapshotRecoveryMetrics,
} from './recovery-metrics.js';
import { CloudEngineLogger }               from '../logs/logger.js';
import { CloudEngineEventBus }             from '../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS }             from '../core/events.js';

const MODULE = 'recovery/recovery-engine';

/* ═══════════════════════════════════
   RECOVERY ENGINE
═══════════════════════════════════ */
export class RecoveryEngineImpl {
  /**
   * @param {object} [opts]
   * @param {object} [opts.encoder]           ShadowEncoder/ShadowEncoderImpl
   * @param {object} [opts.ingestManager]     IngestManager instance
   * @param {object} [opts.fanOutManager]     FanOutManager instance
   * @param {object} [opts.tvStationManager]  TVStationManager instance
   * @param {object} [opts.hybridManager]     HybridManager instance
   * @param {object} [opts.firebaseControl]   FirebaseControl object
   */
  constructor(opts = {}) {
    this._refs = {
      encoder:          opts.encoder          ?? null,
      ingestManager:    opts.ingestManager    ?? null,
      fanOutManager:    opts.fanOutManager    ?? null,
      tvStationManager: opts.tvStationManager ?? null,
      hybridManager:    opts.hybridManager    ?? null,
      firebaseControl:  opts.firebaseControl  ?? null,
    };

    this._sourceRecovery      = new SourceRecovery();
    this._destinationRecovery = new DestinationRecovery();
    this._stationRecovery     = new StationRecovery();
    this._stateRecovery       = new StateRecovery();
    this._processSupervisor   = new ProcessSupervisor();
    this._metrics             = createRecoveryMetrics();
    this._initialized         = false;
    this._subscriptions       = [];
  }

  /**
   * Initialize the recovery engine.
   * Subscribes to failure events from the global event bus.
   */
  async initialize() {
    if (this._initialized) return { success: true, message: 'Already initialized.' };

    this._wireEventBus();
    this._initialized = true;
    this._metrics.watchdogActive = true;

    CloudEngineLogger.info(MODULE, 'RECOVERY_ENGINE_READY',
      'Recovery engine initialized and listening for failure events.');

    return { success: true, message: 'Recovery engine initialized.' };
  }

  /**
   * Update component references (call after components are initialized).
   * @param {object} refs
   */
  setRefs(refs) {
    Object.assign(this._refs, refs);
  }

  /* ── Recovery Entry Points ─────────────────────────────────── */

  /**
   * Handle encoder crash/failure.
   * @param {object} [opts]
   * @param {string} [opts.failureType]
   * @param {object} [opts.errorContext]
   * @returns {Promise<RecoveryResult>}
   */
  async handleEncoderFailure({ failureType = FAILURE_TYPE.ENCODER_CRASH, errorContext = {} } = {}) {
    const startTime = Date.now();
    recordRecoveryAttempt(this._metrics, 'encoder');

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.RECOVERY_STARTED, {
      component:   'encoder',
      failureType,
    });
    CloudEngineLogger.warn(MODULE, 'ENCODER_RECOVERY_STARTED',
      `Encoder recovery: ${failureType}`);

    try {
      // Clean up orphaned processes
      const orphans = this._processSupervisor.cleanupOrphans();
      if (orphans.length) {
        CloudEngineLogger.info(MODULE, 'ORPHAN_CLEANUP',
          `Cleaned up ${orphans.length} orphaned process(es): ${orphans.join(', ')}`);
      }

      // If encoder exists, attempt restart
      if (this._refs.encoder) {
        const restartResult = await this._restartEncoder(failureType);
        if (restartResult.success) {
          recordRecoverySuccess(this._metrics, Date.now() - startTime);
          recordComponentRestart(this._metrics, 'encoder');
          CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.COMPONENT_RESTARTED ?? 'COMPONENT_RESTARTED', {
            component: 'encoder',
          });
          return restartResult;
        }
      }

      recordRecoveryFailure(this._metrics);
      return {
        success: false,
        action:  RECOVERY_ACTION.ESCALATE,
        message: 'Encoder recovery failed — manual intervention required.',
      };

    } catch (err) {
      recordRecoveryFailure(this._metrics);
      CloudEngineLogger.error(MODULE, 'ENCODER_RECOVERY_ERROR', err.message);
      return {
        success: false,
        action:  RECOVERY_ACTION.ESCALATE,
        message: err.message,
      };
    }
  }

  /**
   * Handle ingest source failure.
   * @param {object} opts
   * @param {string} opts.sessionId
   * @param {string} [opts.failureType]
   * @returns {Promise<RecoveryResult>}
   */
  async handleIngestFailure({ sessionId, failureType = FAILURE_TYPE.INGEST_DISCONNECTED } = {}) {
    const startTime = Date.now();
    recordRecoveryAttempt(this._metrics, 'ingest');

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.RECOVERY_STARTED, {
      component:   'ingest',
      failureType,
      sessionId,
    });

    const result = await this._sourceRecovery.recoverSource({
      sessionId,
      failureType,
      ingestManager: this._refs.ingestManager,
      hybridManager: this._refs.hybridManager,
    });

    if (result.success) {
      recordRecoverySuccess(this._metrics, Date.now() - startTime);
      this._metrics.sourceRecoveryCount++;
      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.RECOVERY_COMPLETED ?? CLOUD_ENGINE_EVENTS.RECOVERY_STARTED, {
        component: 'ingest',
        result:    result.action,
      });
    } else {
      recordRecoveryFailure(this._metrics);
      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.RECOVERY_FAILED, {
        component: 'ingest',
        message:   result.message,
      });
    }

    return result;
  }

  /**
   * Handle destination failure (per-destination, not broadcast-level).
   * @param {object} opts
   * @param {string} opts.destinationId
   * @param {string} [opts.failureType]
   * @returns {Promise<RecoveryResult>}
   */
  async handleDestinationFailure({
    destinationId,
    failureType = FAILURE_TYPE.DESTINATION_DISCONNECTED,
  } = {}) {
    const startTime = Date.now();
    recordRecoveryAttempt(this._metrics, `destination:${destinationId}`);
    recordDestinationReconnect(this._metrics, destinationId);

    const result = await this._destinationRecovery.recoverDestination({
      destinationId,
      failureType,
      fanOutManager: this._refs.fanOutManager,
    });

    if (result.success) {
      recordRecoverySuccess(this._metrics, Date.now() - startTime);
    } else {
      recordRecoveryFailure(this._metrics);

      // Check if all destinations failed → escalate to broadcast-level
      if (this._refs.fanOutManager &&
          this._destinationRecovery.allDestinationsFailed(this._refs.fanOutManager)) {
        CloudEngineLogger.warn(MODULE, 'ALL_DESTINATIONS_FAILED',
          'All destinations failed — emitting broadcast-level failure event');
        CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_ERROR, {
          reason: 'All destinations failed recovery',
        });
      }
    }

    return result;
  }

  /**
   * Handle TV station failure.
   * @param {object} opts
   * @param {string} opts.stationId
   * @param {string} opts.ownerId
   * @returns {Promise<RecoveryResult>}
   */
  async handleStationFailure({ stationId, ownerId } = {}) {
    const startTime = Date.now();
    recordRecoveryAttempt(this._metrics, `station:${stationId}`);

    const result = await this._stationRecovery.recoverStation({
      stationId,
      ownerId,
      tvStationManager: this._refs.tvStationManager,
    });

    if (result.success) {
      recordRecoverySuccess(this._metrics, Date.now() - startTime);
      this._metrics.stationRecoveryCount++;
      CloudEngineEventBus.emit('STATION_RECOVERED', { stationId, ownerId });
    } else {
      recordRecoveryFailure(this._metrics);
    }

    return result;
  }

  /* ── State Persistence ─────────────────────────────────────── */

  /**
   * Save current engine state for restart recovery.
   * @param {object} state  Safe state object (no credentials)
   */
  saveRecoveryState(state) {
    return this._stateRecovery.saveState(state);
  }

  /**
   * Evaluate if persisted state can be safely restored.
   * @param {string} ownerId
   * @returns {{ safe: boolean, reason: string, state: object|null }}
   */
  evaluateRestore(ownerId) {
    return this._stateRecovery.evaluateRestore(ownerId);
  }

  /**
   * Build a recovery plan from persisted state.
   * @param {object} persistedState
   * @param {object} currentState
   * @returns {RecoveryPlan}
   */
  buildRecoveryPlan(persistedState, currentState) {
    return this._stateRecovery.buildRecoveryPlan(persistedState, currentState);
  }

  /** Clear persisted recovery state. */
  clearRecoveryState() {
    this._stateRecovery.clearState();
  }

  /* ── Process Supervisor ────────────────────────────────────── */

  /**
   * Register a process with the supervisor.
   * @param {number} pid
   * @param {string} label
   */
  registerProcess(pid, label) {
    this._processSupervisor.register(pid, label);
  }

  /**
   * Mark a process as exited.
   * @param {number} pid
   */
  markProcessExited(pid) {
    this._processSupervisor.markExited(pid);
  }

  /* ── Metrics & Status ──────────────────────────────────────── */

  /** Returns a safe snapshot of all recovery metrics. */
  getMetrics() {
    return snapshotRecoveryMetrics(this._metrics);
  }

  /** Returns full recovery engine status. */
  getStatus() {
    return {
      initialized:         this._initialized,
      metrics:             snapshotRecoveryMetrics(this._metrics),
      stateRecovery:       this._stateRecovery.getStatus(),
      sourceRecovery:      this._sourceRecovery.getStatus(),
      destinationRecovery: this._destinationRecovery.getStatus(),
      stationRecovery:     this._stationRecovery.getStatus(),
      processSupervision:  this._processSupervisor.getStats(),
    };
  }

  /** Shutdown — unsubscribe all event listeners. */
  async shutdown() {
    for (const unsub of this._subscriptions) {
      try { unsub(); } catch { /* ignore */ }
    }
    this._subscriptions  = [];
    this._initialized    = false;
    this._metrics.watchdogActive = false;
    CloudEngineLogger.info(MODULE, 'RECOVERY_ENGINE_SHUTDOWN', 'Recovery engine shut down.');
    return { success: true };
  }

  /* ── Private ───────────────────────────────────────────────── */

  _wireEventBus() {
    // Listen for ingest disconnections
    this._subscriptions.push(
      CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.INGEST_SOURCE_DISCONNECTED, (payload) => {
        this.handleIngestFailure({
          sessionId:   payload?.sessionId,
          failureType: FAILURE_TYPE.INGEST_DISCONNECTED,
        }).catch(err =>
          CloudEngineLogger.error(MODULE, 'AUTO_RECOVERY_ERROR',
            `Auto-recovery (ingest disconnected): ${err.message}`)
        );
      })
    );

    // Listen for destination exhausted (all reconnect attempts used up)
    this._subscriptions.push(
      CloudEngineEventBus.on(CLOUD_ENGINE_EVENTS.DESTINATION_EXHAUSTED, (payload) => {
        if (payload?.destinationId && this._refs.fanOutManager) {
          CloudEngineLogger.warn(MODULE, 'DESTINATION_EXHAUSTED_EVENT',
            `Destination "${payload.destinationId}" exhausted reconnects.`);
          // Check if all destinations failed
          if (this._destinationRecovery.allDestinationsFailed(this._refs.fanOutManager)) {
            CloudEngineLogger.warn(MODULE, 'ALL_DESTINATIONS_EXHAUSTED',
              'All destinations exhausted — broadcast-level escalation');
            CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.BROADCAST_ERROR, {
              reason: 'All destinations exhausted reconnect attempts.',
            });
          }
        }
      })
    );
  }

  async _restartEncoder(failureType) {
    const encoder = this._refs.encoder;
    if (!encoder) {
      return { success: false, message: 'No encoder reference.' };
    }

    try {
      // Stop encoder if it's in a bad state
      const status = encoder.getStatus?.();
      if (status && status.state !== 'STOPPED' && status.state !== 'UNINITIALIZED') {
        await encoder.stop?.().catch(() => {});
      }

      // Re-initialize
      const initResult = await encoder.initialize?.();
      if (initResult && !initResult.success) {
        return {
          success: false,
          action:  RECOVERY_ACTION.RESTART_COMPONENT,
          message: `Encoder re-initialization failed: ${initResult.message}`,
        };
      }

      return {
        success: true,
        action:  RECOVERY_ACTION.RESTART_COMPONENT,
        message: 'Encoder restarted successfully.',
      };
    } catch (err) {
      return {
        success: false,
        action:  RECOVERY_ACTION.RESTART_COMPONENT,
        message: `Encoder restart threw: ${err.message}`,
      };
    }
  }
}

/* ═══════════════════════════════════
   SHARED INSTANCE
   Replace the Stage 1 placeholder.
═══════════════════════════════════ */
const _engineInstance = new RecoveryEngineImpl();

export const RecoveryEngine = Object.freeze({
  async initialize(opts)        { return _engineInstance.initialize(opts); },
  setRefs(refs)                 { return _engineInstance.setRefs(refs); },
  async handleEncoderFailure(o) { return _engineInstance.handleEncoderFailure(o); },
  async handleIngestFailure(o)  { return _engineInstance.handleIngestFailure(o); },
  async handleDestinationFailure(o) { return _engineInstance.handleDestinationFailure(o); },
  async handleStationFailure(o) { return _engineInstance.handleStationFailure(o); },
  saveRecoveryState(state)      { return _engineInstance.saveRecoveryState(state); },
  evaluateRestore(ownerId)      { return _engineInstance.evaluateRestore(ownerId); },
  buildRecoveryPlan(ps, cs)     { return _engineInstance.buildRecoveryPlan(ps, cs); },
  clearRecoveryState()          { return _engineInstance.clearRecoveryState(); },
  registerProcess(pid, label)   { return _engineInstance.registerProcess(pid, label); },
  markProcessExited(pid)        { return _engineInstance.markProcessExited(pid); },
  getMetrics()                  { return _engineInstance.getMetrics(); },
  getStatus()                   { return _engineInstance.getStatus(); },
  getRecoveryCount()            { return _engineInstance.getMetrics().totalRecoveryAttempts; },
  async reset()                 {
    await _engineInstance.shutdown();
    return _engineInstance.initialize();
  },
  async shutdown()              { return _engineInstance.shutdown(); },
  _instance:                    _engineInstance,  // for testing only
});
