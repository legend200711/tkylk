/**
 * 24-HOUR CLOUD ENGINE — State Recovery
 * cloud-engine/recovery/state-recovery.js
 *
 * Persists and restores recoverable engine state.
 *
 * SECURITY: Stream keys and credentials are NEVER persisted here.
 *            Only safe metadata required to reconstruct engine state.
 *
 * Persisted state includes:
 *   - active broadcast metadata (no keys)
 *   - destination references (IDs only)
 *   - enabled destinations
 *   - station ID + schedule position
 *   - active mode (BROADCAST | STATION | HYBRID)
 *   - source reference (session ID, not path/key)
 *   - owner ID (for ownership validation on restore)
 *   - recovery state
 *   - last known safe state timestamp
 *
 * On restore, the engine asks:
 *   1. WHAT WAS RUNNING?
 *   2. WHAT SHOULD STILL BE RUNNING?
 *   3. IS IT SAFE TO RESTORE? (ownership check)
 *   4. WHAT COMPONENTS NEED RECONNECTION?
 *
 * Stage 12 — Watchdog + Automatic Recovery
 */

import { RECOVERY_ERROR_CODE, RecoveryError } from './recovery-errors.js';
import { CloudEngineLogger }                   from '../logs/logger.js';

const MODULE = 'recovery/state-recovery';

/* ═══════════════════════════════════
   ACTIVE MODES
═══════════════════════════════════ */
export const ACTIVE_MODE = Object.freeze({
  BROADCAST: 'BROADCAST',
  STATION:   'STATION',
  HYBRID:    'HYBRID',
  IDLE:      'IDLE',
});

/* ═══════════════════════════════════
   STATE RECOVERY CLASS
═══════════════════════════════════ */
export class StateRecovery {
  constructor() {
    this._persistedState  = null;
    this._stateVersion    = 0;
  }

  /**
   * Save the current engine state for recovery.
   * ONLY stores safe metadata — never credentials.
   *
   * @param {object} state
   * @param {string}   state.ownerId              Owner of this engine session
   * @param {string}   state.mode                 ACTIVE_MODE.*
   * @param {string}   [state.broadcastId]        Safe broadcast reference
   * @param {string[]} [state.destinationIds]     Destination IDs (no keys)
   * @param {string[]} [state.enabledDestinations]
   * @param {string}   [state.stationId]
   * @param {string}   [state.schedulePosition]   Current schedule slot ID
   * @param {string}   [state.ingestSessionId]    Ingest session reference
   * @param {string}   [state.hybridSessionId]
   * @param {object}   [state.meta]               Safe additional metadata
   * @returns {{ success: boolean, version: number }}
   */
  saveState(state) {
    if (!state.ownerId) {
      return { success: false, message: 'ownerId required to save state.' };
    }
    if (!ACTIVE_MODE[state.mode]) {
      return { success: false, message: `Invalid mode: "${state.mode}".` };
    }

    // Explicitly exclude any credential-like fields
    const safe = {
      version:             ++this._stateVersion,
      savedAt:             new Date().toISOString(),
      ownerId:             state.ownerId,
      mode:                state.mode,
      broadcastId:         state.broadcastId         ?? null,
      destinationIds:      Array.isArray(state.destinationIds)
                             ? [...state.destinationIds] : [],
      enabledDestinations: Array.isArray(state.enabledDestinations)
                             ? [...state.enabledDestinations] : [],
      stationId:           state.stationId           ?? null,
      schedulePosition:    state.schedulePosition    ?? null,
      ingestSessionId:     state.ingestSessionId     ?? null,
      hybridSessionId:     state.hybridSessionId     ?? null,
      meta:                state.meta                ?? {},
      // Explicitly excluded: streamKey, token, password, secret, credential
    };

    this._persistedState = safe;

    CloudEngineLogger.debug(MODULE, 'STATE_SAVED',
      `Recovery state saved. version=${safe.version} mode=${safe.mode} owner=${safe.ownerId}`);

    return { success: true, version: safe.version };
  }

  /**
   * Retrieve the persisted state.
   * Returns null if nothing is saved.
   * @returns {object|null}
   */
  getPersistedState() {
    return this._persistedState ? { ...this._persistedState } : null;
  }

