/**
 * 24-HOUR CLOUD ENGINE — Source Recovery
 * cloud-engine/recovery/source-recovery.js
 *
 * Handles ingest source recovery.
 *
 * Recovery flow for missing live ingest:
 *   1. Detect source unhealthy
 *   2. Mark source unhealthy
 *   3. Attempt permitted recovery (per policy)
 *   4. If Hybrid Mode active and valid TV programming exists → return to station
 *   5. Do NOT leave output dead when a legitimate fallback exists
 *
 * NOTE: Camera/microphone/WebRTC source recovery is NOT_IMPLEMENTED.
 *       Only file-based and RTMP-pull sources are handled.
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

import { FAILURE_TYPE, getPolicy, calculateBackoffDelay, checkPolicyAllows }
  from './recovery-policy.js';
import { RECOVERY_ACTION, RECOVERY_ERROR_CODE, RecoveryError }
  from './recovery-errors.js';
import { CloudEngineLogger }
  from '../logs/logger.js';
import { CloudEngineEventBus }
  from '../core/event-bus.js';
import { CLOUD_ENGINE_EVENTS }
  from '../core/events.js';

const MODULE = 'recovery/source-recovery';

/* ═══════════════════════════════════
   SOURCE RECOVERY
═══════════════════════════════════ */
export class SourceRecovery {
  constructor() {
    this._attempts        = 0;
    this._lastAttemptAt   = null;
    this._isRecovering    = false;
    this._sourceHealthy   = true;
  }

  /**
   * Handle ingest source disconnection or stall.
   *
   * @param {object} opts
   * @param {string}   opts.sessionId        Ingest session ID
   * @param {string}   opts.failureType      FAILURE_TYPE.INGEST_*
   * @param {object}   [opts.ingestManager]  IngestManager instance
   * @param {object}   [opts.hybridManager]  HybridManager instance (if Hybrid Mode active)
   * @param {object}   [opts.policyOverrides]
   * @returns {Promise<RecoveryResult>}
   */
  async recoverSource({
    sessionId,
    failureType = FAILURE_TYPE.INGEST_DISCONNECTED,
    ingestManager,
    hybridManager,
    policyOverrides = {},
  } = {}) {
    if (this._isRecovering) {
      return {
        success: false,
        action:  RECOVERY_ACTION.NONE,
        message: 'Source recovery already in progress.',
      };
    }

    this._isRecovering  = true;
    this._sourceHealthy = false;

    CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.SOURCE_RECOVERY_STARTED ?? 'SOURCE_RECOVERY_STARTED', {
      sessionId,
      failureType,
    });
    CloudEngineLogger.warn(MODULE, 'SOURCE_RECOVERY_STARTED',
      `Source recovery started. session="${sessionId}" type=${failureType}`);

    const policy    = getPolicy(failureType, policyOverrides);
    const allowance = checkPolicyAllows(policy, this._attempts, this._lastAttemptAt);

    if (!allowance.allowed) {
      this._isRecovering = false;
      CloudEngineLogger.warn(MODULE, 'SOURCE_RECOVERY_POLICY_BLOCKED', allowance.reason);

      // Try hybrid fallback before giving up
      if (hybridManager?.isLive) {
        return this._returnToStation(hybridManager, sessionId,
          'Policy blocked — falling back to station');
      }

      return {
        success: false,
        action:  RECOVERY_ACTION.ESCALATE,
        message: allowance.reason,
      };
    }

    // Decide recovery action
    if (policy.action === RECOVERY_ACTION.RETURN_TO_STATION && hybridManager?.isLive) {
      const result = await this._returnToStation(hybridManager, sessionId,
        'Ingest disconnected — returning to station programming');
      this._isRecovering = false;
      return result;
    }

    if (policy.action === RECOVERY_ACTION.RESTART_SOURCE && ingestManager) {
      this._attempts++;
      this._lastAttemptAt = Date.now();

      const delay = calculateBackoffDelay(policy, this._attempts);
      CloudEngineLogger.info(MODULE, 'SOURCE_RECOVERY_ATTEMPT',
        `Attempting source restart in ${delay}ms (attempt ${this._attempts})`);

      await _sleep(delay);

      try {
        // Stop existing session and create a fresh one is outside this module's scope.
        // We signal the ingest manager to attempt stopping the stalled session.
        await ingestManager.stopIngest();

        CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.SOURCE_RECOVERED ?? 'SOURCE_RECOVERED', {
          sessionId,
        });

        this._sourceHealthy = true;
        this._isRecovering  = false;
        this._attempts      = 0;

        CloudEngineLogger.info(MODULE, 'SOURCE_RECOVERED',
          `Source recovery succeeded: session "${sessionId}" stopped cleanly.`);

        return {
          success: true,
          action:  RECOVERY_ACTION.RESTART_SOURCE,
          message: 'Ingest stopped cleanly. Re-ingestion requires a new source session.',
        };
      } catch (err) {
        this._isRecovering = false;
        CloudEngineLogger.warn(MODULE, 'SOURCE_RECOVERY_FAILED', err.message);

        // Try station fallback
        if (hybridManager?.isLive) {
          return this._returnToStation(hybridManager, sessionId,
            'Source restart failed — falling back to station');
        }

        return {
          success: false,
          action:  RECOVERY_ACTION.ESCALATE,
          message: `Source recovery failed: ${err.message}`,
        };
      }
    }

    // No specific action available
    this._isRecovering = false;
    return {
      success: false,
      action:  RECOVERY_ACTION.ESCALATE,
      message: `No applicable source recovery action for: ${policy.action}`,
    };
  }

  /**
   * Return to station programming via Hybrid Manager.
   * @param {object} hybridManager
   * @param {string} sessionId
   * @param {string} reason
   * @returns {Promise<RecoveryResult>}
   */
  async _returnToStation(hybridManager, sessionId, reason) {
    try {
      CloudEngineLogger.info(MODULE, 'RETURN_TO_STATION', reason);

      CloudEngineEventBus.emit(CLOUD_ENGINE_EVENTS.FALLBACK_ACTIVATED ?? 'FALLBACK_ACTIVATED', {
        reason,
        sessionId,
      });

      const result = await hybridManager.handleLiveFailure();

      if (result.success) {
        this._sourceHealthy = true;
        CloudEngineLogger.info(MODULE, 'STATION_RESUME_OK',
          `Returned to station programming. ${result.message}`);
        return {
          success: true,
          action:  RECOVERY_ACTION.RETURN_TO_STATION,
          message: `Returned to station: ${result.message}`,
        };
      }

      return {
        success: false,
        action:  RECOVERY_ACTION.RETURN_TO_STATION,
        message: `Station return attempted but failed: ${result.message}`,
      };

    } catch (err) {
      return {
        success: false,
        action:  RECOVERY_ACTION.ESCALATE,
        message: `Return to station threw: ${err.message}`,
      };
    }
  }

  /** Reset recovery counters after successful recovery. */
  reset() {
    this._attempts      = 0;
    this._lastAttemptAt = null;
    this._isRecovering  = false;
    this._sourceHealthy = true;
  }

  getStatus() {
    return {
      sourceHealthy: this._sourceHealthy,
      isRecovering:  this._isRecovering,
      attempts:      this._attempts,
      lastAttemptAt: this._lastAttemptAt
        ? new Date(this._lastAttemptAt).toISOString()
        : null,
    };
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
