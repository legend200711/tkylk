/**
 * 24-HOUR CLOUD ENGINE — Health Monitor
 * cloud-engine/recovery/health-monitor.js
 *
 * Performs periodic health checks against real component state.
 * Does NOT use fake timers or mock status — reads actual module state.
 *
 * Monitored components:
 *   - Cloud Engine process health
 *   - Shadow Encoder (state, progress, stall detection)
 *   - Ingest (active session, source health)
 *   - Fan-Out Manager (all destination sessions)
 *   - Platform Connectors
 *   - TV Station (playback state)
 *   - Hybrid Mode (takeover state, live ingest)
 *   - Firebase Control (connection status, where configured)
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

import { FAILURE_TYPE }           from './recovery-policy.js';
import { RECOVERY_ERROR_CODE }    from './recovery-errors.js';
import { CloudEngineLogger }      from '../logs/logger.js';

const MODULE = 'recovery/health-monitor';

/* ═══════════════════════════════════
   HEALTH CHECK RESULTS
═══════════════════════════════════ */
export const HEALTH_STATUS = Object.freeze({
  HEALTHY:     'HEALTHY',
  WARNING:     'WARNING',
  UNHEALTHY:   'UNHEALTHY',
  UNKNOWN:     'UNKNOWN',
  NOT_ACTIVE:  'NOT_ACTIVE',  // component not running — not a failure
});

/* ═══════════════════════════════════
   STALL DETECTION THRESHOLDS
═══════════════════════════════════ */
const ENCODER_STALL_THRESHOLD_MS   = 30_000;  // 30s without progress
const INGEST_STALL_THRESHOLD_MS    = 20_000;  // 20s without data
const ENCODER_BEHIND_THRESHOLD_SEC = 5;       // encoder >5s behind realtime

/* ═══════════════════════════════════
   HEALTH MONITOR
═══════════════════════════════════ */
export class HealthMonitor {
  constructor() {
    this._encoderLastProgress  = null;  // { time: ts, position: sec }
    this._ingestLastActivity   = null;  // timestamp ms
  }

  /**
   * Run a complete health check pass on all provided component references.
   *
   * @param {object} refs
   * @param {object}  [refs.encoder]          ShadowEncoder instance or impl
   * @param {object}  [refs.ingestManager]    IngestManager instance
   * @param {object}  [refs.fanOutManager]    FanOutManager instance
   * @param {object}  [refs.platformManager]  PlatformManager instance
   * @param {object}  [refs.tvStationManager] TVStationManager instance
   * @param {object}  [refs.hybridManager]    HybridManager instance
   * @param {object}  [refs.firebaseControl]  FirebaseControl object
   * @returns {HealthReport}
   */
  check(refs = {}) {
    const now    = Date.now();
    const checks = [];

    // ── Encoder ────────────────────────────────────────────────
    if (refs.encoder) {
      checks.push(this._checkEncoder(refs.encoder, now));
    }

    // ── Ingest ─────────────────────────────────────────────────
    if (refs.ingestManager) {
      checks.push(this._checkIngest(refs.ingestManager, now));
    }

    // ── Fan-Out / Destinations ─────────────────────────────────
    if (refs.fanOutManager) {
      const destChecks = this._checkDestinations(refs.fanOutManager);
      checks.push(...destChecks);
    }

    // ── Platform Connectors ────────────────────────────────────
    if (refs.platformManager) {
      checks.push(this._checkPlatforms(refs.platformManager));
    }

    // ── TV Station ─────────────────────────────────────────────
    if (refs.tvStationManager) {
      checks.push(this._checkTvStation(refs.tvStationManager));
    }

    // ── Hybrid Mode ────────────────────────────────────────────
    if (refs.hybridManager) {
      checks.push(this._checkHybrid(refs.hybridManager, now));
    }

    // ── Firebase Control ───────────────────────────────────────
    if (refs.firebaseControl) {
      checks.push(this._checkFirebase(refs.firebaseControl));
    }

    const anyUnhealthy = checks.some(c => c.status === HEALTH_STATUS.UNHEALTHY);
    const anyWarning   = checks.some(c => c.status === HEALTH_STATUS.WARNING);
    const overallStatus = anyUnhealthy ? HEALTH_STATUS.UNHEALTHY
      : anyWarning ? HEALTH_STATUS.WARNING
      : HEALTH_STATUS.HEALTHY;

    return {
      overallStatus,
      checkedAt: new Date(now).toISOString(),
      checks,
      failures: checks.filter(c => c.status === HEALTH_STATUS.UNHEALTHY),
      warnings: checks.filter(c => c.status === HEALTH_STATUS.WARNING),
    };
  }