  /**
   * Determine if saved state can safely be restored for the given owner.
   *
   * Validates:
   *   1. State exists
   *   2. State is not too stale (configurable staleness threshold)
   *   3. Owner ID matches
   *
   * If ownership cannot be verified — DO NOT RESTORE.
   *
   * @param {string} requestingOwnerId
   * @param {object} [opts]
   * @param {number} [opts.maxAgeMs]  Max age of persisted state (default: 1 hour)
   * @returns {{ safe: boolean, reason: string, state: object|null }}
   */
  evaluateRestore(requestingOwnerId, { maxAgeMs = 3_600_000 } = {}) {
    if (!this._persistedState) {
      return { safe: false, reason: 'No persisted state found.', state: null };
    }

    const s = this._persistedState;

    // Ownership check — CRITICAL
    if (s.ownerId !== requestingOwnerId) {
      CloudEngineLogger.warn(MODULE, 'OWNERSHIP_MISMATCH',
        `Recovery state ownership mismatch. ` +
        `State owner: ${s.ownerId}, requester: ${requestingOwnerId}. REFUSING RESTORE.`);
      return {
        safe:   false,
        reason: 'Ownership mismatch — recovery refused for safety.',
        state:  null,
      };
    }

    // Staleness check
    const ageMs = Date.now() - new Date(s.savedAt).getTime();
    if (ageMs > maxAgeMs) {
      return {
        safe:   false,
        reason: `State too stale (${Math.floor(ageMs / 60_000)}min old). Manual restart required.`,
        state:  null,
      };
    }

    return {
      safe:   true,
      reason: 'State valid and ownership verified.',
      state:  { ...s },
    };
  }

  /**
   * Determine what recovery actions are needed based on persisted state.
   *
   * @param {object} persistedState  From evaluateRestore()
   * @param {object} currentState    Current live engine status
   * @returns {RecoveryPlan}
   */
  buildRecoveryPlan(persistedState, currentState = {}) {
    const actions = [];

    if (!persistedState) {
      return { actions, summary: 'No persisted state — full restart required.' };
    }

    const mode = persistedState.mode;

    // Determine what needs reconnection
    if (mode === ACTIVE_MODE.BROADCAST || mode === ACTIVE_MODE.HYBRID) {
      if (persistedState.destinationIds?.length) {
        for (const destId of persistedState.destinationIds) {
          const isConnected = currentState.destinationStates?.[destId] === 'BROADCASTING';
          if (!isConnected) {
            actions.push({
              type:    'RECONNECT_DESTINATION',
              target:  destId,
              reason:  'Destination not connected after restart',
            });
          }
        }
      }
    }

    if (mode === ACTIVE_MODE.STATION || mode === ACTIVE_MODE.HYBRID) {
      if (persistedState.stationId) {
        actions.push({
          type:     'RESTORE_STATION',
          target:   persistedState.stationId,
          position: persistedState.schedulePosition,
          reason:   'Station was running — restore from schedule',
        });
      }
    }

    if (mode === ACTIVE_MODE.HYBRID && persistedState.hybridSessionId) {
      // Hybrid live session cannot be auto-restored — ingest reconnect needed
      actions.push({
        type:   'NOTE',
        target: 'hybrid',
        reason: 'Hybrid live session was active — ingest reconnect required before restore',
      });
    }

    const summary = actions.length
      ? `${actions.length} recovery action(s) needed.`
      : 'No recovery actions needed.';

    return { actions, persistedMode: mode, summary };
  }

  /**
   * Clear the persisted state (call after clean shutdown or successful recovery).
   */
  clearState() {
    this._persistedState = null;
    CloudEngineLogger.debug(MODULE, 'STATE_CLEARED', 'Recovery state cleared.');
  }

  /**
   * Get a safe summary of recovery state (for diagnostics — no credentials).
   */
  getStatus() {
    if (!this._persistedState) {
      return { hasPersisted: false, version: this._stateVersion };
    }
    const s = this._persistedState;
    return {
      hasPersisted:        true,
      version:             s.version,
      savedAt:             s.savedAt,
      mode:                s.mode,
      ownerId:             s.ownerId,
      destinationCount:    s.destinationIds?.length ?? 0,
      hasStation:          !!s.stationId,
      hasIngestSession:    !!s.ingestSessionId,
    };
  }
}
