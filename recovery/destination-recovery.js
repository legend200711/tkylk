/**
 * 24-HOUR CLOUD ENGINE — Destination Recovery
 * cloud-engine/recovery/destination-recovery.js
 *
 * Handles per-destination recovery.
 *
 * KEY PRINCIPLE:
 *   Each destination is INDEPENDENT.
 *   YouTube failing → YouTube reconnects.
 *   Twitch, Facebook, Custom RTMP remain live.
 *   Do NOT restart the broadcast when one destination fails.
 *   Only escalate to broadcast-level when ALL destinations fail.
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
import { CLOUD_ENGINE_EVENTS }
  from '../core/events.js';

const MODULE = 'recovery/destination-recovery';

/* ═══════════════════════════════════
   DESTINATION RECOVERY MANAGER
   Tracks per-destination recovery state.
═══════════════════════════════════ */
export class DestinationRecovery {
  constructor() {
    this._state = new Map();  // destinationId → DestinationRecoveryState
  }

  /**
   * Handle a destination failure.
   * Attempts reconnect without affecting other destinations.
   *
   * @param {object} opts
   * @param {string}  opts.destinationId
   * @param {string}  opts.failureType      FAILURE_TYPE.*
   * @param {object}  opts.fanOutManager    FanOutManager instance
   * @param {object}  [opts.policyOverrides]
   * @returns {Promise<RecoveryResult>}
   */
  async recoverDestination({
    destinationId,
    failureType = FAILURE_TYPE.DESTINATION_DISCONNECTED,
    fanOutManager,
    policyOverrides = {},
  } = {}) {
    if (!destinationId) {
      return { success: false, action: RECOVERY_ACTION.NONE, message: 'destinationId required' };
    }
    if (!fanOutManager) {
      return { success: false, action: RECOVERY_ACTION.NONE, message: 'fanOutManager required' };
    }

    const state = this._getOrCreate(destinationId);

    if (state.isRecovering) {
      return {
        success: false,
        action:  RECOVERY_ACTION.NONE,
        message: `Recovery already in progress for destination "${destinationId}"`,
      };
    }

    state.isRecovering = true;
    const policy = getPolicy(failureType, policyOverrides);
    const allowance = checkPolicyAllows(policy, state.attempts, state.lastAttemptAt);

    CloudEngineEventBus.emit(
      CLOUD_ENGINE_EVENTS.DESTINATION_RECOVERY_STARTED ?? 'DESTINATION_RECOVERY_STARTED',
      { destinationId, failureType }
    );
    CloudEngineLogger.info(MODULE, 'DESTINATION_RECOVERY_STARTED',
      `Destination recovery: "${destinationId}" — ${failureType}`);

    if (!allowance.allowed) {
      state.isRecovering = false;
      CloudEngineLogger.warn(MODULE, 'DESTINATION_RECOVERY_BLOCKED',
        `${destinationId}: ${allowance.reason}`);
      return {
        success: false,
        action:  RECOVERY_ACTION.ESCALATE,
        message: allowance.reason,
        destinationId,
      };
    }

    // Attempt reconnect
    state.attempts++;
    state.lastAttemptAt = Date.now();

    const delay = calculateBackoffDelay(policy, state.attempts);
    CloudEngineLogger.info(MODULE, 'DESTINATION_RECONNECT_ATTEMPT',
      `Reconnecting "${destinationId}" in ${delay}ms (attempt ${state.attempts})`);

    await _sleep(delay);

    try {
      const result = await fanOutManager.restartDestination(destinationId);

      if (result.success) {
        state.isRecovering   = false;
        state.successCount++;
        state.lastSuccessAt  = Date.now();

        CloudEngineEventBus.emit(
          CLOUD_ENGINE_EVENTS.DESTINATION_RECOVERED ?? 'DESTINATION_RECOVERED',
          { destinationId }
        );
        CloudEngineLogger.info(MODULE, 'DESTINATION_RECOVERED',
          `Destination "${destinationId}" recovered successfully.`);

        return {
          success: true,
          action:  RECOVERY_ACTION.RECONNECT,
          message: `Destination "${destinationId}" recovered.`,
          destinationId,
        };
      } else {
        state.isRecovering = false;
        state.failureCount++;
        CloudEngineLogger.warn(MODULE, 'DESTINATION_RECONNECT_FAILED',
          `${destinationId}: ${result.message}`);

        return {
          success: false,
          action:  RECOVERY_ACTION.RECONNECT,
          message: result.message,
          destinationId,
        };
      }

    } catch (err) {
      state.isRecovering = false;
      state.failureCount++;
      CloudEngineLogger.warn(MODULE, 'DESTINATION_RECOVERY_ERROR',
        `${destinationId}: ${err.message}`);

      return {
        success: false,
        action:  RECOVERY_ACTION.ESCALATE,
        message: err.message,
        destinationId,
      };
    }
  }

  /**
   * Check if all destinations have failed (escalation trigger).
   * @param {object} fanOutManager
   * @returns {boolean}
   */
  allDestinationsFailed(fanOutManager) {
    try {
      const statuses = fanOutManager.getAllDestinationStatuses?.() ?? [];
      if (!statuses.length) return false;

      return statuses.every(s =>
        s.state === 'ERROR' || s.state === 'EXHAUSTED' || s.state === 'STOPPED'
      );
    } catch {
      return false;
    }
  }

  /**
   * Reset recovery state for a destination.
   * @param {string} destinationId
   */
  resetDestination(destinationId) {
    const state = this._state.get(destinationId);
    if (state) {
      state.attempts      = 0;
      state.isRecovering  = false;
      state.lastAttemptAt = null;
    }
  }

  /**
   * Get recovery status for all tracked destinations.
   */
  getStatus() {
    const result = {};
    for (const [id, s] of this._state.entries()) {
      result[id] = {
        attempts:      s.attempts,
        successCount:  s.successCount,
        failureCount:  s.failureCount,
        isRecovering:  s.isRecovering,
        lastAttemptAt: s.lastAttemptAt
          ? new Date(s.lastAttemptAt).toISOString() : null,
        lastSuccessAt: s.lastSuccessAt
          ? new Date(s.lastSuccessAt).toISOString() : null,
      };
    }
    return result;
  }

  _getOrCreate(destinationId) {
    if (!this._state.has(destinationId)) {
      this._state.set(destinationId, {
        destinationId,
        attempts:      0,
        successCount:  0,
        failureCount:  0,
        isRecovering:  false,
        lastAttemptAt: null,
        lastSuccessAt: null,
      });
    }
    return this._state.get(destinationId);
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
