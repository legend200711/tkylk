/**
 * 24-HOUR CLOUD ENGINE — Watchdog
 * cloud-engine/watchdog/watchdog.js
 *
 * Continuously monitors all engine components.
 * Detects failures and triggers recovery via RecoveryEngine.
 *
 * Monitored:
 *   - Cloud Engine process health
 *   - Shadow Encoder
 *   - Ingest
 *   - Media playback
 *   - Fan-Out Manager
 *   - Each destination session
 *   - Platform connectors
 *   - TV Station
 *   - Hybrid Mode
 *   - Firebase control connection (where configured)
 *
 * Detected failures:
 *   - process crash / encoder crash / encoder stalled / encoder BEHIND
 *   - ingest disconnected / ingest stalled
 *   - destination disconnected / transport crash / repeated reconnect failure
 *   - media playback failure / station playback failure
 *   - hybrid live-source failure / control-plane failure
 *
 * NOT every temporary network issue is treated as a fatal engine failure.
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

import { HealthMonitor, HEALTH_STATUS }   from '../recovery/health-monitor.js';
import { FAILURE_TYPE }                   from '../recovery/recovery-policy.js';
import { RecoveryEngine }                 from '../recovery/recovery-engine.js';
import {
  recordWatchdogCheck,
  recordWatchdogWarning,
  snapshotRecoveryMetrics,
} from '../recovery/recovery-metrics.js';
import { CloudEngineLogger }              from '../logs/logger.js';
import { CloudEngineEventBus }            from '../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS }            from '../core/events.js';
import { COMPONENT_STATUS }              from '../core/state-manager.js';

const MODULE = 'watchdog/watchdog';

/* ═══════════════════════════════════
   WATCHDOG DEFAULTS
═══════════════════════════════════ */
const DEFAULT_CHECK_INTERVAL_MS = 10_000;  // 10 seconds
const DEFAULT_WARNING_THRESHOLD = 2;       // consecutive warnings before action

/* ═══════════════════════════════════
   WATCHDOG IMPLEMENTATION
═══════════════════════════════════ */
class WatchdogImpl {
  /**
   * @param {object} [opts]
   * @param {number}  [opts.checkIntervalMs]  How often to run health checks
   * @param {number}  [opts.warningThreshold] Consecutive warnings before escalating
   */
  constructor(opts = {}) {
    this._checkIntervalMs  = opts.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this._warningThreshold = opts.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;

    this._healthMonitor    = new HealthMonitor();
    this._timer            = null;
    this._active           = false;
    this._checkCount       = 0;
    this._warningCounts    = new Map();   // component → consecutive warning count
    this._refs             = {};
    this._metrics          = RecoveryEngine.getMetrics();
    this._lastReport       = null;
  }

  /**
   * Initialize the watchdog.
   * @param {object} [opts]
   * @param {object} [opts.refs]  Component references { encoder, ingestManager, ... }
   */
  async initialize(opts = {}) {
    if (opts.refs) this._refs = opts.refs;
    CloudEngineLogger.info(MODULE, 'WATCHDOG_INIT',
      `Watchdog initialized. Check interval: ${this._checkIntervalMs}ms`);
    return { success: true, message: 'Watchdog initialized.' };
  }

  /**
   * Set component references.
   * @param {object} refs
   */
  setRefs(refs) {
    this._refs = { ...this._refs, ...refs };
    // Also update the recovery engine
    RecoveryEngine.setRefs(refs);
  }

  /**
   * Start periodic health monitoring.
   * @returns {{ success: boolean, message: string }}
   */
  async start() {
    if (this._active) {
      return { success: false, message: 'Watchdog already running.' };
    }

    // Initialize recovery engine
    await RecoveryEngine.initialize();

    this._active = true;
    this._schedule();

    CloudEngineLogger.info(MODULE, 'WATCHDOG_STARTED',
      `Watchdog started. Monitoring interval: ${this._checkIntervalMs}ms`);

    return {
      success: true,
      message: `Watchdog monitoring active (${this._checkIntervalMs}ms interval).`,
    };
  }

  /**
   * Stop the watchdog.
   * @returns {{ success: boolean, message: string }}
   */
  async stop() {
    if (!this._active) {
      return { success: true, message: 'Watchdog already stopped.' };
    }

    this._active = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    CloudEngineLogger.info(MODULE, 'WATCHDOG_STOPPED', 'Watchdog stopped.');
    return { success: true, message: 'Watchdog stopped.' };
  }

  /**
   * Run a single health check pass immediately.
   * Returns the health report.
   * @returns {HealthReport}
   */
  async runCheck() {
    this._checkCount++;
    const report = this._healthMonitor.check(this._refs);
    this._lastReport = report;

    const m = RecoveryEngine.getMetrics();
    recordWatchdogCheck(m, report.overallStatus !== HEALTH_STATUS.UNHEALTHY);
    // Sync metric reference (snapshotRecoveryMetrics returns a copy, we track live metrics via _instance)
    if (RecoveryEngine._instance) {
      recordWatchdogCheck(RecoveryEngine._instance._metrics, report.overallStatus !== HEALTH_STATUS.UNHEALTHY);
    }

    // Process failures
    for (const failure of report.failures) {
      await this._handleFailure(failure);
    }

    // Process warnings
    for (const warning of report.warnings) {
      await this._handleWarning(warning);
    }

    // Reset warning counts for healthy components
    for (const check of report.checks) {
      if (check.status === HEALTH_STATUS.HEALTHY) {
        this._warningCounts.delete(check.component);
      }
    }

    return report;
  }

