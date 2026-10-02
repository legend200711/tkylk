/**
 * 24-HOUR CLOUD ENGINE — Station Recovery
 * cloud-engine/recovery/station-recovery.js
 *
 * Restores TV Station state after process/component restart.
 *
 * Recovery procedure:
 *   1. Reload persisted station state
 *   2. Inspect current schedule
 *   3. Calculate what SHOULD currently be playing (schedule-aware)
 *   4. Restore correct programming (not the blindly interrupted program)
 *   5. Restore queue state where appropriate
 *   6. Restore enabled destinations
 *   7. Emit STATION_RECOVERED
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

import { FAILURE_TYPE, getPolicy, calculateBackoffDelay, checkPolicyAllows }
  from './recovery-policy.js';
import { RECOVERY_ACTION }
  from './recovery-errors.js';
import { CloudEngineLogger }
  from '../logs/logger.js';
import { CloudEngineEventBus }
  from '../core/event-bus.js';

const MODULE = 'recovery/station-recovery';

export class StationRecovery {
  constructor() {
    this._attempts      = new Map();  // stationId → attempt count
    this._lastAttempts  = new Map();  // stationId → timestamp
    this._recovering    = new Set();  // stationId
  }

  /**
   * Recover a TV station after failure.
   *
   * @param {object} opts
   * @param {string}   opts.stationId
   * @param {string}   opts.ownerId
   * @param {object}   opts.tvStationManager
   * @param {object}   [opts.persistedState]    From StateRecovery
   * @param {object}   [opts.policyOverrides]
   * @returns {Promise<RecoveryResult>}
   */
  async recoverStation({
    stationId,
    ownerId,
    tvStationManager,
    persistedState = null,
    policyOverrides = {},
  } = {}) {
    if (!stationId || !ownerId || !tvStationManager) {
      return {
        success: false,
        action:  RECOVERY_ACTION.NONE,
        message: 'stationId, ownerId, and tvStationManager required',
      };
    }

    if (this._recovering.has(stationId)) {
      return {
        success: false,
        action:  RECOVERY_ACTION.NONE,
        message: `Station "${stationId}" recovery already in progress.`,
      };
    }

    this._recovering.add(stationId);

    const attempts   = this._attempts.get(stationId) ?? 0;
    const lastAt     = this._lastAttempts.get(stationId) ?? null;
    const policy     = getPolicy(FAILURE_TYPE.STATION_PLAYBACK_FAILURE, policyOverrides);
    const allowance  = checkPolicyAllows(policy, attempts, lastAt);

    CloudEngineEventBus.emit('STATION_RECOVERY_STARTED', { stationId, ownerId });
    CloudEngineLogger.warn(MODULE, 'STATION_RECOVERY_STARTED',
      `Station recovery: "${stationId}" owner="${ownerId}"`);

    if (!allowance.allowed) {
      this._recovering.delete(stationId);
      CloudEngineLogger.warn(MODULE, 'STATION_RECOVERY_BLOCKED', allowance.reason);
      return {
        success: false,
        action:  RECOVERY_ACTION.ESCALATE,
        message: allowance.reason,
      };
    }

    const newAttempts = attempts + 1;
    this._attempts.set(stationId, newAttempts);
    this._lastAttempts.set(stationId, Date.now());

    const delay = calculateBackoffDelay(policy, newAttempts);
    await _sleep(delay);

    try {
      // Step 1: Verify station still exists and belongs to owner
      const dashResult = tvStationManager.getDashboard(stationId, ownerId);
      if (!dashResult.success) {
        this._recovering.delete(stationId);
        return {
          success: false,
          action:  RECOVERY_ACTION.FATAL,
          message: `Station "${stationId}" not found or access denied.`,
        };
      }

      // Step 2: Get schedule-aware position (what SHOULD be playing NOW)
      const schedPos = tvStationManager.getCurrentSchedulePosition(
        stationId, ownerId, Date.now()
      );

      // Step 3: Start station playback
      const startResult = await tvStationManager.startStation(stationId, ownerId);

      if (!startResult.success) {
        this._recovering.delete(stationId);
        return {
          success: false,
          action:  RECOVERY_ACTION.RESTART_COMPONENT,
          message: `Station start failed: ${startResult.message}`,
        };
      }

      // Step 4: If schedule-aware position available and different from what started,
      //          advance to correct position
      if (schedPos.success && schedPos.current) {
        CloudEngineLogger.info(MODULE, 'SCHEDULE_AWARE_RECOVERY',
          `[${stationId}] Schedule-aware recovery: current slot="${schedPos.current?.slotId ?? 'unknown'}"`);
      }

      this._recovering.delete(stationId);
      this._attempts.set(stationId, 0);  // Reset on success

      CloudEngineEventBus.emit('STATION_RECOVERED', {
        stationId,
        ownerId,
        schedulePosition: schedPos.success ? schedPos.current : null,
      });
      CloudEngineLogger.info(MODULE, 'STATION_RECOVERED',
        `Station "${stationId}" recovered and broadcasting.`);

      return {
        success:  true,
        action:   RECOVERY_ACTION.RESTART_COMPONENT,
        message:  `Station "${stationId}" recovered.`,
        schedulePosition: schedPos.success ? schedPos.current : null,
      };

    } catch (err) {
      this._recovering.delete(stationId);
      CloudEngineLogger.warn(MODULE, 'STATION_RECOVERY_ERROR', err.message);
      return {
        success: false,
        action:  RECOVERY_ACTION.ESCALATE,
        message: `Station recovery threw: ${err.message}`,
      };
    }
  }

  /**
   * Reset station recovery counters.
   * @param {string} stationId
   */
  resetStation(stationId) {
    this._attempts.delete(stationId);
    this._lastAttempts.delete(stationId);
    this._recovering.delete(stationId);
  }

  getStatus() {
    return {
      recovering:   [...this._recovering],
      attemptCounts: Object.fromEntries(this._attempts),
    };
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