  /* ── Private check methods ─────────────────────────────────── */

  _checkEncoder(encoder, now) {
    try {
      const status  = encoder.getStatus?.() ?? encoder.getStatus?.();
      const metrics = encoder.getMetrics?.();

      if (!status) {
        return _check('encoder', HEALTH_STATUS.UNKNOWN, 'No status available');
      }

      const state = status.state ?? status.encoderState;

      // If encoder is in ERROR state
      if (state === 'ERROR') {
        return _check('encoder', HEALTH_STATUS.UNHEALTHY,
          'Encoder in ERROR state', FAILURE_TYPE.ENCODER_CRASH, {
            lastError: status.lastError,
          });
      }

      // If encoder is encoding, check for stall
      if (state === 'ENCODING' && metrics) {
        const currentPos = metrics.position ?? metrics.positionSec ?? null;
        if (currentPos !== null) {
          if (this._encoderLastProgress &&
              this._encoderLastProgress.position === currentPos) {
            const stalledMs = now - this._encoderLastProgress.time;
            if (stalledMs > ENCODER_STALL_THRESHOLD_MS) {
              return _check('encoder', HEALTH_STATUS.UNHEALTHY,
                `Encoder stalled: position frozen for ${Math.floor(stalledMs / 1000)}s`,
                FAILURE_TYPE.ENCODER_STALLED, { positionSec: currentPos });
            }
          } else {
            // Progress updated
            this._encoderLastProgress = { time: now, position: currentPos };
          }

          // Check if encoder is running behind realtime
          const fps      = metrics.fps ?? null;
          const bitrate  = metrics.videoBitrate ?? null;
          if (fps !== null && fps < 1 && state === 'ENCODING') {
            return _check('encoder', HEALTH_STATUS.WARNING,
              `Encoder running behind (fps: ${fps})`,
              FAILURE_TYPE.ENCODER_BEHIND, { fps });
          }
        }
      }

      // Uninitialized is not a failure
      if (state === 'UNINITIALIZED' || state === null || state === undefined) {
        return _check('encoder', HEALTH_STATUS.NOT_ACTIVE, 'Encoder not initialized');
      }

      return _check('encoder', HEALTH_STATUS.HEALTHY, `Encoder state: ${state}`);

    } catch (err) {
      CloudEngineLogger.warn(MODULE, 'ENCODER_CHECK_ERROR',
        `Encoder health check threw: ${err.message}`);
      return _check('encoder', HEALTH_STATUS.UNKNOWN, `Check error: ${err.message}`);
    }
  }

  _checkIngest(ingestManager, now) {
    try {
      const status = ingestManager.getStatus?.();
      if (!status) return _check('ingest', HEALTH_STATUS.UNKNOWN, 'No status');

      if (status.state === 'IDLE' || status.state === 'STOPPED') {
        return _check('ingest', HEALTH_STATUS.NOT_ACTIVE, `Ingest: ${status.state}`);
      }

      if (status.state === 'ACTIVE') {
        const activeSource = status.activeSource;
        if (activeSource && activeSource.state === 'ERROR') {
          return _check('ingest', HEALTH_STATUS.UNHEALTHY,
            'Active ingest source in ERROR state',
            FAILURE_TYPE.INGEST_DISCONNECTED,
            { sessionId: status.activeSessionId });
        }

        // Stall detection based on last activity timestamp
        if (this._ingestLastActivity) {
          const stalledMs = now - this._ingestLastActivity;
          if (stalledMs > INGEST_STALL_THRESHOLD_MS) {
            return _check('ingest', HEALTH_STATUS.WARNING,
              `Ingest may be stalled (${Math.floor(stalledMs / 1000)}s since last activity)`,
              FAILURE_TYPE.INGEST_STALLED);
          }
        }
        // Update last activity
        this._ingestLastActivity = now;

        return _check('ingest', HEALTH_STATUS.HEALTHY,
          `Ingest active: session ${status.activeSessionId}`);
      }

      return _check('ingest', HEALTH_STATUS.HEALTHY, `Ingest: ${status.state}`);

    } catch (err) {
      return _check('ingest', HEALTH_STATUS.UNKNOWN, `Check error: ${err.message}`);
    }
  }