  /** @returns {boolean} */
  isActive() {
    return this._active;
  }

  /** Returns current watchdog status (no secrets). */
  getStatus() {
    return {
      active:            this._active,
      checkIntervalMs:   this._checkIntervalMs,
      checkCount:        this._checkCount,
      lastCheckAt:       this._lastReport?.checkedAt ?? null,
      lastOverallStatus: this._lastReport?.overallStatus ?? null,
      status:            this._active ? COMPONENT_STATUS.OK : COMPONENT_STATUS.STOPPED,
      warningCounts:     Object.fromEntries(this._warningCounts),
    };
  }

  async shutdown() {
    await this.stop();
    await RecoveryEngine.shutdown();
    return { success: true };
  }

  /* ── Private ───────────────────────────────────────────────── */

  _schedule() {
    if (!this._active) return;
    this._timer = setTimeout(async () => {
      try {
        await this.runCheck();
      } catch (err) {
        CloudEngineLogger.warn(MODULE, 'WATCHDOG_CHECK_ERROR', err.message);
      }
      this._schedule();
    }, this._checkIntervalMs);
  }

  async _handleFailure(check) {
    CloudEngineLogger.warn(MODULE, 'WATCHDOG_FAILURE',
      `Component UNHEALTHY: ${check.component} — ${check.message}`);

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.WATCHDOG_WARNING, {
      component:   check.component,
      status:      HEALTH_STATUS.UNHEALTHY,
      message:     check.message,
      failureType: check.failureType,
    });

    if (RecoveryEngine._instance) {
      recordWatchdogWarning(RecoveryEngine._instance._metrics);
    }

    // Route to correct recovery handler
    const ft = check.failureType;

    if (!ft) return;

    if (ft === FAILURE_TYPE.ENCODER_CRASH || ft === FAILURE_TYPE.ENCODER_STALLED ||
        ft === FAILURE_TYPE.ENCODER_BEHIND) {
      await RecoveryEngine.handleEncoderFailure({ failureType: ft })
        .catch(err => CloudEngineLogger.error(MODULE, 'ENCODER_RECOVERY_ERROR', err.message));
    }

    else if (ft === FAILURE_TYPE.INGEST_DISCONNECTED || ft === FAILURE_TYPE.INGEST_STALLED) {
      await RecoveryEngine.handleIngestFailure({
        sessionId: check.meta?.sessionId,
        failureType: ft,
      }).catch(err => CloudEngineLogger.error(MODULE, 'INGEST_RECOVERY_ERROR', err.message));
    }

    else if (ft === FAILURE_TYPE.DESTINATION_DISCONNECTED || ft === FAILURE_TYPE.TRANSPORT_CRASH ||
             ft === FAILURE_TYPE.RECONNECT_EXHAUSTED) {
      if (check.meta?.destinationId) {
        await RecoveryEngine.handleDestinationFailure({
          destinationId: check.meta.destinationId,
          failureType:   ft,
        }).catch(err => CloudEngineLogger.error(MODULE, 'DESTINATION_RECOVERY_ERROR', err.message));
      }
    }

    else if (ft === FAILURE_TYPE.STATION_PLAYBACK_FAILURE) {
      if (check.meta?.stationId && check.meta?.ownerId) {
        await RecoveryEngine.handleStationFailure({
          stationId: check.meta.stationId,
          ownerId:   check.meta.ownerId,
        }).catch(err => CloudEngineLogger.error(MODULE, 'STATION_RECOVERY_ERROR', err.message));
      }
    }
  }

  async _handleWarning(check) {
    const count = (this._warningCounts.get(check.component) ?? 0) + 1;
    this._warningCounts.set(check.component, count);

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.WATCHDOG_WARNING, {
      component:   check.component,
      status:      HEALTH_STATUS.WARNING,
      message:     check.message,
      consecutive: count,
    });

    if (RecoveryEngine._instance) {
      recordWatchdogWarning(RecoveryEngine._instance._metrics);
    }

    // Only escalate to recovery after threshold consecutive warnings
    if (count >= this._warningThreshold && check.failureType) {
      CloudEngineLogger.warn(MODULE, 'WARNING_THRESHOLD_REACHED',
        `${check.component} has ${count} consecutive warnings — triggering recovery.`);
      await this._handleFailure({
        ...check,
        status: HEALTH_STATUS.UNHEALTHY,
      });
    } else {
      CloudEngineLogger.debug(MODULE, 'WATCHDOG_WARNING',
        `${check.component}: ${check.message} (warning ${count}/${this._warningThreshold})`);
    }
  }
}

/* ═══════════════════════════════════
   SHARED WATCHDOG INSTANCE
   Replaces the Stage 1 placeholder.
═══════════════════════════════════ */
const _watchdogInstance = new WatchdogImpl();

export const Watchdog = Object.freeze({
  async initialize(opts) { return _watchdogInstance.initialize(opts); },
  async start()          { return _watchdogInstance.start(); },
  async stop()           { return _watchdogInstance.stop(); },
  async runCheck()       { return _watchdogInstance.runCheck(); },
  setRefs(refs)          { return _watchdogInstance.setRefs(refs); },
  isActive()             { return _watchdogInstance.isActive(); },
  getStatus()            { return _watchdogInstance.getStatus(); },
  async shutdown()       { return _watchdogInstance.shutdown(); },
  _instance:             _watchdogInstance,  // for testing only
});

// Also export the WatchdogImpl class for test instantiation
export { WatchdogImpl };
