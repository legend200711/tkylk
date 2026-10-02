/**
 * 24-HOUR CLOUD ENGINE — Recovery Metrics
 * cloud-engine/recovery/recovery-metrics.js
 *
 * Tracks real recovery metrics. Only values that are actually tracked
 * are reported — no fabricated metrics.
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

/* ═══════════════════════════════════
   METRIC SHAPE
═══════════════════════════════════ */

/**
 * Create a fresh recovery metrics object.
 * @returns {RecoveryMetrics}
 */
export function createRecoveryMetrics() {
  return {
    // Counters
    totalRecoveryAttempts:    0,
    successfulRecoveries:     0,
    failedRecoveries:         0,
    componentRestartCount:    0,
    destinationReconnectCount:0,
    sourceRecoveryCount:      0,
    stationRecoveryCount:     0,
    fallbackActivationCount:  0,
    escalationCount:          0,

    // Timestamps
    lastFailureAt:            null,  // ISO string
    lastRecoveryAt:           null,  // ISO string
    lastRecoveryDurationMs:   null,  // number

    // Current state
    currentRecoveryState:     'IDLE',  // IDLE | RECOVERING | FAILED
    activeRecoveries:         0,       // number of concurrent recoveries

    // Per-component failure counters
    componentFailureCounts:   {},   // componentId → number

    // Per-destination reconnect counters
    destinationReconnectCounts: {},  // destinationId → number

    // Watchdog health
    watchdogActive:           false,
    watchdogLastCheck:        null,  // ISO string
    watchdogCheckCount:       0,
    watchdogWarningCount:     0,
    watchdogFailureCount:     0,
  };
}

/**
 * Record a recovery attempt starting.
 * @param {RecoveryMetrics} metrics
 * @param {string} componentId
 */
export function recordRecoveryAttempt(metrics, componentId) {
  metrics.totalRecoveryAttempts++;
  metrics.activeRecoveries++;
  metrics.currentRecoveryState = 'RECOVERING';
  metrics.componentFailureCounts[componentId] =
    (metrics.componentFailureCounts[componentId] ?? 0) + 1;
  metrics.lastFailureAt = new Date().toISOString();
}

/**
 * Record a successful recovery.
 * @param {RecoveryMetrics} metrics
 * @param {number} durationMs
 */
export function recordRecoverySuccess(metrics, durationMs) {
  metrics.successfulRecoveries++;
  metrics.activeRecoveries = Math.max(0, metrics.activeRecoveries - 1);
  metrics.lastRecoveryAt       = new Date().toISOString();
  metrics.lastRecoveryDurationMs = durationMs;
  if (metrics.activeRecoveries === 0) {
    metrics.currentRecoveryState = 'IDLE';
  }
}

/**
 * Record a failed recovery (all attempts exhausted).
 * @param {RecoveryMetrics} metrics
 */
export function recordRecoveryFailure(metrics) {
  metrics.failedRecoveries++;
  metrics.activeRecoveries = Math.max(0, metrics.activeRecoveries - 1);
  metrics.currentRecoveryState =
    metrics.activeRecoveries === 0 ? 'FAILED' : 'RECOVERING';
}

/**
 * Record a component restart.
 * @param {RecoveryMetrics} metrics
 * @param {string} componentId
 */
export function recordComponentRestart(metrics, componentId) {
  metrics.componentRestartCount++;
  metrics.componentFailureCounts[componentId] =
    (metrics.componentFailureCounts[componentId] ?? 0) + 1;
}

/**
 * Record a destination reconnect.
 * @param {RecoveryMetrics} metrics
 * @param {string} destinationId
 */
export function recordDestinationReconnect(metrics, destinationId) {
  metrics.destinationReconnectCount++;
  metrics.destinationReconnectCounts[destinationId] =
    (metrics.destinationReconnectCounts[destinationId] ?? 0) + 1;
}

/**
 * Record a watchdog check.
 * @param {RecoveryMetrics} metrics
 * @param {boolean} healthy
 */
export function recordWatchdogCheck(metrics, healthy) {
  metrics.watchdogCheckCount++;
  metrics.watchdogLastCheck = new Date().toISOString();
  if (!healthy) metrics.watchdogFailureCount++;
}

/**
 * Record a watchdog warning.
 * @param {RecoveryMetrics} metrics
 */
export function recordWatchdogWarning(metrics) {
  metrics.watchdogWarningCount++;
}

/**
 * Returns a safe snapshot of the metrics (no internal mutations).
 * @param {RecoveryMetrics} metrics
 * @returns {object}
 */
export function snapshotRecoveryMetrics(metrics) {
  return {
    totalRecoveryAttempts:      metrics.totalRecoveryAttempts,
    successfulRecoveries:       metrics.successfulRecoveries,
    failedRecoveries:           metrics.failedRecoveries,
    componentRestartCount:      metrics.componentRestartCount,
    destinationReconnectCount:  metrics.destinationReconnectCount,
    sourceRecoveryCount:        metrics.sourceRecoveryCount,
    stationRecoveryCount:       metrics.stationRecoveryCount,
    fallbackActivationCount:    metrics.fallbackActivationCount,
    escalationCount:            metrics.escalationCount,
    lastFailureAt:              metrics.lastFailureAt,
    lastRecoveryAt:             metrics.lastRecoveryAt,
    lastRecoveryDurationMs:     metrics.lastRecoveryDurationMs,
    currentRecoveryState:       metrics.currentRecoveryState,
    activeRecoveries:           metrics.activeRecoveries,
    componentFailureCounts:     { ...metrics.componentFailureCounts },
    destinationReconnectCounts: { ...metrics.destinationReconnectCounts },
    watchdog: {
      active:        metrics.watchdogActive,
      lastCheck:     metrics.watchdogLastCheck,
      checkCount:    metrics.watchdogCheckCount,
      warningCount:  metrics.watchdogWarningCount,
      failureCount:  metrics.watchdogFailureCount,
    },
  };
}