  _checkDestinations(fanOutManager) {
    try {
      const statuses = fanOutManager.getAllDestinationStatuses?.() ?? [];
      if (!statuses.length) {
        return [_check('destinations', HEALTH_STATUS.NOT_ACTIVE, 'No destinations registered')];
      }

      return statuses.map(dest => {
        const id = dest.destinationId ?? 'unknown';

        if (dest.state === 'EXHAUSTED') {
          return _check(`destination:${id}`, HEALTH_STATUS.UNHEALTHY,
            `Destination "${id}" reconnect exhausted`,
            FAILURE_TYPE.RECONNECT_EXHAUSTED,
            { destinationId: id });
        }

        if (dest.state === 'ERROR') {
          return _check(`destination:${id}`, HEALTH_STATUS.UNHEALTHY,
            `Destination "${id}" in error state`,
            FAILURE_TYPE.DESTINATION_DISCONNECTED,
            { destinationId: id, lastError: dest.lastError });
        }

        if (dest.state === 'RECONNECTING') {
          return _check(`destination:${id}`, HEALTH_STATUS.WARNING,
            `Destination "${id}" reconnecting (attempt ${dest.reconnectCount})`,
            null,
            { destinationId: id });
        }

        return _check(`destination:${id}`, HEALTH_STATUS.HEALTHY,
          `Destination "${id}": ${dest.state}`);
      });

    } catch (err) {
      return [_check('destinations', HEALTH_STATUS.UNKNOWN, `Check error: ${err.message}`)];
    }
  }

  _checkPlatforms(platformManager) {
    try {
      const summary = platformManager.getStatus?.() ?? platformManager.getSummary?.();
      if (!summary) return _check('platforms', HEALTH_STATUS.UNKNOWN, 'No status');
      return _check('platforms', HEALTH_STATUS.HEALTHY, 'Platform manager reachable');
    } catch (err) {
      return _check('platforms', HEALTH_STATUS.UNKNOWN, `Check error: ${err.message}`);
    }
  }

  _checkTvStation(tvStationManager) {
    try {
      const stations = tvStationManager.listAll?.() ?? [];
      if (!stations.length) {
        return _check('tv-station', HEALTH_STATUS.NOT_ACTIVE, 'No stations registered');
      }

      const problems = [];
      for (const stationId of stations) {
        try {
          const dash = tvStationManager.getDashboard?.(stationId, undefined);
          if (dash?.success && dash.dashboard) {
            const st = dash.dashboard.stationState;
            if (st === 'ERROR') {
              problems.push(`${stationId}:ERROR`);
            }
          }
        } catch { /* skip individual station errors */ }
      }

      if (problems.length) {
        return _check('tv-station', HEALTH_STATUS.UNHEALTHY,
          `Station(s) in error: ${problems.join(', ')}`,
          FAILURE_TYPE.STATION_PLAYBACK_FAILURE);
      }

      return _check('tv-station', HEALTH_STATUS.HEALTHY,
        `${stations.length} station(s) registered`);

    } catch (err) {
      return _check('tv-station', HEALTH_STATUS.UNKNOWN, `Check error: ${err.message}`);
    }
  }

  _checkHybrid(hybridManager, now) {
    try {
      const snap = hybridManager.getStateSnapshot?.();
      if (!snap) return _check('hybrid', HEALTH_STATUS.UNKNOWN, 'No state');

      const state = snap.hybridState ?? snap.state;

      if (state === 'ERROR') {
        return _check('hybrid', HEALTH_STATUS.UNHEALTHY,
          'Hybrid mode in error state',
          FAILURE_TYPE.HYBRID_LIVE_FAILURE);
      }

      return _check('hybrid', HEALTH_STATUS.HEALTHY, `Hybrid state: ${state}`);

    } catch (err) {
      return _check('hybrid', HEALTH_STATUS.UNKNOWN, `Check error: ${err.message}`);
    }
  }

  _checkFirebase(firebaseControl) {
    try {
      const status = firebaseControl.getFirebaseControlStatus?.()
        ?? firebaseControl.getStatus?.();

      if (!status) return _check('firebase', HEALTH_STATUS.UNKNOWN, 'No status');

      if (status.status === 'NOT_CONFIGURED') {
        return _check('firebase', HEALTH_STATUS.NOT_ACTIVE, 'Firebase not configured');
      }

      if (status.connected === false) {
        return _check('firebase', HEALTH_STATUS.WARNING,
          'Firebase control not connected',
          FAILURE_TYPE.CONTROL_PLANE_FAILURE);
      }

      return _check('firebase', HEALTH_STATUS.HEALTHY, 'Firebase control connected');

    } catch (err) {
      return _check('firebase', HEALTH_STATUS.UNKNOWN, `Check error: ${err.message}`);
    }
  }
}

/* ── Helpers ──────────────────────────────────────────────────── */

function _check(component, status, message, failureType = null, meta = {}) {
  return {
    component,
    status,
    message,
    failureType,
    meta,
    checkedAt: new Date().toISOString(),
  };
}
